#!/usr/bin/env python3
"""
Precompute per-parcel proximity to Friends of the San Juans nearshore datasets.

For every tax parcel (keyed by FID, same as ndvi_parcel_stats.json) this writes:
  kelp      merged bull kelp patches within KELP_FT of the parcel (count, acres, nearest ft)
  eelgrass  deep-water-edge eelgrass segments within EELGRASS_FT (count, length, depths, sites)
  forage    documented spawning beaches within FORAGE_FT (names, species) + potential beach count
  herring   herring spawning grounds touching the parcel (ADJACENT_FT tolerance)
  shoreform nearest Friends geomorphic shoreform segment within SHOREFORM_FT (class + attributes)

Only parcels with at least one hit are written, so the file stays small. The
property popup reads it (src/services/nearshoreStats.ts) instead of doing live
turf.js queries — which only worked when the (400 MB) kelp layer happened to be
loaded and used a 100 ft buffer that missed offshore features.

Usage:  python3 scripts/compute-nearshore-stats.py
Needs:  shapely>=2, pyproj  (pip install shapely pyproj)
Inputs: public/data/Tax_Parcels.geojson (or the GCS copy), friends-*.json
Output: public/data/nearshore_parcel_stats.json
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')

KELP_FT = 500
EELGRASS_FT = 500
FORAGE_FT = 100
ADJACENT_FT = 10  # tolerance for "touching" herring grounds
SHOREFORM_FT = 50  # nearest Friends shoreform segment (parcel lines vs. shoreline lines rarely coincide exactly)

# WGS84 → NAD83(HARN) / Washington North (US survey feet) so buffers are in feet
TO_FT = Transformer.from_crs('EPSG:4326', 'EPSG:2926', always_xy=True)


def load(name):
    p = os.path.join(DATA, name)
    t = time.time()
    with open(p) as f:
        d = json.load(f)
    feats = d['features']
    print(f'  loaded {name}: {len(feats):,} features ({time.time() - t:.1f}s)', flush=True)
    return feats


def to_ft(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(TO_FT.transform(xy[:, 0], xy[:, 1])))


def geoms_ft(feats):
    out = []
    for f in feats:
        g = f.get('geometry')
        if not g:
            out.append(None)
            continue
        try:
            out.append(to_ft(shape(g)))
        except Exception:
            out.append(None)
    return out


def main():
    t0 = time.time()
    print('Loading data…', flush=True)
    parcels = load('Tax_Parcels.geojson')
    kelp = load('friends-bull-kelp-patches.geojson')  # merged patches, see build-kelp-patches.py
    eel = load('friends-deepwater-eelgrass.geojson')
    doc = load('friends-documented-forage-spawning.json')
    pot = load('friends-potential-forage-spawning.json')
    her = load('friends-herring-spawning.json')
    sf = load('friends-shoreline-geology.json')

    print('Projecting to feet…', flush=True)
    kelp_g = geoms_ft(kelp)
    eel_g = geoms_ft(eel)
    doc_g = geoms_ft(doc)
    pot_g = geoms_ft(pot)
    her_g = geoms_ft(her)
    sf_g = geoms_ft(sf)

    def tree(gs):
        idx = [i for i, g in enumerate(gs) if g is not None and not g.is_empty]
        return STRtree([gs[i] for i in idx]), idx

    kelp_t, kelp_i = tree(kelp_g)
    eel_t, eel_i = tree(eel_g)
    doc_t, doc_i = tree(doc_g)
    pot_t, pot_i = tree(pot_g)
    her_t, her_i = tree(her_g)
    sf_t, sf_i = tree(sf_g)
    print(f'  indexes built ({time.time() - t0:.0f}s)', flush=True)

    def hits(tr, idx, geoms, query_geom, dist_ft):
        """Indices (into the original list) of features within dist_ft of query_geom, with distances."""
        cand = tr.query(query_geom.buffer(dist_ft))
        out = []
        for c in cand:
            i = idx[c]
            d = geoms[i].distance(query_geom)
            if d <= dist_ft:
                out.append((i, d))
        return out

    results = {}
    n_hit = 0
    t1 = time.time()
    for n, pf in enumerate(parcels):
        g = pf.get('geometry')
        if not g:
            continue
        try:
            pg = to_ft(shape(g))
        except Exception:
            continue
        if pg.is_empty:
            continue
        props = pf.get('properties') or {}
        fid = str(props.get('FID', n))
        rec = {}

        kh = hits(kelp_t, kelp_i, kelp_g, pg, KELP_FT)
        if kh:
            # Patch area from geometry (EPSG:2926 is in US survey feet)
            acres = sum(kelp_g[i].area for i, _ in kh) / 43560.0
            rec['kelp'] = {'n': len(kh), 'acres': round(acres, 3), 'distFt': round(min(d for _, d in kh))}

        eh = hits(eel_t, eel_i, eel_g, pg, EELGRASS_FT)
        if eh:
            length = 0.0
            depths, maxd, sites = [], None, []
            for i, _ in eh:
                p = eel[i].get('properties') or {}
                length += float(p.get('LENGTH') or 0)
                m = p.get('MEAN')
                if m not in (None, 0, ''):
                    depths.append(float(m))
                mx = p.get('MAX_')
                if mx not in (None, 0, ''):
                    maxd = float(mx) if maxd is None else max(maxd, float(mx))
                s = str(p.get('SITE') or '').strip()
                if s and s not in sites:
                    sites.append(s)
            rec['eelgrass'] = {
                'n': len(eh),
                'lengthFt': round(length),
                'meanDepth': round(sum(depths) / len(depths), 1) if depths else None,
                'maxDepth': round(maxd, 1) if maxd is not None else None,
                'distFt': round(min(d for _, d in eh)),
                'sites': sites[:5],
            }

        dh = hits(doc_t, doc_i, doc_g, pg, FORAGE_FT)
        ph = hits(pot_t, pot_i, pot_g, pg, FORAGE_FT)
        if dh or ph:
            beaches = []
            seen = set()
            for i, d in sorted(dh, key=lambda x: x[1]):
                p = doc[i].get('properties') or {}
                name = str(p.get('NAME') or p.get('NAME_2') or '').strip()
                key = (name, str(p.get('SPECIES') or ''))
                if key in seen:
                    continue
                seen.add(key)
                beaches.append({
                    'name': name,
                    'species': str(p.get('SPECIES') or '').strip(),
                    'smelt': str(p.get('SMELT_IND') or '').strip().upper() in ('Y', 'YES', '1', 'TRUE'),
                    'sandLance': str(p.get('SAND_LANCE_IND') or '').strip().upper() in ('Y', 'YES', '1', 'TRUE'),
                    'distFt': round(d),
                })
            rec['forage'] = {'documented': beaches[:6], 'potentialN': len(ph)}

        hh = hits(her_t, her_i, her_g, pg, ADJACENT_FT)
        if hh:
            names = []
            for i, _ in hh:
                nm = str((her[i].get('properties') or {}).get('Name') or '').strip()
                if nm and nm not in names:
                    names.append(nm)
            rec['herring'] = names or ['Herring spawning ground']

        sh = hits(sf_t, sf_i, sf_g, pg, SHOREFORM_FT)
        if sh:
            i, d = min(sh, key=lambda x: x[1])
            p = sf[i].get('properties') or {}
            def clean(v):
                v = '' if v is None else str(v).strip()
                return '' if v in ('<Null>', 'None') else v
            rec['shoreform'] = {
                'code': clean(p.get('PIAT_shoreforms')),
                'unitId': clean(p.get('ShoreForm_Unit_ID')),
                'distFt': round(d),
                'ffhab': clean(p.get('FFhab')),
                'landUse': clean(p.get('LandUse')),
                'shoreDesig': clean(p.get('ShoreDESIG')),
                'protection': clean(p.get('PIATprotection')),
                'restoration': clean(p.get('PIATrestoration')),
                'publicOwnership': clean(p.get('SomePublicOwnership')) == 'Y',
            }

        if rec:
            results[fid] = rec
            n_hit += 1
        if n % 2000 == 0 and n:
            print(f'  {n:,}/{len(parcels):,} parcels, {n_hit:,} with hits ({time.time() - t1:.0f}s)', flush=True)

    out = {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'kelpFt': KELP_FT,
            'eelgrassFt': EELGRASS_FT,
            'forageFt': FORAGE_FT,
            'adjacentFt': ADJACENT_FT,
            'shoreformFt': SHOREFORM_FT,
            'parcels': len(parcels),
            'parcelsWithHits': n_hit,
        },
        'parcels': results,
    }
    dest = os.path.join(DATA, 'nearshore_parcel_stats.json')
    with open(dest, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'Wrote {dest} — {n_hit:,} parcels with hits, {os.path.getsize(dest)/1024:.0f} KB, {time.time() - t0:.0f}s total')


if __name__ == '__main__':
    sys.exit(main())
