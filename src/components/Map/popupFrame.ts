/**
 * The one popup frame every map click renders into.
 *
 * Slots, top to bottom: photo (album with ‹ › arrows when there is more than
 * one), header (layer eyebrow in the layer's map color, title, subtitle),
 * key facts, "why it matters" story block, "what you can do" action block,
 * chips, an optional custom body (the parcel report's tabs), the all-details
 * table, and a footer with source credit and quiet actions.
 *
 * Styling lives in `src/index.css` under `.ssx-*` (Friends of the San Juans'
 * palette: sea blue, driftwood, kelp lime, chartreuse). This module only
 * builds markup and wires the few interactions (album, details toggle,
 * close) through one document-level click handler, because InfoWindow
 * content is plain HTML re-created on every open.
 */

export interface PopupPhoto {
  url: string;
  caption?: string;
  credit?: string;
}

export interface PopupStat {
  value: string;
  unit?: string;
  label: string;
}

export interface PopupChip {
  label: string;
  tone?: 'default' | 'on' | 'warn' | 'teal';
}

export interface PopupBlock {
  kicker: string;
  /** Trusted HTML (already escaped where it came from user data). */
  html: string;
  button?: { label: string; href: string };
}

export interface PopupFooterButton {
  label: string;
  href?: string;
  /** Value for a `data-ssx-action` attribute, handled by the caller. */
  action?: string;
}

