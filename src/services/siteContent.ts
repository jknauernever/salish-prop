import { useEffect, useState } from 'react';

/**
 * Site content: small rich-text blocks that content admins edit in
 * /admin/content and the public map renders. Stored as sanitized HTML in
 * gs://salish-ndvi-tiles/config/site-content.json (public read); writes go
 * through the admin-config Cloud Function at /api/admin/content.
 *
 * Mirrors the categoryTree service: module-level cache + in-flight dedupe,
 * synchronous fallback, and a hook that upgrades once the fetch resolves.
 */

export interface SiteContent {
  version: number;
  updated_at: string | null;
  landing_intro: { html: string };
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  version: 0,
  updated_at: null,
  landing_intro: { html: '' },
};

const CONTENT_URL =
  import.meta.env.VITE_SITE_CONTENT_URL ??
  'https://storage.googleapis.com/salish-ndvi-tiles/config/site-content.json';

let cached: SiteContent | null = null;
let inflight: Promise<SiteContent> | null = null;

function normalize(data: unknown): SiteContent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<SiteContent>;
  const intro = d.landing_intro;
  return {
    version: typeof d.version === 'number' ? d.version : 0,
    updated_at: typeof d.updated_at === 'string' ? d.updated_at : null,
    landing_intro: {
      html: intro && typeof intro.html === 'string' ? intro.html : '',
    },
  };
}

export async function fetchSiteContent(): Promise<SiteContent> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(CONTENT_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const normalized = normalize(await res.json());
      if (!normalized) throw new Error('Invalid site content shape');
      cached = normalized;
      return normalized;
    } catch (err) {
      console.warn('Site content fetch failed, using defaults:', err);
      cached = DEFAULT_SITE_CONTENT;
      return DEFAULT_SITE_CONTENT;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearSiteContentCache(): void {
  cached = null;
}

/**
 * True when the HTML has no visible content — e.g. the editor's empty
 * document (`<p></p>`) or whitespace-only markup. Used to hide the landing
 * box entirely rather than render an empty card.
 */
export function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

/** React hook: current site content (cache or defaults) plus a loading flag. */
export function useSiteContent(): { content: SiteContent; loading: boolean } {
  const [content, setContent] = useState<SiteContent>(() => cached ?? DEFAULT_SITE_CONTENT);
  const [loading, setLoading] = useState<boolean>(() => cached === null);

  useEffect(() => {
    // Initial state already read the cache; nothing to do if it was warm.
    if (cached) return;
    let cancelled = false;
    fetchSiteContent().then((c) => {
      if (cancelled) return;
      setContent(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { content, loading };
}
