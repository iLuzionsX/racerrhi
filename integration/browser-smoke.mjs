import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.b64', 'text/plain; charset=utf-8'],
]);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end('not found');
      return;
    }
    res.setHeader('content-type', mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('failed to bind browser-smoke server');
const url = `http://127.0.0.1:${address.port}/`;

const browser = await chromium.launch({
  headless: false,
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

function pageDiagnostics(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return errors;
}

async function assertRenderableCanvas(page) {
  const canvas = page.locator('#world');
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  if (!box || box.width < 300 || box.height < 200) {
    throw new Error('WebGL canvas did not occupy the CI playability viewport');
  }

  const pngBuffer = await canvas.screenshot();
  const png = PNG.sync.read(pngBuffer);
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  const stride = Math.max(1, Math.floor(Math.min(png.width, png.height) / 120));
  for (let y = 0; y < png.height; y += stride) {
    for (let x = 0; x < png.width; x += stride) {
      const i = (y * png.width + x) * 4;
      const luma = png.data[i] * 0.2126 + png.data[i + 1] * 0.7152 + png.data[i + 2] * 0.0722;
      sum += luma;
      sumSq += luma * luma;
      samples++;
    }
  }
  const mean = sum / Math.max(1, samples);
  const variance = sumSq / Math.max(1, samples) - mean * mean;
  if (mean < 12 || variance < 40) {
    throw new Error(`WebGL canvas looks blank/black (mean=${mean.toFixed(2)}, variance=${variance.toFixed(2)})`);
  }
  return { width: png.width, height: png.height, meanLuma: mean, lumaVariance: variance };
}

async function waitUntilPlayable(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const button = document.getElementById('drive');
    return button && !button.disabled && /START SESSION/.test(button.textContent || '');
  }, null, { timeout: 20_000 });
}

const desktop = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
const desktopPage = await desktop.newPage();
const desktopErrors = pageDiagnostics(desktopPage);
await waitUntilPlayable(desktopPage);
const desktopCanvas = await assertRenderableCanvas(desktopPage);

await desktopPage.click('#drive');
await desktopPage.bringToFront();
await desktopPage.waitForFunction(() => !document.getElementById('hud')?.hidden);
if (await desktopPage.locator('#pause-dialog').evaluate((el) => el.open)) {
  await desktopPage.click('#resume');
  await desktopPage.bringToFront();
}
await desktopPage.waitForFunction(() => !document.getElementById('countdown')?.hidden, null, { timeout: 5000 });
try {
  await desktopPage.waitForFunction(() => document.getElementById('countdown')?.hidden, null, { timeout: 45000 });
} catch (error) {
  const state = await desktopPage.evaluate(() => ({
    countdownHidden: document.getElementById('countdown')?.hidden,
    countdownText: document.getElementById('countdown')?.textContent,
    speedText: document.getElementById('speed')?.textContent,
    hudHidden: document.getElementById('hud')?.hidden,
    visibilityState: document.visibilityState,
    pauseDialogOpen: document.getElementById('pause-dialog')?.open,
  }));
  throw new Error('countdown did not advance: ' + JSON.stringify({ state, errors: desktopErrors }));
}
await desktopPage.keyboard.down('ArrowUp');
await desktopPage.keyboard.down('ArrowLeft');
await desktopPage.waitForFunction(() => Number(document.getElementById('speed')?.textContent || '0') > 0, null, { timeout: 20000 });
const desktopSpeed = Number((await desktopPage.locator('#speed').textContent()) || '0');
await desktopPage.keyboard.up('ArrowLeft');
await desktopPage.keyboard.up('ArrowUp');
if (!(desktopSpeed > 0)) throw new Error('keyboard throttle did not move the car after countdown');

// Exercise session state transitions in the same real browser that rendered and drove.
await desktopPage.click('#pause');
await desktopPage.waitForFunction(() => document.getElementById('pause-dialog')?.open === true);
await desktopPage.click('#resume');
await desktopPage.waitForFunction(() => document.getElementById('pause-dialog')?.open === false);
await desktopPage.click('#pause');
await desktopPage.waitForFunction(() => document.getElementById('pause-dialog')?.open === true);
await desktopPage.click('#restart');
await desktopPage.waitForFunction(() =>
  document.getElementById('pause-dialog')?.open === false &&
  !document.getElementById('countdown')?.hidden
);
await desktopPage.click('#pause');
await desktopPage.waitForFunction(() => document.getElementById('pause-dialog')?.open === true);
await desktopPage.click('#exit');
await desktopPage.waitForFunction(() =>
  document.getElementById('intro')?.hidden === false &&
  document.getElementById('hud')?.hidden === true &&
  document.getElementById('pause-dialog')?.open === false
);
const desktopCanvasAfterExit = await assertRenderableCanvas(desktopPage);
if (desktopErrors.length) throw new Error('desktop startup/session errors: ' + desktopErrors.join(' | '));
await desktop.close();

const mobile = await browser.newContext({
  viewport: { width: 390, height: 640 },
  screen: { width: 390, height: 640 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
await mobile.addInitScript(() => {
  globalThis.__racerrhiDiagnostics = {};
});
const mobilePage = await mobile.newPage();
const mobileErrors = pageDiagnostics(mobilePage);
await waitUntilPlayable(mobilePage);
await mobilePage.bringToFront();
const mobileCanvas = await assertRenderableCanvas(mobilePage);

await mobilePage.evaluate(() => {
  globalThis.__pointerTrace = [];
  const record = (event) => {
    const target = event.target instanceof Element
      ? (event.target.id || event.target.closest?.('[id]')?.id || event.target.tagName)
      : 'unknown';
    const control = event.target instanceof Element
      ? (event.target.closest?.('#wheel,#gas,#brake')?.id || null)
      : null;
    globalThis.__pointerTrace.push({
      type: event.type,
      target,
      control,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      isTrusted: event.isTrusted,
      clientX: event.clientX,
      clientY: event.clientY,
      timestampMs: performance.now(),
    });
  };
  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'gotpointercapture',
    'lostpointercapture',
  ]) {
    document.addEventListener(type, record, true);
  }
});

const readUiState = () => mobilePage.evaluate(async () => {
  const { input } = await import('./ui.js?v=4');
  const wheel = document.getElementById('wheel');
  return {
    ...input,
    visualSteerPercent: Number(wheel?.getAttribute('aria-valuenow') || '0'),
    visualTransform: document.getElementById('wheel-art')?.style.transform || '',
    visibilityState: document.visibilityState,
    pauseOpen: Boolean(document.getElementById('pause-dialog')?.open),
    timestampMs: performance.now(),
  };
});
const readPointerTrace = () => mobilePage.evaluate(() => [...(globalThis.__pointerTrace || [])]);
const clearPointerTrace = () => mobilePage.evaluate(() => { globalThis.__pointerTrace = []; });
const readPhysicsInput = () => mobilePage.evaluate(() => {
  const sample = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return sample ? { ...sample } : null;
});
const waitUi = async (predicate, label, timeout = 2500) => {
  try {
    await mobilePage.waitForFunction(predicate, null, { timeout });
  } catch (error) {
    throw new Error(label + ': ' + JSON.stringify({
      ui: await readUiState(),
      trace: (await readPointerTrace()).slice(-20),
      physics: await readPhysicsInput(),
    }));
  }
};
const visualRecenter = async (label) => {
  const result = await mobilePage.evaluate(() => new Promise((resolve) => {
    const wheel = document.getElementById('wheel');
    const start = performance.now();
    let frames = 0;
    let previous = start;
    let maxFrameGapMs = 0;
    let settled = false;
    const timeout = setTimeout(() => finish(), 8000);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        centered: Math.abs(Number(wheel?.getAttribute('aria-valuenow') || '0')) < 5,
        frames,
        elapsedMs: performance.now() - start,
        maxFrameGapMs,
        finalVisualSteerPercent: Number(wheel?.getAttribute('aria-valuenow') || '0'),
        finalTransform: document.getElementById('wheel-art')?.style.transform || '',
      });
    };
    const tick = (now) => {
      frames++;
      maxFrameGapMs = Math.max(maxFrameGapMs, now - previous);
      previous = now;
      if (Math.abs(Number(wheel?.getAttribute('aria-valuenow') || '0')) < 5 || frames >= 40) {
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  if (!result.centered) {
    throw new Error(label + ' visual recenter did not settle within bounded frame/time budget: ' + JSON.stringify(result));
  }
  return result;
};

await mobilePage.click('#drive');
await mobilePage.waitForFunction(() => !document.getElementById('touch')?.hidden);
const wheel = mobilePage.locator('#wheel');
const gas = mobilePage.locator('#gas');
const brake = mobilePage.locator('#brake');
const [wheelBox, gasBox, brakeBox, canvasBox] = await Promise.all([
  wheel.boundingBox(),
  gas.boundingBox(),
  brake.boundingBox(),
  mobilePage.locator('#world').boundingBox(),
]);
if (!wheelBox || !gasBox || !brakeBox || !canvasBox) {
  throw new Error('mobile controls or canvas have no layout box');
}

const cx = wheelBox.x + wheelBox.width / 2;
const cy = wheelBox.y + wheelBox.height / 2;
const wheelStartX = wheelBox.x + wheelBox.width * 0.90;
const wheelEndY = wheelBox.y + wheelBox.height * 0.90;
const wheelOutsideX = Math.min(canvasBox.x + canvasBox.width - 8, wheelBox.x + wheelBox.width + 90);
const wheelOutsideY = Math.max(canvasBox.y + 8, wheelBox.y - 70);
const gx = gasBox.x + gasBox.width / 2;
const gy = gasBox.y + gasBox.height / 2;
const bx = brakeBox.x + brakeBox.width / 2;
const by = brakeBox.y + brakeBox.height / 2;
const ox = canvasBox.x + canvasBox.width * 0.50;
const oy = canvasBox.y + canvasBox.height * 0.20;

const cdp = await mobile.newCDPSession(mobilePage);
// These are CDP touch-source identifiers, not DOM PointerEvent.pointerId values.
// Chromium assigns the real pointer IDs; those are captured from trusted events below.
const tp = (x, y, sourceId) => ({ x, y, id: sourceId, radiusX: 1, radiusY: 1, force: 1 });
const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const wheelPoint = (sourceId, moved = false) => tp(moved ? cx : wheelStartX, moved ? wheelEndY : cy, sourceId);
const gasPoint = (sourceId) => tp(gx, gy, sourceId);
const brakePoint = (sourceId) => tp(bx, by, sourceId);
const otherPoint = (sourceId) => tp(ox, oy, sourceId);

async function activeWheelPointerId() {
  const trace = await readPointerTrace();
  const down = [...trace].reverse().find((entry) => entry.type === 'pointerdown' && entry.control === 'wheel');
  if (!down) throw new Error('trusted wheel pointerdown was not observed: ' + JSON.stringify(trace.slice(-20)));
  if (!down.isTrusted || down.pointerType !== 'touch') {
    throw new Error('wheel input was not a trusted browser touch pointer: ' + JSON.stringify(down));
  }
  const captured = await wheel.evaluate((el, pointerId) => el.hasPointerCapture(pointerId), down.pointerId);
  if (!captured) throw new Error('wheel did not own pointer capture after pointerdown: ' + JSON.stringify(down));
  return down.pointerId;
}

async function activePedalPointerId(locator, id) {
  const pointerId = Number(await locator.getAttribute('data-pointer'));
  if (!Number.isFinite(pointerId)) throw new Error(id + ' did not record its browser pointer id');
  const captured = await locator.evaluate((el, value) => el.hasPointerCapture(value), pointerId);
  if (!captured) throw new Error(id + ' did not own pointer capture after pointerdown');
  return pointerId;
}

const mobileResults = {};

// Normal release: input ownership must clear immediately; visual recenter is tracked separately.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(1)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'wheel did not enter held state');
const normalPointerId = await activeWheelPointerId();
await touch('touchMove', [wheelPoint(1, true)]);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'wheel move did not create steering request');
const normalBeforeRelease = await readUiState();
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'normal wheel release left input held');
const normalAfterRelease = await readUiState();
const normalTrace = await readPointerTrace();
const normalUp = normalTrace.find((entry) => entry.type === 'pointerup' && entry.pointerId === normalPointerId);
if (!normalUp) throw new Error('normal release did not produce pointerup for captured wheel pointer: ' + JSON.stringify(normalTrace));
mobileResults.normalRelease = {
  pointerId: normalPointerId,
  before: normalBeforeRelease,
  after: normalAfterRelease,
  visual: await visualRecenter('normal wheel release'),
  trace: normalTrace,
};

// Release outside the wheel must still clear the captured steering owner.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(2)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'outside-release wheel did not enter held state');
const outsidePointerId = await activeWheelPointerId();
await touch('touchMove', [tp(wheelOutsideX, wheelOutsideY, 2)]);
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'release outside wheel left steering held');
const outsideTrace = await readPointerTrace();
if (!outsideTrace.some((entry) => entry.type === 'pointerup' && entry.pointerId === outsidePointerId && entry.control === 'wheel')) {
  throw new Error('captured outside release was not delivered back to wheel: ' + JSON.stringify(outsideTrace));
}
mobileResults.outsideRelease = {
  pointerId: outsidePointerId,
  ui: await readUiState(),
  visual: await visualRecenter('outside wheel release'),
  trace: outsideTrace,
};

// Cancellation may leave a decaying visual/request value, but it must release analog ownership.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(3)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'cancel wheel did not enter held state');
const cancelPointerId = await activeWheelPointerId();
await touch('touchMove', [wheelPoint(3, true)]);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'cancel setup did not create steering request');
await touch('touchCancel');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'pointercancel left analog steering ownership held');
const cancelTrace = await readPointerTrace();
if (!cancelTrace.some((entry) => entry.type === 'pointercancel' && entry.pointerId === cancelPointerId)) {
  throw new Error('trusted pointercancel was not observed for wheel: ' + JSON.stringify(cancelTrace));
}
mobileResults.cancel = {
  pointerId: cancelPointerId,
  uiImmediatelyAfterCancel: await readUiState(),
  visual: await visualRecenter('wheel cancellation'),
  trace: cancelTrace,
};

