import { mercatorPixel, metersPerDegree, IMAGERY_ZOOM } from "./imagery.js";

export const ROAD_COLOR = "#3a3a3a";
export const SIDEWALK_METRES = 2.4;
export const MAP_COLORS = {
  paper: "#f3efe6",
  residential: "#e7d3b0",
  grass: "#b5c98a",
  park: "#6ea35a",
  sidewalk: "#c8c2b8",
  road: ROAD_COLOR,
};

const MAX_TEXTURE_PX = 4096;
const MAX_ROAD_WIDTH_M = 30;
const LANE_WIDTH_M = 3.5;

const STREET_TYPES = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "busway",
  "road",
]);

const DEFAULT_WIDTH = {
  motorway: 14,
  motorway_link: 8,
  trunk: 12,
  trunk_link: 8,
  primary: 12,
  primary_link: 7,
  secondary: 9,
  secondary_link: 6,
  tertiary: 7,
  tertiary_link: 5,
  unclassified: 6,
  residential: 6,
  living_street: 6,
  service: 4,
  pedestrian: 8,
  busway: 8,
  road: 6,
};

export function applyStreetColor(materials, color) {
  for (const material of materials) {
    if (material?.name !== "streets") continue;
    if (typeof material.color?.set === "function") material.color.set(color);
    else material.color = color;
  }
}

export function collectMapFeatures(elements) {
  const features = { residential: [], grass: [], parks: [], roads: [] };
  const coveredWays = new Set();
  for (const element of elements) {
    if (element?.type !== "relation") continue;
    const kind = areaKind(element.tags || {});
    if (!kind) continue;
    for (const member of element.members || []) {
      if (member.type === "way" && member.ref != null) coveredWays.add(member.ref);
    }
    features[kind].push(...polygonsFromRelation(element));
  }
  for (const element of elements) {
    if (element?.type !== "way" || coveredWays.has(element.id)) continue;
    const tags = element.tags || {};
    const kind = areaKind(tags);
    const points = lineOf(element.geometry);
    if (kind && isClosed(points)) {
      features[kind].push({ outer: points, holes: [] });
      continue;
    }
    if (!isRoad(tags) || points.length < 2) continue;
    features.roads.push({ points, width: roadWidth(tags) });
  }
  return features;
}

export function ribbonRing(points, widthMetres) {
  if (points.length < 2) return null;
  const originLat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const { mLon, mLat } = metersPerDegree(originLat);
  const originLon = points[0][0];
  const originLat0 = points[0][1];
  const local = points.map(([lon, lat]) => [(lon - originLon) * mLon, (lat - originLat0) * mLat]);
  const { cleaned, closed } = cleanCenterline(local);
  if (cleaned.length < 2) return null;
  const half = widthMetres / 2;
  const left = [];
  const right = [];
  for (const [east, north, nx, ny] of zipOffsets(cleaned, closed, half)) {
    left.push([east + nx, north + ny]);
    right.push([east - nx, north - ny]);
  }
  const ring = [...left, ...right.reverse()].map(([east, north]) => [
    originLon + east / mLon,
    originLat0 + north / mLat,
  ]);
  ring.push(ring[0]);
  return ring;
}

export function basemapLayout(bounds, zoom = IMAGERY_ZOOM) {
  const northWest = mercatorPixel(bounds.lonWest, bounds.latNorth, zoom);
  const southEast = mercatorPixel(bounds.lonEast, bounds.latSouth, zoom);
  const pixelWidth = Math.max(1, southEast.x - northWest.x);
  const pixelHeight = Math.max(1, southEast.y - northWest.y);
  const scale = Math.max(1, pixelWidth / MAX_TEXTURE_PX, pixelHeight / MAX_TEXTURE_PX);
  return {
    zoom,
    northWest,
    scale,
    width: Math.max(1, Math.round(pixelWidth / scale)),
    height: Math.max(1, Math.round(pixelHeight / scale)),
  };
}

export function projectToCanvas(lon, lat, layout) {
  const pixel = mercatorPixel(lon, lat, layout.zoom);
  return {
    x: (pixel.x - layout.northWest.x) / layout.scale,
    y: (pixel.y - layout.northWest.y) / layout.scale,
  };
}

export function paintBasemap(context, features, bounds) {
  const layout = basemapLayout(bounds);
  context.fillStyle = MAP_COLORS.paper;
  context.fillRect(0, 0, layout.width, layout.height);
  fillPolygons(context, features.residential, MAP_COLORS.residential, layout);
  fillPolygons(context, features.grass, MAP_COLORS.grass, layout);
  fillPolygons(context, features.parks, MAP_COLORS.park, layout);
  for (const road of features.roads) {
    const ring = ribbonRing(road.points, road.width + SIDEWALK_METRES * 2);
    if (ring) fillRing(context, ring, MAP_COLORS.sidewalk, layout);
  }
  for (const road of features.roads) {
    const ring = ribbonRing(road.points, road.width);
    if (ring) fillRing(context, ring, MAP_COLORS.road, layout);
  }
}

export function createBasemapCanvas(features, bounds) {
  const layout = basemapLayout(bounds);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  paintBasemap(canvas.getContext("2d"), features, bounds);
  return canvas;
}

function fillPolygons(context, polygons, color, layout) {
  for (const polygon of polygons) fillPolygon(context, polygon, color, layout);
}

