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
    throw new Error('WebGL canvas did not occupy a playable viewport');
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

const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const desktopPage = await desktop.newPage();
const desktopErrors = pageDiagnostics(desktopPage);
await waitUntilPlayable(desktopPage);
const desktopCanvas = await assertRenderableCanvas(desktopPage);

await desktopPage.click('#drive');
await desktopPage.waitForFunction(() => !document.getElementById('hud')?.hidden);
await desktopPage.waitForFunction(() => !document.getElementById('countdown')?.hidden, null, { timeout: 5000 });
try {
  await desktopPage.waitForFunction(() => document.getElementById('countdown')?.hidden, null, { timeout: 10000 });
} catch (error) {
  const state = await desktopPage.evaluate(() => ({
    countdownHidden: document.getElementById('countdown')?.hidden,
    countdownText: document.getElementById('countdown')?.textContent,
    speedText: document.getElementById('speed')?.textContent,
    hudHidden: document.getElementById('hud')?.hidden,
    visibilityState: document.visibilityState,
  }));
  throw new Error('countdown did not advance: ' + JSON.stringify({ state, errors: desktopErrors }));
}
await desktopPage.keyboard.down('ArrowUp');
await desktopPage.keyboard.down('ArrowLeft');
await desktopPage.waitForTimeout(1400);
await desktopPage.keyboard.up('ArrowLeft');
await desktopPage.keyboard.up('ArrowUp');
const desktopSpeed = Number((await desktopPage.locator('#speed').textContent()) || '0');
if (!(desktopSpeed > 0)) throw new Error('keyboard throttle did not move the car after countdown');
if (desktopErrors.length) throw new Error('desktop startup errors: ' + desktopErrors.join(' | '));

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const mobilePage = await mobile.newPage();
const mobileErrors = pageDiagnostics(mobilePage);
await waitUntilPlayable(mobilePage);
const mobileCanvas = await assertRenderableCanvas(mobilePage);

await mobilePage.click('#drive');
await mobilePage.waitForFunction(() => !document.getElementById('touch')?.hidden);
const gas = mobilePage.locator('#gas');
const gasBox = await gas.boundingBox();
if (!gasBox) throw new Error('mobile gas pedal has no layout box');
const gx = gasBox.x + gasBox.width / 2;
const gy = gasBox.y + gasBox.height / 2;
await gas.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', clientX: gx, clientY: gy });
if (!(await gas.evaluate((el) => el.classList.contains('active')))) {
  throw new Error('mobile gas pointerdown did not engage the control');
}
await gas.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', clientX: gx, clientY: gy });
if (await gas.evaluate((el) => el.classList.contains('active'))) {
  throw new Error('mobile gas pointerup did not release the control');
}

const wheel = mobilePage.locator('#wheel');
const wheelBox = await wheel.boundingBox();
if (!wheelBox) throw new Error('mobile steering wheel has no layout box');
const cx = wheelBox.x + wheelBox.width / 2;
const cy = wheelBox.y + wheelBox.height / 2;
await wheel.dispatchEvent('pointerdown', {
  pointerId: 72,
  pointerType: 'touch',
  clientX: wheelBox.x + wheelBox.width * 0.90,
  clientY: cy,
});
await wheel.dispatchEvent('pointermove', {
  pointerId: 72,
  pointerType: 'touch',
  clientX: cx,
  clientY: wheelBox.y + wheelBox.height * 0.90,
});
await mobilePage.waitForTimeout(80);
const steerValue = Number(await wheel.getAttribute('aria-valuenow'));
await wheel.dispatchEvent('pointerup', {
  pointerId: 72,
  pointerType: 'touch',
  clientX: cx,
  clientY: wheelBox.y + wheelBox.height * 0.90,
});
if (!Number.isFinite(steerValue) || Math.abs(steerValue) < 10) {
  throw new Error('mobile steering drag did not produce an analog steering command');
}
if (mobileErrors.length) throw new Error('mobile startup errors: ' + mobileErrors.join(' | '));

console.log(JSON.stringify({
  scenario: 'Racerrhi real-browser startup and controls smoke',
  url,
  desktop: {
    canvas: desktopCanvas,
    keyboardSpeedKmhAfterInput: desktopSpeed,
  },
  mobile: {
    canvas: mobileCanvas,
    steeringAriaPercentAfterDrag: steerValue,
    gasPointerLifecycle: 'passed',
  },
  errors: [],
  status: 'passed',
}, null, 2));

await desktop.close();
await mobile.close();
await browser.close();
await new Promise((resolve) => server.close(resolve));
