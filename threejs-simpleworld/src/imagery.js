// OpenStreetMap does not publish satellite photos. The ground texture is
// Esri World Imagery (Maxar and others), requested live in the browser.
// Zoom 16 covers the whole district in one image. Zoom 19 is the sharpest
// layer Esri publishes for District 1 (about 0.3 m per pixel). Zoom 20 is
// an empty "map data not yet available" tile, so close views use 19.

export const IMAGERY_ZOOM = 16;
export const DETAIL_ZOOM = 19;
export const DETAIL_TILE_LIMIT = 64;
export const IMAGERY_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics";
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const MAX_TEXTURE_PX = 4096;
const DETAIL_MAX_DISTANCE_M = 1600;
const DETAIL_MIN_RADIUS_M = 220;
const DETAIL_MAX_RADIUS_M = 700;

export function metersPerDegree(latDeg) {
  const phi = (latDeg * Math.PI) / 180;
  return {
    mLon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
    mLat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
  };
}

/** Local metres (+X east, +Z south) back to WGS84. */
export function localToLonLat(x, z, originLon, originLat, mLon, mLat) {
  return [originLon + x / mLon, originLat - z / mLat];
}

/** WGS84 to local metres (+X east, +Z south). */
export function lonLatToLocal(lon, lat, originLon, originLat, mLon, mLat) {
  return [(lon - originLon) * mLon, (originLat - lat) * mLat];
}

/**
 * World metres on the district model to map longitude and latitude.
 * The model origin is the centre of bbox [minLon, minLat, maxLon, maxLat].
 */
export function mapLonLat(x, z, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const originLon = (minLon + maxLon) / 2;
  const originLat = (minLat + maxLat) / 2;
  const { mLon, mLat } = metersPerDegree(originLat);
  const [longitude, latitude] = localToLonLat(x, z, originLon, originLat, mLon, mLat);
  return { longitude, latitude };
}

export function formatMapCoordinate(value) {
  return value.toFixed(6);
}

/** Esri World Imagery: /tile/{zoom}/{row}/{column}. Row is Y, column is X. */
export function imageryTileUrl(zoom, x, y) {
  return `${TILE_URL}/${zoom}/${y}/${x}`;
}

/** How far around the view to request zoom-19 tiles. Zero means stay on the overview image. */
export function detailRadiusMeters(distance) {
  if (!(distance <= DETAIL_MAX_DISTANCE_M)) return 0;
  return Math.min(DETAIL_MAX_RADIUS_M, Math.max(DETAIL_MIN_RADIUS_M, distance * 0.9));
}

export function detailBounds(lon, lat, radiusMeters, mLon, mLat) {
  return {
    lonWest: lon - radiusMeters / mLon,
    lonEast: lon + radiusMeters / mLon,
    latSouth: lat - radiusMeters / mLat,
    latNorth: lat + radiusMeters / mLat,
  };
}

function mercatorToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

function mercatorToLat(y, zoom) {
  const mercator = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
}

/** West/north/east/south edges of one Web Mercator tile, in degrees. */
export function tileBounds(x, y, zoom) {
  return {
    lonWest: mercatorToLon(x, zoom),
    lonEast: mercatorToLon(x + 1, zoom),
    latNorth: mercatorToLat(y, zoom),
    latSouth: mercatorToLat(y + 1, zoom),
  };
}

export function tilesCovering(bounds, zoom) {
  const northWest = mercatorTile(bounds.lonWest, bounds.latNorth, zoom);
  const southEast = mercatorTile(
    Math.max(bounds.lonWest, bounds.lonEast - 1e-9),
    Math.min(bounds.latNorth, bounds.latSouth + 1e-9),
    zoom,
  );
  const x0 = Math.min(northWest.x, southEast.x);
  const x1 = Math.max(northWest.x, southEast.x);
  const y0 = Math.min(northWest.y, southEast.y);
  const y1 = Math.max(northWest.y, southEast.y);
  const tiles = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      tiles.push({ x, y, zoom });
    }
  }
  return tiles;
}

/** Tiles inside the view, nearest the camera first, capped so a close pass stays small. */
export function selectDetailTiles(bounds, zoom, centerLon, centerLat, limit) {
  const tiles = tilesCovering(bounds, zoom);
  if (tiles.length <= limit) return tiles;
  const center = mercatorTile(centerLon, centerLat, zoom);
  const distanceToCenter = (tile) => (tile.x - center.x) ** 2 + (tile.y - center.y) ** 2;
  tiles.sort((a, b) => {
    const delta = distanceToCenter(a) - distanceToCenter(b);
    if (delta !== 0) return delta;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
  return tiles.slice(0, limit);
}

export function mercatorTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function mercatorPixel(lon, lat, zoom) {
  const scale = 256 * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Tile failed: ${url}`));
    image.src = url;
  });
}

export function loadImageryTile(zoom, x, y) {
  return loadImage(imageryTileUrl(zoom, x, y));
}

/**
 * Stitch Esri World Imagery over a lon/lat rectangle. The canvas top is north
 * and the left edge is west, in Web Mercator so tiles land on pixel bounds.
 */
export async function stitchSatellite(bounds, { zoom = IMAGERY_ZOOM, onProgress } = {}) {
  const northWest = mercatorPixel(bounds.lonWest, bounds.latNorth, zoom);
  const southEast = mercatorPixel(bounds.lonEast, bounds.latSouth, zoom);
  const pixelWidth = Math.max(1, southEast.x - northWest.x);
  const pixelHeight = Math.max(1, southEast.y - northWest.y);
  const scale = Math.max(1, pixelWidth / MAX_TEXTURE_PX, pixelHeight / MAX_TEXTURE_PX);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pixelWidth / scale));
  canvas.height = Math.max(1, Math.round(pixelHeight / scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#e6dfd3";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const x0 = Math.floor(northWest.x / 256);
  const x1 = Math.floor((southEast.x - 1e-6) / 256);
  const y0 = Math.floor(northWest.y / 256);
  const y1 = Math.floor((southEast.y - 1e-6) / 256);
  const jobs = [];
  for (let tileX = x0; tileX <= x1; tileX += 1) {
    for (let tileY = y0; tileY <= y1; tileY += 1) {
      jobs.push([tileX, tileY]);
    }
  }

  let finished = 0;
  let failures = 0;
  async function drawJob([tileX, tileY]) {
    const url = imageryTileUrl(zoom, tileX, tileY);
    try {
      const image = await loadImage(url);
      const dx = (tileX * 256 - northWest.x) / scale;
      const dy = (tileY * 256 - northWest.y) / scale;
      context.drawImage(image, dx, dy, 256 / scale, 256 / scale);
    } catch {
      failures += 1;
    } finally {
      finished += 1;
      onProgress?.(finished, jobs.length);
    }
  }

  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await drawJob(job);
    }
  });
  await Promise.all(workers);
  if (failures === jobs.length) {
    throw new Error("Every satellite tile failed");
  }
  return canvas;
}
