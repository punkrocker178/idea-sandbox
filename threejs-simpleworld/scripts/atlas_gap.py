"""Extrude Global Building Atlas footprints that OpenStreetMap does not already have.

The Atlas (Zhu et al.) traces a footprint and a height from satellite imagery.
A footprint is kept when most of it is not already an OpenStreetMap building
or water surface. Matching outlines are dropped so the same house is not
drawn twice.
"""

from __future__ import annotations

import math

import duckdb
import osm2threejs as o3
from shapely import STRtree, box, from_wkb, make_valid, union_all
from shapely.affinity import scale
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

# 5° tile e105_n15_e110_n10 covers longitude 105–110 and latitude 10–15.
ATLAS_PARQUET_URL = (
    "https://data.source.coop/tge-labs/globalbuildingatlas-lod1/e105_n15_e110_n10.parquet"
)

# Same fallback osm2threejs uses when a building has no height tag: 3 floors.
LEVEL_HEIGHT_M = 3.2
DEFAULT_HEIGHT_M = 3 * LEVEL_HEIGHT_M
MIN_TRUSTED_HEIGHT_M = 2.0
# A tube house is often about 4 m by 8 m. Smaller remnants are outline slivers.
MIN_FOOTPRINT_AREA_M2 = 12.0
# Outlines of the same house disagree by about a metre. This absorbs that.
FOOTPRINT_BUFFER_M = 0.5
# Above this share, the Atlas polygon is the OSM building with a different outline.
SAME_BUILDING_OVERLAP = 0.4


def atlas_height_m(value) -> float:
    """Return a height in metres. Missing and sub-storey values use the OSM fallback."""
    try:
        height = float(value)
    except (TypeError, ValueError):
        return DEFAULT_HEIGHT_M
    if not math.isfinite(height) or height < MIN_TRUSTED_HEIGHT_M:
        return DEFAULT_HEIGHT_M
    return height


def fetch_atlas_records(bbox: tuple[float, float, float, float]):
    """Download Atlas footprints whose boxes meet ``bbox``.

    ``bbox`` is (min lon, min lat, max lon, max lat). Each record is
    ``(id, height, geometry)`` in longitude/latitude.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    connection = duckdb.connect()
    connection.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    rows = connection.execute(
        """
        SELECT id, height, ST_AsWKB(geometry)
        FROM read_parquet(?)
        WHERE bbox.xmax >= ? AND bbox.xmin <= ?
          AND bbox.ymax >= ? AND bbox.ymin <= ?
        """,
        [ATLAS_PARQUET_URL, min_lon, max_lon, min_lat, max_lat],
    ).fetchall()
    records = []
    for atlas_id, height, wkb in rows:
        if wkb is None:
            continue
        records.append((str(atlas_id), height, from_wkb(bytes(wkb))))
    return records


def add_missing_atlas_buildings(city: o3.CityModel3D, records) -> int:
    """Append Atlas buildings that do not already exist in ``city``. Return how many."""
    occupied = [(building.footprint, building.holes) for building in city.buildings]
    occupied.extend((water.polygon, []) for water in city.waterbodies)
    added = missing_buildings(records, occupied, city.bbox.to_tuple())
    city.buildings.extend(added)
    return len(added)


def missing_buildings(records, occupied, bbox: tuple[float, float, float, float]):
    """Return LOD1 meshes for Atlas footprints outside ``occupied`` rings.

    ``occupied`` is a list of ``(outer, holes)`` longitude/latitude rings.
    OpenStreetMap buildings and water go here. A ring that covers 40% or more
    of an Atlas footprint suppresses that footprint. A smaller overlap is cut
    out, and the remaining piece is kept when it is at least 12 m².
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    origin_lat = (min_lat + max_lat) / 2
    metres_lon, metres_lat = _metres_per_degree(origin_lat)
    window = box(min_lon, min_lat, max_lon, max_lat)
    blocked = _blocked_metres(occupied, metres_lon, metres_lat)
    index = STRtree(blocked) if blocked else None

    meshes = []
    for record_index, (atlas_id, height, geometry) in enumerate(records, start=1):
        if record_index % 5000 == 0:
            print(f"  compared {record_index} of {len(records)} Atlas footprints", flush=True)
        part_index = 0
        for part in _polygons(make_valid(geometry).intersection(window)):
            projected = _to_metres(part, metres_lon, metres_lat)
            if projected.area < MIN_FOOTPRINT_AREA_M2:
                continue
            kept = _subtract_occupied(projected, index, blocked)
            for piece in kept:
                outer, holes = _rings_lonlat(piece, metres_lon, metres_lat)
                if outer is None:
                    continue
                height_m = atlas_height_m(height)
                meshes.append(
                    o3.BuildingMesh(
                        osm_id=f"gba:{atlas_id}:{part_index}",
                        footprint=outer,
                        height_m=height_m,
                        min_height_m=0.0,
                        levels=max(1, round(height_m / LEVEL_HEIGHT_M)),
                        roof_shape="flat",
                        roof_height_m=0.0,
                        building_type="yes",
                        tags={"source": "global-building-atlas"},
                        holes=holes,
                    )
                )
                part_index += 1
    return meshes


