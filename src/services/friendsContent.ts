/**
 * Friends of the San Juans website content, harvested and enriched into a
 * small index (`/data/friends-content.json`, built by
 * scripts/harvest-friends-content.py + scripts/build-friends-content-index.py).
 *
 * The popups use it three ways: the best matching article supplies the
 * story ("why it matters") and photos for a clicked feature; a "From Friends"
 * list links two or three related articles; and a project feature whose
 * LINK matches an article gets that article's summary and images.
 */

export interface ContentImage {
  url: string;
  caption: string;
}

export interface ContentItem {
  id: string;
  url: string;
  title: string;
  date: string; // YYYY-MM-DD
  type: 'post' | 'page';
  summary: string;
  topics: string[];
  islands: string[];
  places: string[];
  projectMatch: string;
  kind: string;
  quality: number;
  image: ContentImage | null;
  images: ContentImage[];
}

export interface ContentIndex {
  generated: string;
  items: Record<string, ContentItem>;
  /** Layer id → article ids, best first. */
  byLayer: Record<string, string[]>;
  /** Article URL (no trailing slash) → id. */
  byUrl: Record<string, string>;
}

const INDEX_URL = '/data/friends-content.json';

let promise: Promise<ContentIndex | null> | null = null;
let cached: ContentIndex | null = null;

/** Start loading (idempotent). Called once at app start so popups usually have it synchronously. */
export function preloadFriendsContent(): Promise<ContentIndex | null> {
  if (!promise) {
    promise = fetch(INDEX_URL)
      .then(r => (r.ok ? (r.json() as Promise<ContentIndex>) : null))
      .then(idx => { cached = idx; return idx; })
      .catch(() => null);
  }
  return promise;
}

/** The index if it has already loaded, else null (and a load is kicked off). */
export function getFriendsContentSync(): ContentIndex | null {
  if (!promise) void preloadFriendsContent();
  return cached;
}

function norm(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/^http:/, 'https:');
}

/** Article for a feature's own link, if we have it. */
export function articleForUrl(idx: ContentIndex | null, url: string | undefined): ContentItem | null {
  if (!idx || !url) return null;
  const id = idx.byUrl[norm(url)];
  return id ? idx.items[id] ?? null : null;
}

/** Best article for a project by its name (matches the enrichment's project_match / places). */
export function articleForProject(idx: ContentIndex | null, name: string, island?: string): ContentItem | null {
  if (!idx || !name) return null;
  const key = name.toLowerCase().replace(/[’']/g, '').replace(/\s+road$/i, '').trim();
  let best: ContentItem | null = null;
  for (const it of Object.values(idx.items)) {
    const pm = it.projectMatch.toLowerCase().replace(/[’']/g, '');
    if (!pm) continue;
    const hit = pm === key || key.includes(pm) || pm.includes(key);
    if (!hit) continue;
    if (island && it.islands.length && !it.islands.some(i => island.toLowerCase().includes(i.toLowerCase()))) continue;
    if (!best || it.quality > best.quality || (it.quality === best.quality && it.date > best.date)) best = it;
  }
  return best;
}

/** Related articles for a layer, best first, optionally preferring an island. */
export function articlesForLayer(idx: ContentIndex | null, layerId: string, island?: string, limit = 3): ContentItem[] {
  if (!idx) return [];
  const ids = idx.byLayer[layerId] ?? [];
  const items = ids.map(id => idx.items[id]).filter(Boolean);
  if (island) {
    const isl = island.toLowerCase();
    items.sort((a, b) => Number(b.islands.some(i => isl.includes(i.toLowerCase()))) - Number(a.islands.some(i => isl.includes(i.toLowerCase()))));
  }
  return items.slice(0, limit);
}

/**
 * Best articles for a specific feature: the layer's topic list re-ranked by
 * how well each article's islands and place names match the feature's own
 * island and names. Ties fall back to quality and recency.
 */
export function articlesForFeature(
  idx: ContentIndex | null,
  layerId: string,
  props: Record<string, unknown>,
  limit = 3,
): ContentItem[] {
  if (!idx) return [];
  const ids = idx.byLayer[layerId] ?? [];
  const candidates = ids.map(id => idx.items[id]).filter(Boolean);
  if (!candidates.length) return [];

  const str = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());
  const island = str(props.ISLAND ?? props.Island ?? props.island).replace(/\s+island$/, '').replace(/\s+is\.?$/, '');
  const nameFields = ['NAME', 'Name', 'name', 'NAME_2', 'SITE', 'Site', 'Beach_ID', 'LOCATION', 'PLACE'];
  const names = nameFields.map(k => str(props[k])).filter(n => n.length >= 4);
  // Words from names worth matching (drop codes like "L-76" and tiny words)
  const nameWords = new Set<string>();
  for (const n of names) for (const w of n.split(/[^a-z]+/)) if (w.length >= 4 && !['island', 'beach', 'point', 'road', 'bay'].includes(w)) nameWords.add(w);

  const score = (a: ContentItem): number => {
    let sc = 0;
    const places = a.places.map(p => p.toLowerCase());
    const title = a.title.toLowerCase();
    if (names.some(n => places.some(p => p.includes(n) || n.includes(p)) || title.includes(n))) sc += 6;
    else if ([...nameWords].some(w => places.some(p => p.includes(w)) || title.includes(w))) sc += 3;
    if (island) {
      const isl = a.islands.map(i => i.toLowerCase());
      if (isl.some(i => island.includes(i) || i.includes(island))) sc += 2;
      else if (isl.length) sc -= 1; // clearly about somewhere else
    }
    return sc;
  };
  return candidates
    .map(a => ({ a, sc: score(a) }))
    .sort((x, y) => y.sc - x.sc || y.a.quality - x.a.quality || (y.a.date > x.a.date ? 1 : -1))
    .slice(0, limit)
    .map(x => x.a);
}

/**
 * Photos whose own caption names the subject (e.g. /eelgrass/), from any
 * article in the index, best articles first. Captions must be short and must
 * not match `exclude` (art projects, boats, ships…). Used for habitat and
 * structure layers, where a related article's photo is often not of the
 * subject at all.
 */
export function photosForSubject(
  idx: ContentIndex | null,
  subject: RegExp,
  exclude: RegExp,
  limit = 2,
): ContentImage[] {
  if (!idx) return [];
  const seen = new Set<string>();
  const out: { im: ContentImage; q: number }[] = [];
  for (const it of Object.values(idx.items)) {
    for (const im of it.images) {
      const c = (im.caption || '').trim();
      if (!c || c.length > 70 || !subject.test(c) || exclude.test(c) || seen.has(im.url)) continue;
      seen.add(im.url);
      out.push({ im: { url: im.url, caption: c }, q: it.quality });
    }
  }
  return out.sort((a, b) => b.q - a.q).slice(0, limit).map(x => x.im);
}

/** Short date for the article list: "Aug 2024". */
export function articleDate(d: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}
