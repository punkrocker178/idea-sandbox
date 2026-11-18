import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createFlyControls } from "./fly.js";
import { applyStreetColor, createBasemapCanvas, ROAD_COLOR } from "./basemap.js";
import { formatMapCoordinate, mapLonLat, stitchSatellite } from "./imagery.js";

const READY_STATUS =
  "Dark gray streets, blue water, and green trees follow OpenStreetMap. Switch to Map for residential blocks, grass, parks, and sidewalks. Houses it does not map come from the Global Building Atlas.";
const IDLE_HINT = "Use Fly or press F. Mark reads latitude and longitude from the district map.";
const MARK_HINT = "Click the city. The pin uses the map latitude and longitude.";
const FLY_HINT = "Fly: WASD move, mouse looks, Q/E or Space/Ctrl height, Shift faster. Esc returns to orbit.";
const LOCK_HINT = "Pointer lock was blocked, so look stops at the window edge.";

const MODEL_URL = "/models/district1.glb";
const META_URL = "/models/district1.json";

const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const buildingsEl = document.querySelector("#stat-buildings");
const streetsEl = document.querySelector("#stat-streets");
const treesEl = document.querySelector("#stat-trees");
const fpsEl = document.querySelector("#stat-fps");
const coordLatEl = document.querySelector("#coord-lat");
const coordLonEl = document.querySelector("#coord-lon");
const coordCursorEl = document.querySelector("#coord-cursor");
const coordHintEl = document.querySelector("#coord-hint");
const markButton = document.querySelector("#mark-tool");
const clearButton = document.querySelector("#clear-marks");
const modeOrbitButton = document.querySelector("#mode-orbit");
const modeFlyButton = document.querySelector("#mode-fly");
const flySpeedInput = document.querySelector("#fly-speed");
const flySpeedValue = document.querySelector("#fly-speed-value");
const markListEl = document.querySelector("#mark-list");
const groundSatelliteButton = document.querySelector("#ground-satellite");
const groundMapButton = document.querySelector("#ground-map");

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

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const markGroup = new THREE.Group();
markGroup.name = "marks";
scene.add(markGroup);

const fly = createFlyControls(renderer.domElement);
const clock = new THREE.Clock();
const lookDirection = new THREE.Vector3();

let mapBbox = null;
let markArmed = false;
let flying = false;
let districtSpan = 0;
const marks = [];
let press = null;
let fpsWindow = 0;
let fpsFrames = 0;
let awaitingLock = false;
let groundMesh = null;
let groundMode = "satellite";
let satelliteTexture = null;
let mapTexture = null;

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
  districtSpan = span;
  fly.setSpan(span);
  applyFlySpeed();
  syncCameraMode();

  const groundSize = Math.max(size.x, size.z) * 1.35;
  const groundY = box.min.y - 0.2;
  groundMesh = satelliteGround(center.x, center.z, groundSize, groundY);
  groundMesh.name = "ground";
  scene.add(groundMesh);
  if (meta?.bbox) {
    const bounds = groundLonLat(center, groundSize, meta.bbox);
    applySatellite(bounds);
    loadBasemap(bounds);
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
  const half = size / 2;
  const northWest = mapLonLat(center.x - half, center.z - half, bbox);
  const southEast = mapLonLat(center.x + half, center.z + half, bbox);
  return {
    lonWest: northWest.longitude,
    lonEast: southEast.longitude,
    latSouth: southEast.latitude,
    latNorth: northWest.latitude,
  };
}

function writeDegrees(element, value) {
  element.textContent = value == null ? "—" : `${formatMapCoordinate(value)}°`;
}

function showMarkedPoint(point) {
  writeDegrees(coordLatEl, point?.latitude);
  writeDegrees(coordLonEl, point?.longitude);
}

function sampleMap(ndcX, ndcY) {
  if (!mapBbox || !groundMesh) return null;
  pointerNdc.set(ndcX, ndcY);
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObject(groundMesh, false)[0];
  if (!hit) return null;
  const { longitude, latitude } = mapLonLat(hit.point.x, hit.point.z, mapBbox);
  return { longitude, latitude, x: hit.point.x, y: hit.point.y, z: hit.point.z };
}

function pickMapPoint(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return sampleMap(ndcX, ndcY);
}

