"""Build a LOD1 GLB of Ho Chi Minh City District 1 from OpenStreetMap.

The GLB is what the Three.js viewer loads. osm2threejs extrudes each footprint
into a closed solid (LOD1). Untagged buildings default to 3 floors at 3.2 m.
"""

from __future__ import annotations

import json
import struct
import sys
import unicodedata
from pathlib import Path

import osm2threejs as o3
from osm2threejs.exporters import _f32, _local_projector, _srgb_hex_to_linear_rgba
from osm2threejs.fetcher import OVERPASS_SERVER_TIMEOUT_S, BoundingBox, OsmDataFetcher, query_overpass
from osm2threejs.geometry import _multipolygon_parts
from osm2threejs.triangulation import triangulate_polygon

# Nominatim relation 2587287, "Quận 1, Thành phố Hồ Chí Minh", queried 2026-11-12.
# (min_lon, min_lat, max_lon, max_lat), the same order as osm2threejs.from_bbox.
DISTRICT1_BBOX = (106.6816889, 10.7535190, 106.7151954, 10.7969493)
CITY_NAME = "Ho Chi Minh City — District 1"
THEME = "Editorial Paper"

# Mirrors that responded here. The package defaults (overpass-api.de, kumi,
# private.coffee) timed out or failed TLS from this environment.
OVERPASS_ENDPOINTS = (
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "public" / "models" / "district1.glb"
META_PATH = ROOT / "public" / "models" / "district1.json"

# Clear blue against the paper ground. The theme's water swatch is grey-blue.
RIVER_COLOR = "#2a6cb3"
RIVER_Y_M = 0.35


def city_from_overpass(payload: dict) -> o3.CityModel3D:
    """Turn an Overpass JSON document into the District 1 city model."""
    bbox = BoundingBox(*DISTRICT1_BBOX)
    return o3.generate_3d_city(
        payload,
        bbox=bbox,
        theme=THEME,
        name=CITY_NAME,
        default_levels=3,
    )


def fetch_overpass() -> dict:
    """Download buildings, roads, parks, water, and trees for the district."""
    bbox = BoundingBox(*DISTRICT1_BBOX)
    fetcher = OsmDataFetcher(endpoints=OVERPASS_ENDPOINTS)
    query = fetcher.build_study_query(bbox).replace(
        f"[timeout:{OVERPASS_SERVER_TIMEOUT_S}]",
        "[timeout:180]",
    )
    print("Querying Overpass for District 1…", flush=True)
    return query_overpass(query, timeout=220, endpoints=OVERPASS_ENDPOINTS)


def _fold_name(text: str) -> str:
    """Lower-case a name and strip Vietnamese accents."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).lower()


def _is_saigon_river(tags: dict) -> bool:
    """True for the Sông Sài Gòn water area, not canals or the tunnel of the same name."""
    if tags.get("natural") != "water" and tags.get("water") != "river":
        return False
    if tags.get("type") == "waterway":
        return False
    names = " ".join(
        value for key, value in tags.items() if key == "name" or key.startswith("name:")
    )
    folded = _fold_name(names)
    return "song sai gon" in folded or "saigon river" in folded


def _clip_polygon(ring: list[tuple[float, float]], bbox: tuple[float, float, float, float]):
    """Clip a lon/lat ring to an axis-aligned box. The box is the clip window."""
    min_lon, min_lat, max_lon, max_lat = bbox

    def clip_edge(poly, inside, intersection):
        if not poly:
            return []
        output = []
        previous = poly[-1]
        previous_inside = inside(previous)
        for current in poly:
            current_inside = inside(current)
            if current_inside:
                if not previous_inside:
                    output.append(intersection(previous, current))
                output.append(current)
            elif previous_inside:
                output.append(intersection(previous, current))
            previous = current
            previous_inside = current_inside
        return output

    def at_lon(start, end, lon):
        lon0, lat0 = start
        lon1, lat1 = end
        if lon1 == lon0:
            return (lon, lat0)
        t = (lon - lon0) / (lon1 - lon0)
        return (lon, lat0 + t * (lat1 - lat0))

    def at_lat(start, end, lat):
        lon0, lat0 = start
        lon1, lat1 = end
        if lat1 == lat0:
            return (lon0, lat)
        t = (lat - lat0) / (lat1 - lat0)
        return (lon0 + t * (lon1 - lon0), lat)

    polygon = [(float(lon), float(lat)) for lon, lat in ring]
    if len(polygon) >= 2 and polygon[0] == polygon[-1]:
        polygon = polygon[:-1]
    polygon = clip_edge(
        polygon, lambda point: point[0] >= min_lon, lambda a, b: at_lon(a, b, min_lon)
    )
    polygon = clip_edge(
        polygon, lambda point: point[0] <= max_lon, lambda a, b: at_lon(a, b, max_lon)
    )
    polygon = clip_edge(
        polygon, lambda point: point[1] >= min_lat, lambda a, b: at_lat(a, b, min_lat)
    )
    polygon = clip_edge(
        polygon, lambda point: point[1] <= max_lat, lambda a, b: at_lat(a, b, max_lat)
    )
    return polygon


def saigon_river_rings(payload: dict):
    """Return (outer, holes) lon/lat rings for the Saigon River, clipped to District 1."""
    nodes: dict = {}
    ways: dict = {}
    for element in payload.get("elements", []):
        if element.get("type") == "node" and "lon" in element and "lat" in element:
            nodes[element["id"]] = (float(element["lon"]), float(element["lat"]))
        elif element.get("type") == "way":
            ways[element["id"]] = list(element.get("nodes") or [])

    clipped = []
    for element in payload.get("elements", []):
        if element.get("type") != "relation" or not _is_saigon_river(element.get("tags") or {}):
            continue
        for outer, holes in _multipolygon_parts(element, ways, nodes):
            outer_clip = _clip_polygon(outer, DISTRICT1_BBOX)
            if len(outer_clip) < 3:
                continue
            hole_clips = []
            for hole in holes:
                hole_clip = _clip_polygon(hole, DISTRICT1_BBOX)
                if len(hole_clip) >= 3:
                    hole_clips.append(hole_clip)
            clipped.append((outer_clip, hole_clips))
    return clipped


def _read_glb(path: Path) -> tuple[dict, bytearray]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a GLB")
    offset = 12
    json_len, _json_type = struct.unpack_from("<II", data, offset)
    gltf = json.loads(data[offset + 8 : offset + 8 + json_len])
    offset += 8 + json_len
    binary = bytearray()
    if offset + 8 <= len(data):
        bin_len, _bin_type = struct.unpack_from("<II", data, offset)
        binary = bytearray(data[offset + 8 : offset + 8 + bin_len])
    return gltf, binary


def _write_glb(path: Path, gltf: dict, binary: bytearray) -> None:
    while len(binary) % 4:
        binary.append(0)
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(binary)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    total = 12 + 8 + len(json_bytes) + (8 + len(binary) if binary else 0)
    with path.open("wb") as handle:
        handle.write(struct.pack("<4sII", b"glTF", 2, total))
        handle.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        handle.write(json_bytes)
        if binary:
            handle.write(struct.pack("<II", len(binary), 0x004E4942))
            handle.write(binary)


def _append_view(binary: bytearray, payload: bytes, target: int, views: list) -> int:
    while len(binary) % 4:
        binary.append(0)
    views.append(
        {"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload), "target": target}
    )
    binary.extend(payload)
    return len(views) - 1


def export_district_glb(city: o3.CityModel3D, rings, output_path: Path) -> None:
    """Write building solids plus the Saigon River as a blue water surface."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    city.to_glb(str(output_path))
    if not rings:
        return

    project = _local_projector(city)
    positions: list[tuple[float, float, float]] = []
    indices: list[int] = []
    for outer, holes in rings:
        outer_xy = [project(lon, lat) for lon, lat in outer]
        hole_xy = [[project(lon, lat) for lon, lat in hole] for hole in holes]
        points, triangles = triangulate_polygon(outer_xy, hole_xy)
        if not triangles:
            continue
        base = len(positions)
        for east, north in points:
            positions.append((_f32(east), _f32(RIVER_Y_M), _f32(-north)))
        for a, b, c in triangles:
            indices.extend((base + a, base + b, base + c))
    if not indices:
        return

    gltf, binary = _read_glb(output_path)
    views = gltf.setdefault("bufferViews", [])
    accessors = gltf.setdefault("accessors", [])
    flat_pos = [_f32(coord) for vertex in positions for coord in vertex]
    pos_view = _append_view(binary, struct.pack(f"<{len(flat_pos)}f", *flat_pos), 34962, views)
    flat_nrm = [coord for vertex in positions for coord in (0.0, 1.0, 0.0)]
    nrm_view = _append_view(binary, struct.pack(f"<{len(flat_nrm)}f", *flat_nrm), 34962, views)
    idx_view = _append_view(binary, struct.pack(f"<{len(indices)}I", *indices), 34963, views)

    accessors.append(
        {
            "bufferView": pos_view,
            "componentType": 5126,
            "count": len(positions),
            "type": "VEC3",
            "min": [min(flat_pos[k::3]) for k in range(3)],
            "max": [max(flat_pos[k::3]) for k in range(3)],
        }
    )
    accessors.append(
        {
            "bufferView": nrm_view,
            "componentType": 5126,
            "count": len(positions),
            "type": "VEC3",
        }
    )
    accessors.append(
        {
            "bufferView": idx_view,
            "componentType": 5125,
            "count": len(indices),
            "type": "SCALAR",
        }
    )
    base_accessor = len(accessors) - 3
    materials = gltf.setdefault("materials", [])
    materials.append(
        {
            "name": "water",
            "doubleSided": True,
            "pbrMetallicRoughness": {
                "baseColorFactor": _srgb_hex_to_linear_rgba(RIVER_COLOR, RIVER_COLOR),
                "metallicFactor": 0.05,
                "roughnessFactor": 0.2,
            },
        }
    )
    primitive = {
        "attributes": {"POSITION": base_accessor, "NORMAL": base_accessor + 1},
        "indices": base_accessor + 2,
        "material": len(materials) - 1,
        "mode": 4,
    }
    meshes = gltf.setdefault("meshes", [{"name": "buildings", "primitives": []}])
    meshes[0].setdefault("primitives", []).append(primitive)
    if "mesh" not in gltf["nodes"][0]:
        gltf["nodes"][0]["mesh"] = 0
    if not gltf.get("buffers"):
        gltf["buffers"] = [{"byteLength": 0}]
    _write_glb(output_path, gltf, binary)


def write_outputs(city: o3.CityModel3D, rings) -> None:
    """Write the GLB the viewer loads and a small JSON summary beside it."""
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    export_district_glb(city, rings, MODEL_PATH)
    summary = city.summary()
    summary.update(
        {
            "source": "OpenStreetMap",
            "license": "ODbL",
            "lod": "LOD1",
            "river": "Sông Sài Gòn",
            "river_color": RIVER_COLOR,
            "attribution": "© OpenStreetMap contributors",
            "generator": "osm2threejs 0.13.0",
            "axes": "+X east, +Y up, -Z north, metres from the district centre",
            "note": (
                "Buildings are LOD1 extrusions. The Saigon River is the blue "
                "water surface clipped to the District 1 boundary."
            ),
        }
    )
    META_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {MODEL_PATH} ({MODEL_PATH.stat().st_size} bytes)")


def main() -> int:
    payload = fetch_overpass()
    print(f"Overpass elements: {len(payload.get('elements', []))}", flush=True)
    city = city_from_overpass(payload)
    rings = saigon_river_rings(payload)
    print(f"Saigon River parts: {len(rings)}", flush=True)
    write_outputs(city, rings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
