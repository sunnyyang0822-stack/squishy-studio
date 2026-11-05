const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const captureEvidence = process.env.CI !== 'true';
const port = process.env.POLISH_PROGRESSION_PORT || '4256';
const base = `http://127.0.0.1:${port}`;
const out = resolve(process.env.POLISH_PROGRESSION_ARTIFACT_DIR || 'artifacts/issue-50/progression');
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
async function open(core, { coreColor = 'mint', video = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...(video && captureEvidence ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } } : {}) });
  const page = await context.newPage(), errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await installPixels(page);
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=${core}&shellMaterial=polish&coreColor=${coreColor}&shellColor=rose&step=shell`);
  await page.waitForSelector('.toy-stage[data-state="ready"] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'day'; }); await page.waitForTimeout(120);
  return { context, page, errors };
}
const diag = page => page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
function depth(d) { let max = 0; for (let i = 0; i < d.corePositions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return max; }
async function pixels(page) { await page.evaluate(() => { window.progressionPixels = null; window.captureProgressionPixels = true; window.captureAfterRevision = window.progressionDrawRevision || 0; }); const v = page.viewportSize(); await page.setViewportSize({ ...v, width: v.width + 1 }); await page.waitForFunction(() => window.progressionPixels); const r = await page.evaluate(() => window.progressionPixels); await page.setViewportSize(v); return r; }
async function point(page) { const b = await page.locator('.orb-input').boundingBox(); return { x: b.x + b.width * .5, y: b.y + b.height * .46 }; }
async function press(page, ms) { const p = await point(page); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); }
async function shot(page, name, closeup = false) { if (!captureEvidence) return; await (closeup ? page.locator('.toy-mount canvas') : page).screenshot({ path: resolve(out, `${name}.png`) }); }
function filmOK(d) { assert.equal(d.state.fragmentCount, 0); assert.equal(d.state.detached, 0); assert.equal(d.metrics.violations, 0, JSON.stringify(d.metrics)); assert.ok(d.metrics.minGap > 0); }
async function side(page, name) { const s = await page.locator('.toy-stage').boundingBox(); await page.mouse.move(s.x + 10, s.y + 20); await page.mouse.down(); await page.mouse.move(s.x + 150, s.y + 25, { steps: 24 }); await page.mouse.up(); await shot(page, name, true); }
async function saveVideo(page, context, name) { const video = page.video(); await context.close(); if (video) { await video.saveAs(resolve(out, `${name}.webm`)); await video.delete(); } }

test('marshmallow polish opens on the first shallow rendered pressure frame after the 60ms target and branches blend during repeated contacts', { timeout: 100000 }, async () => {
  const { context, page, errors } = await open('marshmallow');
  try {
    const intact = await pixels(page); assert.equal(intact.green, 0);
    await page.evaluate(() => { window.onsetArmed = true; window.onsetFrame = null; window.onsetStart = 0; });
    const p = await point(page); await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.waitForFunction(() => window.onsetFrame); const onset = await page.evaluate(() => window.onsetFrame); await page.mouse.up();
    // Software WebGL can submit its first eligible frame later than a hardware
    // renderer. Physical depth below is the onset criterion; record real wall
    // time without treating a delayed frame as deeper pressure or a 60ms proof.
    assert.ok(onset.elapsedMs >= 60 && onset.elapsedMs < 1000, JSON.stringify({ elapsedMs: onset.elapsedMs }));
    assert.ok(depth(onset.diagnostics) > .0002 && depth(onset.diagnostics) < .06, 'Early event includes a genuinely shallow physical core dent');
    assert.ok(onset.pixels.green > 3, 'Actual GPU core pixels appear at first light pressure: ' + JSON.stringify(onset.pixels)); filmOK(onset.diagnostics); await shot(page, 'marshmallow-60ms-light-crack');
    const first = await diag(page); const firstPixels = await pixels(page);
    const stages = [];
    for (let cycle = 0; cycle < 7; cycle++) { await press(page, 350); const held = await diag(page); filmOK(held); await page.mouse.up(); await page.waitForTimeout(120); stages.push({ state: held.state, depth: depth(held) }); if ([1, 3, 6].includes(cycle)) { await shot(page, `marshmallow-branch-stage-${cycle + 2}`); stages[cycle].pixels = await pixels(page); } }
    const final = await diag(page), finalPixels = await pixels(page); assert.ok(final.state.maxDamage > first.state.maxDamage); assert.ok(finalPixels.green > firstPixels.green); filmOK(final); await side(page, 'marshmallow-connected-layers-side');
    const released = await diag(page); await page.waitForTimeout(450); assert.deepEqual((await diag(page)).corePositions, released.corePositions, 'Marshmallow still retains the released dent'); assert.deepEqual(errors, []);
    writeFileSync(resolve(out, 'marshmallow-progression.json'), JSON.stringify({ environment: 'Windows Edge desktop headless 1280x900 DPR1 day; 60ms snapshot is a real rendered frame, not a replaced clock', intact, onset: { elapsedMs: onset.elapsedMs, depth: depth(onset.diagnostics), pixels: onset.pixels, state: onset.diagnostics.state }, first: first.state, firstPixels, stages, final: final.state, finalPixels, metrics: final.metrics, visualConnectivityLimitation: 'Pixel components descriptive only; screenshots and normal-speed video must be inspected for coarse/fine joins' }, null, 2));
  } finally { await saveVideo(page, context, 'marshmallow-light-and-connected-progression'); }
});

test('slow rebound polish keeps a bounded residual exposed aperture after its core reaches exact rest', { timeout: 65000 }, async () => {
  const { context, page, errors } = await open('butter');
  try {
    const initial = await diag(page), intact = await pixels(page); assert.equal(intact.green, 0);
    await press(page, 1400); const deep = await diag(page), deepPixels = await pixels(page); filmOK(deep); assert.ok(deepPixels.green > 20); await shot(page, 'slow-deep-actual-opening');
    await page.mouse.up(); await page.waitForTimeout(800); const during = await diag(page); filmOK(during); const duringPixels = await pixels(page); await shot(page, 'slow-during-rebound');
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').polishDiagnostics(); return d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { polling: 500, timeout: 25000 });
    const restored = await diag(page), residualPixels = await pixels(page); filmOK(restored); assert.equal(depth(restored), 0); assert.equal(restored.state.maxOpening, 0); assert.equal(restored.state.maxDamage, deep.state.maxDamage);
    assert.ok(residualPixels.green > intact.green + 20, 'Real exposed core remains visible after exact core recovery: ' + JSON.stringify(residualPixels));
    assert.ok(residualPixels.green < deepPixels.green, 'Bounded residual stays below fully loaded aperture');
    await shot(page, 'slow-exact-rest-residual-opening'); await side(page, 'slow-exact-rest-side-closeup');
    const renderCount = await page.locator('.toy-mount').getAttribute('data-render-count'); await page.waitForTimeout(350); assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), renderCount); assert.deepEqual(errors, []);
    writeFileSync(resolve(out, 'slow-residual-opening.json'), JSON.stringify({ environment: 'Windows Edge desktop headless day, mint core / rose coating, existing different-color rim stays disabled', initial: initial.state, intact, deep: deep.state, deepDepth: depth(deep), deepPixels, during: during.state, duringDepth: depth(during), duringPixels, restored: restored.state, restoredDepth: depth(restored), residualPixels, metrics: restored.metrics }, null, 2));
  } finally { await saveVideo(page, context, 'slow-deep-rebound-residual-aperture'); }
});

test('same-color rim visual evidence preserves the same scene, camera and day lighting', { timeout: 20000 }, async () => {
  const { context, page, errors } = await open('marshmallow', { coreColor: 'rose', video: false });
  try { await press(page, 450); const held = await diag(page); filmOK(held); await shot(page, 'same-color-marshmallow-rim-unchanged'); await page.mouse.up(); assert.deepEqual(errors, []); }
  finally { await context.close(); }
});
