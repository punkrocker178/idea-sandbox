import assert from "node:assert/strict";
import test from "node:test";

import { flyVelocity } from "./fly.js";

const FORWARD = { x: 0, y: 0, z: -1 };
const RIGHT = { x: 1, y: 0, z: 0 };

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} != ${expected.y}`);
  assert.ok(Math.abs(actual.z - expected.z) < 1e-9, `z ${actual.z} != ${expected.z}`);
}

test("identity camera: W moves on -Z, S on +Z, A on -X, D on +X", () => {
  closeTo(flyVelocity(["KeyW"], FORWARD, RIGHT, 1), { x: 0, y: 0, z: -1 });
  closeTo(flyVelocity(["KeyS"], FORWARD, RIGHT, 1), { x: 0, y: 0, z: 1 });
  closeTo(flyVelocity(["KeyA"], FORWARD, RIGHT, 1), { x: -1, y: 0, z: 0 });
  closeTo(flyVelocity(["KeyD"], FORWARD, RIGHT, 1), { x: 1, y: 0, z: 0 });
});

test("Q and Space move on +Y, and holding both does not double the speed", () => {
  closeTo(flyVelocity(["KeyQ"], FORWARD, RIGHT, 1), { x: 0, y: 1, z: 0 });
  closeTo(flyVelocity(["Space"], FORWARD, RIGHT, 1), { x: 0, y: 1, z: 0 });
  closeTo(flyVelocity(["KeyQ", "Space"], FORWARD, RIGHT, 1), { x: 0, y: 1, z: 0 });
});

test("E and Ctrl move on -Y", () => {
  closeTo(flyVelocity(["KeyE"], FORWARD, RIGHT, 1), { x: 0, y: -1, z: 0 });
  closeTo(flyVelocity(["ControlLeft"], FORWARD, RIGHT, 1), { x: 0, y: -1, z: 0 });
  closeTo(flyVelocity(["ControlRight"], FORWARD, RIGHT, 1), { x: 0, y: -1, z: 0 });
  closeTo(flyVelocity(["KeyE", "ControlLeft"], FORWARD, RIGHT, 1), { x: 0, y: -1, z: 0 });
});

test("opposite keys produce a zero vector", () => {
  closeTo(flyVelocity(["KeyW", "KeyS"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: 0 });
  closeTo(flyVelocity(["KeyA", "KeyD"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: 0 });
  closeTo(flyVelocity(["KeyQ", "KeyE"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: 0 });
  closeTo(flyVelocity(["Space", "ControlLeft"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: 0 });
});

test("a camera pitched 45 degrees upward gives W equal -Z and +Y components", () => {
  const pitched = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const velocity = flyVelocity(["KeyW"], pitched, RIGHT, 100);
  assert.ok(Math.abs(velocity.x) < 1e-9);
  assert.ok(Math.abs(velocity.y - 100 * Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(velocity.z + 100 * Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(velocity.y + velocity.z) < 1e-9);
});

test("speed is metres per second and Shift multiplies it by 4", () => {
  closeTo(flyVelocity(["KeyW"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: -100 });
  closeTo(flyVelocity(["KeyW", "ShiftLeft"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: -400 });
  closeTo(flyVelocity(["KeyW", "ShiftRight"], FORWARD, RIGHT, 100), { x: 0, y: 0, z: -400 });
  closeTo(flyVelocity(["KeyW", "ShiftLeft"], FORWARD, RIGHT, 0), { x: 0, y: 0, z: 0 });
});
