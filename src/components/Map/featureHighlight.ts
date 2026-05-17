/**
 * Shared highlight layer for click feedback. Any component that wants to
 * show "here's the thing you just clicked" can call `highlightFeatureGeometry`;
 * the closeclick handler in FeaturePopup (and ForestLossPopup) clears it.
 *
 * The layer is module-level state — one highlight at a time across the app.
 * Style varies by geometry type so polygons, lines, and points all read well.
 */
let highlightLayer: google.maps.Data | null = null;
let highlightLayerMap: google.maps.Map | null = null;

function ensureHighlightLayer(map: google.maps.Map): google.maps.Data {
  if (highlightLayer && highlightLayerMap === map) return highlightLayer;
  if (highlightLayer) highlightLayer.setMap(null);
  highlightLayer = new google.maps.Data({ map });
  highlightLayer.setStyle((feature) => {
    const geomType = feature.getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      return {
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#F97316',
          fillOpacity: 0,
          strokeColor: '#F97316',
          strokeWeight: 3,
          scale: 18,
        },
        zIndex: 10,
        clickable: false,
      };
    }
    if (geomType === 'LineString' || geomType === 'MultiLineString') {
      return {
        strokeColor: '#F97316',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        zIndex: 10,
        clickable: false,
      };
    }
    // Polygon / MultiPolygon
    return {
      strokeColor: '#F97316',
      strokeWeight: 4,
      fillColor: '#F97316',
      fillOpacity: 0.25,
      zIndex: 10,
      clickable: false,
    };
  });
  highlightLayerMap = map;
  return highlightLayer;
}

export function clearFeatureHighlight(): void {
  if (highlightLayer) {
    highlightLayer.forEach((f) => highlightLayer!.remove(f));
  }
}

export function highlightFeatureGeometry(
  geoFeature: GeoJSON.Feature | GeoJSON.Geometry | null,
  map: google.maps.Map,
): void {
  const hl = ensureHighlightLayer(map);
  hl.forEach((f) => hl.remove(f));
  if (!geoFeature) return;
  // Accept either a Feature or a bare Geometry — wrap geometry in a Feature for Data layer.
  if ('type' in geoFeature && geoFeature.type === 'Feature') {
    hl.addGeoJson(geoFeature);
  } else {
    hl.addGeoJson({
      type: 'Feature',
      properties: {},
      geometry: geoFeature as GeoJSON.Geometry,
    });
  }
}
