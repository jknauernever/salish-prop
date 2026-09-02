#!/usr/bin/env python3
"""
Merge the Friends/DNR 2007 bull kelp raster-cell polygons (228,964 pieces,
median 1 sq ft) into visible kelp patches.

The source file is a raster converted to vectors: each cell is roughly a foot
across, so drawn as-is the layer is invisible at every zoom (and 400 MB).
This buffers the cells, dissolves them, shrinks back, simplifies, and writes a
small WGS84 GeoJSON of kelp patches with an `acres` attribute.

Usage: python3 scripts/build-kelp-patches.py <input EPSG:2926 json> [output]
"""
import json, sys, time
import numpy as np
import shapely
from shapely.geometry import shape, mapping
from pyproj import Transformer

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else 'public/data/friends-bull-kelp-patches.geojson'
GROW_FT, SHRINK_FT, SIMPLIFY_FT = 20.0, 12.0, 3.0

t0 = time.time()
d = json.load(open(src))
geoms = [shape(f['geometry']) for f in d['features'] if f.get('geometry')]
print(f'loaded {len(geoms):,} cells ({time.time()-t0:.0f}s)', flush=True)
# Cluster first, then dissolve per cluster — one global union of 228k shapes
# takes far too long. Cells within GROW_FT*2 of each other belong together.
tree = shapely.STRtree(geoms)
pairs = tree.query(geoms, predicate='dwithin', distance=GROW_FT * 2)
print(f'{pairs.shape[1]:,} neighbor pairs ({time.time()-t0:.0f}s)', flush=True)
parent = list(range(len(geoms)))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
for a_i, b_i in pairs.T:
    ra, rb = find(int(a_i)), find(int(b_i))
    if ra != rb:
        parent[rb] = ra
groups = {}
for i in range(len(geoms)):
    groups.setdefault(find(i), []).append(i)
print(f'{len(groups):,} clusters ({time.time()-t0:.0f}s)', flush=True)
parts = []
for n, members in enumerate(groups.values()):
    g = shapely.union_all(shapely.buffer(np.array([geoms[i] for i in members], dtype=object), GROW_FT, quad_segs=2))
    g = shapely.simplify(shapely.buffer(g, -SHRINK_FT, quad_segs=2), SIMPLIFY_FT)
    if g.is_empty:
        continue
    for piece in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
        if piece.area > 50:
            parts.append(piece)
    if n % 500 == 0 and n:
        print(f'  {n:,}/{len(groups):,} clusters ({time.time()-t0:.0f}s)', flush=True)
print(f'{len(parts):,} patches ({time.time()-t0:.0f}s)', flush=True)

to_wgs = Transformer.from_crs('EPSG:2926', 'EPSG:4326', always_xy=True)
def wgs(g):
    return shapely.transform(g, lambda xy: np.column_stack(to_wgs.transform(xy[:, 0], xy[:, 1])))
features = []
for i, p in enumerate(sorted(parts, key=lambda g: -g.area)):
    acres = p.area / 43560.0
    w = wgs(p)
    features.append({'type': 'Feature', 'properties': {'id': i + 1, 'acres': round(acres, 3), 'sqft': round(p.area)}, 'geometry': json.loads(json.dumps(mapping(w)))})
# round coordinates to 6 decimals to keep the file small
def rnd(c):
    return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
for f in features:
    f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'])
json.dump({'type': 'FeatureCollection', 'features': features}, open(dst, 'w'), separators=(',', ':'))
import os
print(f'wrote {dst}: {len(features):,} patches, {sum(f["properties"]["acres"] for f in features):.1f} acres, {os.path.getsize(dst)/1e6:.1f} MB ({time.time()-t0:.0f}s)')