def _metres_per_degree(latitude: float) -> tuple[float, float]:
    metres_lat = 111_320.0
    metres_lon = 111_320.0 * math.cos(math.radians(latitude))
    return metres_lon, metres_lat


def _to_metres(geometry: BaseGeometry, metres_lon: float, metres_lat: float) -> BaseGeometry:
    return scale(geometry, xfact=metres_lon, yfact=metres_lat, origin=(0.0, 0.0))


def _to_lonlat(geometry: BaseGeometry, metres_lon: float, metres_lat: float) -> BaseGeometry:
    return scale(geometry, xfact=1 / metres_lon, yfact=1 / metres_lat, origin=(0.0, 0.0))


def _polygons(geometry: BaseGeometry):
    if geometry is None or geometry.is_empty:
        return
    if isinstance(geometry, Polygon):
        yield geometry
        return
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        for child in geometry.geoms:
            yield from _polygons(child)


def _polygon_from_rings(outer, holes) -> Polygon | None:
    ring = [(float(lon), float(lat)) for lon, lat in outer]
    if len(ring) >= 2 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3:
        return None
    hole_rings = []
    for hole in holes or []:
        cleaned = [(float(lon), float(lat)) for lon, lat in hole]
        if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
            cleaned = cleaned[:-1]
        if len(cleaned) >= 3:
            hole_rings.append(cleaned)
    polygon = Polygon(ring, hole_rings)
    if not polygon.is_valid:
        polygon = make_valid(polygon)
    if polygon.is_empty:
        return None
    return polygon


def _blocked_metres(occupied, metres_lon: float, metres_lat: float) -> list:
    blocked = []
    for outer, holes in occupied:
        polygon = _polygon_from_rings(outer, holes)
        if polygon is None:
            continue
        projected = _to_metres(make_valid(polygon), metres_lon, metres_lat)
        grown = projected.buffer(FOOTPRINT_BUFFER_M, quad_segs=2)
        blocked.extend(_polygons(grown))
    return blocked


def _subtract_occupied(projected: Polygon, index: STRtree | None, blocked: list):
    """Return pieces of ``projected`` that are not already occupied."""
    if index is None:
        return [projected]
    hits = index.query(projected, predicate="intersects")
    if len(hits) == 0:
        return [projected]
    nearby = [blocked[int(hit)] for hit in hits]
    covered = nearby[0] if len(nearby) == 1 else union_all(nearby)
    overlap = projected.intersection(covered).area
    if projected.area <= 0 or overlap / projected.area >= SAME_BUILDING_OVERLAP:
        return []
    remainder = make_valid(projected.difference(covered))
    return [
        piece
        for piece in _polygons(remainder)
        if piece.area >= MIN_FOOTPRINT_AREA_M2
    ]


def _ring_coords(ring) -> list[tuple[float, float]] | None:
    points = []
    for lon, lat in ring.coords:
        point = (float(lon), float(lat))
        if points and point == points[-1]:
            continue
        points.append(point)
    if len(points) >= 2 and points[0] == points[-1]:
        points.pop()
    if len(points) < 3:
        return None
    return points


def _rings_lonlat(piece: Polygon, metres_lon: float, metres_lat: float):
    restored = _to_lonlat(piece, metres_lon, metres_lat)
    if not isinstance(restored, Polygon):
        return None, []
    outer = _ring_coords(restored.exterior)
    holes = []
    for interior in restored.interiors:
        hole = _ring_coords(interior)
        if hole is not None:
            holes.append(hole)
    return outer, holes
