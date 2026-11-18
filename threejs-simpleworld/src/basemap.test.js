import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { metersPerDegree } from "./imagery.js";
import {
  MAP_COLORS,
  ROAD_COLOR,
  SIDEWALK_METRES,
  applyStreetColor,
  basemapLayout,
  collectMapFeatures,
  paintBasemap,
  projectToCanvas,
  ribbonRing,
} from "./basemap.js";

const BOUNDS = {
  lonWest: 106.69,
  lonEast: 106.71,
  latSouth: 10.76,
  latNorth: 10.78,
};

test("the district map file draws residential land, grass, parks, and roads", async () => {
  const data = JSON.parse(
    await readFile(new URL("../public/models/district1-map.json", import.meta.url), "utf8"),
  );
  assert.ok(data.residential.length > 0);
  assert.ok(data.grass.length > 0);
  assert.ok(data.parks.length > 0);
  assert.ok(data.roads.length > 1000);
  assert.equal(typeof data.roads[0].width, "number");
  assert.ok(data.roads[0].points.length >= 2);
});

test("map colors paint roads dark gray and keep land uses distinct", () => {
  assert.equal(ROAD_COLOR, "#3a3a3a");
  assert.equal(MAP_COLORS.road, ROAD_COLOR);
  assert.equal(MAP_COLORS.residential, "#e7d3b0");
  assert.equal(MAP_COLORS.grass, "#b5c98a");
  assert.equal(MAP_COLORS.park, "#6ea35a");
  assert.equal(MAP_COLORS.sidewalk, "#c8c2b8");
  assert.notEqual(MAP_COLORS.sidewalk, MAP_COLORS.road);
  assert.notEqual(MAP_COLORS.grass, MAP_COLORS.park);
});

test("street materials named streets take the dark gray road color", () => {
  const streets = { name: "streets", color: "#5c4636" };
  const walls = { name: "walls", color: "#ffffff" };
  applyStreetColor([streets, walls], ROAD_COLOR);
  assert.equal(streets.color, "#3a3a3a");
  assert.equal(walls.color, "#ffffff");
});

test("closed landuse and park ways become polygons and open highways become roads", () => {
  const features = collectMapFeatures([
    way(1, ring(106.7, 10.77, 0.002, 0.001), { landuse: "residential" }),
    way(2, ring(106.704, 10.772, 0.0004, 0.0003), { landuse: "grass" }),
    way(3, ring(106.705, 10.774, 0.0008, 0.0006), { leisure: "park" }),
    way(4, [[106.7, 10.771], [106.706, 10.771]], { highway: "residential", lanes: "2" }),
    way(5, [[106.7, 10.772], [106.702, 10.772]], { highway: "footway", footway: "sidewalk" }),
    way(6, [[106.7, 10.773], [106.702, 10.773]], { highway: "primary", tunnel: "yes" }),
  ]);

  assert.equal(features.residential.length, 1);
  assert.equal(features.grass.length, 1);
  assert.equal(features.parks.length, 1);
  assert.equal(features.roads.length, 1);
  assert.equal(features.roads[0].width, 7);
  assert.equal(features.residential[0].outer.length, 5);
  assert.deepEqual(features.residential[0].holes, []);
});

test("a multipolygon park keeps its inner ring as a hole", () => {
  const features = collectMapFeatures([
    {
      type: "relation",
      id: 9,
      tags: { type: "multipolygon", leisure: "park" },
      members: [
        { type: "way", ref: 11, role: "outer", geometry: geom(ring(106.7, 10.77, 0.004, 0.003)) },
        { type: "way", ref: 12, role: "inner", geometry: geom(ring(106.701, 10.771, 0.001, 0.0008)) },
      ],
    },
    way(11, ring(106.7, 10.77, 0.004, 0.003), { leisure: "park" }),
  ]);

  assert.equal(features.parks.length, 1);
  assert.equal(features.parks[0].holes.length, 1);
});

