"""Atlas footprints are extruded only where OpenStreetMap has no building."""

import math

from shapely.affinity import scale
from shapely.geometry import Polygon, box

from scripts.atlas_gap import (
    DEFAULT_HEIGHT_M,
    MIN_FOOTPRINT_AREA_M2,
    add_missing_atlas_buildings,
    atlas_height_m,
    missing_buildings,
)
from scripts.build_district1 import DISTRICT1_BBOX, city_from_overpass, export_district_glb


BBOX = (106.70, 10.77, 106.71, 10.78)


def _rect(lon0, lat0, lon1, lat1):
    return box(lon0, lat0, lon1, lat1)


def _area_m2(mesh, latitude):
    metres_lon = 111_320.0 * math.cos(math.radians(latitude))
    polygon = Polygon(mesh.footprint, mesh.holes)
    return scale(polygon, xfact=metres_lon, yfact=111_320.0, origin=(0.0, 0.0)).area


def test_heights_below_one_storey_use_the_osm_fallback():
    assert atlas_height_m(None) == DEFAULT_HEIGHT_M
    assert atlas_height_m(-999) == DEFAULT_HEIGHT_M
    assert atlas_height_m(0.4) == DEFAULT_HEIGHT_M
    assert atlas_height_m(6.5) == 6.5


def test_atlas_houses_are_added_only_where_osm_has_none():
    osm = [(106.7020, 10.7720), (106.7024, 10.7720), (106.7024, 10.7723), (106.7020, 10.7723)]
    duplicate = _rect(106.70198, 10.77198, 106.70242, 10.77232)
    neighbor = _rect(106.7030, 10.7720, 106.7034, 10.7723)
    # The mapped house is about a fifth of this block, so the rest is still a house.
    block = _rect(106.7040, 10.7740, 106.7060, 10.7744)
    mapped_part = [
        (106.7040, 10.7740),
        (106.7044, 10.7740),
        (106.7044, 10.7744),
        (106.7040, 10.7744),
    ]
    sliver = _rect(106.7080, 10.7760, 106.70801, 10.77602)
    outside = _rect(106.7200, 10.7720, 106.7210, 10.7730)
    records = [
        ("dup", 11.0, duplicate),
        ("neighbor", 7.5, neighbor),
        ("block", 8.0, block),
        ("sliver", 5.0, sliver),
        ("outside", 5.0, outside),
        ("unknown", -999, _rect(106.7050, 10.7760, 106.7054, 10.7763)),
    ]

    meshes = missing_buildings(records, [(osm, []), (mapped_part, [])], BBOX)
    by_id = {mesh.osm_id: mesh for mesh in meshes}

    assert "gba:dup:0" not in by_id
    assert by_id["gba:neighbor:0"].height_m == 7.5
    assert by_id["gba:unknown:0"].height_m == DEFAULT_HEIGHT_M
    assert "gba:sliver:0" not in by_id
    assert "gba:outside:0" not in by_id

    kept_block = by_id["gba:block:0"]
    metres_lon = 111_320.0 * math.cos(math.radians(10.775))
    full_area = scale(block, xfact=metres_lon, yfact=111_320.0, origin=(0.0, 0.0)).area
    kept_area = _area_m2(kept_block, 10.775)
    assert kept_area < full_area * 0.9
    assert kept_area >= MIN_FOOTPRINT_AREA_M2
    assert max(lon for lon, _lat in kept_block.footprint) <= BBOX[2]


def test_water_suppresses_an_atlas_footprint():
    pond = [(106.7020, 10.7720), (106.7030, 10.7720), (106.7030, 10.7730), (106.7020, 10.7730)]
    house_in_pond = _rect(106.7022, 10.7722, 106.7026, 10.7726)
    meshes = missing_buildings([("boat", 4.0, house_in_pond)], [(pond, [])], BBOX)
    assert meshes == []


def test_added_atlas_building_is_extruded_with_the_osm_model(tmp_path):
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
                "tags": {"building": "yes", "height": "12"},
            },
        ]
    }
    city = city_from_overpass(payload)
    records = [
        ("same", 9.0, _rect(106.69998, 10.77498, 106.70042, 10.77532)),
        ("gap", 8.0, _rect(106.7010, 10.7750, 106.7014, 10.7753)),
    ]

    added = add_missing_atlas_buildings(city, records)

    assert added == 1
    assert city.building_count == 2
    assert city.buildings[0].height_m == 12
    assert city.buildings[1].osm_id == "gba:gap:0"
    assert city.buildings[1].height_m == 8
    out = tmp_path / "with-atlas.glb"
    export_district_glb(city, [], out)
    assert out.read_bytes()[:4] == b"glTF"
    assert DISTRICT1_BBOX[0] < 106.701 < DISTRICT1_BBOX[2]
