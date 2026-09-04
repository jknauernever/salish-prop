/**
 * deck.gl on top of Google Maps: vector-tile layers for the datasets that
 * are too big to ship as one GeoJSON (parcels, buildings). Tiles come from
 * our own Cloud Storage bucket (built with tippecanoe, see README), so only
 * the tiles in view are downloaded and drawing happens on the GPU.
 *
 * One GoogleMapsOverlay per map holds every MVTLayer. Styling mirrors the
 * layer config (same fill / stroke colors and pixel widths as the Data
 * layers), so nothing changes visually. Clicks are re-broadcast as a window
 * event that FeaturePopup routes exactly like a Data-layer click.
 */
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { MVTLayer } from '@deck.gl/geo-layers';
import type { LayerConfig } from '../../types';

export const DECK_CLICK_EVENT = 'ssx-deck-click';

/** San Juan County bounding box [west, south, east, north] — the area the tiles cover. */
const TILE_EXTENT: [number, number, number, number] = [-123.35, 48.33, -122.65, 48.85];

export interface DeckClickDetail {
  layerId: string;
  properties: Record<string, unknown>;
  lat: number;
  lng: number;
}

interface Entry {
  config: LayerConfig;
  visible: boolean;
  /** User asked to see this layer at any zoom (ignore config.minZoom). */
  ignoreGate?: boolean;
}

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const m = hex.replace('#', '');
  if (m.length !== 6) return fallback;
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

class DeckManager {
  private overlay: GoogleMapsOverlay;
  private entries = new Map<string, Entry>();
  private live = new Map<string, MVTLayer>();
  private zoom: number;

  constructor(map: google.maps.Map) {
    this.zoom = map.getZoom() ?? 0;
    this.overlay = new GoogleMapsOverlay({
      // Google's interleaved WebGLOverlayView path hands deck a 16384 px canvas
      // on this vector map, so everything draws into the top-left corner. The
      // classic overlay (deck's own canvas, sized to the map div) is reliable.
      interleaved: false,
      layers: [],
      onClick: info => {
        if (!info.layer || !info.object || !info.coordinate) return;
        const properties = (info.object as { properties?: Record<string, unknown> }).properties ?? {};
        window.dispatchEvent(new CustomEvent<DeckClickDetail>(DECK_CLICK_EVENT, {
          detail: { layerId: info.layer.id, properties, lat: info.coordinate[1], lng: info.coordinate[0] },
        }));
      },
    });
    this.overlay.setMap(map);
    // Debug handle (harmless): lets us inspect deck's viewport from the console
    (window as unknown as Record<string, unknown>).__ssxDeck = this.overlay;
  }

  /** Add or update a tile layer. Visibility here already includes the zoom gate. */
  setLayer(config: LayerConfig, visible: boolean) {
    const prev = this.entries.get(config.id);
    this.entries.set(config.id, { config, visible, ignoreGate: prev?.ignoreGate });
    this.rebuild();
  }

  /** Show the layer regardless of its minZoom (or restore the gate). */
  setGateOverride(layerId: string, ignore: boolean) {
    const e = this.entries.get(layerId);
    if (!e || !!e.ignoreGate === ignore) return;
    e.ignoreGate = ignore;
    this.rebuild();
  }

  setVisible(layerId: string, visible: boolean) {
    const e = this.entries.get(layerId);
    if (!e || e.visible === visible) return;
    e.visible = visible;
    this.rebuild();
  }

  remove(layerId: string) {
    if (this.entries.delete(layerId)) this.rebuild();
  }

  setZoom(zoom: number) {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.rebuild();
  }

  /** Features from the tiles currently loaded for a layer (used by the radius report). */
  getRenderedFeatures(layerId: string): GeoJSON.Feature[] {
    const l = this.live.get(layerId);
    if (!l) return [];
    try {
      return (l.getRenderedFeatures() as unknown as GeoJSON.Feature[]) ?? [];
    } catch {
      return [];
    }
  }

  destroy() {
    this.overlay.setMap(null);
    this.overlay.finalize();
    this.entries.clear();
    this.live.clear();
  }

  private build(e: Entry): MVTLayer {
    const { config } = e;
    const t = config.tiles!;
    const st = config.style;
    const fill = hexToRgb(st.fillColor, [173, 181, 189]);
    const stroke = hexToRgb(st.strokeColor, [13, 79, 79]);
    const fillA = Math.round((st.fillOpacity ?? 0) * 255);
    const strokeA = Math.round((st.strokeOpacity ?? 1) * 255);
    const gated = !e.ignoreGate && config.minZoom != null && this.zoom < config.minZoom;
    const layer = new MVTLayer({
      id: config.id,
      data: t.url,
      minZoom: t.minZoom,
      maxZoom: t.maxZoom,
      // With an extent, deck keeps requesting the lowest tile zoom when the
      // map is zoomed out past it (instead of loading nothing), so a layer
      // gate like 13.5 works even though the tiles start at z13.
      extent: TILE_EXTENT,
      loadOptions: { mvt: { layers: [t.sourceLayer] } },
      uniqueIdProperty: t.idProperty ?? 'FID',
      visible: e.visible && !gated,
      pickable: true,
      filled: fillA > 0,
      stroked: true,
      getFillColor: [fill[0], fill[1], fill[2], fillA],
      getLineColor: [stroke[0], stroke[1], stroke[2], strokeA],
      lineWidthUnits: 'pixels',
      getLineWidth: st.strokeWeight ?? 1,
      lineWidthMinPixels: Math.min(st.strokeWeight ?? 1, 1),
      pointRadiusUnits: 'pixels',
      getPointRadius: 4,
    });
    this.live.set(config.id, layer);
    return layer;
  }

  private rebuild() {
    const layers = Array.from(this.entries.values()).map(e => this.build(e));
    this.overlay.setProps({ layers });
  }
}

const managers = new WeakMap<google.maps.Map, DeckManager>();

/** The deck.gl manager for a map, created on first use. */
export function getDeckManager(map: google.maps.Map): DeckManager {
  let m = managers.get(map);
  if (!m) {
    m = new DeckManager(map);
    managers.set(map, m);
  }
  return m;
}

let current: DeckManager | null = null;

/** Remember the active manager so non-React code (the radius report) can reach it. */
export function registerDeckManager(m: DeckManager | null) {
  current = m;
}

export function getDeckRenderedFeatures(layerId: string): GeoJSON.Feature[] {
  return current ? current.getRenderedFeatures(layerId) : [];
}
