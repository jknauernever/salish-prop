/**
 * Phone replacement for google.maps.InfoWindow: the same popup HTML, shown
 * as a full-width bottom sheet over the map instead of a floating bubble.
 *
 * It mirrors the handful of InfoWindow methods FeaturePopup uses
 * (setContent / setPosition / open / close / isOpen / addListener) and fires
 * the same 'domready' and 'closeclick' events through google.maps.event, so
 * the code that fills tabs and snapshots after open runs unchanged.
 */

export interface PopupHost {
  setContent(content?: string | Element | Text | null): void;
  setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined): void;
  open(map?: google.maps.Map | google.maps.StreetViewPanorama | null): void;
  close(): void;
  readonly isOpen: boolean;
  addListener(eventName: string, handler: (...args: unknown[]) => void): google.maps.MapsEventListener;
}

const SHEET_CLASS = 'ssx-sheet';

export class MobileSheetWindow implements PopupHost {
  private el: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private content: string | Element | Text | null = null;
  private position: google.maps.LatLng | google.maps.LatLngLiteral | null = null;
  private map: google.maps.Map | null = null;
  private _open = false;

  get isOpen(): boolean {
    return this._open;
  }

  setContent(content?: string | Element | Text | null): void {
    this.content = content ?? null;
    if (this._open) this.render();
  }

  setPosition(position: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined): void {
    this.position = position ?? null;
  }

  addListener(eventName: string, handler: (...args: unknown[]) => void): google.maps.MapsEventListener {
    return google.maps.event.addListener(this, eventName, handler);
  }

  open(map?: google.maps.Map | google.maps.StreetViewPanorama | null): void {
    if (map instanceof google.maps.Map) this.map = map;
    if (!this.map) return;
    if (!this.el) {
      const host = this.map.getDiv().parentElement ?? document.body;
      const el = document.createElement('div');
      el.className = SHEET_CLASS;
      el.setAttribute('role', 'dialog');
      const grip = document.createElement('div');
      grip.className = 'ssx-sheet-grip';
      grip.addEventListener('click', () => this.closeFromUser());
      const body = document.createElement('div');
      body.className = 'ssx-sheet-body';
      el.append(grip, body);
      host.appendChild(el);
      this.el = el;
      this.body = body;
    }
    const wasOpen = this._open;
    this._open = true;
    this.el!.classList.add('is-open');
    this.render();
    if (!wasOpen) this.revealPosition();
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.el?.classList.remove('is-open');
    if (this.body) this.body.innerHTML = '';
  }

  /** Close triggered by the sheet itself (grip tap) — same as InfoWindow's × */
  private closeFromUser(): void {
    this.close();
    google.maps.event.trigger(this, 'closeclick');
  }

  private render(): void {
    if (!this.body) return;
    this.body.innerHTML = '';
    if (typeof this.content === 'string') this.body.innerHTML = this.content;
    else if (this.content) this.body.appendChild(this.content);
    this.body.scrollTop = 0;
    // Same timing contract as InfoWindow: content is in the DOM now
    google.maps.event.trigger(this, 'domready');
  }

  /** Nudge the map so the clicked point sits in the strip above the sheet. */
  private revealPosition(): void {
    if (!this.map || !this.position || !this.el) return;
    const mapH = this.map.getDiv().clientHeight;
    const sheetH = this.el.getBoundingClientRect().height || mapH * 0.6;
    this.map.panTo(this.position);
    // Visible strip is the top (mapH - sheetH); put the point in its middle.
    this.map.panBy(0, Math.round(sheetH / 2));
  }
}
