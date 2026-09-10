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

### Current fitment, dry-surface and gravel-control correction

The detailed source G90 had 324–326 mm front and 363–366 mm rear visual wheel
widths. The loader now centres and sizes the assemblies to 285 / 295 mm while
retaining the 369 mm visual radius, physical hub positions, steering/spin hierarchy
and stationary calipers. This removes the rear spacer-like stance without moving
the physical track. The CI rear view measures the actual loaded meshes.

The rally centre is now a compacted dry surface (friction 0.72, rolling resistance
0.036, looseness 0.30); the soft shoulder blends toward 0.56 / 0.075 / 0.85.
The coefficients are game calibration, not manufacturer gravel measurements.
The fifth explicit donor patch makes enabled traction control reserve force for
cornering when the loaded rear tyres develop lateral slip on loose surfaces.
It cuts engine demand only: no yaw impulses, steering override, velocity clipping,
respawning, extra tyre forces or changes to the paved-road controller. TCS OFF
remains an opt-out. The 54-case full-throttle regression tests 50/70/90 km/h,
three hand-wheel demands, three surfaces and old/new controller paths. Paved
traces are exactly equal. In the 70 km/h, half-wheel packed-gravel case, peak
sideslip falls from 38.74° to 8.98° with surface parameters held constant.

