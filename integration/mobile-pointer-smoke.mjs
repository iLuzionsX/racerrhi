import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromium } from 'playwright';

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
if (!address || typeof address === 'string') throw new Error('failed to bind mobile pointer server');
const url = `http://127.0.0.1:${address.port}/`;

const browser = await puppeteer.launch({
  executablePath: chromium.executablePath(),
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
const page = await browser.newPage();
await page.setViewport({
  width: 390,
  height: 640,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
await page.evaluateOnNewDocument(() => {
  globalThis.__racerrhiDiagnostics = {};
});

const errors = [];
page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push('console: ' + message.text());
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const button = document.getElementById('drive');
  return button && !button.disabled && /START SESSION/.test(button.textContent || '');
}, { timeout: 20_000 });

await page.evaluate(() => {
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

await page.click('#drive');
await page.waitForFunction(() => !document.getElementById('touch')?.hidden, { timeout: 5000 });

const rect = async (selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const [wheelBox, gasBox, canvasBox] = await Promise.all([
  rect('#wheel'),
  rect('#gas'),
  rect('#world'),
]);
const cx = wheelBox.x + wheelBox.width / 2;
const cy = wheelBox.y + wheelBox.height / 2;
const wheelStartX = wheelBox.x + wheelBox.width * 0.90;
const wheelEndY = wheelBox.y + wheelBox.height * 0.90;
const gx = gasBox.x + gasBox.width / 2;
const gy = gasBox.y + gasBox.height / 2;
const ox = canvasBox.x + canvasBox.width * 0.50;
const oy = canvasBox.y + canvasBox.height * 0.20;

const clearTrace = () => page.evaluate(() => { globalThis.__pointerTrace = []; });
const readTrace = () => page.evaluate(() => [...(globalThis.__pointerTrace || [])]);
const readUi = () => page.evaluate(async () => {
  const { input } = await import('./ui.js?v=4');
  return {
    ...input,
    visualSteerPercent: Number(document.getElementById('wheel')?.getAttribute('aria-valuenow') || '0'),
    visibilityState: document.visibilityState,
    pauseOpen: Boolean(document.getElementById('pause-dialog')?.open),
  };
});
const readPhysics = () => page.evaluate(() => {
  const value = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return value ? { ...value } : null;
});
const waitUi = async (fn, label, timeout = 2500) => {
  try {
    await page.waitForFunction(fn, { timeout });
  } catch {
    throw new Error(label + ': ' + JSON.stringify({
      ui: await readUi(),
      physics: await readPhysics(),
      trace: (await readTrace()).slice(-24),
    }));
  }
};
const activePointerId = async (control) => {
  const trace = await readTrace();
  const down = [...trace].reverse().find((entry) => entry.type === 'pointerdown' && entry.control === control);
  if (!down) throw new Error('no trusted pointerdown for ' + control + ': ' + JSON.stringify(trace.slice(-20)));
  if (!down.isTrusted || down.pointerType !== 'touch') {
    throw new Error(control + ' input was not a trusted touch pointer: ' + JSON.stringify(down));
  }
  const captured = await page.$eval('#' + control, (el, pointerId) => el.hasPointerCapture(pointerId), down.pointerId);
  if (!captured) throw new Error(control + ' did not own browser pointer capture: ' + JSON.stringify(down));
  return down.pointerId;
};

const results = {};

// Steering + gas, gas released first.
await clearTrace();
const wheelA = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'wheel A did not acquire analog ownership');
const wheelPointerA = await activePointerId('wheel');
const gasA = await page.touchscreen.touchStart(gx, gy);
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === true, 'gas A did not activate');
const gasPointerA = await activePointerId('gas');
await wheelA.move(cx, wheelEndY);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'wheel A did not create steering');
await gasA.end();
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === false, 'gas-first release stayed active');
const afterGasFirst = await readUi();
if (!afterGasFirst.held) throw new Error('gas-first release incorrectly cleared wheel ownership');
const wheelCaptureAfterGas = await page.$eval('#wheel', (el, id) => el.hasPointerCapture(id), wheelPointerA);
if (!wheelCaptureAfterGas) throw new Error('gas-first release lost wheel capture');
await wheelA.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'wheel stayed held after gas-first cleanup');
results.gasReleasedFirst = {
  wheelPointerId: wheelPointerA,
  gasPointerId: gasPointerA,
  stateAfterGasRelease: afterGasFirst,
  trace: await readTrace(),
};

// Gas + steering, wheel released first.
await clearTrace();
const gasB = await page.touchscreen.touchStart(gx, gy);
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === true, 'gas B did not activate');
const gasPointerB = await activePointerId('gas');
const wheelB = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'wheel B did not acquire analog ownership');
const wheelPointerB = await activePointerId('wheel');
await wheelB.move(cx, wheelEndY);
await wheelB.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'wheel-first release stayed held');
if (!(await page.$eval('#gas', (el) => el.classList.contains('active')))) {
  throw new Error('wheel-first release incorrectly cleared gas');
}
const gasCaptureAfterWheel = await page.$eval('#gas', (el, id) => el.hasPointerCapture(id), gasPointerB);
if (!gasCaptureAfterWheel) throw new Error('wheel-first release lost gas capture');
await gasB.end();
await waitUi(() => document.getElementById('gas')?.classList.contains('active') === false, 'gas stayed active after wheel-first cleanup');
results.wheelReleasedFirst = {
  wheelPointerId: wheelPointerB,
  gasPointerId: gasPointerB,
  trace: await readTrace(),
};

