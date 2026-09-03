#!/usr/bin/env python3
"""
Split the 133 MB Tax_Parcels.geojson into what the app actually needs once
parcels and buildings render from vector tiles (deck.gl) instead of a full
client-side download:

  <out>/parcels/<FID>.json   one file per parcel: the parcel feature (full
                             geometry + assessor attributes) and the building
                             footprints that intersect it or sit within 60 ft
                             (for the popup's building tab and mini-map)
  public/data/parcel_index.json
                             FID -> [minLng, minLat, maxLng, maxLat, Tax_Area, PIN]
                             a ~1 MB bbox index so point-in-parcel lookups
                             (shared-link restore, address search) and the
                             island percentile index work without the big file

Usage:  python3 scripts/build-parcel-files.py [out_dir]
Then:   gsutil -m -h "Cache-Control:public,max-age=86400" cp -r <out>/parcels gs://salish-ndvi-tiles/
Needs:  shapely>=2 (pip install shapely)
"""
import json
import os
import sys
import time

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.parcel-files')
NEAR_DEG = 60 / 364000.0  # ~60 ft in degrees of latitude


def main():
    t0 = time.time()
    with open(os.path.join(DATA, 'Tax_Parcels.geojson')) as f:
        parcels = json.load(f)['features']
    with open(os.path.join(DATA, 'Building_Footprints.geojson')) as f:
        buildings = json.load(f)['features']
    print(f'loaded {len(parcels):,} parcels, {len(buildings):,} buildings ({time.time() - t0:.0f}s)', flush=True)

    bgeoms = []
    bidx = []
    for i, b in enumerate(buildings):
        g = b.get('geometry')
        if not g:
            continue
        try:
            bgeoms.append(shape(g))
            bidx.append(i)
        except Exception:
            pass
    tree = STRtree(bgeoms)

    out_dir = os.path.join(OUT, 'parcels')
    os.makedirs(out_dir, exist_ok=True)
    index = {}
    n = 0
    for pf in parcels:
        props = pf.get('properties') or {}
        fid = props.get('FID')
        g = pf.get('geometry')
        if fid is None or not g:
            continue
        try:
            pg = shape(g)
        except Exception:
            continue
        if pg.is_empty:
            continue
        minx, miny, maxx, maxy = pg.bounds
        index[str(fid)] = [round(minx, 6), round(miny, 6), round(maxx, 6), round(maxy, 6),
                           str(props.get('Tax_Area') or '').strip(), str(props.get('PIN') or '').strip()]
        near = pg.buffer(NEAR_DEG)
        cands = tree.query(near)
        blds = []
        for c in cands:
            bg = bgeoms[c]
            if bg.intersects(near):
                blds.append(buildings[bidx[c]])
        rec = {'parcel': pf, 'buildings': blds}
        with open(os.path.join(out_dir, f'{fid}.json'), 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        n += 1
        if n % 2000 == 0:
            print(f'  {n:,} parcel files ({time.time() - t0:.0f}s)', flush=True)

    idx_path = os.path.join(DATA, 'parcel_index.json')
    with open(idx_path, 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print(f'wrote {n:,} parcel files to {out_dir} and {idx_path} ({os.path.getsize(idx_path)/1024:.0f} KB) in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    sys.exit(main())
