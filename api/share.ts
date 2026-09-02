/**
 * /api/share — serves the SPA shell with Open Graph / Twitter meta tags that
 * describe the shared map state, so a pasted link unfurls with a preview of
 * exactly that view (image from /api/og with the same view params; the
 * description names the visible layers).
 *
 * Wired by vercel.json `routes` (not `rewrites`: rewrites run *after* the
 * static filesystem check, and "/" is a real file, so they never fired).
 * Requests to "/" or "/view/:preset" that carry a `c` (center) param are
 * routed here with `?path=<original path>` added, ahead of the filesystem
 * handler. Everything else is served statically as before.
 *
 * Node runtime (classic req/res signature) — this project's ESM setup trips
 * Vercel's edge bundler, and crawler traffic doesn't need edge latency.
 */
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
// Explicit .js extensions: this package is ESM ("type": "module"), so Node's
// runtime resolver needs them even though the sources are .ts.
import { parseShareState, describeState, shareTitle, SITE_NAME } from './_shareState.js';

type Req = IncomingMessage & { query?: Record<string, string | string[]> };
type Res = ServerResponse & {
  status: (code: number) => Res;
  send: (body: string) => void;
  redirect: (code: number, url: string) => void;
};

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadShell(origin: string, routePath: string): Promise<string> {
  // Presets have their own pre-rendered shell (dist/view/<name>/index.html)
  // with preset-specific meta; fall back to the root shell. The built HTML is
  // bundled into this function via `includeFiles` in vercel.json, so read it
  // from disk first; fetching our own origin is the fallback (it fails on
  // password-protected preview deployments).
  const rel = routePath !== '/' ? [`dist${routePath.replace(/\/$/, '')}/index.html`, 'dist/index.html'] : ['dist/index.html'];
  for (const r of rel) {
    try {
      return await readFile(path.join(process.cwd(), r), 'utf8');
    } catch {
      /* not bundled — try the next candidate */
    }
  }
  for (const r of rel) {
    const res = await fetch(`${origin}/${r.replace(/^dist\//, '')}`);
    if (res.ok) return res.text();
  }
  throw new Error('Could not load app shell');
}

/**
 * HMAC-SHA256 over the sorted `k=v` pairs (raw values, `&`-joined), hex,
 * truncated to 32 chars. Must match `_verify_sig` in cloud-functions/og-image.
 */
function signOgParams(params: URLSearchParams): string | null {
  const secret = process.env.OG_SIGNING_SECRET;
  if (!secret) return null;
  const canonical = [...params.entries()]
    .filter(([k]) => k !== 'sig')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return createHmac('sha256', secret).update(canonical).digest('hex').slice(0, 32);
}

export default async function handler(req: Req, res: Res) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const origin = `${proto}://${host}`;

  const url = new URL(req.url ?? '/', origin);
  const path = url.searchParams.get('path') || '/';
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  const presetName = path.match(/^\/view\/([^/]+)/)?.[1] ?? null;
  const st = parseShareState(url.searchParams, presetName);
  const pageUrl = `${origin}${path}${qs ? `?${qs}` : ''}`;
  const title = shareTitle(presetName, !!(st.parcel || st.search));
  const description = describeState(st);

  // Image: just the view params (center / zoom / basemap / marker), signed so
  // only URLs minted here can spend Static Maps quota (the og-image function
  // rejects unsigned requests that carry view params).
  const img = new URLSearchParams();
  for (const k of ['c', 'z', 'b', 'p', 'q']) {
    const v = url.searchParams.get(k);
    if (v) img.set(k, v);
  }
  const sig = signOgParams(img);
  if (sig) img.set('sig', sig);
  const imageUrl = `${origin}/api/og?${img.toString()}`;

  let html: string;
  try {
    html = await loadShell(origin, path);
  } catch {
    res.redirect(302, `${origin}${path}`);
    return;
  }

  // Drop any static OG tags from the shell so ours win.
  html = html.replace(/<meta (?:property|name)="(?:og:|twitter:)[^"]*"[^>]*>\s*/g, '');

  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${escapeAttr(pageUrl)}">`,
    `<meta property="og:image" content="${escapeAttr(imageUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(imageUrl)}">`,
  ].join('\n    ');

  html = html.replace('</head>', `    ${tags}\n  </head>`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The shell's asset hashes change per deploy — never let a CDN pin it.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.status(200).send(html);
}