test("a sidewalk ribbon is one sidewalk wider than the road on each side", () => {
  const points = [[106.7, 10.77], [106.71, 10.77]];
  const road = ribbonRing(points, 6);
  const sidewalk = ribbonRing(points, 6 + SIDEWALK_METRES * 2);
  const { mLat } = metersPerDegree(10.77);
  const crossWidth = (ring) => Math.abs(ring[0][1] - ring[ring.length - 2][1]) * mLat;
  const roadWidth = crossWidth(road);
  const sidewalkWidth = crossWidth(sidewalk);
  assert.ok(Math.abs(roadWidth - 6) < 0.05, `road ${roadWidth}`);
  assert.ok(Math.abs(sidewalkWidth - (6 + SIDEWALK_METRES * 2)) < 0.05, `walk ${sidewalkWidth}`);
});

test("the north-west bound lands on the canvas origin and the south-east on the far corner", () => {
  const layout = basemapLayout(BOUNDS);
  const origin = projectToCanvas(BOUNDS.lonWest, BOUNDS.latNorth, layout);
  const far = projectToCanvas(BOUNDS.lonEast, BOUNDS.latSouth, layout);
  assert.ok(Math.abs(origin.x) < 1e-6);
  assert.ok(Math.abs(origin.y) < 1e-6);
  assert.ok(Math.abs(far.x - layout.width) < 1);
  assert.ok(Math.abs(far.y - layout.height) < 1);
  assert.ok(layout.width <= 4096);
  assert.ok(layout.height <= 4096);
});

test("painting fills paper, residential, grass, parks, sidewalks, then dark gray roads", () => {
  const features = {
    residential: [{ outer: ring(106.692, 10.762, 0.004, 0.004), holes: [] }],
    grass: [{ outer: ring(106.698, 10.766, 0.002, 0.002), holes: [] }],
    parks: [{ outer: ring(106.7, 10.768, 0.003, 0.002), holes: [ring(106.7005, 10.7684, 0.0006, 0.0004)] }],
    roads: [{ points: [[106.693, 10.77], [106.706, 10.77]], width: 8 }],
  };
  const context = fakeContext();
  paintBasemap(context, features, BOUNDS);

  const fills = context.ops.filter((op) => op.op === "fill" || op.op === "rect");
  assert.deepEqual(fills.map((op) => op.fill), [
    MAP_COLORS.paper,
    MAP_COLORS.residential,
    MAP_COLORS.grass,
    MAP_COLORS.park,
    MAP_COLORS.sidewalk,
    MAP_COLORS.road,
  ]);
  assert.equal(fills[0].op, "rect");
  const park = fills[3];
  assert.equal(park.fillRule, "evenodd");
  assert.ok(park.points.length > 8);
  assert.equal(fills[5].fill, "#3a3a3a");
});

function way(id, points, tags) {
  return { type: "way", id, tags, geometry: geom(points) };
}

function geom(points) {
  return points.map(([lon, lat]) => ({ lon, lat }));
}

function ring(lon, lat, width, height) {
  return [
    [lon, lat],
    [lon + width, lat],
    [lon + width, lat + height],
    [lon, lat + height],
    [lon, lat],
  ];
}

function fakeContext() {
  const ops = [];
  let fill = "";
  let current = [];
  return {
    ops,
    set fillStyle(value) {
      fill = value;
    },
    get fillStyle() {
      return fill;
    },
    fillRect(x, y, w, h) {
      ops.push({ op: "rect", fill, x, y, w, h });
    },
    beginPath() {
      current = [];
    },
    moveTo(x, y) {
      current.push([x, y]);
    },
    lineTo(x, y) {
      current.push([x, y]);
    },
    closePath() {},
    fill(fillRule) {
      ops.push({ op: "fill", fill, fillRule, points: current.slice() });
    },
  };
}
