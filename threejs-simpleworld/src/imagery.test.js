import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMapCoordinate,
  localToLonLat,
  mapLonLat,
  mercatorTile,
  metersPerDegree,
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

test("east and north offsets follow the local metre scale", () => {
  const { mLon, mLat } = metersPerDegree(ORIGIN_LAT);
  const [eastLon, eastLat] = localToLonLat(1000, 0, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  const [northLon, northLat] = localToLonLat(0, -1000, ORIGIN_LON, ORIGIN_LAT, mLon, mLat);
  assert.ok(Math.abs(eastLon - (ORIGIN_LON + 1000 / mLon)) < 1e-12);
  assert.equal(eastLat, ORIGIN_LAT);
  assert.equal(northLon, ORIGIN_LON);
  assert.ok(Math.abs(northLat - (ORIGIN_LAT + 1000 / mLat)) < 1e-12);
});
