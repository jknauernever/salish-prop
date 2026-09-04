import { useEffect, useState } from 'react';
import { getShareUrl } from '../../services/urlState';

/**
 * Header "Share" button. The address bar already carries the full map state
 * (see services/urlState.ts); this just puts that link on the clipboard, or
 * hands it to the OS share sheet on phones. The link's Open Graph preview is
 * generated server-side from the same query string (api/og).
 */
export function ShareButton({ variant = 'header', onDone }: { variant?: 'header' | 'menu'; onDone?: () => void } = {}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function handleShare() {
    const url = getShareUrl();
    const canNativeShare =
      typeof navigator.share === 'function' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (canNativeShare) {
      try {
        await navigator.share({ title: 'Salish Sea Explorer', url });
        return;
      } catch {
        /* user cancelled or share failed — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Copy this link:', url);
    }
    onDone?.();
  }

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-teal-50 hover:text-deep-teal transition-colors"
      >
        <svg className="w-4 h-4 text-deep-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 12.684a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        {copied ? 'Link copied' : 'Share this view'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      title="Copy a link to this exact view"
      className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium transition-colors px-2 py-1 rounded hover:bg-white/10"
    >
      {copied ? (
        <svg className="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 12.684a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      )}
      <span className="hidden sm:inline">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  );
}
