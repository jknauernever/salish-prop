"""
Cloud Function: Sentinel-2 NDVI dynamic tile server.

Takes a date range, computes a cloud-free Sentinel-2 NDVI composite over
San Juan County, and returns a tile URL that Google Maps can consume directly.

Endpoint: GET /get-tiles?start=2024-06-01&end=2024-08-31
Response: { "tileUrl": "https://earthengine.googleapis.com/v1/.../{z}/{x}/{y}" }
"""
import ee
import google.auth
import functions_framework
from flask import jsonify

# NDVI color palette (matches NAIP layer)
NDVI_VIS = {
    'min': -0.2,
    'max': 0.8,
    'palette': [
        '#d73027',  # bare/water
        '#fc8d59',  # sparse
        '#fee08b',  # low veg
        '#d9ef8b',  # moderate
        '#66bd63',  # healthy
        '#1a9850',  # dense
        '#006837',  # very dense
    ],
}

PROJECT = 'salish-sea-property-mapper'

# Lazy initialization flag
_ee_initialized = False


def _ensure_ee():
    """Initialize Earth Engine lazily on first request."""
    global _ee_initialized
    if _ee_initialized:
        return
    credentials, _ = google.auth.default(
        scopes=['https://www.googleapis.com/auth/earthengine']
    )
    ee.Initialize(credentials, project=PROJECT)
    _ee_initialized = True


def mask_s2_clouds(image):
    """Mask clouds and cloud shadows using the SCL band."""
    scl = image.select('SCL')
    # SCL classes: 3=cloud shadow, 8=cloud medium, 9=cloud high, 10=thin cirrus
    mask = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10))
    return image.updateMask(mask)


@functions_framework.http
def get_tiles(request):
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600',
        }
        return ('', 204, headers)

    cors_headers = {'Access-Control-Allow-Origin': '*'}

    start = request.args.get('start')
    end = request.args.get('end')

    if not start or not end:
        return (jsonify({'error': 'Missing start/end parameters'}), 400, cors_headers)

    try:
        _ensure_ee()

        # San Juan County bounding box
        region = ee.Geometry.Rectangle([-123.22, 48.40, -122.75, 48.77])

        # Build cloud-free Sentinel-2 composite
        s2 = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
              .filterBounds(region)
              .filterDate(start, end)
              .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
              .map(mask_s2_clouds)
              .median())

        # Compute NDVI from B8 (NIR) and B4 (Red) — both at 10m
        ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI')

        # Get tile URL
        map_id = ndvi.getMapId(NDVI_VIS)
        tile_url = map_id['tile_fetcher'].url_format

        return (jsonify({'tileUrl': tile_url}), 200, cors_headers)

    except Exception as e:
        return (jsonify({'error': str(e)}), 500, cors_headers)
