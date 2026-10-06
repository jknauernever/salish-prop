/**
 * San Juan County's 2025 orthophotos (EagleView) as the imagery under every
 * data layer whenever the basemap is Satellite or Hybrid, from zoom 13 in.
 * Sharper and more current than Google's imagery in the islands, and the water
 * has no sun-glint. Below zoom 13 Google's imagery stays: the county's own
 * zoomed-out overviews are hazy and their stair-step outline stands out.
 *
 * The county service is not tile-cached, so each 256 px tile comes from its
 * dynamic export endpoint (~0.5 s per tile, rendered on demand). Outside the
 * county the Google imagery underneath shows through:
 *   - tiles outside the mosaic footprint are never requested;
 *   - tiles wholly inside it come back as JPG (~25 KB);
 *   - tiles straddling its edge come back as transparent PNG drawing only
 *     the image raster (layer 4): the flat blue-grey "Background" (layer 0)
 *     and the footprint/boundary outlines stay off, so only real photo
 *     pixels cover Google's imagery (~40–150 KB, few tiles).
 */

export const COUNTY_AERIALS_SERVICE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer';
export const COUNTY_AERIALS_ATTRIBUTION = '2025 aerials: San Juan County / EagleView';
const NAME = 'county-aerials-2025';
export const COUNTY_AERIALS_MIN_ZOOM = 13;

/** Mosaic footprint (the service's "Boundary" layer 2), lng/lat. */
const FOOTPRINT: [number, number][] = [[-122.9307,48.7969],[-122.9854,48.7959],[-122.9839,48.7597],[-122.9292,48.7607],[-122.9286,48.7463],[-122.9176,48.7465],[-122.9165,48.7175],[-122.9602,48.7168],[-122.9596,48.7023],[-123.0033,48.7015],[-123.0051,48.7449],[-123.0489,48.744],[-123.0479,48.7224],[-123.0698,48.7219],[-123.0692,48.7075],[-123.0801,48.7073],[-123.0788,48.6783],[-123.0898,48.6781],[-123.0891,48.6636],[-123.1328,48.6628],[-123.1331,48.67],[-123.144,48.6698],[-123.1444,48.677],[-123.1553,48.6768],[-123.1559,48.6913],[-123.1996,48.6904],[-123.2,48.6976],[-123.2437,48.6967],[-123.2416,48.6533],[-123.198,48.6542],[-123.1963,48.6181],[-123.2072,48.6179],[-123.2065,48.6034],[-123.2174,48.6032],[-123.2161,48.5742],[-123.1943,48.5747],[-123.1939,48.5674],[-123.183,48.5677],[-123.182,48.546],[-123.1712,48.5462],[-123.1698,48.5173],[-123.1589,48.5175],[-123.1583,48.503],[-123.1474,48.5032],[-123.1471,48.496],[-123.1362,48.4962],[-123.1359,48.489],[-123.1141,48.4894],[-123.1138,48.4822],[-123.1029,48.4824],[-123.1026,48.4752],[-123.0808,48.4756],[-123.0805,48.4683],[-123.0696,48.4686],[-123.0693,48.4613],[-123.0476,48.4617],[-123.0472,48.4545],[-123.0255,48.4549],[-123.0252,48.4477],[-122.9491,48.4491],[-122.9488,48.4419],[-122.9379,48.4421],[-122.9376,48.4348],[-122.9267,48.435],[-122.9264,48.4278],[-122.9047,48.4282],[-122.9041,48.4137],[-122.8498,48.4147],[-122.8495,48.4075],[-122.806,48.4082],[-122.8066,48.4227],[-122.7957,48.4229],[-122.7979,48.4807],[-122.7435,48.4816],[-122.7446,48.5106],[-122.7664,48.5102],[-122.7678,48.5464],[-122.7569,48.5466],[-122.7579,48.5755],[-122.7797,48.5751],[-122.782,48.633],[-122.7383,48.6337],[-122.741,48.7061],[-122.7519,48.7059],[-122.7522,48.7131],[-122.785,48.7126],[-122.7847,48.7054],[-122.8503,48.7042],[-122.8514,48.7332],[-122.7968,48.7341],[-122.7979,48.763],[-122.8635,48.7619],[-122.8641,48.7764],[-122.9298,48.7752],[-122.9307,48.7969]];

const R = 6378137;
const HALF = Math.PI * R;
const toMercX = (lng: number) => (lng * HALF) / 180;
const toMercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const RING = FOOTPRINT.map(([lng, lat]) => [toMercX(lng), toMercY(lat)] as const);
const BOX = {
  xmin: Math.min(...RING.map(p => p[0])), xmax: Math.max(...RING.map(p => p[0])),
  ymin: Math.min(...RING.map(p => p[1])), ymax: Math.max(...RING.map(p => p[1])),
};

function inside(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = RING.length - 1; i < RING.length; j = i++) {
    const [xi, yi] = RING[i], [xj, yj] = RING[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 'out' = skip, 'in' = wholly inside the footprint, 'edge' = straddles it. */
function classify(xmin: number, ymin: number, xmax: number, ymax: number): 'out' | 'in' | 'edge' {
  if (xmax <= BOX.xmin || xmin >= BOX.xmax || ymax <= BOX.ymin || ymin >= BOX.ymax) return 'out';
  const corners = [inside(xmin, ymin), inside(xmax, ymin), inside(xmin, ymax), inside(xmax, ymax)];
  // The footprint is a rectilinear outline, so a tile whose four corners are
  // inside and that holds no footprint vertex lies wholly inside it.
  const vertexInTile = RING.some(([x, y]) => x > xmin && x < xmax && y > ymin && y < ymax);
  if (corners.every(Boolean) && !vertexInTile) return 'in';
  return 'edge';
}

export function createCountyAerials(): google.maps.ImageMapType {
  return new google.maps.ImageMapType({
    getTileUrl(coord, zoom) {
      if (zoom < COUNTY_AERIALS_MIN_ZOOM) return null;
      const n = 2 ** zoom;
      const size = (2 * HALF) / n;
      const x = ((coord.x % n) + n) % n;
      const xmin = -HALF + x * size, xmax = xmin + size;
      const ymax = HALF - coord.y * size, ymin = ymax - size;
      const kind = classify(xmin, ymin, xmax, ymax);
      if (kind === 'out') return null;
      const fmt = kind === 'in' ? 'format=jpg&transparent=false' : 'format=png32&transparent=true&layers=show:4';
      return `${COUNTY_AERIALS_SERVICE}/export?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=3857&imageSR=3857&size=256,256&${fmt}&f=image`;
    },
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 22,
    name: NAME,
  });
}

export function isCountyAerials(mt: unknown): boolean {
  return (mt as google.maps.ImageMapType | undefined)?.name === NAME;
}

/** Index at which a data overlay should be inserted so it draws above the aerials. */
export function dataOverlayBase(map: google.maps.Map): number {
  return map.overlayMapTypes.getLength() > 0 && isCountyAerials(map.overlayMapTypes.getAt(0)) ? 1 : 0;
}

/** Basemaps the aerials sit on (imagery basemaps; Map and Terrain stay Google's). */
export function showsCountyAerials(mapTypeId: string | undefined | null): boolean {
  return mapTypeId === 'hybrid' || mapTypeId === 'satellite';
}
