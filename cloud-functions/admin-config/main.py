"""
Cloud Function: Admin config endpoint.

Two documents live behind this one function, switched on the request path:

  /          → category tree   (gs://salish-ndvi-tiles/config/category-tree.json)
  /content   → site content    (gs://salish-ndvi-tiles/config/site-content.json)

Each path supports the same method set:
  GET            → returns the current document (public, no auth)
  POST ?verify=1 → checks X-Admin-Token only; 204 / 401, no side effects
  POST           → validates X-Admin-Token + payload, writes the document

Writes are authenticated with a single shared password stored in the
ADMIN_PASSWORD env var. Constant-time compare to mitigate timing leaks.
"""
import hmac
import json
import os
from datetime import datetime, timezone

import functions_framework
import nh3
from flask import jsonify
from google.cloud import storage
from jsonschema import validate, ValidationError

BUCKET_NAME = os.environ.get('GCS_BUCKET', 'salish-ndvi-tiles')
CONFIG_PATH = 'config/category-tree.json'
CONTENT_PATH = 'config/site-content.json'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')

ALLOWED_ORIGINS = {
    'https://salishsea.knauernever.com',
    'http://localhost:5173',
    'http://localhost:4173',  # vite preview
}

# ---------------------------------------------------------------------------
# Category tree
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Site content (rich-text blocks edited in /admin/content)
# ---------------------------------------------------------------------------

# Light formatting only: the editor exposes bold/italic/underline/strike,
# links, bullet + numbered lists, and small headings. Anything else the
# browser could smuggle in (script, style, img, iframe, on* handlers) is
# stripped server-side before the HTML is stored.
CONTENT_ALLOWED_TAGS = {
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'a', 'ul', 'ol', 'li', 'h3', 'h4',
}
CONTENT_ALLOWED_ATTRS = {'a': {'href', 'title', 'target'}}
CONTENT_URL_SCHEMES = {'http', 'https', 'mailto'}
CONTENT_MAX_HTML_LENGTH = 20000

CONTENT_PAYLOAD_SCHEMA = {
    '$schema': 'http://json-schema.org/draft-07/schema#',
    'type': 'object',
    'required': ['landing_intro'],
    'additionalProperties': True,  # client may echo version/updated_at; server overwrites them
    'properties': {
        'landing_intro': {
            'type': 'object',
            'required': ['html'],
            'additionalProperties': False,
            'properties': {
                'html': {'type': 'string', 'maxLength': CONTENT_MAX_HTML_LENGTH},
            },
        },
    },
}


def _sanitize_html(html):
    return nh3.clean(
        html,
        tags=CONTENT_ALLOWED_TAGS,
        attributes=CONTENT_ALLOWED_ATTRS,
        url_schemes=CONTENT_URL_SCHEMES,
        link_rel='noopener noreferrer',
        strip_comments=True,
    )


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

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


def _read_json(client, path, default):
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(path)
    try:
        return json.loads(blob.download_as_text())
    except Exception:
        return default


def _write_json(client, path, data):
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(path)
    blob.cache_control = 'no-cache, max-age=0'
    blob.upload_from_string(
        json.dumps(data, indent=2),
        content_type='application/json',
    )
    blob.make_public()


def _read_current_tree(client):
    return _read_json(client, CONFIG_PATH, {'version': 0, 'updated_at': None, 'tree': []})


def _read_current_content(client):
    return _read_json(
        client, CONTENT_PATH,
        {'version': 0, 'updated_at': None, 'landing_intro': {'html': ''}},
    )


def _now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _check_auth(request, cors):
    """Returns an error response tuple if the request is not authorized, else None."""
    if not ADMIN_PASSWORD:
        return (jsonify({'error': 'Server misconfigured: ADMIN_PASSWORD not set'}), 500, cors)
    token = request.headers.get('X-Admin-Token', '')
    if not hmac.compare_digest(token, ADMIN_PASSWORD):
        return (jsonify({'error': 'Unauthorized'}), 401, cors)
    return None


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _handle_tree(request, client, cors):
    if request.method == 'GET':
        try:
            return (jsonify(_read_current_tree(client)), 200, cors)
        except Exception as e:
            return (jsonify({'error': str(e)}), 500, cors)

    if request.method == 'POST':
        denied = _check_auth(request, cors)
        if denied:
            return denied

        # Verify-only mode: AuthGate uses this to check the password without
        # making any changes. No body required, no side effects.
        if request.args.get('verify') == '1':
            return ('', 204, cors)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return (jsonify({'error': 'Invalid JSON body'}), 400, cors)

        err = _validate_payload(payload)
        if err:
            return (jsonify({'error': err}), 400, cors)

        current = _read_current_tree(client)
        new_data = {
            'version': int(current.get('version', 0)) + 1,
            'updated_at': _now_iso(),
            'tree': payload['tree'],
        }

        try:
            _write_json(client, CONFIG_PATH, new_data)
        except Exception as e:
            return (jsonify({'error': f'Write failed: {e}'}), 500, cors)

        return (jsonify(new_data), 200, cors)

    return (jsonify({'error': 'Method not allowed'}), 405, cors)


def _handle_content(request, client, cors):
    if request.method == 'GET':
        try:
            return (jsonify(_read_current_content(client)), 200, cors)
        except Exception as e:
            return (jsonify({'error': str(e)}), 500, cors)

    if request.method == 'POST':
        denied = _check_auth(request, cors)
        if denied:
            return denied

        if request.args.get('verify') == '1':
            return ('', 204, cors)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return (jsonify({'error': 'Invalid JSON body'}), 400, cors)

        try:
            validate(payload, CONTENT_PAYLOAD_SCHEMA)
        except ValidationError as e:
            return (jsonify({'error': f'Schema validation failed: {e.message}'}), 400, cors)

        current = _read_current_content(client)
        new_data = {
            'version': int(current.get('version', 0)) + 1,
            'updated_at': _now_iso(),
            'landing_intro': {
                'html': _sanitize_html(payload['landing_intro']['html']),
            },
        }

        try:
            _write_json(client, CONTENT_PATH, new_data)
        except Exception as e:
            return (jsonify({'error': f'Write failed: {e}'}), 500, cors)

        return (jsonify(new_data), 200, cors)

    return (jsonify({'error': 'Method not allowed'}), 405, cors)


@functions_framework.http
def admin_config(request):
    origin = request.headers.get('Origin')
    cors = _cors_headers(origin)

    if request.method == 'OPTIONS':
        return ('', 204, cors)

    client = storage.Client()
    path = (request.path or '/').rstrip('/') or '/'

    if path == '/':
        return _handle_tree(request, client, cors)
    if path == '/content':
        return _handle_content(request, client, cors)

    return (jsonify({'error': 'Not found'}), 404, cors)
