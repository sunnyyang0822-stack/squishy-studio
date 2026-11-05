const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const port = process.env.POLISH_STYLES_PORT || '4257';
const base = `http://127.0.0.1:${port}`;
const out = resolve(process.env.POLISH_PROGRESSION_ARTIFACT_DIR || 'artifacts/issue-50/all-styles');
const { installStyleProbe, rotate } = require('./helpers/squishy-browser.cjs');
const { projectedMeshContact } = require('./helpers/wax-style-probe.cjs');
const styles = ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const cores = ['clay', 'marshmallow', 'butter'];
const inCI = process.env.CI === 'true';
const selectedStyles = process.env.POLISH_STYLE_CASE ? styles.filter(style => style === process.env.POLISH_STYLE_CASE) : styles;
assert.ok(selectedStyles.length, 'POLISH_STYLE_CASE must name a supported test style');
let browser, server;
before(async () => {
  mkdirSync(out, { recursive: true }); mkdirSync('.tmp/runtime', { recursive: true });
  process.env.TEMP = resolve('.tmp/runtime'); process.env.TMP = process.env.TEMP;
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function installPixels(page) {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = get.call(this, type, ...args);
      if (type === 'webgl2' && gl) {
        window.progressionGL = gl;
        if (!gl.progressionDrawHook) { gl.progressionDrawHook = true; const draw = gl.drawElements.bind(gl); gl.drawElements = (...a) => { const r = draw(...a); window.progressionDrawRevision = (window.progressionDrawRevision || 0) + 1; return r; }; }
      } return gl;
    };
    window.readProgressionPixels = () => {
      const gl = window.progressionGL, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const p = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
      let opaque = 0, green = 0, pink = 0, dark = 0; const mask = new Uint8Array(w * h);
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] < 254) continue; opaque++;
        if (p[i + 1] > p[i] + 7 && p[i + 1] > p[i + 2] + 4) { green++; mask[i / 4] = 1; }
        if (p[i] > p[i + 1] + 8 && p[i + 2] > p[i + 1] + 2) pink++;
        if (Math.max(p[i], p[i + 1], p[i + 2]) < 90) dark++;
      }
      // Eight-neighbour pixel connectivity is descriptive only: antialiasing and
      // subpixel branches can interrupt color classification without a mesh gap.
      const components = [];
      for (let i = 0; i < mask.length; i++) if (mask[i]) {
        mask[i] = 0; const queue = [i]; let size = 0;
        while (queue.length) { const q = queue.pop(), x = q % w, y = Math.floor(q / w); size++;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const k = ny * w + nx; if (mask[k]) { mask[k] = 0; queue.push(k); } }
        } if (size >= 4) components.push(size);
      }
      components.sort((a, b) => b - a);
      return { opaque, green, pink, dark, width: w, height: h, greenComponentsAtLeast4Pixels: components };
    };
    document.addEventListener('pointerdown', e => { if (e.target.closest('.orb-input') && window.onsetArmed) { window.onsetStart = performance.now(); window.onsetArmed = false; } }, true);
    const frame = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => frame(time => {
      callback(time);
      if (window.onsetStart && !window.onsetFrame && performance.now() - window.onsetStart >= 60 && window.progressionGL) {
        const elapsedMs = performance.now() - window.onsetStart;
        window.onsetFrame = { elapsedMs, pixels: window.readProgressionPixels(), diagnostics: document.querySelector('.toy-mount').polishDiagnostics() };
      }
      if (window.captureProgressionPixels && window.progressionGL && window.progressionDrawRevision > window.captureAfterRevision) { window.captureProgressionPixels = false; window.progressionPixels = window.readProgressionPixels(); }
    });
  });
}
async function open(style, core, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: inCI ? 0.5 : 1, reducedMotion: mobile ? 'reduce' : 'no-preference', isMobile: mobile, hasTouch: mobile, ...(!mobile && !inCI ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } } : {}) });
  const page = await context.newPage(), errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs'); const mesh = await installStyleProbe(page, getSquishyStyle(style)); await installPixels(page);
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${core}&shellMaterial=polish&coreColor=mint&shellColor=rose&step=shell`);
  await page.waitForSelector('.toy-stage[data-state="ready"] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled && window.styleProbe?.mainMatrix);
  await page.evaluate(mobile => { document.documentElement.dataset.theme = mobile ? 'night' : 'day'; }, mobile); await page.waitForTimeout(120);
  return { context, page, errors, mesh };
}
const diag = page => page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
function depth(d) { let max = 0; for (let i = 0; i < d.corePositions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return max; }
async function pixels(page) { await page.evaluate(() => { window.progressionPixels = null; window.captureProgressionPixels = true; window.captureAfterRevision = window.progressionDrawRevision || 0; }); const v = page.viewportSize(); await page.setViewportSize({ ...v, width: v.width + 1 }); await page.waitForFunction(() => window.progressionPixels); const r = await page.evaluate(() => window.progressionPixels); await page.setViewportSize(v); return r; }
async function shot(page, name, closeup = false) { if (inCI) return; await (closeup ? page.locator('.toy-mount canvas') : page).screenshot({ path: resolve(out, `${name}.png`) }); }
function filmOK(d, stage) { assert.equal(d.state.fragmentCount, 0, stage); assert.equal(d.state.detached, 0, stage); assert.equal(d.metrics.violations, 0, stage + ': ' + JSON.stringify(d.metrics)); assert.ok(d.metrics.minGap > 0, stage + ': ' + JSON.stringify(d.metrics)); }
async function saveVideo(page, context, name) { const video = page.video(); await context.close(); if (video) { await video.saveAs(resolve(out, `${name}.webm`)); await video.delete(); } }
async function press(page, contact) { await page.mouse.move(contact.x, contact.y); await page.mouse.down(); assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true', 'Real GLB point owns pressure'); }
async function waitRecovered(page) { await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').polishDiagnostics(); return d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { polling: 500, timeout: 23000 }); }
for (const style of selectedStyles) for (const core of cores) test(`${style} ${core} polish: structural GLB contact, real GPU exposure, drag, release, side view`, { timeout: 150000 }, async () => {
  const { context, page, errors, mesh } = await open(style, core); const id = `${style}-${core}`;
  try {
    const initial = await diag(page), intact = await pixels(page); filmOK(initial, 'initial'); assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), style); assert.equal(initial.feelId, core === 'butter' ? 'slow-rebound' : core);
    assert.ok(intact.green <= 1, 'Intact rose coat covers mint core (allow one raster edge pixel)');
    const contact = await projectedMeshContact(page, mesh, style); if (style === 'donut') assert.ok(contact.radialDot < -.03, 'Contact is real inner wall, not empty donut hole');
    await press(page, contact); await page.waitForTimeout(150); const shallow = await diag(page); filmOK(shallow, 'shallow');
    await page.waitForTimeout(1300); const deep = await diag(page), opened = await pixels(page); filmOK(deep, 'deep'); assert.ok(depth(deep) > .005, id + ' core genuinely deforms'); assert.ok(opened.green > intact.green + 3, id + ' true exposed core GPU pixels ' + JSON.stringify(opened)); assert.equal(deep.state.maxLocalContacts, 1);
    await shot(page, `${id}-deep`);
    const target = await projectedMeshContact(page, mesh, style, [.08, .015]); await page.mouse.move(target.x, target.y, { steps: 18 }); await page.waitForTimeout(250); const dragged = await diag(page); if (dragged.metrics.violations) writeFileSync(resolve(out, `${id}-drag-failure.json`), JSON.stringify(dragged)); filmOK(dragged, 'drag'); await page.mouse.up(); await page.waitForTimeout(250); const released = await diag(page); filmOK(released, 'release');
    await page.waitForTimeout(500); const waiting = await diag(page); filmOK(waiting, 'waiting'); assert.equal(waiting.state.maxDamage, released.state.maxDamage);
    if (core === 'marshmallow') assert.deepEqual(waiting.corePositions, released.corePositions, id + ' retains shape'); if (core === 'butter') assert.ok(depth(waiting) < depth(released), id + ' rebounds');
    await rotate(page, 100, 8); const rotated = await diag(page); filmOK(rotated, 'side view'); await shot(page, `${id}-side`, true);
    let recovered;
    if (core === 'butter') { await waitRecovered(page); recovered = await diag(page); filmOK(recovered, 'exact rest'); assert.equal(depth(recovered), 0); assert.ok(recovered.state.maxDamage > 0); const residualPixels = await pixels(page); assert.ok(residualPixels.green > 0, id + ' residual crack still exposes real core'); await shot(page, `${id}-recovered`, true); }
    await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(1000); const reset = await diag(page); filmOK(reset, 'reset'); assert.equal(reset.state.maxDamage, 0); assert.ok(depth(reset) < .00002); assert.equal(await page.locator('.toy-mount canvas').count(), 1); assert.deepEqual(errors, []);
    writeFileSync(resolve(out, `${id}.json`), JSON.stringify({ environment: 'Windows Edge headless desktop day 1280x900 DPR1; not phone hardware', style, core, contact, intact, opened, shallowDepth: depth(shallow), deepDepth: depth(deep), releasedDepth: depth(released), waitingDepth: depth(waiting), deep: deep.state, deepMetrics: deep.metrics, dragMetrics: dragged.metrics, sideMetrics: rotated.metrics, recovered: recovered && { state: recovered.state, metrics: recovered.metrics }, reset: reset.state, resources: rotated.resources }, null, 2));
  } finally { await saveVideo(page, context, `${id}-normal-speed`); }
});
for (let i = 0; i < styles.length; i++) {
  const style = styles[i], core = cores[i % cores.length];
  if (!selectedStyles.includes(style)) continue;
  test(`${style} ${core} mobile emulation: night reduced motion structural touch`, { timeout: 90000 }, async () => {
    const { context, page, errors, mesh } = await open(style, core, true); const id = `${style}-${core}-mobile-night-reduced`;
    try {
      const contact = await projectedMeshContact(page, mesh, style), cdp = await context.newCDPSession(page); if (style === 'donut') assert.ok(contact.radialDot < -.03);
      const intact = await pixels(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: contact.x, y: contact.y }] }); await page.waitForTimeout(1500); const held = await diag(page), exposed = await pixels(page); filmOK(held, id + ' held'); assert.ok(depth(held) > .002); assert.ok(exposed.green > intact.green + 2, JSON.stringify({ id, intact, exposed })); await shot(page, `${id}-held`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false'); const cancelled = await diag(page); filmOK(cancelled, id + ' cancel'); assert.deepEqual(errors, []); assert.equal(await page.locator('.toy-mount canvas').count(), 1);
      writeFileSync(resolve(out, `${id}.json`), JSON.stringify({ hardwarePhoneTested: false, style, core, contact, intact, exposed, state: held.state, metrics: held.metrics, cancelled: cancelled.state }, null, 2));
    } finally { await context.close(); }
  });
}
