import type { ReactNode } from 'react';

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:)\]])/gi;

/**
 * Render a text value with any http(s):// or www. URLs turned into links that
 * open in a new tab. Plain text otherwise.
 */
export function linkifyText(value: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(value.slice(last, idx));
    const url = m[0];
    const href = url.startsWith('www.') ? `https://${url}` : url;
    parts.push(
      <a
        key={`${idx}-${url}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-deep-teal underline break-all"
      >
        {url}
      </a>,
    );
    last = idx + url.length;
  }
  if (parts.length === 0) return value;
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}