// Unexpected capture loss must be idempotent and release only the captured wheel owner.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(4)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'capture-loss wheel did not enter held state');
const lostPointerId = await activeWheelPointerId();
await touch('touchMove', [wheelPoint(4, true)]);
await wheel.evaluate((el, pointerId) => el.releasePointerCapture(pointerId), lostPointerId);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'lostpointercapture left analog steering ownership held');
const lostTraceBeforeEnd = await readPointerTrace();
if (!lostTraceBeforeEnd.some((entry) => entry.type === 'lostpointercapture' && entry.pointerId === lostPointerId)) {
  throw new Error('browser did not emit lostpointercapture for released wheel capture: ' + JSON.stringify(lostTraceBeforeEnd));
}
await touch('touchEnd');
mobileResults.captureLoss = {
  pointerId: lostPointerId,
  ui: await readUiState(),
  visual: await visualRecenter('wheel capture loss'),
  trace: await readPointerTrace(),
};

// Wheel + gas: add the second source while preserving the already captured wheel source.
// Remove gas first; wheel must remain held and captured.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(5)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'multitouch wheel did not enter held state');
const wheelGasPointerId = await activeWheelPointerId();
await touch('touchStart', [wheelPoint(5), gasPoint(6)]);
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === true, 'second-finger gas did not activate');
const gasPointerId = await activePedalPointerId(gas, 'gas');
await touch('touchMove', [wheelPoint(5, true), gasPoint(6)]);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'multitouch wheel did not steer');
await touch('touchMove', [wheelPoint(5, true)]);
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === false, 'releasing gas first did not clear gas');
const wheelStillHeldAfterGasRelease = await readUiState();
if (!wheelStillHeldAfterGasRelease.held) throw new Error('unrelated gas release cleared wheel ownership');
if (!(await wheel.evaluate((el, pointerId) => el.hasPointerCapture(pointerId), wheelGasPointerId))) {
  throw new Error('releasing gas first stole wheel pointer capture');
}
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'final wheel release after gas left steering held');
mobileResults.gasReleasedFirst = {
  wheelPointerId: wheelGasPointerId,
  gasPointerId,
  wheelStateAfterGasRelease: wheelStillHeldAfterGasRelease,
  visual: await visualRecenter('wheel after gas-first release'),
  trace: await readPointerTrace(),
};