export interface PopupFrameOptions {
  /** DOM id for the root element (also used to find slots later). */
  id: string;
  /** Layer color, used only for the top edge and the eyebrow. */
  accent: string;
  layerName: string;
  swatch?: 'line' | 'fill' | 'point';
  /** Fill color for a 'fill' swatch when it differs from the accent. */
  swatchColor?: string;
  title: string;
  /** Give the title element an id so it can be filled in later (address lookup). */
  titleId?: string;
  subtitle?: string;
  photos?: PopupPhoto[];
  stats?: PopupStat[];
  chips?: PopupChip[];
  /** Element id for a chips row that is filled in asynchronously. */
  chipsId?: string;
  story?: PopupBlock;
  action?: PopupBlock;
  /** Arbitrary HTML placed between the blocks and the details table. */
  body?: string;
  fields?: { label: string; value: string }[];
  /** Show the table open instead of behind the "All details" toggle. */
  detailsOpen?: boolean;
  source?: { credit?: string; url?: string };
  footerButtons?: PopupFooterButton[];
  width?: number;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape text, then turn bare URLs into links that open in a new tab. */
export function linkifyText(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}

function swatchHtml(kind: PopupFrameOptions['swatch'], accent: string, fill?: string): string {
  if (kind === 'fill') {
    return `<span class="ssx-sw ssx-sw-fill" style="background:${escapeHtml(fill ?? accent)};border-color:${escapeHtml(accent)}"></span>`;
  }
  if (kind === 'point') return `<span class="ssx-sw ssx-sw-pt"></span>`;
  return `<span class="ssx-sw"></span>`;
}

function photoHtml(photos: PopupPhoto[]): string {
  const slides = photos
    .map((p, i) => {
      const cap = p.caption || p.credit
        ? `<div class="ssx-cap">${p.caption ? escapeHtml(p.caption) : ''}${p.caption && p.credit ? ' · ' : ''}${p.credit ? `<i>${escapeHtml(p.credit)}</i>` : ''}</div>`
        : '';
      return `<div class="ssx-slide"${i === 0 ? '' : ' hidden'}>
        <img src="${escapeHtml(p.url)}" alt=""${i === 0 ? '' : ' loading="lazy"'} onerror="this.closest('.ssx-photo').setAttribute('hidden','')">
        ${cap}
      </div>`;
    })
    .join('');
  const album = photos.length > 1
    ? `<button type="button" class="ssx-arrow ssx-prev" data-ssx-album="prev" aria-label="Previous photo">&#8249;</button>
       <button type="button" class="ssx-arrow ssx-next" data-ssx-album="next" aria-label="Next photo">&#8250;</button>
       <span class="ssx-count"><b>1</b> / ${photos.length}</span>`
    : '';
  return `<div class="ssx-photo">${slides}${album}</div>`;
}

function blockHtml(cls: string, b: PopupBlock): string {
  const btn = b.button
    ? `<div class="ssx-btn-row"><a class="ssx-btn-sun" href="${escapeHtml(b.button.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.button.label)}</a></div>`
    : '';
  return `<div class="ssx-block ${cls}"><div class="ssx-k">${escapeHtml(b.kicker)}</div>${b.html}${btn}</div>`;
}

export function buildPopupFrame(o: PopupFrameOptions): string {
  const photos = o.photos?.filter(p => !!p.url) ?? [];
  const stats = o.stats?.filter(s => s.value) ?? [];
  const chips = o.chips ?? [];
  const fields = o.fields ?? [];
  const showToggle = !o.detailsOpen && fields.length > 6;

  const statsHtml = stats.length
    ? `<div class="ssx-stats">${stats
        .map(s => `<div class="ssx-stat"><div class="ssx-v${s.value.length > 7 ? ' ssx-v-text' : ''}">${escapeHtml(s.value)}${s.unit ? `<small>${escapeHtml(s.unit)}</small>` : ''}</div><div class="ssx-l">${escapeHtml(s.label)}</div></div>`)
        .join('')}</div>`
    : '';

  const chipsHtml = chips.length || o.chipsId
    ? `<div class="ssx-chips"${o.chipsId ? ` id="${escapeHtml(o.chipsId)}"` : ''}${!chips.length ? ' hidden' : ''}>${chips
        .map(c => `<span class="ssx-chip${c.tone && c.tone !== 'default' ? ` ssx-chip-${c.tone}` : ''}">${escapeHtml(c.label)}</span>`)
        .join('')}</div>`
    : '';

  const table = fields.length
    ? `<table class="ssx-table"${showToggle ? ' hidden' : ''}>${fields
        .map(f => `<tr><td>${escapeHtml(f.label)}</td><td>${linkifyText(f.value)}</td></tr>`)
        .join('')}</table>`
    : '';
  const detailsHtml = fields.length
    ? `<div class="ssx-details">${showToggle
        ? `<button type="button" class="ssx-tg" data-ssx-details aria-expanded="false"><span>All details</span><span>${fields.length} fields <i class="ssx-caret">&#9662;</i></span></button>`
        : ''}${table}</div>`
    : '';

  const src = o.source && (o.source.credit || o.source.url)
    ? `<div class="ssx-src">Source: ${o.source.url
        ? `<a href="${escapeHtml(o.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.source.credit || 'View the dataset')} &#8599;</a>`
        : escapeHtml(o.source.credit!)}</div>`
    : '<div class="ssx-src"></div>';
  const btns = o.footerButtons?.length
    ? `<div class="ssx-btns">${o.footerButtons
        .map(b => b.href
          ? `<a class="ssx-btn" href="${escapeHtml(b.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.label)}</a>`
          : `<button type="button" class="ssx-btn"${b.action ? ` data-ssx-action="${escapeHtml(b.action)}"` : ''}>${escapeHtml(b.label)}</button>`)
        .join('')}</div>`
    : '';

  return `<div class="ssx" id="${escapeHtml(o.id)}" style="--accent:${escapeHtml(o.accent)};${o.width ? `width:${o.width}px;` : ''}">
    <div class="ssx-edge"></div>
    <button type="button" class="ssx-x" data-ssx-close aria-label="Close">&times;</button>
    ${photos.length ? photoHtml(photos) : ''}
    <div class="ssx-head">
      <div class="ssx-layer">${swatchHtml(o.swatch, o.accent, o.swatchColor)}${escapeHtml(o.layerName)}</div>
      <div class="ssx-ttl"${o.titleId ? ` id="${escapeHtml(o.titleId)}"` : ''}>${escapeHtml(o.title)}</div>
      ${o.subtitle ? `<div class="ssx-sub">${escapeHtml(o.subtitle)}</div>` : ''}
    </div>
    ${statsHtml}
    ${o.story ? blockHtml('ssx-story', o.story) : ''}
    ${o.action ? blockHtml('ssx-act', o.action) : ''}
    ${chipsHtml}
    ${o.body ?? ''}
    ${detailsHtml}
    <div class="ssx-foot">${src}${btns}</div>
  </div>`;
}

/** Fired on `window` when the frame's own close button is pressed. */
export const POPUP_CLOSE_EVENT = 'ssx-popup-close';

let handlersInstalled = false;

/**
 * One delegated click handler for every frame on the page: album arrows,
 * the details toggle, and the close button. Safe to call more than once.
 */
export function installPopupFrameHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const arrow = target.closest<HTMLElement>('[data-ssx-album]');
    if (arrow) {
      e.preventDefault();
      e.stopPropagation();
      const photo = arrow.closest<HTMLElement>('.ssx-photo');
      if (!photo) return;
      const slides = Array.from(photo.querySelectorAll<HTMLElement>('.ssx-slide'));
      const current = slides.findIndex(s => !s.hidden);
      const dir = arrow.dataset.ssxAlbum === 'next' ? 1 : -1;
      const next = (current + dir + slides.length) % slides.length;
      slides.forEach((s, i) => { s.hidden = i !== next; });
      const count = photo.querySelector<HTMLElement>('.ssx-count b');
      if (count) count.textContent = String(next + 1);
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-ssx-details]');
    if (toggle) {
      e.preventDefault();
      const table = toggle.parentElement?.querySelector<HTMLElement>('.ssx-table');
      if (!table) return;
      table.hidden = !table.hidden;
      toggle.setAttribute('aria-expanded', String(!table.hidden));
      toggle.classList.toggle('open', !table.hidden);
      return;
    }

    if (target.closest('[data-ssx-close]')) {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new Event(POPUP_CLOSE_EVENT));
    }
  });
}
