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

Upload this repository to a new GitHub repository with default branch `main`. In Settings → Pages choose **GitHub Actions** as source. The included workflow verifies driving logic and publishes `dist`. All rendering code, model, decoder, and fonts are local, using relative URLs compatible with repository Pages subpaths. No npm install or bundler is needed.

## Verification

`node test.mjs` covers acceleration, braking, full-lock high-speed stability, smooth steering reversal, ordered lap completion, start-line shortcuts, and invalid off-track laps. JavaScript syntax and local dependency references were checked. Browser rendering, phone usability, and real-device frame rate have not been verified in this run. Driving is supplied by the pinned Racing26 M5 physics stack: deterministic 120 Hz rigid-body simulation, four-wheel transient tire forces, suspension/load transfer, M xDrive differential logic, powertrain, ABS/TCS, and M5 mass/geometry calibration. `integration/m5-bridge.ts` adapts that engine to the Riviera track surface and game HUD.

## Credits

- BMW M5 G90 exterior runtime and M5 physics donor: `iLuzionsX/Racing26`, pinned by the Pages build to commit `e330cf5edb2c77b40267dd17d12e09858e3602a1`. BMW names/marks belong to their owners; no affiliation is claimed.
- Three.js 0.180.0: MIT, included in `dist/assets/THREE-LICENSE.txt`.
- Poly Haven CC0: Asphalt 02, Leafy Grass, Rock Boulder Cracked PBR maps and Grasslands Sunset HDR, downloaded at 1K. `download-assets.mjs` records reproducible source downloads. See https://polyhaven.com/license .
- Mediterranean stone-pine cutout generated for this project; crossed instanced foliage replaces the original cone trees. Detailed rock geometry, continuous safety fencing, tire barriers and pit lighting supplement the textured terrain.
- Google Draco: Apache 2.0, included in `dist/assets/DRACO-LICENSE.txt`.
- Barlow Condensed and Manrope fonts: SIL Open Font License, included in assets.
- Original circuit, scene geometry, procedural materials, UI, synthesized audio, and driving code: created for this project.

The reusable build brief is in `dist/PROMPT.md`.
