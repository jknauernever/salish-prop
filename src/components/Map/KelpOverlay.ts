/**
 * Kelp "chart symbol" overlay: draws kelp patches on a 2D canvas using the
 * classic nautical-chart kelp squiggle (wavy stem with leaf clusters) as a
 * repeating pattern fill, with a pale cream palette that stays legible over
 * both dark water and bright beaches in satellite imagery.
 *
 * Zoomed out (below PATTERN_MIN_ZOOM) the squiggles would be noise, so the
 * patches are drawn as soft glowing bands instead — enough mass to read
 * "there's a lot of kelp here" at county scale.
 *
 * Same deferred-class pattern as HeatmapOverlay.ts: `google.maps.OverlayView`
 * doesn't exist until the Maps library has loaded, so the class is built on
 * first use.
 */

export interface KelpOverlay extends google.maps.OverlayView {
  setData(data: GeoJSON.FeatureCollection): void;
}

type Ring = [number, number][]; // [lng, lat]
interface Patch {
  rings: Ring[];
  bbox: [number, number, number, number]; // minLng, minLat, maxLng, maxLat
}

const PATTERN_MIN_ZOOM = 12.5;
const REF_ZOOM = 12; // geometry cache zoom (world-pixel precision vs. Path2D float range)
const CREAM = '#FFF4CC';
const CREAM_RGB = '255, 244, 204';

let cachedCtor: (new () => KelpOverlay) | null = null;

/**
 * One kelp squiggle: a wavy stem with small leaf ovals, on a transparent tile.
 * `size`/`scale` are CSS px; the tile is rasterized at `dpr` × so it stays
 * crisp on retina screens (the pattern transform divides the dpr back out).
 */