// Gas + wheel: remove the wheel source first; gas must remain active and captured.
await clearPointerTrace();
await touch('touchStart', [gasPoint(7)]);
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === true, 'gas-first setup did not activate gas');
const gasFirstPointerId = await activePedalPointerId(gas, 'gas');
await touch('touchStart', [gasPoint(7), wheelPoint(8)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'second-finger wheel did not acquire steering');
const wheelSecondPointerId = await activeWheelPointerId();
await touch('touchMove', [gasPoint(7), wheelPoint(8, true)]);
await touch('touchMove', [gasPoint(7)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'releasing wheel first left analog steering held');
if (!(await gas.evaluate((el) => el.classList.contains('active')))) throw new Error('releasing wheel first cleared gas pedal');
if (!(await gas.evaluate((el, pointerId) => el.hasPointerCapture(pointerId), gasFirstPointerId))) {
  throw new Error('releasing wheel first stole gas pointer capture');
}
await touch('touchEnd');
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === false, 'final gas release left pedal active');
mobileResults.wheelReleasedFirst = {
  wheelPointerId: wheelSecondPointerId,
  gasPointerId: gasFirstPointerId,
  visual: await visualRecenter('wheel-first multitouch release'),
  trace: await readPointerTrace(),
};

// An unrelated second finger disappearing must not clear wheel ownership.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(9)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'unrelated-finger setup did not hold wheel');
const unrelatedWheelPointerId = await activeWheelPointerId();
await touch('touchStart', [wheelPoint(9), otherPoint(10)]);
await touch('touchMove', [wheelPoint(9)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'unrelated finger release cleared wheel ownership');
if (!(await wheel.evaluate((el, pointerId) => el.hasPointerCapture(pointerId), unrelatedWheelPointerId))) {
  throw new Error('unrelated finger release lost wheel capture');
}
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'wheel stayed held after unrelated-finger scenario cleanup');
mobileResults.unrelatedFingerRelease = {
  wheelPointerId: unrelatedWheelPointerId,
  visual: await visualRecenter('unrelated-finger wheel release'),
  trace: await readPointerTrace(),
};

// Immediate release and re-grab must create a new browser pointer lifecycle cleanly.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(11)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'first re-grab touch did not hold wheel');
const firstGrabPointerId = await activeWheelPointerId();
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'first re-grab release stayed held');
await touch('touchStart', [wheelPoint(12)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'immediate second grab did not hold wheel');
const secondGrabPointerId = await activeWheelPointerId();
await touch('touchMove', [wheelPoint(12, true)]);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'second grab did not regain steering');
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'second re-grab release stayed held');
mobileResults.regrab = {
  firstPointerId: firstGrabPointerId,
  secondPointerId: secondGrabPointerId,
  visual: await visualRecenter('immediate re-grab release'),
  trace: await readPointerTrace(),
};

