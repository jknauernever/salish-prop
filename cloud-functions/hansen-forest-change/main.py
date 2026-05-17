"""
Cloud Function: Hansen Global Forest Change.

Two modes (same URL, switched by query params):
  GET /                       → returns a tile URL for the loss-by-year viz
  GET /?lat=<lat>&lng=<lng>   → returns { year, acres } for the connected
                                loss patch containing the given point
"""
import math

import ee
import google.auth
import functions_framework
from flask import jsonify

ASSET_ID = 'UMD/hansen/global_forest_change_2025_v1_13'

LOSS_VIS = {
    'min': 1,
    'max': 25,
    'palette': [
        'fee2e2',  # 2001 — pale pink (oldest)
        'fecaca',
        'fca5a5',
        'f87171',
        'ef4444',
        'dc2626',
        'b91c1c',  # 2025 — bright bold red (newest)
    ],
}

PROJECT = 'salish-sea-property-mapper'
SJC_BBOX = [-123.22, 48.40, -122.75, 48.77]

# EE caps connectedPixelCount at 1024. ~1024 Hansen pixels at our latitude
# is roughly 160 acres — comfortably above any plausible single loss event
# in San Juan County. If we ever hit it, we surface the cap to the client.
PATCH_MAX_SIZE_PX = 1024

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


def _handle_tile_url_request():
    region = ee.Geometry.Rectangle(SJC_BBOX)
    forest = ee.Image(ASSET_ID)
    loss = forest.select('loss')
    lossyear = forest.select('lossyear')
    viz = lossyear.updateMask(loss).clip(region).visualize(**LOSS_VIS)
    map_id = viz.getMapId()
    return (jsonify({'tileUrl': map_id['tile_fetcher'].url_format}), 200, CORS_HEADERS)


def _handle_point_request(lat: float, lng: float):
    forest = ee.Image(ASSET_ID)
    lossyear = forest.select('lossyear')
    point = ee.Geometry.Point([lng, lat])

    sampled = lossyear.reduceRegion(
        reducer=ee.Reducer.first(),
        geometry=point,
        scale=30,
    ).getInfo()
    year_offset = sampled.get('lossyear')

    if not year_offset:
        return (jsonify({'year': None, 'acres': 0}), 200, CORS_HEADERS)

    year_offset = int(year_offset)
    year = 2000 + year_offset

    # Build a mask of all pixels with this loss year, then count the
    # connected component (8-neighborhood) that contains the click point.
    year_mask = lossyear.eq(year_offset).selfMask()
    connected = year_mask.connectedPixelCount(
        maxSize=PATCH_MAX_SIZE_PX, eightConnected=True
    )
    count_at_point = connected.reduceRegion(
        reducer=ee.Reducer.first(),
        geometry=point,
        scale=30,
    ).getInfo()
    pixel_count = count_at_point.get('lossyear') or 0

    # Hansen pixels are 1 arc-second in geographic coords. At latitude L,
    # each pixel covers roughly 30.9 m N-S and 30.9 * cos(L) m E-W.
    cos_lat = math.cos(math.radians(lat))
    pixel_area_sqm = 30.9 * 30.9 * cos_lat
    area_sqm = pixel_count * pixel_area_sqm
    acres = area_sqm / 4046.86

    truncated = pixel_count >= PATCH_MAX_SIZE_PX

    # Vectorize the connected component so the client can outline it on the map.
    # connectedComponents labels each component uniquely; sample the label at the
    # click point, mask to that label, and reduce to polygon vectors.
    patch_geometry = None
    try:
        labels = year_mask.connectedComponents(
            connectedness=ee.Kernel.square(1),  # 8-connected
            maxSize=PATCH_MAX_SIZE_PX,
        ).select('labels')
        label_sample = labels.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=30,
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
            )
            vectors_info = vectors.getInfo()
            features = vectors_info.get('features', [])
            if features:
                patch_geometry = features[0].get('geometry')
    except Exception:
        # Outline is nice-to-have; absent geometry just means no highlight on client.
        patch_geometry = None

    return (
        jsonify({
            'year': year,
            'acres': round(acres, 2),
            'pixelCount': pixel_count,
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

        return _handle_tile_url_request()
    except Exception as e:
        return (jsonify({'error': str(e)}), 500, CORS_HEADERS)
