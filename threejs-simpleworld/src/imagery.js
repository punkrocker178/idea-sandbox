// OpenStreetMap does not publish satellite photos. The ground texture is
// Esri World Imagery (Maxar and others), requested live in the browser.

export const IMAGERY_ZOOM = 16;
export const IMAGERY_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics";
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const MAX_TEXTURE_PX = 4096;

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
    const url = `${TILE_URL}/${zoom}/${tileY}/${tileX}`;
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
