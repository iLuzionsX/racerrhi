# racerrhi
Tu

# APEX / Côte d’Azur

A self-contained Three.js coastal time-attack game created with Astra. A 2025 BMW M5 G90 runs on an original closed circuit at sunset, powered by the same deterministic Racing26 M5 simulation used in `iLuzionsX/Racing26`.

## Play

Serve `dist` over HTTP: `python3 -m http.server 8080 --directory dist`. Open http://localhost:8080. Loading ES modules and Draco from file:// is not supported.

- WASD or arrows: steer, accelerate, brake; holding brake while stopped reverses.
- Space: brake. C: camera. R: reset. Escape: pause.
- Analog touch steering wheel and independent throttle/brake pedals. Settings supports resizing, positioning with sliders or dragging, sensitivity, and persistent device layouts. Sound is opt-in.
- Start Session begins a countdown for Time Attack or Free Practice. Leaving the circuit invalidates the lap; crossing the start line begins a fresh attempt. Ordered sectors prevent shortcut lap times.
- C cycles chase, bonnet and cinematic cameras. Pause offers restart, settings and quit to menu.
- Best valid lap is saved only on the current browser/device.

## GitHub Pages

Upload this repository to a new GitHub repository with default branch `main`. In Settings → Pages choose **GitHub Actions** as source. The included workflow verifies driving logic and publishes `dist`. All rendering code, model, decoder, and fonts are local, using relative URLs compatible with repository Pages subpaths. The workflow fetches the pinned donor, applies the checked-in suspension timing patch, and bundles the M5 runtime before publishing.

## Verification

`node test.mjs` covers acceleration, braking, full-lock high-speed stability, smooth steering reversal, ordered lap completion, start-line shortcuts, and invalid off-track laps. JavaScript syntax and local dependency references were checked. Browser rendering, phone usability, and real-device frame rate have not been verified in this run. Driving is supplied by the pinned Racing26 M5 physics stack: deterministic 120 Hz rigid-body simulation, four-wheel transient tire forces, suspension/load transfer, M xDrive differential logic, powertrain, ABS/TCS, and M5 mass/geometry calibration. `integration/m5-bridge.ts` adapts that engine to the Riviera track surface and game HUD.

## Credits

- BMW M5 G90 exterior runtime and M5 physics donor: `iLuzionsX/Racing26`, pinned by the Pages build to commit `abff9f452e4c2b22ac1220a1414418ace3f36e0a`. BMW names/marks belong to their owners; no affiliation is claimed.
- Three.js 0.180.0: MIT, included in `dist/assets/THREE-LICENSE.txt`.
- Poly Haven CC0: Asphalt 02, Leafy Grass, Rock Boulder Cracked PBR maps and Grasslands Sunset HDR, downloaded at 1K. `download-assets.mjs` records reproducible source downloads. See https://polyhaven.com/license .
- Mediterranean stone-pine cutout generated for this project; crossed instanced foliage replaces the original cone trees. Detailed rock geometry, continuous safety fencing, tire barriers and pit lighting supplement the textured terrain.
- Google Draco: Apache 2.0, included in `dist/assets/DRACO-LICENSE.txt`.
- Barlow Condensed and Manrope fonts: SIL Open Font License, included in assets.
- Original circuit, scene geometry, procedural materials, UI, synthesized audio, and driving code: created for this project.

The reusable build brief is in `dist/PROMPT.md`.

## M5 uphill corner load correction

The donor remains pinned to `abff9f452e4c2b22ac1220a1414418ace3f36e0a`.
After checking it out at `.vendor/Racing26`, run `node integration/apply-donor-patches.mjs`
before building or running physics tests. The script verifies the pin and applies
`integration/patches/racing26-road-load-time.patch` idempotently.

The suspension previously evaluated its advanced wheel hub against the previous
road elevation. On a steady climb this discarded `tire stiffness × vertical road
speed × timestep` of load per tire; descents gained the same fictitious load.
The patch advances the sampled road plane alongside the hub for the end-of-step
compression evaluation. Tire coefficients, steering, suspension calibration and
crash stabilization are unchanged.

`node --import tsx integration/m5-uphill-corner-regression.test.ts` checks uphill and
downhill load invariance and drives the actual first uphill corner from rest with
a 119 km/h speed target. It extracts the shipped track sampling code, uses the
production input bridge, and covers four analog steering trajectories. Before:
about 89 degrees peak sideslip, with the slide beginning on asphalt before any
barrier contact. After: 1.93–2.86 degrees, no barrier contact or crash-stabilizer
intervention. The flattened-track control is unchanged at 2.14 degrees.
This is a deterministic driver regression, not physical iPhone testing.

## Progressive high-speed touch steering

The touch-wheel mapping keeps its existing response through 100 km/h. Above
that, ordinary full-travel rack demand eases from 30% at 100 km/h to 23.2% at
150 km/h, 13.3% at 200 km/h and 12% at 220 km/h. A mild cubic input curve also
adds precision near center at high speed without a deadzone. Genuine opposite
lock still unlocks the full rack and removes the extra input shaping. Keyboard
steering, input handoff, tire forces, suspension and rendering remain unchanged.

`node --import tsx integration/m5-speed-steering-regression.test.ts` sweeps forward
and reverse speeds, checks symmetry and continuous gain, verifies severe recovery
authority, and drives left/right 150 and 200 km/h corrections through the bridge.
For the tested 33.75-degree hand-wheel ramp, hold and release, peak sideslip falls
from 17.8 to 8.3 degrees at 150 km/h and from 26.3 to 3.6 degrees at 200 km/h.
These are deterministic simulation comparisons, not a guarantee against sliding
with larger inputs or a claim of physical phone testing.
