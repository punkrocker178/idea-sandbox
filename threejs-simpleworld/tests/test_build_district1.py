"""Checks the District 1 builder turns OSM elements into a named city model."""

import json
import struct

from scripts.build_district1 import (
    DISTRICT1_BBOX,
    city_from_overpass,
    export_district_glb,
    saigon_river_rings,
)


def test_district1_bbox_contains_ben_thanh_market():
    min_lon, min_lat, max_lon, max_lat = DISTRICT1_BBOX
    assert min_lon < 106.698 < max_lon
    assert min_lat < 10.772 < max_lat
    assert max_lon - min_lon < 0.05
    assert max_lat - min_lat < 0.06


def test_city_from_overpass_extrudes_one_building(tmp_path):
    payload = {
        "elements": [
            {"type": "node", "id": 1, "lon": 106.7000, "lat": 10.7750},
            {"type": "node", "id": 2, "lon": 106.7004, "lat": 10.7750},
            {"type": "node", "id": 3, "lon": 106.7004, "lat": 10.7753},
            {"type": "node", "id": 4, "lon": 106.7000, "lat": 10.7753},
            {
                "type": "way",
                "id": 10,
                "nodes": [1, 2, 3, 4, 1],
                "tags": {"building": "yes", "building:levels": "4"},
            },
        ]
    }

    city = city_from_overpass(payload)
    out = tmp_path / "block.glb"
    city.to_glb(str(out))

    assert city.name == "Ho Chi Minh City — District 1"
    assert city.building_count == 1
    assert city.buildings[0].height_m == 4 * 3.2
    data = out.read_bytes()
    assert data[:4] == b"glTF"
    assert b"buildings" in data


def _closed_way(way_id, lon0, lat0, lon1, lat1, tags=None):
    """A rectangular closed way and its corner nodes."""
    a, b, c, d = way_id * 10 + 1, way_id * 10 + 2, way_id * 10 + 3, way_id * 10 + 4
    return [
        {"type": "node", "id": a, "lon": lon0, "lat": lat0},
        {"type": "node", "id": b, "lon": lon1, "lat": lat0},
        {"type": "node", "id": c, "lon": lon1, "lat": lat1},
        {"type": "node", "id": d, "lon": lon0, "lat": lat1},
        {
            "type": "way",
            "id": way_id,
            "nodes": [a, b, c, d, a],
            **({"tags": tags} if tags else {}),
        },
    ]


def _gltf_json(data: bytes) -> dict:
    assert data[:4] == b"glTF"
    json_len = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + json_len])


def test_saigon_river_is_a_blue_surface_inside_the_district(tmp_path):
    # The rectangle crosses the district's east edge (106.715) and must be clipped.
    river = _closed_way(20, 106.7100, 10.7700, 106.7300, 10.7740)
    pond = _closed_way(40, 106.7020, 10.7760, 106.7022, 10.7762)
    building = _closed_way(10, 106.7000, 10.7750, 106.7004, 10.7753, {"building": "yes"})
    payload = {
        "elements": building
        + river
        + pond
        + [
            {
                "type": "relation",
                "id": 3850169,
                "tags": {
                    "type": "multipolygon",
                    "natural": "water",
                    "water": "river",
                    "name": "Sông Sài Gòn",
                },
                "members": [{"type": "way", "ref": 20, "role": "outer"}],
            },
            {
                "type": "relation",
                "id": 99,
                "tags": {"type": "multipolygon", "natural": "water", "name": "Ao sen"},
                "members": [{"type": "way", "ref": 40, "role": "outer"}],
            },
        ]
    }

    rings = saigon_river_rings(payload)
    assert len(rings) == 1

    city = city_from_overpass(payload)
    out = tmp_path / "district.glb"
    export_district_glb(city, rings, out)
    gltf = _gltf_json(out.read_bytes())

    water = next(material for material in gltf["materials"] if material["name"] == "water")
    red, _green, blue, _alpha = water["pbrMetallicRoughness"]["baseColorFactor"]
    assert blue > red

    water_index = gltf["materials"].index(water)
    primitive = next(
        item for item in gltf["meshes"][0]["primitives"] if item["material"] == water_index
    )
    position = gltf["accessors"][primitive["attributes"]["POSITION"]]
    _min_x, _min_y, _min_z = position["min"]
    max_x, _max_y, _max_z = position["max"]
    # District east edge is about 1.8 km east of the bbox centre. The unclipped
    # bank sits another 1.6 km further east and must not survive.
    assert max_x < 2000
    assert max_x > 0
