/**
 * Custom 2D-canvas density overlay for Google Maps.
 *
 * Replaces the now-deprecated `google.maps.visualization.HeatmapLayer`
 * (deprecated May 2025, removed May 2026). We paint radial gradients on
 * a 2D canvas with additive ('lighter') compositing — overlapping warm
 * orange blobs naturally sum to the yellow-core / orange-mid / red-edge
 * "fire" look without a sampling/colormap step.
 *
 * Why a factory (not a top-level `class extends google.maps.OverlayView`):
 * The Maps JS API is loaded asynchronously via `importLibrary('maps')`.
 * When this module is first imported by the bundler, `google.maps` is
 * still `undefined` and `extends` would throw
 * `TypeError: Class extends value undefined`. We defer the class
 * definition until the first construction, by which time the Map has
 * been created and `google.maps.OverlayView` exists.
 *
 * API mirrors what the old HeatmapLayer offered so the call sites in
 * useLayers stay roughly the same:
 *   const h = createHeatmapOverlay({ data, radius, opacity })
 *   h.setData([...])
 *   h.setOpacity(0.5)
 *   h.setMap(map | null)
 */

export interface HeatmapOverlayOptions {
  data?: google.maps.LatLng[];
  /** Per-point gradient radius in CSS pixels. */
  radius?: number;
  /** Overlay opacity 0–1; combines multiplicatively with the per-stop alpha. */
  opacity?: number;
}

/**
 * Public shape of a heatmap overlay. Extends `google.maps.OverlayView`
 * so `setMap()` / `getMap()` are available for the caller. The interface
 * declaration is purely a compile-time type — there's no runtime cost
 * here even before Maps loads, because TS interfaces erase to nothing.
 */
export interface HeatmapOverlay extends google.maps.OverlayView {
  setData(data: google.maps.LatLng[]): void;
  setOpacity(opacity: number): void;
  setRadius(radius: number): void;
}

type HeatmapCtor = new (opts?: HeatmapOverlayOptions) => HeatmapOverlay;

// Memoized class — built once the first time createHeatmapOverlay() is
// called (which happens after the Maps API library has loaded).
let cachedCtor: HeatmapCtor | null = null;

function buildClass(): HeatmapCtor {
  if (typeof google === 'undefined' || !google.maps?.OverlayView) {
    throw new Error(
      'HeatmapOverlay: google.maps.OverlayView is not available yet. ' +
        'Wait for importLibrary("maps") to resolve before constructing.',
    );
  }

  class HeatmapOverlayImpl extends google.maps.OverlayView {
    private points: google.maps.LatLng[];
    private canvas: HTMLCanvasElement | null = null;
    private radius_: number;
    private opacity_: number;
    // rAF coalescing — google.maps calls draw() on every pan tick, but
    // the canvas only needs to repaint once per frame.
    private rafId: number | null = null;
    // Last painted viewport — skip the gradient loop on no-op draws.
    private lastLeft = NaN;
    private lastTop = NaN;
    private lastW = NaN;
    private lastH = NaN;

    constructor(options: HeatmapOverlayOptions = {}) {
      super();
      this.points = options.data ?? [];
      this.radius_ = options.radius ?? 30;
      this.opacity_ = options.opacity ?? 1;
    }

    setData(data: google.maps.LatLng[]): void {
      this.points = data;
      this.invalidate();
    }

    setOpacity(opacity: number): void {
      this.opacity_ = Math.max(0, Math.min(1, opacity));
      if (this.canvas) this.canvas.style.opacity = String(this.opacity_);
    }

    setRadius(radius: number): void {
      this.radius_ = radius;
      this.invalidate();
    }

    private invalidate(): void {
      this.lastLeft = NaN;
      this.scheduleDraw();
    }

    onAdd(): void {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      canvas.style.opacity = String(this.opacity_);
      canvas.style.willChange = 'transform';
      this.canvas = canvas;
      const panes = this.getPanes();
      panes?.overlayLayer.appendChild(canvas);
    }

    // OverlayView.draw() fires on every pan and zoom. We forward to a
    // rAF-coalesced renderer so the canvas paints at most once per frame.
    draw(): void {
      this.scheduleDraw();
    }

    private scheduleDraw(): void {
      if (this.rafId != null) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.paint();
      });
    }

    private paint(): void {
      if (!this.canvas) return;
      const map = this.getMap() as google.maps.Map | null;
      const proj = this.getProjection();
      if (!map || !proj) return;
      const bounds = map.getBounds();
      if (!bounds) return;

      const sw = proj.fromLatLngToDivPixel(bounds.getSouthWest());
      const ne = proj.fromLatLngToDivPixel(bounds.getNorthEast());
      if (!sw || !ne) return;

      const left = Math.min(sw.x, ne.x);
      const right = Math.max(sw.x, ne.x);
      const top = Math.min(sw.y, ne.y);
      const bottom = Math.max(sw.y, ne.y);
      const w = right - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) return;

      const sizeChanged = w !== this.lastW || h !== this.lastH;
      const positionChanged = left !== this.lastLeft || top !== this.lastTop;
      if (!sizeChanged && !positionChanged) return;

      if (sizeChanged) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
      }
      if (positionChanged) {
        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
      }
      this.lastLeft = left;
      this.lastTop = top;
      this.lastW = w;
      this.lastH = h;

      const ctx = this.canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      if (this.points.length === 0) return;

      ctx.globalCompositeOperation = 'lighter';
      const r = this.radius_;
      for (const pt of this.points) {
        const px = proj.fromLatLngToDivPixel(pt);
        if (!px) continue;
        const x = px.x - left;
        const y = px.y - top;
        if (x < -r || x > w + r || y < -r || y > h + r) continue;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0.0, 'rgba(255, 220, 100, 0.55)');
        grad.addColorStop(0.5, 'rgba(255, 110, 0, 0.30)');
        grad.addColorStop(1.0, 'rgba(255, 110, 0, 0.00)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    onRemove(): void {
      if (this.rafId != null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.canvas?.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.canvas = null;
      this.lastLeft = NaN;
      this.lastTop = NaN;
      this.lastW = NaN;
      this.lastH = NaN;
    }
  }

  // The subclass-of-OverlayView satisfies the HeatmapOverlay interface
  // (interface extends OverlayView, plus our extra methods). Cast through
  // `unknown` to detach TS from the anonymous class type.
  return HeatmapOverlayImpl as unknown as HeatmapCtor;
}

export function createHeatmapOverlay(options: HeatmapOverlayOptions = {}): HeatmapOverlay {
  if (!cachedCtor) cachedCtor = buildClass();
  return new cachedCtor(options);
}
