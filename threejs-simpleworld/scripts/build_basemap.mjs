import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectMapFeatures } from "../src/basemap.js";

const BBOX = [106.6816889, 10.753519, 106.7151954, 10.7969493];
const BBOX_TEXT = BBOX.join(",");
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const OSM_API = "https://api.openstreetmap.org/api/0.6/map";
const USER_AGENT = "threejs-simpleworld/0.1 (district map build)";

const QUERY = `
[out:json][timeout:180];
(
  way["landuse"="residential"](${BBOX_TEXT});
  way["landuse"="grass"](${BBOX_TEXT});
  way["landuse"="meadow"](${BBOX_TEXT});
  way["natural"="grassland"](${BBOX_TEXT});
  way["leisure"="park"](${BBOX_TEXT});
  way["leisure"="garden"](${BBOX_TEXT});
  relation["landuse"="residential"](${BBOX_TEXT});
  relation["landuse"="grass"](${BBOX_TEXT});
  relation["landuse"="meadow"](${BBOX_TEXT});
  relation["natural"="grassland"](${BBOX_TEXT});
  relation["leisure"="park"](${BBOX_TEXT});
  relation["leisure"="garden"](${BBOX_TEXT});
  way["highway"](${BBOX_TEXT});
);
out geom;
`.trim();

const output = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/models/district1-map.json",
);

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function ring(points) {
  return points.map(([lon, lat]) => [round(lon), round(lat)]);
}

function compact(features) {
  return {
    residential: features.residential.map((polygon) => ({
      outer: ring(polygon.outer),
      holes: polygon.holes.map(ring),
    })),
    grass: features.grass.map((polygon) => ({
      outer: ring(polygon.outer),
      holes: polygon.holes.map(ring),
    })),
    parks: features.parks.map((polygon) => ({
      outer: ring(polygon.outer),
      holes: polygon.holes.map(ring),
    })),
    roads: features.roads.map((road) => ({
      width: Math.round(road.width * 10) / 10,
      points: ring(road.points),
    })),
  };
}

function attr(line, name) {
  const match = line.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (!match) return "";
  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseOsmXml(xml) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  let current = null;
  for (const line of xml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("<node ")) {
      nodes.set(attr(trimmed, "id"), [Number(attr(trimmed, "lon")), Number(attr(trimmed, "lat"))]);
    } else if (trimmed.startsWith("<way ")) {
      current = { type: "way", id: Number(attr(trimmed, "id")), nds: [], tags: {} };
      ways.set(current.id, current);
    } else if (trimmed.startsWith("<relation ")) {
      current = { type: "relation", id: Number(attr(trimmed, "id")), members: [], tags: {} };
      relations.set(current.id, current);
    } else if (trimmed.startsWith("<nd ") && current?.type === "way") {
      current.nds.push(attr(trimmed, "ref"));
    } else if (trimmed.startsWith("<member ") && current?.type === "relation") {
      current.members.push({
        type: attr(trimmed, "type"),
        ref: Number(attr(trimmed, "ref")),
        role: attr(trimmed, "role"),
      });
    } else if (trimmed.startsWith("<tag ") && current) {
      current.tags[attr(trimmed, "k")] = attr(trimmed, "v");
    } else if (trimmed.startsWith("</way>") || trimmed.startsWith("</relation>")) {
      current = null;
    }
  }
  return { nodes, ways, relations };
}

function interesting(tags) {
  return (
    tags.landuse === "residential"
    || tags.landuse === "grass"
    || tags.landuse === "meadow"
    || tags.natural === "grassland"
    || tags.leisure === "park"
    || tags.leisure === "garden"
    || tags.highway
  );
}

function elementsFromMaps(nodes, ways, relations) {
  const keepWays = new Set();
  const keptRelations = [];
  for (const relation of relations.values()) {
    if (!interesting(relation.tags)) continue;
    keptRelations.push(relation);
    for (const member of relation.members) {
      if (member.type === "way") keepWays.add(member.ref);
    }
  }
  for (const way of ways.values()) {
    if (interesting(way.tags)) keepWays.add(way.id);
  }
  const elements = [];
  for (const id of keepWays) {
    const way = ways.get(id);
    if (!way) continue;
    const geometry = way.nds.flatMap((ref) => {
      const coord = nodes.get(ref);
      return coord ? [{ lon: coord[0], lat: coord[1] }] : [];
    });
    elements.push({ type: "way", id, tags: way.tags, geometry });
  }
  for (const relation of keptRelations) {
    elements.push({
      type: "relation",
      id: relation.id,
      tags: relation.tags,
      members: relation.members.map((member) => {
        const way = member.type === "way" ? ways.get(member.ref) : null;
        const geometry = way
          ? way.nds.flatMap((ref) => {
            const coord = nodes.get(ref);
            return coord ? [{ lon: coord[0], lat: coord[1] }] : [];
          })
          : undefined;
        return { ...member, geometry };
      }),
    });
  }
  return elements;
}

function tiles(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonStep = (maxLon - minLon) / 3;
  const latStep = (maxLat - minLat) / 4;
  const boxes = [];
  for (let lon = minLon; lon < maxLon - 1e-12; lon += lonStep) {
    for (let lat = minLat; lat < maxLat - 1e-12; lat += latStep) {
      boxes.push([
        lon,
        lat,
        Math.min(lon + lonStep, maxLon),
        Math.min(lat + latStep, maxLat),
      ]);
    }
  }
  return boxes;
}

async function fetchOverpass() {
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(QUERY)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`${endpoint} ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      console.error(String(error));
    }
  }
  throw lastError;
}

async function fetchOsmApi() {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  const boxes = tiles(BBOX);
  for (let index = 0; index < boxes.length; index += 1) {
    const [west, south, east, north] = boxes[index];
    const url = `${OSM_API}?bbox=${west},${south},${east},${north}`;
    console.log(`OSM tile ${index + 1}/${boxes.length}`);
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`${url} ${response.status} ${(await response.text()).slice(0, 180)}`);
    const parsed = parseOsmXml(await response.text());
    for (const [id, coord] of parsed.nodes) nodes.set(id, coord);
    for (const [id, way] of parsed.ways) ways.set(id, way);
    for (const [id, relation] of parsed.relations) relations.set(id, relation);
  }
  return { elements: elementsFromMaps(nodes, ways, relations) };
}

let payload;
try {
  payload = await fetchOverpass();
} catch {
  console.error("Overpass unavailable. Downloading the district from the OSM map API.");
  payload = await fetchOsmApi();
}
const features = compact(collectMapFeatures(payload.elements || []));
await writeFile(output, `${JSON.stringify(features)}\n`);
console.log(
  JSON.stringify({
    residential: features.residential.length,
    grass: features.grass.length,
    parks: features.parks.length,
    roads: features.roads.length,
    bytes: (await import("node:fs")).statSync(output).size,
  }),
);
