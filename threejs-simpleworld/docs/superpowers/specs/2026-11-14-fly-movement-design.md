# Fly movement

Orbit stays the default camera. Pressing `F` after the district is framed enters a free-flight mode with pointer lock. `Esc` returns to orbit. The camera passes through buildings and the ground.

## Controls

`F` requests pointer lock on the canvas. The key does nothing until `frameObject` has stored the district span, and it does nothing while fly mode is already active. If the browser denies pointer lock, the camera stays in orbit and the coordinate hint reads "Pointer lock was blocked. Orbit is unchanged." until the next hint change.

Entering fly mode turns OrbitControls off and disarms the mark tool. Leaving fly mode turns OrbitControls on and places its target at the camera position plus the look direction times 15% of the district span, so the view does not jump.

`Esc` unlocks the pointer. Any `pointerlockchange` that clears the lock exits fly mode, including the browser leaving pointer lock on its own.

While the pointer is locked:

| Input | Motion |
| --- | --- |
| `W` / `S` | Along the camera look direction, including pitch |
| `A` / `D` | Camera left / right. Roll stays zero, so strafe is horizontal |
| `Q` or `Space` | World up |
| `E` or `Ctrl` | World down |
| `Shift` | Multiplies speed by 4 |

`Q` and `Space` share one up input, and `E` and either `Ctrl` share one down input. Holding both keys of a pair does not double the speed. Up and down cancel. `W`/`S`/`A`/`D` are normalized so a diagonal is the same speed as a single direction, then the height axis is added. Mouse movement yaws and pitches the camera at 0.002 radians per pixel. Pitch is clamped to ±89° so the look direction cannot flip.

## Speed

Base speed is one district span per second. Span is the same value `frameObject` already computes: the maximum of the model bounds' width, height, and depth, and at least 1. `Shift` makes that four spans per second. There is no collision and no gravity.

## Marks and coordinates

Mark placement and the cursor readout stay orbit-only. While flying, a ray from the camera through the screen center updates the latitude and longitude fields and the cursor line. A hit shows `Look` plus the formatted coordinates. A miss shows `Look —`. When marks exist, a miss leaves the latitude and longitude fields on the last marked point. When no marks exist, a miss clears those fields. Exiting fly mode leaves the last look sample in place until the pointer moves over the canvas again.

The coordinate hint:

- Idle: "Press F to fly. Mark reads latitude and longitude from the district map."
- Marking: "Click the city. The pin uses the map latitude and longitude."
- Flying: "Fly: WASD move, Q/E or Space/Ctrl height, Shift faster, Esc orbit."
- Pointer lock denied: "Pointer lock was blocked. Orbit is unchanged."

## Modules

`src/fly.js` owns key state, yaw and pitch, pointer-lock listeners, and the per-frame move. It exports a pure `flyVelocity` used by tests and a controller `main.js` can start, stop, and update with a delta in seconds. The controller does not import the scene, the mark tool, or OrbitControls.

`src/main.js` listens for `F`, disarms marking, enables and disables OrbitControls, copies the framed span into the controller, and runs the center ray while fly mode is active. The animation loop uses a `THREE.Clock` delta so speed is in metres per second.

## Tests

`src/fly.test.js` runs under the existing `node --test` script. It covers `flyVelocity` with no WebGL and no pointer lock:

- Identity camera: `W` moves on −Z, `S` on +Z, `A` on −X, `D` on +X.
- `Q` and `Space` move on +Y. `E` and `Ctrl` move on −Y.
- Opposite keys produce a zero vector.
- A camera pitched 45° upward gives `W` equal −Z and +Y components.
- Speed `100` moves 100 units per second. `Shift` moves 400. Speed `0` stays put.

## Out of scope

Collision, gravity, a fly button, and replacing orbit mode.
