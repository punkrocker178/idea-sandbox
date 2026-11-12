"""Checks the District 1 builder turns OSM elements into a named city model."""

from scripts.build_district1 import DISTRICT1_BBOX, city_from_overpass


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
