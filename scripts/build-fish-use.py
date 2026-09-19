#!/usr/bin/env python3
"""
Build public/data/fish-use.geojson: the one shoreline file behind all seven
Beamer & Fresh (2012) fish-use layers.

The app used to ship seven byte-identical copies of this dataset (one per
species layer, ~5.4 MB each). Every segment already carries every species'
score, so one file serves them all. This also:
  - drops the low-resolution model columns (LRM_*): Friends only presents the
    high-resolution model (HRM_*),
  - drops Z coordinates and rounds to 6 decimals (~0.1 m).

Priority tiers (moderate / high / highest) are NOT baked in here — the bins
live in src/config/fishUse.ts so there is a single place to change them.

Usage: python3 scripts/build-fish-use.py <source geojson> [output]
  e.g. python3 scripts/build-fish-use.py public/data/chinook-salmon.geojson
"""
import json, sys

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else 'public/data/fish-use.geojson'


def clean(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 6), round(coords[1], 6)]
    return [clean(c) for c in coords]


def dedupe(line):
    out = [line[0]]
    for p in line[1:]:
        if p != out[-1]:
            out.append(p)
    return out if len(out) > 1 else line[:2]


d = json.load(open(src))
features = []
for f in d['features']:
    g = f.get('geometry')
    if not g:
        continue
    coords = clean(g['coordinates'])
    if g['type'] == 'LineString':
        coords = dedupe(coords)
    elif g['type'] == 'MultiLineString':
        coords = [dedupe(l) for l in coords]
    props = {}
    for k, v in (f.get('properties') or {}).items():
        if k.startswith('LRM_'):
            continue
        if isinstance(v, str):
            v = v.strip()
        if v is None or v == '':
            continue
        if k.startswith('HRM_') or k == 'Length_km':
            v = round(float(v), 6)
        props[k] = v
    features.append({'type': 'Feature', 'properties': props, 'geometry': {'type': g['type'], 'coordinates': coords}})

json.dump({'type': 'FeatureCollection', 'features': features}, open(dst, 'w'), separators=(',', ':'))
print(f'{len(features):,} segments -> {dst}')
