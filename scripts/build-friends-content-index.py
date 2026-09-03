#!/usr/bin/env python3
"""
Merge the harvested corpus (harvest-friends-content.py) with the per-article
enrichment (summary / topics / islands / project match, produced by Claude
from ENRICH-INSTRUCTIONS.md) into the small index the app loads:
public/data/friends-content.json — see src/services/friendsContent.ts.

Usage:  python3 scripts/build-friends-content-index.py <content_dir>
        (<content_dir> holds friends-corpus.json and enrich-*.json)
"""
import glob
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.friends-content')
OUT = os.path.join(ROOT, 'public', 'data', 'friends-content.json')

# Enrichment topic → map layer ids that should surface it
TOPIC_LAYERS = {
    'kelp': ['friends-bull-kelp'],
    'eelgrass': ['friends-deepwater-eelgrass', 'eelgrass', 'friends-herring-spawning'],
    'forage-fish': ['friends-documented-forage-spawning', 'friends-potential-forage-spawning', 'pacific-sand-lance', 'surf-smelt'],
    'herring': ['friends-herring-spawning', 'pacific-herring'],
    'salmon': ['chinook-salmon', 'chum-salmon', 'pink-salmon'],
    'seabirds': ['marbled-murrelet-observations', 'marbled-murrelet-breeding', 'marbled-murrelet-winter', 'ebird-hotspots'],
    'shoreline-armor': ['friends-armor', 'friends-armor-2019', 'friends-armor-change-2019', 'friends-shoreline-geology', 'friends-groins'],
    'docks-and-moorings': ['friends-docks', 'friends-mooring-buoys', 'friends-pilings', 'friends-boat-ramps', 'friends-marine-railway'],
    'restoration': ['friends-projects'],
    'riparian': ['friends-projects', 'ndvi', 'forest-loss', 'opera-dist-alert'],
    'landowner-stewardship': ['tax-parcels', 'friends-shoreline-geology'],
    'water-quality': ['stormwater-pipes'],
    'green-boating': ['friends-mooring-buoys', 'friends-deepwater-eelgrass'],
}

SKIP_IMG = ('logo', 'icon', 'avatar', 'gravatar', 'button', 'badge', 'emoji', 'spacer', 'pixel')


def good_image(im):
    u = (im.get('url') or '').lower()
    if not u.startswith('http') or any(k in u for k in SKIP_IMG):
        return False
    if u.endswith('.svg') or u.endswith('.gif'):
        return False
    try:
        w = int(im.get('width') or 0)
        h = int(im.get('height') or 0)
        if (w and w < 300) or (h and h < 200):
            return False
    except (TypeError, ValueError):
        pass
    return True


def main():
    corpus = json.load(open(os.path.join(DIR, 'friends-corpus.json')))
    enrich = {}
    for p in sorted(glob.glob(os.path.join(DIR, 'enrich-*.json'))):
        for e in json.load(open(p)):
            enrich[e['id']] = e
    # Project pages linked from the Friends' Projects layer always make it in,
    # even the short "in progress" stubs the enrichment pass skipped.
    project_links = set()
    try:
        fp = json.load(open(os.path.join(ROOT, 'public', 'data', 'friends-projects.geojson')))
        project_links = {f['properties'].get('LINK', '').rstrip('/') for f in fp['features'] if f['properties'].get('LINK')}
    except FileNotFoundError:
        pass

    items = {}
    by_url = {}
    for it in corpus['items']:
        e = enrich.get(it['id'])
        if not e and it['url'].rstrip('/') in project_links:
            e = {'summary': it.get('excerpt') or it['text'][:300], 'topics': ['restoration'], 'islands': [], 'places': [],
                 'project_match': '', 'kind': 'project-story', 'quality': 3}
        if not e:
            continue
        feat = it.get('featured')
        images = []
        if feat and good_image(feat):
            images.append({'url': feat['url'], 'caption': feat.get('caption') or ''})
        for im in it.get('images', []):
            if good_image(im) and im['url'] not in {x['url'] for x in images}:
                images.append({'url': im['url'], 'caption': im.get('caption') or ''})
        rec = {
            'id': it['id'],
            'url': it['url'],
            'title': it['title'],
            'date': (it.get('date') or '')[:10],
            'type': it['type'],
            'summary': e.get('summary', '').strip(),
            'topics': e.get('topics', []),
            'islands': e.get('islands', []),
            'places': e.get('places', []),
            'projectMatch': e.get('project_match', '') or '',
            'kind': e.get('kind', 'other'),
            'quality': int(e.get('quality') or 1),
            'image': images[0] if images else None,
            'images': images[:6],
        }
        items[it['id']] = rec
        by_url[it['url'].rstrip('/')] = it['id']

    by_layer = {}
    for rec in items.values():
        for t in rec['topics']:
            for lid in TOPIC_LAYERS.get(t, []):
                by_layer.setdefault(lid, []).append(rec['id'])
    # rank: quality desc, has image, newest
    for lid, ids in by_layer.items():
        uniq = list(dict.fromkeys(ids))
        uniq.sort(key=lambda i: (-items[i]['quality'], 0 if items[i]['image'] else 1, items[i]['date']), reverse=False)
        uniq.sort(key=lambda i: (-items[i]['quality'], 0 if items[i]['image'] else 1))
        by_layer[lid] = uniq[:12]

    out = {'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'items': items, 'byLayer': by_layer, 'byUrl': by_url}
    with open(OUT, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {len(items)} items, {len(by_layer)} layers, {os.path.getsize(OUT)/1024:.0f} KB → {OUT}')
    print('per layer:', {k: len(v) for k, v in sorted(by_layer.items())})
    print('project matches:', sorted({r["projectMatch"] for r in items.values() if r["projectMatch"]}))


if __name__ == '__main__':
    sys.exit(main())
