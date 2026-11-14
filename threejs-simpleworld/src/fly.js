import * as THREE from "three";

const UP_KEYS = ["KeyQ", "Space"];
const DOWN_KEYS = ["KeyE", "ControlLeft", "ControlRight"];
const SHIFT_KEYS = ["ShiftLeft", "ShiftRight"];
const PITCH_LIMIT = (89 * Math.PI) / 180;
const LOOK_SENSITIVITY = 0.002;

function hasKey(keys, codes) {
  return codes.some((code) => keys.has(code));
}

/**
 * Metres per second in world space.
 * `forward` is the camera look direction. `right` is horizontal strafe.
 * WASD is normalized, then world up and down are added.
 */
export function flyVelocity(keyCodes, forward, right, speed) {
  const keys = keyCodes instanceof Set ? keyCodes : new Set(keyCodes);
  const forwardAmount = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const strafeAmount = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  let x = forward.x * forwardAmount + right.x * strafeAmount;
  let y = forward.y * forwardAmount + right.y * strafeAmount;
  let z = forward.z * forwardAmount + right.z * strafeAmount;
  const length = Math.hypot(x, y, z);
  if (length > 0) {
    x /= length;
    y /= length;
    z /= length;
  }
  const vertical = (hasKey(keys, UP_KEYS) ? 1 : 0) - (hasKey(keys, DOWN_KEYS) ? 1 : 0);
  y += vertical;
  const scale = speed * (hasKey(keys, SHIFT_KEYS) ? 4 : 1);
  return { x: x * scale, y: y * scale, z: z * scale };
}

export function createFlyControls(domElement) {
  const keys = new Set();
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let active = false;
  let span = 1;

  function onKeyDown(event) {
    keys.add(event.code);
    if (!active) return;
    if (event.code === "Space") event.preventDefault();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onMouseMove(event) {
    if (!active || document.pointerLockElement !== domElement) return;
    yaw -= event.movementX * LOOK_SENSITIVITY;
    pitch -= event.movementY * LOOK_SENSITIVITY;
    pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
  }

  function onBlur() {
    keys.clear();
  }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  window.addEventListener("blur", onBlur);

  return {
    get active() {
      return active;
    },
    setSpan(value) {
      span = Math.max(value, 1);
    },
    engage(camera) {
      camera.updateMatrixWorld();
      camera.getWorldDirection(direction);
      pitch = Math.asin(Math.min(1, Math.max(-1, direction.y)));
      yaw = Math.atan2(-direction.x, -direction.z);
      pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
      active = true;
    },
    release() {
      active = false;
      keys.clear();
    },
    update(camera, delta) {
      if (!active) return;
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.rotation.z = 0;
      camera.updateMatrixWorld();
      camera.getWorldDirection(direction);
      right.set(-direction.z, 0, direction.x);
      if (right.lengthSq() > 1e-8) right.normalize();
      else right.set(1, 0, 0);
      const velocity = flyVelocity(keys, direction, right, span);
      camera.position.x += velocity.x * delta;
      camera.position.y += velocity.y * delta;
      camera.position.z += velocity.z * delta;
    },
  };
}
