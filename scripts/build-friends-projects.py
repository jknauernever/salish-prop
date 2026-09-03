#!/usr/bin/env python3
"""
Merge Friends of the San Juans' four project files into the one always-on
"Friends' Projects" layer (public/data/friends-projects.geojson).

Inputs (scripts/friends-projects-source/): restoration projects (points),
riparian projects (points), in/over-water structure projects (points), and
restoration sites (shoreline segments). Each feature gets a `kind`, a
normalized NAME / ISLAND / DATE / DESCRIPTION / LINK / HABITAT_TYPES, and
the project stats when present. Owner names are deliberately dropped.

LINKs in the source files point at sanjuans.org/project/<slug>/ URLs that
no longer exist; PROJECT_LINKS maps each old slug to the live page (found
through the site's WordPress search API, 2026-09-03). Run with --check to
HEAD every link.

Usage:  python3 scripts/build-friends-projects.py [--check]
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'friends-projects-source')
OUT = os.path.join(ROOT, 'public', 'data', 'friends-projects.geojson')

PROJECT_LINKS = {
    'barlow-bay-restoration': 'https://sanjuans.org/barlow-bay-eelgrass-forage-fish-spawn-habitat-restoration-lopez-island/',
    'blind-bay-restoration': 'https://sanjuans.org/blind-bay-forage-fish-spawn-habitat-restoration-shaw/',
    'broken-point-restoration': 'https://sanjuans.org/broken-point-beach-habitat-restoration-shaw/',
    'brown-island-restoration': 'https://sanjuans.org/beach-and-bluff-restoration-brown-island/',
    'eastsound-waterfront-park-beach-restoration-orcas-in-progress': 'https://sanjuans.org/eastsound-waterfront-park-beach-restoration-orcas-in-progress/',
    'fisherman-bay-restoration': 'https://sanjuans.org/fisherman-bay-marsh-and-beach-restoration-lopez/',
    'forage-fish-spawn-restoration-lopez': 'https://sanjuans.org/forage-fish-spawn-habitat-restoration-lopez/',
    'neck-point-beach-restoration-shaw-in-progress': 'https://sanjuans.org/neck-point-beach-restoration-shaw-in-progress/',
    'neck-point-restoration': 'https://sanjuans.org/neck-point-wetland-restoration-shaw/',
    'salmon-point-restoration': 'https://sanjuans.org/salmon-point-forage-fish-spawn-habitat-restoration-lopez/',
    'shoal-bay-restoration': 'https://sanjuans.org/shoal-bay-tide-channel-lagoon-restoration-lopez/',
    'smugglers-cove-restoration': 'https://sanjuans.org/smugglers-cove-road-forage-fish-spawning-habitat-enhancement-shaw/',
    'sucia-island-restoration': 'https://sanjuans.org/mud-bay-wetland-and-beach-restoration-sucia/',
    'thatcher-bay-restoration': 'https://sanjuans.org/thatcher-bay-nearshore-restoration-blakely/',
    'turn-point-restoration': 'https://sanjuans.org/turn-point-marsh-and-beach-restoration-san-juan/',
    'upright-head-beach-restoration-lopez-in-progress': 'https://sanjuans.org/upright-head-beach-restoration-lopez-in-progress/',
    'west-sound-restoration': 'https://sanjuans.org/west-sound-beach-restoration-orcas/',
}
BUOY_PROGRAM = 'https://sanjuans.org/buoy-upgrade-program/'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'


def load(name):
    with open(os.path.join(SRC, name)) as f:
        return json.load(f)['features']


def s(v):
    v = '' if v is None else str(v).strip()
    return '' if v in ('<Null>', 'None') else v


def fix_link(link):
    link = s(link)
    if not link:
        return ''
    slug = link.rstrip('/').split('/')[-1]
    return PROJECT_LINKS.get(slug, link)


def main():
    check = '--check' in sys.argv
    out = []

    def add(f, kind, name, island, date, desc, link, types, extra=None):
        props = {'kind': kind, 'NAME': name, 'ISLAND': island, 'DATE': date, 'DESCRIPTION': desc,
                 'LINK': link, 'HABITAT_TYPES': ', '.join(t for t in types if t)}
        if extra:
            props.update({k: v for k, v in extra.items() if v not in (None, '')})
        out.append({'type': 'Feature', 'geometry': f['geometry'], 'properties': props})

    for f in load('friends-restoration-projects.json'):
        p = f['properties']
        add(f, 'Restoration project', s(p.get('NAME')), s(p.get('ISLAND')), s(p.get('DATE')), s(p.get('DESCRIPTION')),
            fix_link(p.get('LINK')), [s(p.get('HABITAT_TYPE')), s(p.get('HABITAT_TYPE_2')), s(p.get('HABITAT_TYPE_3'))],
            {k: p.get(k) for k in ('LINEARFEET_SHORELINE', 'ACRES_PROTECTED', 'SQFT_HABITATRESTORED')})
    for f in load('friends-riparian-projects.json'):
        p = f['properties']
        add(f, 'Riparian project', s(p.get('NAME')), s(p.get('ISLAND')), s(p.get('DATE')), s(p.get('DESCRIPTION')),
            fix_link(p.get('LINK')), [s(p.get('HABITAT_TYPE'))])
    for f in load('friends-iow-structures.json'):
        p = f['properties']
        ptype = s(p.get('PROJECT_TYPE')) or s(p.get('HABITAT_TYPE')) or 'In/over-water structure project'
        link = fix_link(p.get('LINK')) or (BUOY_PROGRAM if 'buoy' in ptype.lower() else '')
        add(f, 'In/over-water structure project', ptype, s(p.get('ISLAND')), s(p.get('DATE')), s(p.get('DESCRIPTION')),
            link, [s(p.get('HABITAT_TYPE'))], {'AMOUNT': s(p.get('AMOUNT'))})
    for f in load('friends-restoration-sites.json'):
        p = f['properties']
        add(f, 'Restoration site', 'Shoreline restoration site', s(p.get('Island')), s(p.get('DateTimeS'))[:4],
            s(p.get('Notes')), '', [])

    with open(OUT, 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': out}, f, separators=(',', ':'))
    print(f'wrote {len(out)} features to {OUT}')

    if check:
        links = sorted({f['properties']['LINK'] for f in out if f['properties']['LINK']})
        bad = 0
        for u in links:
            req = urllib.request.Request(u, headers={'User-Agent': UA}, method='HEAD')
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            except Exception as e:
                code = str(e)
            ok = code == 200
            bad += 0 if ok else 1
            print(f'  {"ok " if ok else "BAD"} {code} {u}')
        print(f'{len(links)} links, {bad} bad')


if __name__ == '__main__':
    sys.exit(main())
