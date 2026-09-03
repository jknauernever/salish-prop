#!/usr/bin/env python3
"""
Harvest every post and page on sanjuans.org through the site's WordPress
REST API into one corpus file, ready for enrichment (see
enrich-friends-content.py). No scraping: the API returns title, date,
rendered body, excerpt, categories/tags, and the featured image.

Output: <out>/friends-corpus.json
  { "harvested": ISO time, "items": [ { id, type, url, title, date, modified,
    excerpt, text, images: [{url, caption, width, height}], featured: {...}|null,
    tags: [..], categories: [..] } ] }

Usage:  python3 scripts/harvest-friends-content.py [out_dir] [--since ISO-DATE]
Needs:  beautifulsoup4 (pip install beautifulsoup4)
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from bs4 import BeautifulSoup

SITE = 'https://sanjuans.org'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.friends-content')
SINCE = None
if '--since' in sys.argv:
    SINCE = sys.argv[sys.argv.index('--since') + 1]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r), r.headers


def fetch_all(kind):
    items = []
    page = 1
    while True:
        q = {'per_page': 50, 'page': page, '_embed': 'wp:featuredmedia,wp:term', 'status': 'publish'}
        if SINCE:
            q['modified_after'] = SINCE
        url = f'{SITE}/wp-json/wp/v2/{kind}?{urllib.parse.urlencode(q)}'
        try:
            data, headers = get(url)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                break  # past the last page
            raise
        items.extend(data)
        total_pages = int(headers.get('X-WP-TotalPages', '1'))
        print(f'  {kind} page {page}/{total_pages} ({len(items)} so far)', flush=True)
        if page >= total_pages or not data:
            break
        page += 1
        time.sleep(0.4)
    return items


def clean(html):
    soup = BeautifulSoup(html or '', 'html.parser')
    images = []
    for fig in soup.find_all('figure'):
        img = fig.find('img')
        cap = fig.find('figcaption')
        if img and img.get('src'):
            images.append({'url': img['src'], 'caption': (cap.get_text(' ', strip=True) if cap else img.get('alt', '')).strip(),
                           'width': img.get('width'), 'height': img.get('height')})
    seen = {i['url'] for i in images}
    for img in soup.find_all('img'):
        src = img.get('src')
        if src and src not in seen and not src.startswith('data:'):
            images.append({'url': src, 'caption': (img.get('alt') or '').strip(), 'width': img.get('width'), 'height': img.get('height')})
            seen.add(src)
    for t in soup(['script', 'style', 'noscript', 'iframe', 'form']):
        t.decompose()
    text = soup.get_text('\n', strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text, images


def embedded_terms(item):
    tags, cats = [], []
    for group in (item.get('_embedded', {}).get('wp:term') or []):
        for t in group:
            if t.get('taxonomy') == 'post_tag':
                tags.append(t['name'])
            elif t.get('taxonomy') == 'category':
                cats.append(t['name'])
    return tags, cats


def featured(item):
    media = (item.get('_embedded', {}).get('wp:featuredmedia') or [None])[0]
    if not media or not media.get('source_url'):
        return None
    sizes = (media.get('media_details') or {}).get('sizes') or {}
    pick = sizes.get('large') or sizes.get('medium_large') or {}
    return {
        'url': pick.get('source_url') or media['source_url'],
        'full': media['source_url'],
        'caption': BeautifulSoup((media.get('caption') or {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True) or (media.get('alt_text') or ''),
        'width': pick.get('width') or (media.get('media_details') or {}).get('width'),
        'height': pick.get('height') or (media.get('media_details') or {}).get('height'),
    }


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    corpus = []
    for kind in ('posts', 'pages'):
        print(f'Fetching {kind}…', flush=True)
        for it in fetch_all(kind):
            text, images = clean(it.get('content', {}).get('rendered', ''))
            title = BeautifulSoup(it.get('title', {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True)
            excerpt = BeautifulSoup(it.get('excerpt', {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True)
            tags, cats = embedded_terms(it)
            corpus.append({
                'id': f'{kind[:-1]}-{it["id"]}',
                'type': kind[:-1],
                'url': it.get('link'),
                'title': title,
                'date': it.get('date'),
                'modified': it.get('modified'),
                'excerpt': excerpt,
                'text': text,
                'images': images[:12],
                'featured': featured(it),
                'tags': tags,
                'categories': cats,
            })
    dest = os.path.join(OUT, 'friends-corpus.json')
    with open(dest, 'w') as f:
        json.dump({'harvested': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'site': SITE, 'items': corpus}, f, ensure_ascii=False)
    words = sum(len(i['text'].split()) for i in corpus)
    print(f'wrote {len(corpus)} items ({words:,} words, {os.path.getsize(dest)/1024:.0f} KB) to {dest} in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    sys.exit(main())
