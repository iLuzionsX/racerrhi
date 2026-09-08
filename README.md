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

- High-detail BMW G90 M5 by [JUSTGAME](https://sketchfab.com/JUSTGAME), [source model](https://sketchfab.com/3d-models/bmw-g90-m5-9dc9e5c88bec4faa94552fdd0b76ed21), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Converted, material-calibrated, batched, and aligned to the existing M5 physics rig. Attribution and source hash are in `dist/assets/g90/`.
- BMW M5 G90 exterior runtime and M5 physics donor: `iLuzionsX/Racing26`, pinned by the Pages build to commit `abff9f452e4c2b22ac1220a1414418ace3f36e0a`. BMW names/marks belong to their owners; no affiliation is claimed.
- Three.js 0.180.0: MIT, included in `dist/assets/THREE-LICENSE.txt`.
- Poly Haven CC0: Asphalt 02, Leafy Grass, Rock Boulder Cracked PBR maps and Grasslands Sunset HDR at 2K; Sandy Gravel 02 and Dirt Aerial 02 use lightweight 1K color maps in Balanced and 4K albedo maps in High for the runoff shoulders. `download-assets-hq.mjs` records reproducible source downloads. See https://polyhaven.com/license .
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

## Fixed touch steering and gradual keyboard input

Touch maps thumb position to requested rack position with the fixed magnitude
curve `0.30*x + 0.70*x^4.5`. It has a gentle center, no deadzone, and full mechanical
lock at full travel. Speed, pedals, yaw and sideslip never change that mapping.
The donor's existing analog slew and physical rack response remain in place.

Settings → Keyboard has independent **Response speed** (70–180%) and **Turn
strength** (75–125%) sliders, saved on this device. The new default is 125% response
and 100% strength: approximately 0.46 seconds to build ordinary steering, versus
0.58 seconds at the previous 100% response. Strength adjusts the requested
cornering envelope, not available tyre grip; more can produce scrub or a slide.
Touch sensitivity remains separate. Reset Controls restores all control defaults.

Keyboard holds build toward the donor's speed-dependent cornering envelope. Release and the unwind part of a reversal are faster. Genuine
countersteer smoothly gains both authority and urgency; at maximum recovery
severity, buildup takes about 0.12 seconds, close to the donor's recovery slew.
Ordinary steering does not receive that recovery rate. Tyres, braking, suspension,
chassis stabilization and rendering are unchanged.

`integration/m5-speed-steering-regression.test.ts` checks the fixed touch map and
keyboard timing at 0/50/80/120/150/200 km/h, state independence, symmetry, reversal,
and bounded recovery slew. `integration/m5-slide-unwind-regression.test.ts` checks
30 explicit left/right recovery plans at 70/80/92 km/h. Touch plans state their
travel, 100 ms wind-on, hold and unwind times; larger disturbances require more
deliberate thumb travel. All practical cases must settle with at most 1 deg/s
opposite yaw and 0.25 degrees opposite sideslip. The original tighter 80 km/h
heading, path, speed-loss and settling limits remain enforced.

The report also retains unchanged old thumb scripts as diagnostics, which can
under-correct or over-correct with the new map. Historical held-countersteer
measurements replay the frozen pre-redesign input law. Natural braking/kerb
comparisons express the old rack demand through the new curve to isolate physics
from changed hand travel. That reference conversion exists only in test fixtures;
the runtime touch controller has no automatic recovery gain. Automated browser
and multitouch tests cannot establish subjective feel or latency on a real phone.

## Thumb-controlled on-screen wheel

The default wheel gesture is now a relative horizontal drag: grab anywhere on
the wheel, slide left/right, and lift to center. Vertical drift does not steer;
pointer capture keeps the gesture working outside the rim. Full ordinary travel
takes 45% of the displayed wheel width in either direction at 100% sensitivity.
Moving back from an overdrag immediately unwinds, with no accumulated dead travel.
The wheel graphic turns up to 72 degrees either way so its center marker remains
readable. Input is applied directly; the M5's existing steering slew is unchanged.

Settings → Wheel gesture also offers Rotate wheel. Its center crossing re-anchors
the gesture instead of jumping half a turn. Existing saved pedal positions, wheel
size and sensitivity are retained. Browser regressions cover center grabs, small
corrections, vertical drift, overdrag/reversal, release/re-grab, the saved rotary
option, and independent pedal/steering pointer ownership.

## Visible tyre contact

The physical M5 compresses its tyres by roughly 19–22 mm under static load, while
the rendered asphalt is raised another 20 mm above the physics surface. A rigid
cylinder drawn directly at the physical hub therefore appeared buried by roughly
39–42 mm. The visual wheel now clears the rendered surface using the cylinder's
support along the road normal, including wheel width and steering on slopes.
Only the visible hub height is corrected; physical hub motion, contact forces,
load transfer, braking, chassis alignment and airborne motion are retained.

Regression coverage includes settings bounds, response/strength independence,
settings persistence into live physics, the faster default's 18 keyboard recovery
cases, and mesh clearance on flat/uphill/downhill surfaces. The full donor,
braking, load, recovery, handoff and browser suites remain deployment gates.

## Continuous road support

The nearest-road query now projects onto both adjacent segments of the nearest
track vertex. The old forward-only choice made height jump halfway between
vertices and could misread longitudinal separation as off-track distance. On a
controlled 120 km/h, 5% grade comparison, total tyre-load standard deviation drops
from about 4.10 kN to 0.47 kN while mean support load stays within 0.1%. This fixes
an integration disturbance rather than adding grip or changing suspension tuning.
The sampled track geometry, material blending and pinned donor remain intact.


## Console graphics preview

### Full-detail G90 replacement

`astra/next-gen-g90` replaces the untextured LOD-C body with the downloaded full-detail G90, including interior, lamps, badges, grille textures, wheel meshes and separate brake calipers. About 320k triangles remain after removing the closed-hood engine; Draco and WebP reduce the 29MB original to 2.5MB. No mesh simplification is applied. Geometry is batched into nine physics-aligned assemblies. Mis-parented rear rim components in the source are reassigned by position. The fixed-step donor physics, track, steering, UI and cameras are unchanged.

To reproduce conversion, install `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `draco3dgltf`, `sharp`, and `three`, then run `node integration/prepare-g90.mjs /path/to/bmw_g90_m5.glb` with the official licensed Sketchfab download. The optimized GLB is checked in; production does not require Sketchfab credentials.

The older console-graphics notes below describe the preceding pass, not the new body.

`astra/console-graphics` combines the unmerged intuitive steering and reward loop branches; main is unchanged. Visual additions: 2K Poly Haven color/normal/roughness maps and HDR, circuit-local cubemap reflections (128px High / 64px Balanced), physical clearcoat paint and glass, 96-segment rounded tyres with tread, ten-spoke alloys, drilled discs and stationary calipers, tree trunks and denser trackside tyre geometry. High uses 4096px desktop / 2048px mobile shadows. The original compact M5 body and pinned donor physics are preserved; a full-detail body requires the original asset. Reflection captures use nearby solid scenery proxies and omit the car and distant foliage. Existing quality settings control capture frequency and resolution.
