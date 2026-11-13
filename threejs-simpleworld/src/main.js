import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { localToLonLat, metersPerDegree, stitchSatellite } from "./imagery.js";

const MODEL_URL = "/models/district1.glb";
const META_URL = "/models/district1.json";

const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const buildingsEl = document.querySelector("#stat-buildings");
const streetsEl = document.querySelector("#stat-streets");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f5f2eb");

const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 40000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#fff8ee", "#c9b9a6", 1.15));
const sun = new THREE.DirectionalLight("#fff4e0", 1.35);
sun.position.set(1200, 1800, 600);
scene.add(sun);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.target.set(0, 0, 0);

function resize() {
  const width = app.clientWidth || window.innerWidth;
  const height = app.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function frameObject(object, meta) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);

  const groundSize = Math.max(size.x, size.z) * 1.35;
  const groundY = box.min.y - 0.2;
  const ground = satelliteGround(center.x, center.z, groundSize, groundY);
  scene.add(ground);
  if (meta?.bbox) {
    applySatellite(ground, center, groundSize, meta.bbox);
  }

  const distance = span * 0.72;
  camera.position.set(center.x + distance * 0.15, box.max.y + distance * 0.38, center.z + distance);
  camera.near = Math.max(0.5, span / 1000);
  camera.far = span * 20;
  camera.updateProjectionMatrix();
  controls.target.set(center.x, box.min.y + size.y * 0.15, center.z);
  controls.maxDistance = span * 4;
  controls.update();

  scene.fog = new THREE.Fog("#d9d3c6", distance * 2.4, distance * 8);
}

function satelliteGround(centerX, centerZ, size, y) {
  const half = size / 2;
  const x0 = centerX - half;
  const x1 = centerX + half;
  const zSouth = centerZ + half;
  const zNorth = centerZ - half;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [x0, y, zSouth, x1, y, zSouth, x1, y, zNorth, x0, y, zNorth],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: "#e6dfd3" }),
  );
}

function groundLonLat(center, size, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const originLon = (minLon + maxLon) / 2;
  const originLat = (minLat + maxLat) / 2;
  const { mLon, mLat } = metersPerDegree(originLat);
  const half = size / 2;
  const xWest = center.x - half;
  const xEast = center.x + half;
  const zNorth = center.z - half;
  const zSouth = center.z + half;
  const [lonWest, latNorth] = localToLonLat(xWest, zNorth, originLon, originLat, mLon, mLat);
  const [lonEast, latSouth] = localToLonLat(xEast, zSouth, originLon, originLat, mLon, mLat);
  return { lonWest, lonEast, latSouth, latNorth };
}

async function applySatellite(ground, center, size, bbox) {
  try {
    const canvas = await stitchSatellite(groundLonLat(center, size, bbox), {
      onProgress(done, total) {
        const percent = Math.round((100 * done) / total);
        setStatus(`Loading satellite ${percent}%`);
      },
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    ground.material.color.set("#ffffff");
    ground.material.map = texture;
    ground.material.needsUpdate = true;
    setStatus(
      "Brown streets follow OpenStreetMap. Houses it does not map come from the Global Building Atlas. Blue is the Saigon River.",
    );
  } catch {
        setStatus("Satellite tiles failed. Streets are still drawn. Drag to orbit.");
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

async function loadMeta() {
  try {
    const response = await fetch(META_URL);
    if (!response.ok) return null;
    const meta = await response.json();
    if (typeof meta.building_count === "number") {
      buildingsEl.textContent = meta.building_count.toLocaleString("en-US");
    }
    if (typeof meta.street_count === "number") {
      streetsEl.textContent = meta.street_count.toLocaleString("en-US");
    }
    return meta;
  } catch {
    return null;
  }
}

function loadModel(meta) {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      scene.add(gltf.scene);
      frameObject(gltf.scene, meta);
      if (!meta?.bbox) {
        setStatus(
          "Brown streets follow OpenStreetMap. Houses it does not map come from the Global Building Atlas. Blue is the Saigon River.",
        );
      }
    },
    (event) => {
      if (!event.total) return;
      const percent = Math.round((100 * event.loaded) / event.total);
      setStatus(`Loading buildings ${percent}%`);
    },
    () => {
      setStatus(
        "Could not load public/models/district1.glb. Run npm run model, then refresh.",
        true,
      );
    },
  );
}

resize();
window.addEventListener("resize", resize);
loadMeta().then((meta) => loadModel(meta));

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
