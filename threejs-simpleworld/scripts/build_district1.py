"""Build a LOD1 GLB of Ho Chi Minh City District 1 from OpenStreetMap.

The GLB is what the Three.js viewer loads. osm2threejs extrudes each footprint
into a closed solid (LOD1). Untagged buildings default to 3 floors at 3.2 m.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import osm2threejs as o3
from osm2threejs.fetcher import OVERPASS_SERVER_TIMEOUT_S, BoundingBox, OsmDataFetcher, query_overpass

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


def write_outputs(city: o3.CityModel3D) -> None:
    """Write the GLB the viewer loads and a small JSON summary beside it."""
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    city.to_glb(str(MODEL_PATH))
    summary = city.summary()
    summary.update(
        {
            "source": "OpenStreetMap",
            "license": "ODbL",
            "lod": "LOD1",
            "attribution": "© OpenStreetMap contributors",
            "generator": "osm2threejs 0.13.0",
            "axes": "+X east, +Y up, -Z north, metres from the district centre",
            "note": (
                "The GLB contains extruded buildings only. "
                "osm2threejs keeps roads, parks, and water on the city model, "
                "but its GLB exporter writes building solids."
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
    write_outputs(city)
    return 0


if __name__ == "__main__":
    sys.exit(main())