function fillPolygon(context, polygon, color, layout) {
  context.fillStyle = color;
  context.beginPath();
  traceRing(context, polygon.outer, layout);
  for (const hole of polygon.holes) traceRing(context, hole, layout);
  context.fill("evenodd");
}

function fillRing(context, ring, color, layout) {
  context.fillStyle = color;
  context.beginPath();
  traceRing(context, ring, layout);
  context.fill();
}

function traceRing(context, ring, layout) {
  ring.forEach(([lon, lat], index) => {
    const point = projectToCanvas(lon, lat, layout);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function areaKind(tags) {
  if (tags.landuse === "residential") return "residential";
  if (tags.landuse === "grass" || tags.landuse === "meadow" || tags.natural === "grassland") return "grass";
  if (tags.leisure === "park" || tags.leisure === "garden") return "parks";
  return null;
}

function isRoad(tags) {
  return STREET_TYPES.has(tags.highway) && tags.tunnel !== "yes" && tags.area !== "yes";
}

function roadWidth(tags) {
  const tagged = parseWidth(tags.width);
  const lanes = Number.parseFloat(tags.lanes);
  const width = tagged ?? (Number.isFinite(lanes) && lanes > 0 ? lanes * LANE_WIDTH_M : DEFAULT_WIDTH[tags.highway] ?? 6);
  return Math.min(Math.max(width, 0.5), MAX_ROAD_WIDTH_M);
}

function parseWidth(value) {
  if (value == null) return null;
  const match = String(value).match(/[\d.]+/);
  if (!match) return null;
  const width = Number(match[0]);
  return Number.isFinite(width) && width > 0 ? width : null;
}

function polygonsFromRelation(element) {
  const outers = [];
  const inners = [];
  for (const member of element.members || []) {
    const line = lineOf(member.geometry);
    if (line.length < 2) continue;
    if (member.role === "inner") inners.push(line);
    else outers.push(line);
  }
  const holes = stitchRings(inners);
  return stitchRings(outers).map((outer) => ({
    outer,
    holes: holes.filter((hole) => ringContains(outer, hole[0][0], hole[0][1])),
  }));
}

function stitchRings(lines) {
  const unused = lines.map((line) => line.map((point) => point.slice()));
  const rings = [];
  while (unused.length) {
    let chain = unused.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let index = 0; index < unused.length; index += 1) {
        const part = unused[index];
        const joined = joinChain(chain, part);
        if (!joined) continue;
        chain = joined;
        unused.splice(index, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(chain) && chain.length >= 4) rings.push(chain);
  }
  return rings;
}

function joinChain(chain, part) {
  if (samePoint(chain.at(-1), part[0])) return chain.concat(part.slice(1));
  if (samePoint(chain.at(-1), part.at(-1))) return chain.concat(part.slice(0, -1).reverse());
  if (samePoint(chain[0], part.at(-1))) return part.concat(chain.slice(1));
  if (samePoint(chain[0], part[0])) return part.slice().reverse().concat(chain.slice(1));
  return null;
}

function lineOf(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry.map((point) => [Number(point.lon ?? point[0]), Number(point.lat ?? point[1])]);
}

function isClosed(points) {
  return points.length >= 4 && samePoint(points[0], points.at(-1));
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-7 && Math.abs(a[1] - b[1]) <= 1e-7;
}

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cleanCenterline(points) {
  const cleaned = [];
  for (const [east, north] of points) {
    if (!cleaned.length || Math.hypot(east - cleaned.at(-1)[0], north - cleaned.at(-1)[1]) > 0.05) {
      cleaned.push([east, north]);
    }
  }
  let closed = false;
  if (
    cleaned.length >= 3
    && Math.hypot(cleaned[0][0] - cleaned.at(-1)[0], cleaned[0][1] - cleaned.at(-1)[1]) <= 0.05
  ) {
    cleaned.pop();
    closed = true;
  }
  return { cleaned, closed };
}

function zipOffsets(points, closed, half) {
  return leftOffsets(points, closed).map(([nx, ny], index) => [
    points[index][0],
    points[index][1],
    nx * half,
    ny * half,
  ]);
}

function leftOffsets(points, closed) {
  const leftOf = (start, end) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    return [-dy / length, dx / length];
  };
  const count = points.length;
  const at = (index) => points[(index + count) % count];
  const offsets = [];
  for (let index = 0; index < count; index += 1) {
    if (!closed && index === 0) {
      offsets.push(leftOf(points[0], points[1]));
      continue;
    }
    if (!closed && index === count - 1) {
      offsets.push(leftOf(points[count - 2], points[count - 1]));
      continue;
    }
    const incoming = leftOf(at(index - 1), points[index]);
    const outgoing = leftOf(points[index], at(index + 1));
    const mx = incoming[0] + outgoing[0];
    const my = incoming[1] + outgoing[1];
    const length = Math.hypot(mx, my);
    if (length < 1e-6) {
      offsets.push(incoming);
      continue;
    }
    const unit = [mx / length, my / length];
    const dot = incoming[0] * unit[0] + incoming[1] * unit[1];
    offsets.push(dot < 0.5 ? incoming : [unit[0] / dot, unit[1] / dot]);
  }
  return offsets;
}
