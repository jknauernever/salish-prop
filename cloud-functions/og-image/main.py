"""
Cloud Function: og-image — Open Graph preview image for a shared map link.

GET /?c=<lat,lng>&z=<zoom>&b=<basemap>&p=<lat,lng>&q=<lat,lng>

Renders a 1200x630 JPEG:
  * Google Static Maps at the shared center / zoom / basemap, using the same
    Map ID as the live map (so the cloud style — hidden commercial POI labels —
    matches), with a marker on the shared property (p or q).
  * Friends of the San Juans logo in the upper-right corner.
  * A small "Salish Sea Explorer" label bottom-left.

Wired to the site as /api/og by a Vercel route (see vercel.json). The
Static Maps key lives only in this function's env (GOOGLE_STATIC_MAPS_KEY).

Abuse guard: any request with view params must carry `sig`, an HMAC-SHA256
(hex, first 32 chars) over the sorted `k=v` pairs, keyed by OG_SIGNING_SECRET —
only api/share.ts can mint those, so strangers can't burn Static Maps quota
with arbitrary coordinates. Copying a signed URL just replays a cached image.
"""
import hashlib
import hmac
import io
import os
import functions_framework
import requests
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
MAP_ID = os.environ.get('MAP_ID', '4b9b02e605e78fc81946b107')
STATIC_MAPS_KEY = os.environ.get('GOOGLE_STATIC_MAPS_KEY', '')
# Shared with api/share.ts (Vercel). Requests carrying view params must be
# signed; the bare default image (no params) is allowed unsigned.
SIGNING_SECRET = os.environ.get('OG_SIGNING_SECRET', '')
VIEW_PARAMS = ('c', 'z', 'b', 'p', 'q')

DEFAULT_CENTER = (48.605, -123.0)
DEFAULT_ZOOM = 10.8
SITE_NAME = 'Salish Sea Explorer'

TEAL = (13, 79, 79)
SLATE = (44, 62, 80)
WHITE = (255, 255, 255)
BASEMAPS = {'roadmap', 'satellite', 'hybrid', 'terrain'}

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')


def _font(name, size):
    return ImageFont.truetype(os.path.join(ASSETS, name), size)


def _parse_latlng(v):
    if not v:
        return None
    try:
        lat, lng = (float(x) for x in v.split(',', 1))
    except ValueError:
        return None
    if abs(lat) > 90 or abs(lng) > 180:
        return None
    return (lat, lng)


def _fetch_static_map(center, zoom, basemap, marker):
    if not STATIC_MAPS_KEY:
        return None
    params = {
        'center': f'{center[0]},{center[1]}',
        'zoom': str(max(1, min(20, round(zoom)))),
        'size': f'{W // 2}x{H // 2}',
        'scale': '2',
        'maptype': basemap,
        'map_id': MAP_ID,
        'key': STATIC_MAPS_KEY,
    }
    if marker:
        params['markers'] = f'color:0x0D4F4F|{marker[0]},{marker[1]}'
    try:
        r = requests.get('https://maps.googleapis.com/maps/api/staticmap', params=params, timeout=15)
        if r.status_code != 200:
            return None
        return Image.open(io.BytesIO(r.content)).convert('RGBA')
    except Exception:
        return None


def _gradient_band(width, height, color, top_alpha=0, mid_alpha=228, bottom_alpha=250):
    """Vertical gradient: transparent at top → nearly opaque at bottom.
    Built as a 1-px-wide alpha ramp scaled up, so it's fast in pure Python."""
    ramp = Image.new('L', (1, height))
    px = ramp.load()
    for y in range(height):
        t = y / max(1, height - 1)
        if t < 0.4:
            px[0, y] = int(top_alpha + (mid_alpha - top_alpha) * (t / 0.4))
        else:
            px[0, y] = int(mid_alpha + (bottom_alpha - mid_alpha) * ((t - 0.4) / 0.6))
    band = Image.new('RGBA', (width, height), color + (255,))
    band.putalpha(ramp.resize((width, height)))
    return band


def _diagonal_gradient(width, height, c0, c1):
    """Branded fallback background (no map): c0 → c1 left to right."""
    row = Image.new('RGB', (width, 1))
    px = row.load()
    for x in range(width):
        t = x / max(1, width - 1)
        px[x, 0] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return row.resize((width, height)).convert('RGBA')


def render(center, zoom, basemap, marker):
    img = Image.new('RGBA', (W, H), SLATE + (255,))

    map_img = _fetch_static_map(center, zoom, basemap, marker)
    if map_img is not None:
        if map_img.size != (W, H):
            map_img = map_img.resize((W, H), Image.LANCZOS)
        img.alpha_composite(map_img)
    else:
        img.alpha_composite(_diagonal_gradient(W, H, TEAL, SLATE))

    # --- small site name, bottom-left, on a light gradient for legibility ---
    band_h = 120
    img.alpha_composite(_gradient_band(W, band_h, SLATE, top_alpha=0, mid_alpha=120, bottom_alpha=170), (0, H - band_h))
    draw = ImageDraw.Draw(img)
    f_title = _font('SourceSans3-Semibold.ttf', 30)
    draw.text((40, H - 34 - 34), SITE_NAME, font=f_title, fill=WHITE + (240,))

    # --- logo, upper right, on a soft dark pill ---
    try:
        logo = Image.open(os.path.join(ASSETS, 'friends-logo-white.png')).convert('RGBA')
        lh = 86
        lw = int(logo.width * lh / logo.height)
        logo = logo.resize((lw, lh), Image.LANCZOS)
        pad_x, pad_y = 22, 14
        box_w, box_h = lw + 2 * pad_x, lh + 2 * pad_y
        bx1, by1 = W - 32, 28
        bx0, by0 = bx1 - box_w, by1
        overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(overlay).rounded_rectangle(
            (bx0, by0, bx1, by0 + box_h), radius=16, fill=SLATE + (200,)
        )
        img.alpha_composite(overlay)
        img.alpha_composite(logo, (bx0 + pad_x, by0 + pad_y))
    except Exception:
        pass

    # JPEG: satellite imagery compresses ~6x better than PNG, and every
    # social unfurler accepts it. Quality 88 keeps text edges crisp.
    out = io.BytesIO()
    img.convert('RGB').save(out, format='JPEG', quality=88, optimize=True, progressive=True)
    return out.getvalue()


def _verify_sig(args):
    """True if the request is the unsigned default image or carries a valid sig."""
    present = [k for k in VIEW_PARAMS if args.get(k)]
    if not present:
        return True
    if not SIGNING_SECRET:
        return False
    canonical = '&'.join(f'{k}={args.get(k)}' for k in sorted(present))
    expected = hmac.new(SIGNING_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expected, args.get('sig', ''))


@functions_framework.http
def og_image(request):
    args = request.args
    if not _verify_sig(args):
        return ('Forbidden: missing or invalid signature', 403, {'Content-Type': 'text/plain'})
    center = _parse_latlng(args.get('c')) or DEFAULT_CENTER
    try:
        zoom = float(args.get('z', ''))
        if not (1 <= zoom <= 22):
            zoom = DEFAULT_ZOOM
    except ValueError:
        zoom = DEFAULT_ZOOM
    basemap = args.get('b') if args.get('b') in BASEMAPS else 'hybrid'
    marker = _parse_latlng(args.get('p')) or _parse_latlng(args.get('q'))
    png = render(center, zoom, basemap, marker)
    headers = {
        'Content-Type': 'image/jpeg',
        # Same query = same picture; let CDNs hold it for a week.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
    }
    return (png, 200, headers)