function renderMarkList() {
  markListEl.replaceChildren();
  marks.forEach((mark, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}  ${formatMapCoordinate(mark.latitude)}°, ${formatMapCoordinate(mark.longitude)}°`;
    markListEl.append(item);
  });
  clearButton.disabled = marks.length === 0;
}

function makePin(index) {
  const group = new THREE.Group();
  group.userData.isMark = true;

  const markMaterial = new THREE.MeshBasicMaterial({ color: "#e25b2a", depthTest: false });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), markMaterial);
  pole.position.y = 0.5;
  pole.renderOrder = 10;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), markMaterial);
  head.position.y = 1.08;
  head.renderOrder = 10;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "#e25b2a";
  context.beginPath();
  context.arc(64, 64, 56, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 64px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(index), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  label.position.y = 1.55;
  label.scale.set(0.85, 0.85, 1);
  label.renderOrder = 11;

  group.add(pole, head, label);
  return group;
}

function placeMark(point) {
  marks.push({ latitude: point.latitude, longitude: point.longitude });
  const pin = makePin(marks.length);
  pin.position.set(point.x, point.y, point.z);
  markGroup.add(pin);
  showMarkedPoint(point);
  renderMarkList();
}

function clearMarks() {
  marks.length = 0;
  for (const pin of markGroup.children) {
    pin.traverse((child) => {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material?.map?.dispose();
        material?.dispose();
      }
    });
  }
  markGroup.clear();
  showMarkedPoint(null);
  renderMarkList();
}

function showHint(message) {
  coordHintEl.textContent = message;
}

function setMarkTool(armed) {
  markArmed = armed;
  markButton.setAttribute("aria-pressed", String(armed));
  markButton.textContent = armed ? "Marking" : "Mark point";
  controls.mouseButtons.LEFT = armed ? null : THREE.MOUSE.ROTATE;
  renderer.domElement.classList.toggle("is-marking", armed);
  if (!flying) showHint(armed ? MARK_HINT : IDLE_HINT);
}

function applyFlySpeed() {
  const percent = Number(flySpeedInput.value);
  fly.setSpeedScale(percent / 100);
  flySpeedValue.textContent = String(percent);
}

function syncCameraMode() {
  const ready = districtSpan > 0;
  modeOrbitButton.disabled = !ready;
  modeFlyButton.disabled = !ready;
  modeOrbitButton.setAttribute("aria-pressed", String(!flying));
  modeFlyButton.setAttribute("aria-pressed", String(flying));
  document.body.classList.toggle("is-flying", flying);
}

function canvasLocked() {
  return document.pointerLockElement === renderer.domElement;
}

function enterFly() {
  if (flying || !districtSpan) return;
  flying = true;
  setMarkTool(false);
  controls.enabled = false;
  fly.engage(camera);
  syncCameraMode();
  showHint(FLY_HINT);
  awaitingLock = true;
  const lockRequest = renderer.domElement.requestPointerLock();
  lockRequest?.catch?.(() => {
    awaitingLock = false;
    if (flying) showHint(LOCK_HINT);
  });
}

function exitFly() {
  if (!flying) return;
  awaitingLock = false;
  const locked = canvasLocked();
  flying = false;
  fly.release();
  camera.getWorldDirection(lookDirection);
  controls.target.copy(camera.position).addScaledVector(lookDirection, districtSpan * 0.15);
  const offset = lookDirection.copy(camera.position).sub(controls.target);
  const phi = Math.atan2(Math.hypot(offset.x, offset.z), offset.y);
  controls.maxPolarAngle = Math.max(Math.PI / 2 - 0.05, Math.min(Math.PI - 0.01, phi));
  controls.enabled = true;
  controls.update();
  syncCameraMode();
  showHint(markArmed ? MARK_HINT : IDLE_HINT);
  if (locked) document.exitPointerLock();
}

document.addEventListener("pointerlockchange", () => {
  if (canvasLocked()) {
    awaitingLock = false;
    if (flying) showHint(FLY_HINT);
    return;
  }
  if (awaitingLock) return;
  if (flying) exitFly();
});

document.addEventListener("pointerlockerror", () => {
  awaitingLock = false;
  if (flying) showHint(LOCK_HINT);
});

function updateFlyReadout() {
  const point = sampleMap(0, 0);
  if (!point) {
    coordCursorEl.textContent = "Look —";
    if (marks.length === 0) showMarkedPoint(null);
    else showMarkedPoint(marks[marks.length - 1]);
    return;
  }
  showMarkedPoint(point);
  coordCursorEl.textContent = `Look ${formatMapCoordinate(point.latitude)}°, ${formatMapCoordinate(point.longitude)}°`;
}

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === "Escape") {
    exitFly();
    return;
  }
  if (event.code !== "KeyF" || !districtSpan) return;
  if (flying) exitFly();
  else enterFly();
});

modeOrbitButton.addEventListener("click", () => {
  exitFly();
  modeOrbitButton.blur();
});

modeFlyButton.addEventListener("click", () => {
  enterFly();
  modeFlyButton.blur();
});

flySpeedInput.addEventListener("input", applyFlySpeed);

const pinAnchor = new THREE.Vector3();

function scalePins() {
  for (const pin of markGroup.children) {
    const distance = camera.position.distanceTo(pin.getWorldPosition(pinAnchor));
    pin.scale.setScalar(Math.max(distance * 0.045, 12));
  }
}

markButton.addEventListener("click", () => {
  if (markButton.disabled) return;
  setMarkTool(!markArmed);
});

clearButton.addEventListener("click", () => {
  if (clearButton.disabled) return;
  clearMarks();
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (flying) return;
  if (event.buttons !== 0) return;
  const point = pickMapPoint(event);
  if (!point) {
    coordCursorEl.textContent = "Cursor —";
    if (marks.length === 0) showMarkedPoint(null);
    return;
  }
  coordCursorEl.textContent = `Cursor ${formatMapCoordinate(point.latitude)}°, ${formatMapCoordinate(point.longitude)}°`;
  if (marks.length === 0) showMarkedPoint(point);
});

renderer.domElement.addEventListener("pointerleave", () => {
  if (flying) return;
  press = null;
  coordCursorEl.textContent = "Cursor —";
  if (marks.length === 0) showMarkedPoint(null);
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (flying || !markArmed || event.button !== 0) return;
  press = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!markArmed || event.button !== 0 || !press) return;
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  press = null;
  if (moved > 6) return;
  const point = pickMapPoint(event);
  if (point) placeMark(point);
});

function textureFromCanvas(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function showGround() {
  if (!groundMesh) return;
  const texture = groundMode === "map" ? mapTexture : satelliteTexture;
  groundMesh.material.map = texture || null;
  groundMesh.material.color.set(texture ? "#ffffff" : "#e6dfd3");
  groundMesh.material.needsUpdate = true;
  const satellite = groundMode === "satellite";
  groundSatelliteButton.setAttribute("aria-pressed", String(satellite));
  groundMapButton.setAttribute("aria-pressed", String(!satellite));
}

function setGroundMode(mode) {
  groundMode = mode;
  showGround();
}

function recolorStreets(root) {
  const materials = [];
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    materials.push(...list);
  });
  applyStreetColor(materials, ROAD_COLOR);
}

async function applySatellite(bounds) {
  try {
    const canvas = await stitchSatellite(bounds, {
      onProgress(done, total) {
        const percent = Math.round((100 * done) / total);
        setStatus(`Loading satellite ${percent}%`);
      },
    });
    satelliteTexture = textureFromCanvas(canvas);
    showGround();
    setStatus(READY_STATUS);
  } catch {
    if (groundMode === "satellite") {
      setStatus("Satellite tiles failed. Streets are still drawn. Drag to orbit.", true);
    }
  }
}

async function loadBasemap(bounds) {
  try {
    const response = await fetch("/models/district1-map.json");
    if (!response.ok) throw new Error(String(response.status));
    mapTexture = textureFromCanvas(createBasemapCanvas(await response.json(), bounds));
    showGround();
  } catch {
    if (groundMode === "map") {
      setStatus("Map data failed. Satellite is still available.", true);
    }
  }
}

groundSatelliteButton.addEventListener("click", () => {
  setGroundMode("satellite");
  groundSatelliteButton.blur();
});

groundMapButton.addEventListener("click", () => {
  setGroundMode("map");
  groundMapButton.blur();
});

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
    if (typeof meta.tree_count === "number") {
      treesEl.textContent = meta.tree_count.toLocaleString("en-US");
    }
    if (Array.isArray(meta.bbox) && meta.bbox.length === 4 && meta.bbox.every((value) => Number.isFinite(value))) {
      mapBbox = meta.bbox;
      markButton.disabled = false;
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
      recolorStreets(gltf.scene);
      scene.add(gltf.scene);
      frameObject(gltf.scene, meta);
      if (!meta?.bbox) setStatus(READY_STATUS);
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

applyFlySpeed();
syncCameraMode();
showHint(IDLE_HINT);

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  fpsWindow += delta;
  fpsFrames += 1;
  if (fpsWindow >= 0.25) {
    fpsEl.textContent = String(Math.round(fpsFrames / fpsWindow));
    fpsWindow = 0;
    fpsFrames = 0;
  }
  if (flying) {
    fly.update(camera, delta);
    updateFlyReadout();
  } else {
    controls.update();
  }
  scalePins();
  renderer.render(scene, camera);
});