// Brake cancellation is independent from wheel ownership.
await clearPointerTrace();
await touch('touchStart', [brakePoint(13)]);
await waitUi(() => document.getElementById('brake')?.classList.contains('active') === true, 'brake did not activate');
const brakePointerId = await activePedalPointerId(brake, 'brake');
await touch('touchCancel');
await waitUi(() => document.getElementById('brake')?.classList.contains('active') === false, 'brake pointercancel left pedal active');
mobileResults.brakeCancel = { pointerId: brakePointerId, trace: await readPointerTrace() };

// Wait for active physics so touch->keyboard handoff is observed at the donor input,
// not only at the UI layer.
await mobilePage.waitForFunction(() => document.getElementById('countdown')?.hidden, null, { timeout: 45_000 });
await mobilePage.keyboard.down('ArrowLeft');
await clearPointerTrace();
await touch('touchStart', [wheelPoint(14)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'keyboard-handoff touch did not hold wheel');
await touch('touchMove', [wheelPoint(14, true)]);
await mobilePage.waitForFunction(() => {
  const d = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return d && d.analogSteerActive === true && d.digitalSteerDirection === 1;
}, null, { timeout: 2500 });
const physicsDuringTouchAndKey = await readPhysicsInput();
await touch('touchEnd');
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'touch release while key held left analog owner active');
await mobilePage.waitForFunction(() => {
  const d = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return d &&
    d.analogSteerActive === false &&
    d.digitalSteerDirection === 1 &&
    Math.abs(d.donorDigitalSteeringInput) > 0.01;
}, null, { timeout: 2500 });
const physicsAfterTouchReleaseWithKey = await readPhysicsInput();
if (!physicsAfterTouchReleaseWithKey || !Number.isFinite(physicsAfterTouchReleaseWithKey.roadWheelAngleRad)) {
  throw new Error('physics steering diagnostic did not expose road-wheel angle after handoff');
}
await mobilePage.keyboard.up('ArrowLeft');
mobileResults.keyboardHandoff = {
  duringTouchAndKey: physicsDuringTouchAndKey,
  afterTouchReleaseWithKey: physicsAfterTouchReleaseWithKey,
  visual: await visualRecenter('touch release while keyboard remains held'),
  trace: await readPointerTrace(),
};

