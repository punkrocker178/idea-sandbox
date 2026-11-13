# threejs-simpleworld

LOD1 building massing for **Ho Chi Minh City, District 1**, viewed in Three.js.

OpenStreetMap footprints are extruded with [osm2threejs](https://pypi.org/project/osm2threejs/). Houses that OSM does not map are filled from the [Global Building Atlas](https://source.coop/tge-labs/globalbuildingatlas-lod1) (Zhu et al.), which traces footprints and heights from satellite imagery. An Atlas footprint is kept when it is not already an OSM building or water surface. Where neither source has a height, the model uses 3 floors at 3.2 m. Atlas outlines of a house OSM already mapped are dropped, so the same building is not drawn twice. Streets are flat ribbons from OSM `highway` ways (motorway through service and pedestrian), using each way's width. Footways, paths, steps, and tunnels are left out. Bridges sit above the river. OpenStreetMap water polygons — the Saigon River (Sông Sài Gòn, relation 3850169), canals such as Kênh Bến Nghé, lakes, and ponds — are blue surfaces clipped to the district boundary. Each `natural=tree` node is a trunk and crown. Untagged trees are 6 m tall. The GLB is centred on the district bounding box: +X east, +Y up, −Z north, in metres.

OpenStreetMap does not publish satellite photos. The ground plane is textured at runtime with [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) (zoom 16), aligned to that same local frame. Imagery © Esri, Maxar, Earthstar Geographics.

The district box is Nominatim relation [2587287](https://www.openstreetmap.org/relation/2587287) (Quận 1), captured 2026-11-12:

`106.6816889, 10.7535190, 106.7151954, 10.7969493` (min lon, min lat, max lon, max lat).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Unmapped buildings © Global Building Atlas, Technical University of Munich, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

## Run the viewer

```bash
cd threejs-simpleworld
npm install
npm run dev
```

Open the URL Vite prints. The committed model is `public/models/district1.glb`.

## Rebuild the model

Needs network access to an Overpass mirror.

```bash
pip install -r requirements.txt
npm run model
```

`scripts/build_district1.py` writes `public/models/district1.glb` and `public/models/district1.json`.

## Tests

```bash
pip install pytest
pytest
node --test src/imagery.test.js
```