function makeSquiggleTile(size: number, scale: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = CREAM;
  ctx.fillStyle = CREAM;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.4 * scale;

  // Two offset stems per tile so the repeat doesn't read as a grid.
  const stems: [number, number, number][] = [
    [size * 0.28, size * 0.1, 1],
    [size * 0.72, size * 0.55, -1],
  ];
  for (const [x0, y0, dir] of stems) {
    const h = size * 0.42;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + 3 * dir * scale, y0 + h * 0.3, x0 - 3 * dir * scale, y0 + h * 0.6, x0, y0 + h);
    ctx.stroke();
    // leaf clusters at two points along the stem
    for (const t of [0.35, 0.8]) {
      const y = y0 + h * t;
      const sway = Math.sin(t * Math.PI) * 2 * dir * scale;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x0 + sway + side * 2.6 * scale, y, 2.2 * scale, 1.1 * scale, side * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return c;
}

function buildClass(): new () => KelpOverlay {
  if (typeof google === 'undefined' || !google.maps?.OverlayView) {
    throw new Error('KelpOverlay: google.maps.OverlayView is not available yet.');
  }

  class KelpOverlayImpl extends google.maps.OverlayView implements KelpOverlay {
    private patches: Patch[] = [];
    private canvas: HTMLCanvasElement | null = null;
    private rafId: number | null = null;
    private tileCache = new Map<string, CanvasPattern>();
    // Projected geometry cache: Path2D per patch in div-pixel space, valid for
    // one zoom level (div pixels are stable across pans at a fixed zoom). This
    // makes an animation frame just fills and strokes — no re-projection.
    private pathCache: { zoom: number; items: { path: Path2D; bbox: [number, number, number, number] }[] } | null = null;
    // Sway animation: the squiggle pattern drifts a few pixels on a slow
    // sine so the fronds appear to stream in the current. Runs only while
    // the pattern is visible (zoomed in) and the overlay is on a map.
    private animId: number | null = null;
    private animStart = performance.now();
    private lastFrame = 0;
    private frameInterval = 40;

    private startAnimation(): void {
      if (this.animId != null) return;
      const tick = (now: number) => {
        this.animId = requestAnimationFrame(tick);
        // ~24 fps is plenty for a slow drift; back off to ~8 fps if frames are slow
        if (now - this.lastFrame < this.frameInterval) return;
        this.lastFrame = now;
        const t0 = performance.now();
        this.paint(now);
        const cost = performance.now() - t0;
        this.frameInterval = cost > 25 ? 120 : 40;
      };
      this.animId = requestAnimationFrame(tick);
    }

    private stopAnimation(): void {
      if (this.animId != null) cancelAnimationFrame(this.animId);
      this.animId = null;
    }

    setData(data: GeoJSON.FeatureCollection): void {
      const out: Patch[] = [];
      for (const f of data.features) {
        const g = f.geometry;
        if (!g) continue;
        const polys: Ring[][] =
          g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : [];
        for (const rings of polys) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const [lng, lat] of rings[0]) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          out.push({ rings, bbox: [minLng, minLat, maxLng, maxLat] });
        }
      }
      this.patches = out;
      this.pathCache = null;
      this.frame = null;
      this.draw();
    }

    /**
     * Paths are built once in "world pixels" at REF_ZOOM (Mercator). At render
     * time the canvas transform scales them to the current zoom and shifts
     * them into div-pixel space, so zooming never rebuilds geometry.
     */
    private worldPaths() {
      if (this.pathCache) return this.pathCache.items;
      const scale = 256 * Math.pow(2, REF_ZOOM);
      const items: { path: Path2D; bbox: [number, number, number, number] }[] = [];
      for (const p of this.patches) {
        const path = new Path2D();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of p.rings) {
          for (let i = 0; i < ring.length; i++) {
            const sLat = Math.sin((ring[i][1] * Math.PI) / 180);
            const x = ((ring[i][0] + 180) / 360) * scale;
            const y = (0.5 - Math.log((1 + sLat) / (1 - sLat)) / (4 * Math.PI)) * scale;
            if (i === 0) path.moveTo(x, y);
            else path.lineTo(x, y);
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
          path.closePath();
        }
        items.push({ path, bbox: [x0, y0, x1, y1] });
      }
      this.pathCache = { zoom: REF_ZOOM, items };
      return items;
    }

    private zoomListener: google.maps.MapsEventListener | null = null;

    onAdd(): void {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      this.canvas = canvas;
      this.getPanes()?.overlayLayer.appendChild(canvas);
      // Vector maps zoom fractionally and continuously; re-layout on every
      // zoom tick so the overlay follows the animation instead of snapping.
      const map = this.getMap() as google.maps.Map | null;
      if (map) this.zoomListener = map.addListener('zoom_changed', () => this.draw());
    }

    onRemove(): void {
      this.stopAnimation();
      this.frame = null;
      this.zoomListener?.remove();
      this.zoomListener = null;
      this.canvas?.remove();
      this.canvas = null;
      if (this.rafId != null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Google calls draw() when the map's projection/pane changes (pan end,
    // zoom, re-origin). That is the ONLY place we read the projection; the
    // sway loop just repaints from the last frame it produced. Repainting from
    // fresh getZoom()/projection reads mid-animation was fighting Google's own
    // pane transform and produced the jitter.
    private frame: {
      left: number; top: number; w: number; h: number; k: number; ox: number; oy: number; zoom: number;
      /** Patch paths already transformed into canvas pixel space (CSS px) for this layout. */
      screen: { path: Path2D; bbox: [number, number, number, number] }[];
    } | null = null;

    // Synchronous: Google calls draw() exactly when the pane/projection is
    // settled for a frame. Deferring to the next animation frame left one
    // frame where the old raster sat at the new zoom — visible as a flicker.
    draw(): void {
      const changed = this.updateLayout();
      // Pans don't need a repaint: the overlay pane moves the canvas. Only a
      // new layout (zoom change / re-origin / left the padded area) does.
      if (changed) this.paint(performance.now());
    }

    private pattern(ctx: CanvasRenderingContext2D, zoom: number, dpr: number): CanvasPattern | null {
      // Larger glyphs as you zoom in, in steps to keep the cache small.
      const step = zoom >= 18 ? 4 : zoom >= 16 ? 3 : zoom >= 14 ? 2 : 1;
      const key = `${step}@${dpr}`;
      let p = this.tileCache.get(key);
      if (!p) {
        const size = 22 + step * 7;
        const tile = makeSquiggleTile(size, 0.85 + step * 0.2, dpr);
        p = ctx.createPattern(tile, 'repeat') ?? undefined;
        if (p) this.tileCache.set(key, p);
      }
      return p ?? null;
    }

    /** Read the map projection once and decide where the canvas sits (div-pixel space). Returns true if the layout changed. */
    private updateLayout(): boolean {
      const canvas = this.canvas;
      const map = this.getMap() as google.maps.Map | null;
      const proj = this.getProjection();
      if (!canvas || !map || !proj) return false;
      const bounds = map.getBounds();
      if (!bounds) return false;
      const zoom = map.getZoom() ?? 0;

      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const tl = proj.fromLatLngToDivPixel(new google.maps.LatLng(ne.lat(), sw.lng()));
      const br = proj.fromLatLngToDivPixel(new google.maps.LatLng(sw.lat(), ne.lng()));
      if (!tl || !br) return false;
      const vw = Math.ceil(br.x - tl.x), vh = Math.ceil(br.y - tl.y);
      if (vw <= 0 || vh <= 0) return false;

      // World(REF_ZOOM) → div pixels. Derive the scale and offset from the two
      // API-projected viewport corners rather than assuming 2^(zoom-REF): at
      // fractional zooms Google's div-pixel scale is not exactly that, and the
      // error grows with distance from any single reference point (which is
      // what made the overlay drift off the click highlight).
      const refScale = 256 * Math.pow(2, REF_ZOOM);
      const world = (lng: number, lat: number): [number, number] => {
        const sl = Math.sin((lat * Math.PI) / 180);
        return [((lng + 180) / 360) * refScale, (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * refScale];
      };
      const [wxA, wyA] = world(sw.lng(), ne.lat()); // top-left
      const [wxB, wyB] = world(ne.lng(), sw.lat()); // bottom-right
      const kx = (br.x - tl.x) / (wxB - wxA);
      const ky = (br.y - tl.y) / (wyB - wyA);
      const k = (kx + ky) / 2;
      const ox = tl.x - wxA * k, oy = tl.y - wyA * k;

      // Keep the canvas where it is unless the zoom changed, the div-pixel
      // origin moved (ox/oy differ), or the viewport left the padded area.
      const F = this.frame;
      // (ox/oy are derived from the viewport corners, so tolerate sub-pixel
      // float drift between pans — an exact compare would re-layout every frame.)
      const covered =
        F && F.zoom === zoom && Math.abs(F.k - k) < 1e-9 &&
        Math.abs(F.ox - ox) < 0.5 && Math.abs(F.oy - oy) < 0.5 &&
        tl.x >= F.left && tl.y >= F.top && br.x <= F.left + F.w && br.y <= F.top + F.h;
      if (covered) return false;

      const pad = Math.round(Math.max(vw, vh) * 0.5);
      const left = Math.floor(tl.x) - pad, top = Math.floor(tl.y) - pad;
      const w = vw + 2 * pad, h = vh + 2 * pad;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;

      // Bake world → canvas-pixel transform into the paths once per layout so
      // painting (and the pattern fill) happens in an unscaled context — a
      // pattern sampled inside a 256× scaled context renders pixelated.
      const m = new DOMMatrix([k, 0, 0, k, ox - left, oy - top]);
      const vx0 = -50, vy0 = -50, vx1 = w + 50, vy1 = h + 50;
      const screen: { path: Path2D; bbox: [number, number, number, number] }[] = [];
      for (const { path, bbox } of this.worldPaths()) {
        const sb: [number, number, number, number] = [bbox[0] * k + ox - left, bbox[1] * k + oy - top, bbox[2] * k + ox - left, bbox[3] * k + oy - top];
        if (sb[2] < vx0 || sb[0] > vx1 || sb[3] < vy0 || sb[1] > vy1) continue;
        const sp = new Path2D();
        sp.addPath(path, m);
        screen.push({ path: sp, bbox: sb });
      }
      this.frame = { left, top, w, h, k, ox, oy, zoom, screen };
      return true;
    }

    /** Repaint from the cached frame — no projection reads here. */
    private paint(now: number = performance.now()): void {
      const canvas = this.canvas;
      const F = this.frame;
      if (!canvas || !F) return;
      const { w, h, zoom, screen } = F;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const usePattern = zoom >= PATTERN_MIN_ZOOM;
      const pat = usePattern ? this.pattern(ctx, zoom, dpr) : null;
      if (usePattern) this.startAnimation(); else this.stopAnimation();

      // Sway phase: ±3 px sideways over ~7 s, plus a gentle ±1 px lift, so the
      // fronds drift like blades streaming in a slow current.
      const tSec = (now - this.animStart) / 1000;
      const swayX = Math.sin((tSec / 7) * Math.PI * 2) * 3;
      const swayY = Math.sin((tSec / 11) * Math.PI * 2 + 1) * 1;
      if (pat && typeof DOMMatrix !== 'undefined') {
        // Tile is rasterized at dpr×; the context is scaled by dpr, so undo it
        pat.setTransform(new DOMMatrix().scale(1 / dpr).translate(swayX * dpr, swayY * dpr));
      }

      // Zoomed-out treatment: a translucent cream band. (No canvas shadow
      // blur — it is software-blurred per path and was the main perf cost.)
      const t = Math.min(1, Math.max(0, (zoom - 10) / (PATTERN_MIN_ZOOM - 10)));
      const haloW = 7 - 4 * t; // 7 px at z10 → 3 px at z12.5

      for (const { path } of screen) {
        if (usePattern && pat) {
          ctx.fillStyle = `rgba(${CREAM_RGB}, 0.18)`;
          ctx.fill(path, 'evenodd');
          ctx.fillStyle = pat;
          ctx.fill(path, 'evenodd');
          ctx.strokeStyle = `rgba(${CREAM_RGB}, 0.9)`;
          ctx.lineWidth = 1.2;
          ctx.stroke(path);
        } else {
          ctx.strokeStyle = `rgba(${CREAM_RGB}, 0.32)`;
          ctx.lineWidth = haloW;
          ctx.lineJoin = 'round';
          ctx.stroke(path);
          ctx.fillStyle = `rgba(${CREAM_RGB}, 0.8)`;
          ctx.fill(path, 'evenodd');
        }
      }
    }
  }

  return KelpOverlayImpl as unknown as new () => KelpOverlay;
}

export function createKelpOverlay(data?: GeoJSON.FeatureCollection): KelpOverlay {
  if (!cachedCtor) cachedCtor = buildClass();
  const o = new cachedCtor();
  if (data) o.setData(data);
  return o;
}
