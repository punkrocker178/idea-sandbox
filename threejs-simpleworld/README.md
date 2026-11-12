# threejs-simpleworld

LOD1 building massing for **Ho Chi Minh City, District 1**, generated from OpenStreetMap with [osm2threejs](https://pypi.org/project/osm2threejs/) and viewed in Three.js.

Buildings are extruded footprints (flat roofs). Where OSM has no `height` or `building:levels`, the model uses 3 floors at 3.2 m. The GLB is centred on the district bounding box: +X east, +Y up, −Z north, in metres.

The district box is Nominatim relation [2587287](https://www.openstreetmap.org/relation/2587287) (Quận 1), captured 2026-11-12:

`106.6816889, 10.7535190, 106.7151954, 10.7969493` (min lon, min lat, max lon, max lat).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.

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
```
