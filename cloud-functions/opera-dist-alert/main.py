"""
Cloud Function: OPERA DIST-ALERT (forest disturbance, near-real-time).

Source: GLAD's GEE mirror of NASA OPERA L3 DIST-ALERT HLS V1, published as
a folder of per-band ImageCollections under projects/glad/HLSDIST/current/.

Three visualization modes (switched by `?mode=`):
  - recency  (default): bright-red recent → dark-red older, based on
                        VEG-DIST-DATE (days since 2020-12-31)
  - status            : categorical palette over VEG-DIST-STATUS
                        (1–4 = provisional/confirmed, first/recurrent)
  - severity          : yellow → orange → red ramp over VEG-ANOM-MAX
                        (0–100 % vegetation loss)

GET /                           → returns { tileUrl } for the default mode
GET /?mode=<recency|status|severity>
                                → returns { tileUrl } for that mode
"""
import ee
import google.auth
import functions_framework
from flask import jsonify

FOLDER = 'projects/glad/HLSDIST/current'
PROJECT = 'salish-sea-property-mapper'

# San Juan County bounding box (same as Hansen layer)
SJC_BBOX = [-123.22, 48.40, -122.75, 48.77]

# Earliest alert date GLAD exposes
START_DATE = '2023-01-01'

# OPERA encodes dates as days since 2020-12-31. Recency window we paint:
# anything from day 730 (2023-01-01) onward; brighter = more recent.
DATE_MIN = 730    # ~2023-01-01
DATE_MAX = 2200   # extends ~2027 — auto-comfortable headroom

RECENCY_VIS = {
    'min': DATE_MIN,
    'max': DATE_MAX,
    # dark red (old) → bright red (recent)
    'palette': ['450a0a', '7f1d1d', 'b91c1c', 'dc2626', 'ef4444', 'fb923c', 'fbbf24'],
}

SEVERITY_VIS = {
    'min': 0,
    'max': 100,
    # yellow → orange → red
    'palette': ['fef3c7', 'fde68a', 'fbbf24', 'fb923c', 'ef4444', 'b91c1c'],
}

# VEG-DIST-STATUS values per OPERA L3 DIST-ALERT spec:
#   0 = no disturbance
#   1 = provisional (anomaly), first detection
#   2 = confirmed,  first detection
#   3 = provisional, ongoing
#   4 = confirmed,  ongoing
#   5 = finished provisional
#   6 = finished confirmed
#   7 = no data
STATUS_VIS = {
    'min': 1,
    'max': 6,
    # provisional muted, confirmed bold; first vs. ongoing share hue
    'palette': ['fde68a', 'fb923c', 'fca5a5', 'ef4444', 'b91c1c', '7f1d1d'],
}

CORS_HEADERS = {'Access-Control-Allow-Origin': '*'}

_ee_initialized = False


def _ensure_ee():
    global _ee_initialized
    if _ee_initialized:
        return
    credentials, _ = google.auth.default(
        scopes=['https://www.googleapis.com/auth/earthengine']
    )
    ee.Initialize(credentials, project=PROJECT)
    _ee_initialized = True


def _mosaic_band(band: str) -> ee.Image:
    """Latest-pixel mosaic of one DIST-ALERT band over San Juan County."""
    region = ee.Geometry.Rectangle(SJC_BBOX)
    coll = (
        ee.ImageCollection(f'{FOLDER}/{band}')
        .filterDate(START_DATE, ee.Date(ee.Date.fromYMD(2030, 1, 1)))
        .filterBounds(region)
    )
    return coll.mosaic().clip(region)


def _tile_url(image: ee.Image, vis: dict) -> str:
    map_id = image.visualize(**vis).getMapId()
    return map_id['tile_fetcher'].url_format


def _handle_recency() -> tuple:
    img = _mosaic_band('VEG-DIST-DATE')
    # 0 = no disturbance recorded; mask it out so only alert pixels render.
    img = img.updateMask(img.gte(DATE_MIN))
    return (jsonify({'tileUrl': _tile_url(img, RECENCY_VIS)}), 200, CORS_HEADERS)


def _handle_severity() -> tuple:
    img = _mosaic_band('VEG-ANOM-MAX')
    img = img.updateMask(img.gt(0))
    return (jsonify({'tileUrl': _tile_url(img, SEVERITY_VIS)}), 200, CORS_HEADERS)


def _handle_status() -> tuple:
    # VEG-DIST-STATUS is published as a band within the same folder structure
    # the GLAD viewer derives from VEG-ANOM-MAX + VEG-DIST-CONF + duration.
    # GLAD's mirror exposes it directly at projects/glad/HLSDIST/current/VEG-DIST-STATUS.
    img = _mosaic_band('VEG-DIST-STATUS')
    img = img.updateMask(img.gte(1).And(img.lte(6)))
    return (jsonify({'tileUrl': _tile_url(img, STATUS_VIS)}), 200, CORS_HEADERS)


@functions_framework.http
def get_tiles(request):
    if request.method == 'OPTIONS':
        return ('', 204, {
            **CORS_HEADERS,
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600',
        })

    try:
        _ensure_ee()
        mode = (request.args.get('mode') or 'recency').lower()
        if mode == 'severity':
            return _handle_severity()
        if mode == 'status':
            return _handle_status()
        return _handle_recency()
    except Exception as e:
        return (jsonify({'error': str(e)}), 500, CORS_HEADERS)