The aerial cracked-earth tiling is replaced with [Amal Kumar's scanned Gravel
Road](https://polyhaven.com/a/gravel_road), alongside [Dimitrios Savva's Clean
Asphalt](https://polyhaven.com/a/clean_asphalt). A metre-scale material shader mixes
fine aggregate with nonrepeating broad variation, feathered shoulders and subtle
compacted wheel paths. Dry roughness is bounded. [Greg Zaal's Kloofendal daylight
HDR](https://polyhaven.com/a/kloofendal_48d_partly_cloudy) supplies sky illumination;
the shadow-casting sun is aligned to its bright sun disc. All three are
[CC0](https://polyhaven.com/license); machine-readable attribution is included in
`dist/assets/terrain/surface-manifest.json`.

Rally stones and fewer, darker wooden route posts now sample the ground below
each object. Tapered grass clumps replace solid polygon scrub, with coherent
terrain coloration and greater tree size/shape variation. Reflections include a
bounded set of the actual nearby trees. Wheel metal and paint have less brittle
highlights. Both quality tiers share compact scanned maps; switching no longer
streams 4K runoff images. Adaptive resolution changes in smaller, slower steps
and pauses during paused scenes. Existing layouts, controls and donor pin remain.

Matched CI views use 960×540 **drawing buffers**, High, identical car/camera poses,
and pre-fix commit `d8c1b6e95df3353d5f306bfee23e7a1cdaf38512`; they now include rear
fitment and a road-level dirt chase view. SwiftShader timings are software-renderer
diagnostics, not actual phone or GPU performance. The earlier sections below
record historical implementation steps and measurements.

### Connected hill rally route

`astra/rally-realism` builds on the G90 and keyboard-handling preview. Turn left through the signed opening just beyond start/finish, before the pit garages. The access lane joins a roughly 985 m dirt loop with approximately 33 m of elevation range and an 11.4% maximum sampled grade. The main circuit geometry and pinned donor are unchanged. Going onto dirt invalidates a paved timed lap. Free Practice is recommended. Orange lines on the minimap show the access and loop.

The rally physics follow-up fixes a gameplay integration bug: the simulation loop still classified the car against the paved circuit, causing a 32.64 m boundary correction when leaving the entrance opening. All driving stages now use the same combined surface sampler. The entry regression executes the actual gameplay block, and the full-loop driver includes its boundary response. Circuit barriers are restricted to their local contact band, rather than projecting distant off-road cars back to the circuit.

Compacted dirt uses nominal friction 0.66, rolling resistance 0.032 and granular looseness 0.5; shoulders blend continuously toward 0.49, 0.075 and 1.0. A fixed spatial variation adds at most 0.015 to the friction coefficient. These are game calibration parameters, not measured G90/gravel test data. The per-wheel granular integration patch broadens force buildup, reduces camber/trail contribution, and retains a broader sliding-force plateau. Existing combined-slip limits, ABS, TCS, mass, suspension and paved tyre calibration remain. This is a reduced-order granular contact approximation, not deformable-soil terramechanics or a claim of manufacturer validation. Higher-fidelity approaches such as [Chrono CRM](https://arxiv.org/abs/2507.05643) explicitly model soil mechanics; this browser game does not.

Road crown, shallow ruts and centimetre-scale undulations share their height definition between mesh and suspension. Contact normals come from that same surface, including shoulders. Nearby terrain heights blend spatially around close bends, avoiding nearest-segment height jumps. No random chassis impulses or artificial camera shake are added. The M5 remains a road car; its suspension does not silently change to rally hardware.

The contact regression also exposed stale tyre force while airborne: a zero-load wheel could retain roughly 1.09 kN because a zero friction envelope bypassed the limiter. The integration patch now clears tread/shear force memory below 5 N load while retaining wheel rotation and brake integration. Tyre damping is also gated on actual tyre compression, preventing descending airborne wheels from receiving support above the ground. These are contact-loss correctness fixes on all surfaces; ordinary loaded paved tyre response is unchanged. A 0.8 m drop test on four rally grades now produces genuine flight, zero airborne traction and bounded landing loads of approximately 24–26 kN per wheel.

Rally regressions cover gameplay entry, two-way access and faster laps, terrain continuity, grade holding, airborne traction/landing, tire-force envelopes, 40/80/120 km/h braking, and modest/large slides with coast/partial/full braking. In the flat 80 km/h stopping comparison: paved 25.68 m, legacy dirt 41.46 m, compacted dirt 39.01 m, loose shoulder 47.73 m. These are deterministic model outputs, not real-world stopping-distance advice. The faster driver reaches about 83 km/h on straights and slows for corners. CI additionally injects a test-only hook into the deployed game to drive through the former reset point with keyboard input and inspect the rendered chassis. Test hooks are not part of the published game.

The scenery pass adds graded hills, instanced scrub, stones and route posts, pit facade/shutter detail, vegetation ground shading, world-space asphalt variation, finer asphalt texture scale, toned-down mountain colors and material-calibrated reflections. Existing licensed Poly Haven textures are reused; no additional third-party asset license is introduced. Balanced uses half the extra scrub/stone instances.

`integration/rally-route-regression.test.ts` checks route clearance, grades, entrance height continuity, original asphalt sampling, chassis support on twelve grades, and a headless look-ahead drive around the loop. `integration/rally-visual-review.mjs` runs only in CI, injecting a non-shipped camera hook into an isolated server for matched close/chase/trackside/rally screenshots and software-renderer timing against pre-rally commit `b41bcac6839060bb2cd724a1f0f3646dd786bf4b`.

### Rally driving feel and feedback

The follow-up to public commit `2b5e97a77e29bab97640676158dd5e94a8ac86c1` fixes another complete-pipeline issue: `SuspensionKinematicsAdapter` wrapped `WheelDynamics.update` but dropped its new surface-looseness argument. The previous direct tyre tests passed while the running car still received zero looseness. A fourth pinned-donor patch forwards that value without changing the kinematic wheel frame. The new end-to-end regression observes the actual tyre calls at all four corners, including a split surface.

`rally-feel-regression.test.ts` compares the old dropped-argument behavior against the corrected pipeline across 36 cases: paved, packed, loose, washboard, downhill and crest surfaces, each with braking, power and a mid-corner lift. Paved traces are exactly equal. In the controlled 60 km/h loose-ground power corner, peak sideslip is 1.49° before and 2.32° after: the tyres now build force over the intended broader slip range. The car must still be slowed for the available grip; a saturated slide is not automatically corrected. Current 80 km/h stopping distances are 25.68 m paved, 36.87 m packed and 46.02 m loose.

Spring rates, dampers, anti-roll bars and AWD calibration are retained after auditing their behavior. The actual damper curves are monotonic and dissipative; acceleration/braking transfer load in the correct directions. `rally-awd-regression.test.ts` checks torque conservation, clutch energy dissipation, reverse symmetry, rear-overspeed front engagement, and mixed-grip acceleration. These are simulation checks, not measured BMW calibration. The road-car identity is consistent with BMW's [M5 description of Adaptive M suspension and M xDrive](https://www.press.bmwgroup.com/usa/article/detail/T0443395EN_US/the-all-new-2025-bmw-m5?language=en_US); proprietary damper and differential maps are not available here.

Presentation-only feedback now combines two filtered gravel-noise voices with a contact/slip-driven dust pool and small suspension-force-driven camera offsets. Driving sound remains opt-in; pause, menu and sound-off mute the gravel graph. Stationary, paved and airborne wheels do not emit dust. High allows 256 particles, Balanced 128, in one pooled draw; dust is depth-tested and absent from reflection proxies. Camera offsets are bounded at 24 mm heave and 0.004 radians pitch input, retain the existing follow/lag controls and respect reduced-motion preferences. No random chassis impulses, yaw correction or grip boosts are involved. The particle shader and seeded audio are original code and require no new licensed downloads.

CI checks the real dirt entrance with keyboard and simultaneous trusted touch controls, steering release/handoff, dust rendering, quality switching, user-gesture audio startup and audible/muted OfflineAudioContext output. The hook exists only in the test server/intercepted response. Matched graphics baseline is now the pre-feedback `2b5e97a` build. Hardware/mobile performance remains a separate device check.

### Full-detail G90 replacement (asset details)

`astra/next-gen-g90` replaces the untextured LOD-C body with the downloaded full-detail G90, including interior, lamps, badges, grille textures, wheel meshes and separate brake calipers. About 320k triangles remain after removing the closed-hood engine; Draco and WebP reduce the 29MB original to 2.5MB. No mesh simplification is applied. Geometry is batched into nine physics-aligned assemblies. Mis-parented rear rim components in the source are reassigned by position. The fixed-step donor physics, track, steering, UI and cameras are unchanged.

To reproduce conversion, install `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `draco3dgltf`, `sharp`, and `three`, then run `node integration/prepare-g90.mjs /path/to/bmw_g90_m5.glb` with the official licensed Sketchfab download. The optimized GLB is checked in; production does not require Sketchfab credentials.

The older console-graphics notes below describe the preceding pass, not the new body.

`astra/console-graphics` combines the unmerged intuitive steering and reward loop branches; main is unchanged. Visual additions: 2K Poly Haven color/normal/roughness maps and HDR, circuit-local cubemap reflections (128px High / 64px Balanced), physical clearcoat paint and glass, 96-segment rounded tyres with tread, ten-spoke alloys, drilled discs and stationary calipers, tree trunks and denser trackside tyre geometry. High uses 4096px desktop / 2048px mobile shadows. The original compact M5 body and pinned donor physics are preserved; a full-detail body requires the original asset. Reflection captures use nearby solid scenery proxies and omit the car and distant foliage. Existing quality settings control capture frequency and resolution.
