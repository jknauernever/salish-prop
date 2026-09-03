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

/** Short date for the article list: "Aug 2024". */
export function articleDate(d: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}
