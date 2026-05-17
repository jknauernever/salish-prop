"""
Cloud Function: Admin config endpoint for the category tree.

Reads from / writes to gs://salish-ndvi-tiles/config/category-tree.json.

Endpoints (same URL, method-switched):
  GET  /          → returns the current tree
  POST /          → validates X-Admin-Token + payload schema, writes new tree

Writes are authenticated with a single shared password stored in the
ADMIN_PASSWORD env var. Constant-time compare to mitigate timing leaks.
"""
import hmac
import json
import os
from datetime import datetime, timezone

import functions_framework
from flask import jsonify
from google.cloud import storage
from jsonschema import validate, ValidationError

BUCKET_NAME = os.environ.get('GCS_BUCKET', 'salish-ndvi-tiles')
CONFIG_PATH = 'config/category-tree.json'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')

ALLOWED_ORIGINS = {
    'https://salishsea.knauernever.com',
    'http://localhost:5173',
    'http://localhost:4173',  # vite preview
}

NODE_SCHEMA = {
    'type': 'object',
    'required': ['id', 'label', 'children'],
    'additionalProperties': False,
    'properties': {
        'id': {'type': 'string', 'pattern': '^[a-z0-9-]+$', 'minLength': 1, 'maxLength': 64},
        'label': {'type': 'string', 'minLength': 1, 'maxLength': 120},
        # Optional list of layer ids assigned to this category. A layer can
        # appear in multiple nodes. Slug pattern matches the layer id convention.
        'layers': {
            'type': 'array',
            'items': {'type': 'string', 'pattern': '^[a-z0-9-]+$', 'minLength': 1, 'maxLength': 64},
            'uniqueItems': True,
        },
        'children': {
            'type': 'array',
            'items': {'$ref': '#/definitions/node'},
        },
    },
}

PAYLOAD_SCHEMA = {
    '$schema': 'http://json-schema.org/draft-07/schema#',
    'type': 'object',
    'required': ['tree'],
    'additionalProperties': True,  # client may echo version/updated_at; server overwrites them
    'properties': {
        'tree': {
            'type': 'array',
            'items': {'$ref': '#/definitions/node'},
        },
    },
    'definitions': {'node': NODE_SCHEMA},
}


def _cors_headers(origin):
    headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
        'Access-Control-Max-Age': '3600',
    }
    if origin and origin in ALLOWED_ORIGINS:
        headers['Access-Control-Allow-Origin'] = origin
        headers['Vary'] = 'Origin'
    return headers


def _collect_ids(nodes, acc):
    for n in nodes:
        acc.append(n['id'])
        _collect_ids(n.get('children', []), acc)


def _validate_payload(payload):
    try:
        validate(payload, PAYLOAD_SCHEMA)
    except ValidationError as e:
        return f'Schema validation failed: {e.message}'
    ids = []
    _collect_ids(payload['tree'], ids)
    if len(ids) != len(set(ids)):
        seen = set()
        dupes = set()
        for i in ids:
            if i in seen:
                dupes.add(i)
            seen.add(i)
        return f'Duplicate category id(s): {", ".join(sorted(dupes))}'
    return None


def _read_current_tree(client):
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(CONFIG_PATH)
    try:
        return json.loads(blob.download_as_text())
    except Exception:
        return {'version': 0, 'updated_at': None, 'tree': []}


def _write_tree(client, tree_data):
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(CONFIG_PATH)
    blob.cache_control = 'no-cache, max-age=0'
    blob.upload_from_string(
        json.dumps(tree_data, indent=2),
        content_type='application/json',
    )
    blob.make_public()


@functions_framework.http
def admin_config(request):
    origin = request.headers.get('Origin')
    cors = _cors_headers(origin)

    if request.method == 'OPTIONS':
        return ('', 204, cors)

    client = storage.Client()

    if request.method == 'GET':
        try:
            current = _read_current_tree(client)
            return (jsonify(current), 200, cors)
        except Exception as e:
            return (jsonify({'error': str(e)}), 500, cors)

    if request.method == 'POST':
        if not ADMIN_PASSWORD:
            return (jsonify({'error': 'Server misconfigured: ADMIN_PASSWORD not set'}), 500, cors)

        token = request.headers.get('X-Admin-Token', '')
        if not hmac.compare_digest(token, ADMIN_PASSWORD):
            return (jsonify({'error': 'Unauthorized'}), 401, cors)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return (jsonify({'error': 'Invalid JSON body'}), 400, cors)

        err = _validate_payload(payload)
        if err:
            return (jsonify({'error': err}), 400, cors)

        current = _read_current_tree(client)
        new_data = {
            'version': int(current.get('version', 0)) + 1,
            'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'tree': payload['tree'],
        }

        try:
            _write_tree(client, new_data)
        except Exception as e:
            return (jsonify({'error': f'Write failed: {e}'}), 500, cors)

        return (jsonify(new_data), 200, cors)

    return (jsonify({'error': 'Method not allowed'}), 405, cors)
