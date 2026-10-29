const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('./helpers/squishy-browser.cjs');
const { installWaxStyleProbe } = require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('./helpers/wax-upload-observer.cjs');
const { diagnostics, geometryOK, load, workflow, restart } = require('../scripts/capture-thick-orb-cores.cjs');
const port = process.env.THICK_ORB_CORE_TEST_PORT || '4366', base = `http://127.0.0.1:${port}`;
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined), args: process.env.THIN_WAX_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
});
after(async () => { await browser?.close(); server?.kill(); });
for (const core of ['marshmallow', 'butter']) test(`orb ${core} thick wax keeps real gradual core, dwell, release, final scope and resource lifecycle`, { timeout: 120000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    await installStyleProbe(page, getSquishyStyle('orb')); await installWaxStyleProbe(page);
    await load(page, base, core, 'thick', 'core');
    const bareBox = await page.locator('.orb-input').boundingBox(); assert.equal((await diagnostics(page)).enabled, false);
    await page.locator('.step-next').click(); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    const box = await page.locator('.orb-input').boundingBox(); for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[key] - bareBox[key]) < 1);
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false, surface: true }); return [...window.waxGPUObserver.buffers.values()].some(b => b.length === d.surface.positions.length && b.every((v, i) => Math.abs(v - d.surface.positions[i]) <= 1e-6)); });
    const initial = await diagnostics(page, true); geometryOK(initial, 'thick'); assert.equal(initial.geometry.patches, 36); assert.equal(initial.debrisStage.visible, false);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), core === 'butter' ? 'slow-rebound' : 'marshmallow');
    assert.equal(await page.locator('.toy-mount').getAttribute('data-appearance-id'), core === 'butter' ? 'full-matte' : 'matte');
    const press = async () => { const hit = await projectedSurfaceContact(page, 0, .03); await page.mouse.move(hit.x, hit.y); await page.mouse.down(); return hit; };
    await armWaxUploadEnd(page, { minimumDepth: core === 'butter' ? .0001 : .001 }); await press(); const short = await readWaxUploadEnd(page); await page.mouse.up();
    assert.ok(short.actualGPU && short.trustedDown && short.gpuCoreError < 1e-6); assert.ok(short.state.cracked > 0); assert.equal(short.state.detached, 0);
    await restart(page);
    await page.locator('.toy-mount').evaluate(el => {
      window.thickCoreClock = { before: null, onset: null, trusted: false };
      window.addEventListener('pointerdown', event => { window.thickCoreClock.trusted = event.isTrusted; }, { once: true, capture: true });
      const observe = () => { const s = el.thinWaxDiagnostics({ measure: false }).thinWax; if (!s.active) return; if (s.dwell <= .5) window.thickCoreClock.before = s; else if (!window.thickCoreClock.onset) window.thickCoreClock.onset = s; };
      window.waxStyleObservers.add(observe); window.stopThickCoreClock = () => window.waxStyleObservers.delete(observe);
    });
    await press(); await page.waitForTimeout(1800); await page.mouse.up();
    const released = await diagnostics(page, false, true), clock = await page.evaluate(() => { window.stopThickCoreClock(); return window.thickCoreClock; });
    assert.ok(clock.trusted && clock.before && clock.onset); assert.equal(clock.before.detached, 0); assert.ok(clock.onset.dwell > .5 && clock.onset.detached > 0);
    assert.ok(released.coreMaximumDisplacement > .2); assert.ok(released.thinWax.detached > 0);
    await page.waitForTimeout(600); const recovering = await diagnostics(page, true, true); geometryOK(recovering, 'thick');
    assert.equal(recovering.thinWax.detached, released.thinWax.detached);
    if (core === 'marshmallow') assert.deepEqual(recovering.corePositions, released.corePositions);
    else { assert.ok(recovering.coreMaximumDisplacement < released.coreMaximumDisplacement); await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 25000 }); }
    await rotate(page, 35, 8); geometryOK(await diagnostics(page, true), 'thick');
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.living === 0, null, { timeout: 15000 });
    const cleaned = await diagnostics(page, true); geometryOK(cleaned); assert.equal(cleaned.thinWax.expired, cleaned.thinWax.detached);
    const reset = await workflow(page, 'thick'); geometryOK(reset, 'thick'); assert.equal(reset.thinWax.detached, 0);
    // Final play uploads the existing floor once. Subsequent committed changes
    // keep that warmed GPU geometry baseline stable and release old shell data.
    const warmed = reset.resources.geometries;
    for (let i = 0; i < 2; i++) {
      await page.locator('[name=waxThickness][value=thin]').check(); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .014);
      await page.locator('[name=waxThickness][value=thick]').check(); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .042);
      assert.equal((await diagnostics(page)).resources.geometries, warmed);
    }
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ core, shortMs: short.elapsed, timing: clock, depth: released.coreMaximumDisplacement, recovery: recovering.coreMaximumDisplacement, detached: cleaned.thinWax.detached, originalResources: initial.resources, warmedResources: reset.resources }));
  } finally { await page.close(); }
});

test('new orb core thick wax does not enable other models, materials or final-play shells', { timeout: 120000 }, async () => {
  const page = await browser.newPage();
  try {
    for (const core of ['marshmallow', 'butter']) for (const extra of ['style=cloud&step=shell', 'style=orb&step=play', 'style=orb&step=shell&shellMaterial=sugar', 'style=orb&step=shell&shellMaterial=polish']) {
      await page.goto(`${base}/squishy/cloud/?coreMaterial=${core}&waxThickness=thick&${extra}`); await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics);
      assert.equal((await diagnostics(page)).enabled, false, `${core}/${extra}`);
    }
  } finally { await page.close(); }
});
