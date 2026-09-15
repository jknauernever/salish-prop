#!/usr/bin/env python3
"""
Simplify the heavy shoreline GeoJSON files in place: Douglas-Peucker with a
0.5 m tolerance (topology-preserving), in a projected CRS so the tolerance is
real metres. At the widths we draw (1–10 px) nothing moves visibly at any
zoom the app reaches, and vertex counts fall by more than half — which is
parse time, memory and GPU upload on every visit.

Usage:  python3 scripts/simplify-geometry.py            (all six files)
        python3 scripts/simplify-geometry.py <file>...   (specific files under public/data)
Needs:  shapely >= 2, pyproj
"""
import json
import os
import sys

from pyproj import Transformer
from shapely import force_2d
from shapely.geometry import shape, mapping
from shapely.ops import transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
TOLERANCE_M = float(os.environ.get('SIMPLIFY_M', '0.5'))
FILES = [
    'friends-shoreline-geology.json',
    'friends-potential-forage-spawning.json',
    'friends-documented-forage-spawning.json',
    'friends-armor.json',
    'friends-armor-change-2019.json',
    'friends-bull-kelp-patches.geojson',
    'friends-deepwater-eelgrass.geojson',
    'friends-herring-spawning.json',
    'Stormwater_Pipes.geojson',
]
# WGS84 <-> NAD83(HARN) Washington North (metres)
TO_M = Transformer.from_crs('EPSG:4326', 'EPSG:2855', always_xy=True).transform
TO_DEG = Transformer.from_crs('EPSG:2855', 'EPSG:4326', always_xy=True).transform


def vertices(geom):
    if geom.geom_type in ('Point',):
        return 1
    if geom.geom_type == 'LineString':
        return len(geom.coords)
    if geom.geom_type == 'Polygon':
        return len(geom.exterior.coords) + sum(len(r.coords) for r in geom.interiors)
    return sum(vertices(g) for g in geom.geoms)


def main():
    names = [a for a in sys.argv[1:]] or FILES
    for name in names:
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            print(f'skip {name}: not found')
            continue
        fc = json.load(open(path))
        before = after = 0
        size0 = os.path.getsize(path)
        for f in fc['features']:
            g = f.get('geometry')
            if not g or g['type'] == 'Point':
                continue
            geom = force_2d(shape(g))
            before += vertices(geom)
            proj = transform(TO_M, geom)
            simp = proj.simplify(TOLERANCE_M, preserve_topology=True)
            if simp.is_empty:
                simp = proj
            back = transform(TO_DEG, simp)
            after += vertices(back)
            out = mapping(back)
            # round to 7 decimals (~1 cm) so the file stays compact
            def rnd(c):
                if isinstance(c[0], (int, float)):
                    return [round(c[0], 7), round(c[1], 7)]
                return [rnd(x) for x in c]
            out['coordinates'] = rnd(out['coordinates'])
            f['geometry'] = out
        with open(path, 'w') as fh:
            json.dump(fc, fh, separators=(',', ':'))
        print(f'{name:42} vertices {before:>9,} → {after:>8,}  ({100 * after / max(before, 1):.0f}%)  size {size0 / 1e6:.1f} → {os.path.getsize(path) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