// Real focus/visibility loss where Chromium exposes it: input must clear and the
// drive session must suspend. If this xvfb browser keeps both pages visible,
// report that environment limitation instead of fabricating a visibility event.
await clearPointerTrace();
await touch('touchStart', [wheelPoint(15)]);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'focus-loss setup did not hold wheel');
await touch('touchMove', [wheelPoint(15, true)]);
const coverPage = await mobile.newPage();
await coverPage.goto('about:blank');
await coverPage.bringToFront();
let visibilityLossObserved = true;
try {
  await mobilePage.waitForFunction(() => document.visibilityState === 'hidden', null, { timeout: 2000 });
} catch {
  visibilityLossObserved = false;
}
if (visibilityLossObserved) {
  await waitUi(async () => {
    const { input } = await import('./ui.js?v=4');
    return input.held === false && input.steer === 0 && input.throttle === 0 && input.brake === 0;
  }, 'visibility loss did not clear mobile controls');
}
await mobilePage.bringToFront();
if (visibilityLossObserved) {
  await mobilePage.waitForFunction(() => document.getElementById('pause-dialog')?.open === true, null, { timeout: 2500 });
  await mobilePage.click('#resume');
  await mobilePage.waitForFunction(() => document.getElementById('pause-dialog')?.open === false, null, { timeout: 2500 });
} else {
  // Clean up the still-active trusted source because xvfb did not hide the page.
  await touch('touchEnd');
  await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'focus-loss fallback cleanup left wheel held');
}
await coverPage.close();
mobileResults.visibilityLoss = {
  observed: visibilityLossObserved,
  ui: await readUiState(),
  trace: await readPointerTrace(),
};

if (mobileErrors.length) throw new Error('mobile startup/control errors: ' + mobileErrors.join(' | '));

console.log(JSON.stringify({
  scenario: 'Racerrhi real-browser startup and controls smoke',
  url,
  desktop: {
    canvas: desktopCanvas,
    keyboardSpeedKmhAfterInput: desktopSpeed,
    sessionTransitions: 'pause/resume, restart, return-to-intro passed',
    canvasAfterReturnToIntro: desktopCanvasAfterExit,
  },
  mobile: {
    canvas: mobileCanvas,
    ...mobileResults,
  },
  errors: [],
  status: 'passed',
}, null, 2));

await mobile.close();
await browser.close();
await new Promise((resolve) => server.close(resolve));
