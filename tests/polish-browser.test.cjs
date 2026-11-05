const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const captureEvidence = process.env.CI !== 'true';
const port = process.env.POLISH_TEST_PORT || '4250';
const base = `http://127.0.0.1:${port}`;
const out = resolve(process.env.POLISH_ARTIFACT_DIR || 'artifacts/issue-50');
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
      const gl = get.call(this, type, ...args); if (type === 'webgl2' && gl) window.polishGL = gl; return gl;
    };
    const frame = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => frame(time => {
      callback(time);
      if (window.measurePolishFrames) (window.polishFrameTimes ||= []).push(performance.now());
      if (!window.capturePolishPixels || !window.polishGL) return;
      window.capturePolishPixels = false;
      const gl = window.polishGL, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let opaque = 0, green = 0, pink = 0, transparent = 0, patchOpaque = 0, patchGreen = 0;
      const canvas = gl.canvas.getBoundingClientRect(), toy = document.querySelector('.orb-input').getBoundingClientRect();
      const cx = (toy.x + toy.width * .5 - canvas.x) * w / canvas.width;
      const cy = h - (toy.y + toy.height * .46 - canvas.y) * h / canvas.height;
      const rx = toy.width * .22 * w / canvas.width, ry = toy.height * .22 * h / canvas.height;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
        if (a < 254) { transparent++; continue; }
        opaque++;
        const pixel = i / 4, px = pixel % w, py = Math.floor(pixel / w);
        if (Math.abs(px-cx)<rx && Math.abs(py-cy)<ry) { patchOpaque++; if (g>r+7 && g>b+4) patchGreen++; }
        if (g > r + 7 && g > b + 4) green++;
        if (r > g + 8 && b > g + 2) pink++;
      }
      window.polishPixels = { opaque, green, pink, transparent, patchOpaque, patchGreen, width: w, height: h };
    });
  });
}
async function open({ mobile = false, night = false, reduced = false, video = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference',
    ...(video && captureEvidence ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } } : {}) });
  const page = await context.newPage(); const errors = [];
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await installPixels(page);
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&shellMaterial=polish&coreColor=mint&shellColor=rose&step=shell`);
  await page.waitForSelector('.toy-stage[data-state="ready"] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  await page.evaluate(night => { document.documentElement.dataset.theme = night ? 'night' : 'day'; }, night);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const diag = page => page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
const depth = d => { let max = 0; for (let i = 0; i < d.corePositions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return max; };
async function pixels(page) {
  await page.evaluate(() => { window.polishPixels = null; window.capturePolishPixels = true; document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'; window.dispatchEvent(new Event('resize')); });
  // ResizeObserver reliably requests a real draw even when the object is idle.
  const v = page.viewportSize(); await page.setViewportSize({ ...v, width: v.width + 1 });
  await page.waitForFunction(() => window.polishPixels); const result = await page.evaluate(() => window.polishPixels);
  await page.setViewportSize(v); return result;
}
async function location(page, x = .5, y = .46) {
  const b = await page.locator('.orb-input').boundingBox(); return { x: b.x + b.width * x, y: b.y + b.height * y };
}
async function press(page, ms, x = .5, y = .46) {
  const p = await location(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); return p;
}
async function shot(page, name) { if (!captureEvidence) return; await page.screenshot({ path: resolve(out, name + '.png') }); }
async function restart(page) { await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(900); }

test('polish clay actual GPU opening, local progressive damage, lifecycle and normal-speed desktop recording', { timeout: 120000 }, async () => {
  const { context, page, errors } = await open({ video: true });
  const initial = await diag(page), intactPixels = await pixels(page);
  assert.equal(initial.coreColor, 'mint'); assert.equal(initial.shellColor, 'rose');
  assert.ok(intactPixels.pink > 1000, JSON.stringify(intactPixels));
  assert.ok(intactPixels.green < intactPixels.pink * .01, 'Intact coating covers the independent mint core');
  await shot(page, 'desktop-day-intact');
  await page.evaluate(() => { window.polishFrameTimes = []; window.measurePolishFrames = true; });
  await press(page, 900);
  await page.evaluate(() => { window.measurePolishFrames = false; });
  await page.mouse.up();
  const frameTimes = await page.evaluate(() => window.polishFrameTimes);
  const intervals = frameTimes.slice(1).map((v, i) => v - frameTimes[i]).sort((a, b) => a - b);
  const performanceSample = { environment: 'Windows Edge headless, desktop 1280x900 DPR1; 900ms press; no diagnostics reads during sample', samples: intervals.length, medianMs: intervals[Math.floor(intervals.length * .5)], p95Ms: intervals[Math.floor(intervals.length * .95)] };
  await restart(page);
  // Same recipe/color/view/light, bare core then coating; no material retuning.
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&shellMaterial=polish&coreColor=rose&shellColor=rose&step=core`);
  await page.waitForSelector('.toy-stage[data-state="ready"] .toy-mount canvas'); await page.waitForTimeout(300); await shot(page, 'same-color-bare-core');
  await page.locator('.step-next').click(); await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  await page.waitForTimeout(150); await shot(page, 'same-color-polish');
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&shellMaterial=polish&coreColor=mint&shellColor=rose&step=shell`);
  await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  await press(page, 180); const shallow = await diag(page); await shot(page, 'shallow-held');
  await page.waitForTimeout(900); const deep = await diag(page), openedPixels = await pixels(page); await shot(page, 'deep-held');
  assert.ok(depth(deep) > depth(shallow) + .01, `${depth(shallow)} -> ${depth(deep)}`);
  assert.ok(openedPixels.green > intactPixels.green + 20, `Real mint pixels appear through shell: ${JSON.stringify({ intactPixels, openedPixels })}`);
  await page.mouse.up(); await page.waitForTimeout(400);
  const first = await diag(page);
  for (let i = 0; i < 3; i++) { await press(page, 350); await page.mouse.up(); await page.waitForTimeout(180); }
  const repeated = await diag(page);
  assert.ok(repeated.state.maxDamage > first.state.maxDamage, 'Same-region independent contacts increase damage');
  assert.ok(repeated.state.maxLocalContacts > first.state.maxLocalContacts);
  await shot(page, 'repeated-same-region');
  for (let i = 0; i < 7; i++) { await press(page, 400); await page.mouse.up(); await page.waitForTimeout(100); }
  const saturatedPixels = await pixels(page);
  assert.ok(saturatedPixels.patchGreen / saturatedPixels.patchOpaque < .13, 'Repeated deep pressure keeps at least 87% of local film: ' + JSON.stringify(saturatedPixels));
  await shot(page, 'saturated-film-coverage');
  await press(page, 400, .72, .40); await page.mouse.up(); await page.waitForTimeout(250); await shot(page, 'neighbor-new-region');
  const start = await press(page, 1400, .42, .55); const target = await location(page, .7, .50);
  await page.mouse.move(target.x, target.y, { steps: 35 }); await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(600); await shot(page, 'long-hold-slide-released');
  const beforeNavigation = await diag(page);
  await page.locator('.step-next').click(); await page.locator('.step-next').click(); await page.locator('.step-next').click();
  await page.waitForFunction(() => document.querySelector('.workflow-progress li[data-step=play]')?.getAttribute('aria-current') === 'step');
  const afterNavigation = await diag(page);
  assert.equal(afterNavigation.state.maxDamage, beforeNavigation.state.maxDamage, 'Same recipe retains damage through making and final play');
  assert.equal(afterNavigation.state.cycle, beforeNavigation.state.cycle);
  await page.locator('.step-back').click(); await page.locator('.step-back').click();
  await page.waitForFunction(() => document.querySelector('.workflow-progress li[data-step=shell]')?.getAttribute('aria-current') === 'step');
  await press(page, 200);
  await page.evaluate(() => {
    // Explicit mechanism simulation, not a real OS background/hardware claim.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
  assert.equal((await diag(page)).state.active, false);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.mouse.up();
  const b = await page.locator('.toy-stage').boundingBox();
  await page.mouse.move(b.x + 10, b.y + 20); await page.mouse.down(); await page.mouse.move(b.x + 170, b.y + 25, { steps: 24 }); await page.mouse.up(); await page.waitForTimeout(200); await shot(page, 'side-rotated');
  if (captureEvidence) await page.locator('.toy-mount canvas').screenshot({ path: resolve(out, 'side-rotated-closeup.png') });
  const settled = await diag(page);
  for (const d of [shallow, deep, first, repeated, settled]) {
    assert.equal(d.state.detached, 0); assert.equal(d.state.falling, 0); assert.equal(d.state.fragmentCount, 0);
    assert.equal(d.metrics.violations, 0, JSON.stringify(d.metrics));
    assert.ok(d.metrics.samples > 10000); assert.ok(d.metrics.minGap > 0); assert.ok(d.metrics.maxGap < .004);
  }
  assert.equal(deep.state.maxLocalContacts, 1, 'One long contact counts once');
  await page.waitForTimeout(450);
  const count = await page.locator('.toy-mount').getAttribute('data-render-count'); await page.waitForTimeout(250);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count, 'Static scene stops requesting frames');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  await restart(page); await shot(page, 'restart');
  const reset = await diag(page); assert.ok(depth(reset) < .0001); assert.equal(reset.state.maxDamage, 0);
  await press(page, 550); await page.mouse.up();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.waitForTimeout(80); await press(page, 220);
  const takeover = await diag(page); assert.equal(takeover.state.active, true); assert.ok(depth(takeover) > .015, 'New input takes over explicit restore continuously');
  await page.mouse.up(); await restart(page);
  await page.getByRole('group', { name: '外壳颜色', exact: true }).getByRole('radio', { name: '雾蓝', exact: true }).check();
  await page.waitForTimeout(900); const recolored = await diag(page); assert.equal(recolored.coreColor, 'mint'); assert.equal(recolored.shellColor, 'sky'); await shot(page, 'shell-color-changed');
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'desktop-browser.json'), JSON.stringify({ environment: 'Windows Edge desktop; not phone hardware; document.hidden override tests background mechanism only', performanceSample, takeover: takeover.state, intactPixels, openedPixels, saturatedPixels, shallowDepth: depth(shallow), deepDepth: depth(deep), first: first.state, repeated: repeated.state, settled: settled.state, metrics: settled.metrics, reset: reset.state, resources: settled.resources }, null, 2));
  const video = page.video(); await context.close(); if (video) { await video.saveAs(resolve(out, 'desktop-normal-speed.webm')); await video.delete(); }
});

test('polish clay mobile emulation, night, reduced motion and cancellation remain real shell', { timeout: 90000 }, async () => {
  const reports = [];
  for (const profile of [{ mobile: true, night: false, reduced: false }, { mobile: true, night: true, reduced: true }, { mobile: false, night: true, reduced: false }]) {
    const { context, page, errors } = await open(profile);
    const before = await pixels(page); const p = await location(page);
    if (profile.mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await page.waitForTimeout(1200); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await page.waitForTimeout(180); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    } else { await press(page, 1200); await page.mouse.up(); }
    await page.waitForTimeout(350); const d = await diag(page), after = await pixels(page);
    assert.ok(depth(d) > .02, JSON.stringify({ profile, depth: depth(d), state: d.state })); assert.equal(d.state.detached, 0); assert.equal(d.state.falling, 0); assert.equal(d.metrics.violations, 0, JSON.stringify(d.metrics)); assert.ok(after.green > before.green + 10, JSON.stringify({ profile, before, after }));
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.toy-mount canvas').count(), 1); assert.deepEqual(errors, []);
    await shot(page, `${profile.mobile ? 'mobile-emulated' : 'desktop'}-${profile.night ? 'night' : 'day'}-${profile.reduced ? 'reduced' : 'normal'}`);
    reports.push({ profile, before, after, state: d.state, metrics: d.metrics, depth: depth(d) });
    await context.close();
  }
  writeFileSync(resolve(out, 'profiles-browser.json'), JSON.stringify({ hardwarePhoneTested: false, reports }, null, 2));
});
