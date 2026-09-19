#!/usr/bin/env python3
"""
Build public/data/tile-manifest.json: which vector tiles exist on GCS.

The parcel and building tilesets only have tiles where there is land, so most
of a San Juan Islands viewport (open water) has none. Without this list the map
requests every tile in view and logs a 404 for each missing one; with it,
DeckLayers answers the missing ones locally and never makes the request.

Format: { "<tileset>": { "<z>": { "<x>": [[yStart, yEnd], ...] } } }  (inclusive y ranges)

Usage: python3 scripts/build-tile-manifest.py      (needs gsutil on PATH)
Re-run whenever the tiles are regenerated.
"""
import json, re, subprocess, sys

BUCKET = 'gs://salish-ndvi-tiles/tiles'
TILESETS = ['parcels', 'buildings']
OUT = 'public/data/tile-manifest.json'

manifest = {}
for name in TILESETS:
    listing = subprocess.run(['gsutil', 'ls', f'{BUCKET}/{name}/**'], capture_output=True, text=True, check=True).stdout
    cols = {}
    for m in re.finditer(r'/(\d+)/(\d+)/(\d+)\.pbf', listing):
        z, x, y = m.groups()
        cols.setdefault(z, {}).setdefault(x, []).append(int(y))
    out = {}
    total = 0
    for z, xs in cols.items():
        out[z] = {}
        for x, ys in xs.items():
            ys.sort()
            total += len(ys)
            ranges, start, prev = [], ys[0], ys[0]
            for y in ys[1:]:
                if y != prev + 1:
                    ranges.append([start, prev])
                    start = y
                prev = y
            ranges.append([start, prev])
            out[z][x] = ranges
    manifest[name] = out
    print(f'{name}: {total:,} tiles', file=sys.stderr)

json.dump(manifest, open(OUT, 'w'), separators=(',', ':'))
print(f'wrote {OUT}', file=sys.stderr)
