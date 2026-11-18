import assert from "node:assert/strict";
import test from "node:test";

import {
  DETAIL_TILE_LIMIT,
  DETAIL_ZOOM,
  detailBounds,
  detailRadiusMeters,
  formatMapCoordinate,
  imageryTileUrl,
  localToLonLat,
  lonLatToLocal,
  mapLonLat,
  mercatorTile,
  metersPerDegree,
  selectDetailTiles,
  tileBounds,
  tilesCovering,
} from "./imagery.js";

const BBOX = [106.6816889, 10.753519, 106.7151954, 10.7969493];

const ORIGIN_LON = 106.69844215;
const ORIGIN_LAT = 10.77523415;

test("district centre is the Esri tile fetched for zoom 16", () => {
  assert.deepEqual(mercatorTile(ORIGIN_LON, ORIGIN_LAT, 16), { x: 52191, y: 30794 });
});

test("local origin projects back to the district centre", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const [lon, lat] = localToLonLat(0, 0, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  assert.equal(lon, ORIGIN_LON);
  assert.equal(lat, ORIGIN_LAT);
  assert.ok(Math.abs(mLon - 109369.41637) < 1e-4);
  assert.ok(Math.abs(mLat - 110613.09249) < 1e-4);
});

test("a map point at the local origin is the district centre", () => {
  const point = mapLonLat(0, 0, BBOX);
  assert.equal(point.longitude, ORIGIN_LON);
  assert.equal(point.latitude, ORIGIN_LAT);
});

test("a map point one kilometre east and north uses the district metre scale", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const point = mapLonLat(1000, -1000, BBOX);
  assert.ok(Math.abs(point.longitude - (ORIGIN_LON + 1000 / mLon)) < 1e-12);
  assert.ok(Math.abs(point.latitude - (ORIGIN_LAT + 1000 / mLat)) < 1e-12);
});

test("map coordinates display as six decimal degrees", () => {
  const point = mapLonLat(0, 0, BBOX);
  assert.equal(formatMapCoordinate(point.latitude), "10.775234");
  assert.equal(formatMapCoordinate(point.longitude), "106.698442");
});

test("zoom 19 is the sharp Esri tile for the district centre", () => {
  assert.equal(DETAIL_ZOOM, 19);
  assert.deepEqual(mercatorTile(ORIGIN_LON, ORIGIN_LAT, DETAIL_ZOOM), {
    x: 417534,
    y: 246358,
  });
});

test("Esri requests are zoom, row, then column", () => {
  assert.equal(
    imageryTileUrl(19, 417534, 246358),
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/246358/417534",
  );
});

test("a tile's bounds contain the point that selected it", () => {
  const { x, y } = mercatorTile(ORIGIN_LON, ORIGIN_LAT, 19);
  const bounds = tileBounds(x, y, 19);
  assert.ok(ORIGIN_LON >= bounds.lonWest && ORIGIN_LON < bounds.lonEast);
  assert.ok(ORIGIN_LAT <= bounds.latNorth && ORIGIN_LAT > bounds.latSouth);
  const west = tileBounds(x - 1, y, 19);
  assert.ok(ORIGIN_LON >= west.lonEast);
});

test("local metres invert back to longitude and latitude", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const [x, z] = lonLatToLocal(
    ORIGIN_LON + 0.01,
    ORIGIN_LAT - 0.02,
    ORIGIN_LON,
    ORIGIN_LAT,
    mLon,
    mLat,
  );
  const [lon, lat] = localToLonLat(x, z, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  assert.ok(Math.abs(lon - (ORIGIN_LON + 0.01)) < 1e-12);
  assert.ok(Math.abs(lat - (ORIGIN_LAT - 0.02)) < 1e-12);
});

test("detail tiles cover a city block around the camera", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const bounds = detailBounds(ORIGIN_LON, ORIGIN_LAT, 100, mLon, mLat);
  const tiles = selectDetailTiles(bounds, 19, ORIGIN_LON, ORIGIN_LAT, DETAIL_TILE_LIMIT);
  assert.ok(tiles.length >= 1 && tiles.length <= 16);
  const center = mercatorTile(ORIGIN_LON, ORIGIN_LAT, 19);
  assert.ok(tiles.some((tile) => tile.x === center.x && tile.y === center.y && tile.zoom === 19));
  for (const tile of tiles) {
    const tileBox = tileBounds(tile.x, tile.y, tile.zoom);
    const overlaps =
      tileBox.lonEast > bounds.lonWest &&
      tileBox.lonWest < bounds.lonEast &&
      tileBox.latNorth > bounds.latSouth &&
      tileBox.latSouth < bounds.latNorth;
    assert.equal(overlaps, true);
  }
});

test("a wide view keeps only the tiles nearest the camera", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const bounds = detailBounds(ORIGIN_LON, ORIGIN_LAT, 5000, mLon, mLat);
  const tiles = selectDetailTiles(bounds, 19, ORIGIN_LON, ORIGIN_LAT, 4);
  assert.equal(tiles.length, 4);
  const center = mercatorTile(ORIGIN_LON, ORIGIN_LAT, 19);
  assert.ok(tiles.some((tile) => tile.x === center.x && tile.y === center.y));
  const dist = (tile) => (tile.x - center.x) ** 2 + (tile.y - center.y) ** 2;
  const kept = Math.max(...tiles.map(dist));
  const dropped = tilesCovering(bounds, 19).filter(
    (tile) => !tiles.some((keptTile) => keptTile.x === tile.x && keptTile.y === tile.y),
  );
  assert.ok(dropped.length > 0);
  for (const tile of dropped) assert.ok(dist(tile) >= kept);
});

test("sharper imagery is requested only from a close camera", () => {
  assert.equal(detailRadiusMeters(2000), 0);
  assert.equal(detailRadiusMeters(1600.1), 0);
  assert.equal(detailRadiusMeters(100), 220);
  assert.equal(detailRadiusMeters(400), 360);
  assert.equal(detailRadiusMeters(1500), 700);
});

test("east and north offsets follow the local metre scale", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const [eastLon, eastLat] = localToLonLat(1000, 0, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  const [northLon, northLat] = localToLonLat(0, -1000, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  assert.ok(Math.abs(eastLon - (ORIGIN_LON + 1000 / mLon)) < 1e-12);
  assert.equal(eastLat, ORIGIN_LAT);
  assert.equal(northLon, ORIGIN_LON);
  assert.ok(Math.abs(northLat - (ORIGIN_LAT + 1000 / mLat)) < 1e-12);
});