// Unrelated second finger release while steering remains held.
await clearTrace();
const wheelC = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'wheel C did not acquire analog ownership');
const wheelPointerC = await activePointerId('wheel');
const otherC = await page.touchscreen.touchStart(ox, oy);
await otherC.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'unrelated finger release cleared steering ownership');
const captureAfterUnrelated = await page.$eval('#wheel', (el, id) => el.hasPointerCapture(id), wheelPointerC);
if (!captureAfterUnrelated) throw new Error('unrelated finger release lost wheel capture');
await wheelC.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'wheel C cleanup stayed held');
results.unrelatedFingerRelease = { wheelPointerId: wheelPointerC, trace: await readTrace() };

// Immediate release and re-grab.
await clearTrace();
const wheelD1 = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'first immediate grab failed');
const firstGrabPointerId = await activePointerId('wheel');
await wheelD1.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'first immediate release stayed held');
const wheelD2 = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'second immediate grab failed');
const secondGrabPointerId = await activePointerId('wheel');
await wheelD2.move(cx, wheelEndY);
await waitUi(async () => Math.abs((await import('./ui.js?v=4')).input.steer) > 0.10, 'second immediate grab did not steer');
await wheelD2.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'second immediate release stayed held');
results.immediateRegrab = { firstGrabPointerId, secondGrabPointerId, trace: await readTrace() };

// Wait for live physics and prove touch release hands control back to a still-held keyboard key.
await page.waitForFunction(() => document.getElementById('countdown')?.hidden, { timeout: 45_000 });
await page.keyboard.down('ArrowLeft');
await clearTrace();
const wheelE = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'keyboard handoff touch did not acquire analog ownership');
await wheelE.move(cx, wheelEndY);
await page.waitForFunction(() => {
  const d = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return d && d.analogSteerActive === true && d.digitalSteerDirection === 1;
}, { timeout: 2500 });
const physicsDuringTouchAndKey = await readPhysics();
await wheelE.end();
await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'touch release with key held left analog owner active');
await page.waitForFunction(() => {
  const d = globalThis.__racerrhiDiagnostics?.lastPhysicsInput;
  return d &&
    d.analogSteerActive === false &&
    d.digitalSteerDirection === 1 &&
    Math.abs(d.donorDigitalSteeringInput) > 0.01;
}, { timeout: 2500 });
const physicsAfterTouchReleaseWithKey = await readPhysics();
if (!physicsAfterTouchReleaseWithKey || !Number.isFinite(physicsAfterTouchReleaseWithKey.roadWheelAngleRad)) {
  throw new Error('physics handoff diagnostics missing road-wheel state');
}
await page.keyboard.up('ArrowLeft');
results.keyboardHandoff = {
  duringTouchAndKey: physicsDuringTouchAndKey,
  afterTouchReleaseWithKey: physicsAfterTouchReleaseWithKey,
  trace: await readTrace(),
};

// Focus/visibility loss using a real second browser page when Chromium exposes it.
await clearTrace();
const wheelF = await page.touchscreen.touchStart(wheelStartX, cy);
await waitUi(async () => (await import('./ui.js?v=4')).input.held === true, 'focus-loss setup did not hold wheel');
await wheelF.move(cx, wheelEndY);
const cover = await browser.newPage();
await cover.goto('about:blank');
await cover.bringToFront();
let visibilityLossObserved = true;
try {
  await page.waitForFunction(() => document.visibilityState === 'hidden', { timeout: 2000 });
} catch {
  visibilityLossObserved = false;
}
if (visibilityLossObserved) {
  await waitUi(async () => {
    const { input } = await import('./ui.js?v=4');
    return input.held === false && input.steer === 0 && input.throttle === 0 && input.brake === 0;
  }, 'visibility loss did not clear live controls');
  await page.bringToFront();
  await page.waitForFunction(() => document.getElementById('pause-dialog')?.open === true, { timeout: 2500 });
  await page.click('#resume');
  await page.waitForFunction(() => document.getElementById('pause-dialog')?.open === false, { timeout: 2500 });
  try { await wheelF.end(); } catch {}
} else {
  await page.bringToFront();
  await wheelF.end();
  await waitUi(async () => (await import('./ui.js?v=4')).input.held === false, 'focus-loss fallback cleanup stayed held');
}
await cover.close();
results.visibilityLoss = {
  observed: visibilityLossObserved,
  ui: await readUi(),
  trace: await readTrace(),
};

if (errors.length) throw new Error('mobile pointer browser errors: ' + errors.join(' | '));

console.log(JSON.stringify({
  scenario: 'Racerrhi independent multi-touch pointer ownership',
  browserInput: 'Puppeteer TouchHandle backed by real Chromium input',
  url,
  ...results,
  errors: [],
  status: 'passed',
}, null, 2));

await browser.close();
await new Promise((resolve) => server.close(resolve));
