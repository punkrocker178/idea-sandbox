import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "/models/district1.glb";
const META_URL = "/models/district1.json";

const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const buildingsEl = document.querySelector("#stat-buildings");

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

function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);

  const groundSize = Math.max(size.x, size.z) * 1.35;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: "#e6dfd3", roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, box.min.y - 0.2, center.z);
  scene.add(ground);

  const distance = span * 0.72;
  camera.position.set(center.x + distance * 0.15, box.max.y + distance * 0.38, center.z + distance);
  camera.near = Math.max(0.5, span / 1000);
  camera.far = span * 20;
  camera.updateProjectionMatrix();
  controls.target.set(center.x, box.min.y + size.y * 0.15, center.z);
  controls.maxDistance = span * 4;
  controls.update();

  scene.fog = new THREE.Fog("#e8e2d5", distance * 1.2, distance * 4.5);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

async function loadMeta() {
  try {
    const response = await fetch(META_URL);
    if (!response.ok) return;
    const meta = await response.json();
    if (typeof meta.building_count === "number") {
      buildingsEl.textContent = meta.building_count.toLocaleString("en-US");
    }
  } catch {
    // The model can still load if the summary file is missing.
  }
}

function loadModel() {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      scene.add(gltf.scene);
      frameObject(gltf.scene);
      setStatus("Blue is the Saigon River. Drag to orbit.");
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
loadMeta();
loadModel();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
