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
GET /?lat=<lat>&lng=<lng>       → returns alert info at the click point:
    { date, status, statusCode, statusLabel, severity, acres,
      pixelCount, truncated, patchGeometry }
"""
from datetime import date, timedelta

import ee
import google.auth
import functions_framework
from flask import jsonify

FOLDER = 'projects/glad/HLSDIST/current'
PROJECT = 'salish-sea-property-mapper'

# San Juan County bounding box (same as Hansen layer)
SJC_BBOX = [-123.22, 48.40, -122.75, 48.77]

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

# Human-readable labels for the VEG-DIST-STATUS code returned to the client.
STATUS_LABELS = {
    1: 'Provisional alert (first detection)',
    2: 'Confirmed alert (first detection)',
    3: 'Provisional alert (ongoing)',
    4: 'Confirmed alert (ongoing)',
    5: 'Provisional alert (resolved)',
    6: 'Confirmed alert (resolved)',
}

# OPERA's date epoch
DATE_EPOCH = date(2020, 12, 31)

# Same cap as Hansen; ~160 acres at our latitude, comfortably above any
# plausible single disturbance event in San Juan County.
PATCH_MAX_SIZE_PX = 1024

# HLS pixels are 30 m × 30 m in the native UTM projection — square at any latitude.
HLS_PIXEL_AREA_SQM = 30 * 30

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
    """Mosaic one DIST-ALERT band over San Juan County.

    Each per-band ImageCollection at projects/glad/HLSDIST/current/<band>
    exposes its data as a single `b1` band. GLAD does not set
    system:time_start on these images, so filterDate() would drop everything;
    we filter by bounds only and let GLAD's continuous publishing pipeline
    handle freshness (they overwrite `current/` in place).
    """
    region = ee.Geometry.Rectangle(SJC_BBOX)
    coll = ee.ImageCollection(f'{FOLDER}/{band}').filterBounds(region)
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


def _handle_point_request(lat: float, lng: float) -> tuple:
    """Sample DIST-ALERT at a click point and return per-pixel info + patch outline."""
    point = ee.Geometry.Point([lng, lat])

    status_img = _mosaic_band('VEG-DIST-STATUS')
    date_img = _mosaic_band('VEG-DIST-DATE')
    severity_img = _mosaic_band('VEG-ANOM-MAX')

    # Sample all three bands at the click point in one round trip.
    sampled = (
        status_img.rename('status')
        .addBands(date_img.rename('date'))
        .addBands(severity_img.rename('severity'))
        .reduceRegion(reducer=ee.Reducer.first(), geometry=point, scale=30)
        .getInfo()
    )

    status_code = sampled.get('status')
    if not status_code:  # 0 or None → no disturbance recorded here
        return (
            jsonify({'date': None, 'statusCode': 0, 'statusLabel': None}),
            200,
            CORS_HEADERS,
        )

    status_code = int(status_code)
    days_since_epoch = sampled.get('date')
    severity = sampled.get('severity')

    alert_date_str = None
    if days_since_epoch is not None:
        alert_date = DATE_EPOCH + timedelta(days=int(days_since_epoch))
        alert_date_str = alert_date.isoformat()

    # Patch geometry + size: mask of all disturbed pixels (status 1–6), then
    # the 8-connected component containing the click point.
    disturbed_mask = status_img.gte(1).And(status_img.lte(6)).selfMask()

    connected = disturbed_mask.connectedPixelCount(
        maxSize=PATCH_MAX_SIZE_PX, eightConnected=True
    )
    pixel_count = (
        connected.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=30
        ).getInfo().get('b1') or 0
    )
    acres = (pixel_count * HLS_PIXEL_AREA_SQM) / 4046.86
    truncated = pixel_count >= PATCH_MAX_SIZE_PX

    patch_geometry = None
    try:
        labels = disturbed_mask.connectedComponents(
            connectedness=ee.Kernel.square(1), maxSize=PATCH_MAX_SIZE_PX
        ).select('labels')
        label_sample = labels.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=30
        ).getInfo()
        label = label_sample.get('labels')
        if label is not None:
            component_mask = labels.eq(label).selfMask()
            vectors = component_mask.reduceToVectors(
                geometry=point.buffer(2000),
                scale=30,
                geometryType='polygon',
                eightConnected=True,
                bestEffort=True,
                maxPixels=int(1e9),
            ).getInfo()
            features = vectors.get('features', [])
            if features:
                patch_geometry = features[0].get('geometry')
    except Exception:
        # Outline is nice-to-have; absent geometry just means no highlight.
        patch_geometry = None

    return (
        jsonify({
            'date': alert_date_str,
            'statusCode': status_code,
            'statusLabel': STATUS_LABELS.get(status_code, f'Status {status_code}'),
            'severity': round(float(severity), 1) if severity is not None else None,
            'pixelCount': int(pixel_count),
            'acres': round(acres, 2),
            'truncated': truncated,
            'patchGeometry': patch_geometry,
        }),
        200,
        CORS_HEADERS,
    )


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

        lat = request.args.get('lat')
        lng = request.args.get('lng')
        if lat is not None and lng is not None:
            return _handle_point_request(float(lat), float(lng))

        mode = (request.args.get('mode') or 'recency').lower()
        if mode == 'severity':
            return _handle_severity()
        if mode == 'status':
            return _handle_status()
        return _handle_recency()
    except Exception as e:
        return (jsonify({'error': str(e)}), 500, CORS_HEADERS)
