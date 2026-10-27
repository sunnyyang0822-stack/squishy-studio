const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('./helpers/squishy-browser.cjs');
const { regions, installWaxStyleProbe, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('./helpers/wax-upload-observer.cjs');
const port = process.env.WAX_STYLE_TEST_PORT || '4240', base = `http://127.0.0.1:${port}`;
const styles = Object.keys(regions); let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(id, material = 'clay', step = 'core', { failFirstModel = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs'), mesh = await installStyleProbe(page, getSquishyStyle(id));
  await installWaxStyleProbe(page);
  if (failFirstModel) {
    let requests = 0;
    await page.route(`**/squishy-${id}.glb`, route => ++requests === 1 ? route.abort() : route.continue());
  }
  await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=${material}&coreColor=mint&shellColor=rose&waxThickness=thin&step=${step}`);
  if (failFirstModel) await page.waitForSelector('.toy-stage[data-state=error]');
  else await ready(page);
  return { page, mesh };
}
const diagnostic = (page, options = { measure: false }) => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), options);
function maxChange(a, b) { return Math.max(...a.map((v, i) => Math.abs(v - b[i]))); }
async function pressAt(page, contact) { await page.mouse.move(contact.x, contact.y); await page.mouse.down(); }
function compareBounds(a, b) { for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) < 1, `${key}: ${a[key]} vs ${b[key]}`); }

for (const id of styles) test(`${id} clay thin-wax making preview: real mesh input, structural region, geometry and cleanup`, { timeout: 180000 }, async t => {
  const { page, mesh } = await open(id), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const bare = await diagnostic(page), contact = await projectedMeshContact(page, mesh, id);
    assert.equal(bare.enabled, false);
    assert.equal(await page.locator('[name=coreMaterial][value=clay]').isChecked(), true, 'The existing clay preset is selected before the shell step');
    if (id === 'donut') assert.ok(contact.radialDot < -.03, 'The selected actual GLB triangle belongs to the inner wall');
    if (id === 'paw') assert.ok(Math.abs(contact.point[0]) < .15 && contact.point[1] > .08 && contact.point[1] < .3, 'The actual face lies in the palm-to-toe connection');
    await pressAt(page, contact); await page.waitForTimeout(180);
    const pressedBare = await diagnostic(page);
    assert.ok(pressedBare.coreState.active); assert.ok(maxChange(bare.corePositions, pressedBare.corePositions) > .001, 'Confirmed clay actually deforms before adding wax');
    assert.ok(Math.hypot(...contact.point.map((v, k) => v - pressedBare.coreState.center[k])) < .12, 'Real ray input hits the selected GLB structural region');
    await page.mouse.up(); await page.waitForTimeout(650);
    const bareBox = await page.locator('.orb-input').boundingBox(), bareCanvas = await page.locator('.toy-mount canvas').boundingBox();
    await page.locator('.step-next').click();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    await page.waitForTimeout(350);
    const shellBox = await page.locator('.orb-input').boundingBox(), shellCanvas = await page.locator('.toy-mount canvas').boundingBox();
    compareBounds(bareBox, shellBox); compareBounds(bareCanvas, shellCanvas);
    const initial = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(initial);
    assert.equal(initial.debrisStage.visible, false); assert.equal(initial.thinWax.collectionEnabled, false);
    assert.notEqual(initial.coreColor, initial.shellColor);
    // End force after an actual changed core position upload, before costly
    // native drawing. The trusted down and Pointer Capture stay real.
    await armWaxUploadEnd(page, { resultKey: 'waxStyleShort' });
    const shellContact = await projectedMeshContact(page, mesh, id); await pressAt(page, shellContact);
    const short = await readWaxUploadEnd(page, 'waxStyleShort'); await page.mouse.up();
    assert.ok(short.elapsed < 500 && short.captured && short.trusted, JSON.stringify(short.state));
    assert.ok(short.state.cracked > 0); assert.equal(short.state.detached, 0);
    assert.ok(maxChange(initial.corePositions, short.core) > .0001, 'The same short input changes core geometry under the independent wax');
    await page.locator('.toy-mount').evaluate(el => {
      window.waxStyleOnset = null; window.waxStyleBeforeThreshold = [];
      let lastRender, started;
      window.addEventListener('pointerdown', () => { started = performance.now(); }, { capture: true, once: true });
      const observe = () => {
        if (lastRender === el.dataset.renderCount || started === undefined) return; lastRender = el.dataset.renderCount;
        const d = el.thinWaxDiagnostics({ measure: false }), state = d.thinWax;
        if (state.active && state.dwell <= .5) window.waxStyleBeforeThreshold.push({ dwell: state.dwell, detached: state.detached });
        if (state.active && state.dwell > .5) { window.waxStyleOnset = { elapsed: performance.now() - started, state, core: d.corePositions }; window.waxStyleObservers.delete(observe); }
      }; window.waxStyleObservers.add(observe);
    });
    await pressAt(page, await projectedMeshContact(page, mesh, id));
    await page.waitForFunction(() => window.waxStyleOnset !== null, null, { timeout: 15000 });
    const onset = await page.evaluate(() => ({ onset: window.waxStyleOnset, before: window.waxStyleBeforeThreshold }));
    assert.ok(onset.before.length > 0 && onset.before.every(s => s.detached === 0));
    assert.ok(onset.onset.state.dwell > .5 && onset.onset.elapsed > 500, JSON.stringify(onset));
    assert.ok(onset.onset.state.detached > 0 && onset.onset.state.living <= 24);
    await page.waitForTimeout(800);
    const deep = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(deep);
    const gpuCoreError = await page.locator('.toy-mount').evaluate(el => {
      const d = el.thinWaxDiagnostics({ measure: false });
      return Math.max(...d.corePositions.map((v, i) => Math.abs(v - window.styleProbe.positions[i])));
    });
    assert.ok(gpuCoreError < 1e-6, `The live core matches its actual GPU upload: ${gpuCoreError}`);
    assert.ok(maxChange(initial.corePositions, deep.corePositions) > .01, 'Long input continues deep clay deformation');
    const drag = await projectedMeshContact(page, mesh, id, [.1, .02]);
    await page.mouse.move(drag.x, drag.y, { steps: 6 }); await page.waitForTimeout(250);
    const dragged = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(dragged);
    assert.ok(maxChange(deep.corePositions, dragged.corePositions) > .001, 'A real captured drag continues the original clay response');
    await page.mouse.up(); await page.waitForTimeout(750);
    const recovered = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(recovered);
    assert.ok(maxChange(dragged.corePositions, recovered.corePositions) > .001, 'Normal clay release/recovery continues beneath the shell');
    await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.detached > 0 && s.living === 0 && s.expired === s.detached; }, null, { timeout: 15000 });
    const cleared = await page.locator('.toy-mount').evaluate(el => {
      const d = el.thinWaxDiagnostics({ measure: true, exhaustive: true, surface: true });
      let gpu;
      for (const values of window.waxStyleBuffers.values()) if (values.length === d.surface.positions.length && values.every((v, i) => Math.abs(v - d.surface.positions[i]) < 1e-6)) { gpu = values; break; }
      if (!gpu) throw Error('Current shell geometry does not match any actual GPU upload');
      let holes = 0;
      for (let r = 0; r < d.surface.panelIds.length; r++) if (d.surface.damage[r] && !d.surface.detached[r] && [0, 1, 2].every(k => gpu[r * 3 + k] === 0)) holes++;
      return { geometry: d.geometry, state: d.thinWax, holes, core: d.corePositions };
    }); geometryOK(cleared);
    assert.equal(cleared.state.settled, 0); assert.equal(cleared.state.debris.gridCells, 0);
    assert.equal(cleared.state.debris.moving + cleared.state.debris.settled, 0); assert.ok(cleared.holes > 20);
    await page.locator('.step-next').click(); await page.locator('.step-back').click();
    const back = await diagnostic(page); assert.equal(back.thinWax.detached, cleared.state.detached); assert.equal(back.thinWax.expired, cleared.state.expired);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ style: id, actualContact: contact, shortMs: short.elapsed, shortGPU: { depth: short.gpuDepth, changedSinceDown: short.changedSinceDown, error: short.gpuCoreError, captured: short.captured, trusted: short.trusted }, onset: onset.onset.state, bareBox, shellBox, gpuCoreError, geometry: recovered.geometry, cleanup: { holes: cleared.holes, state: cleared.state } }));
  } finally { await page.close(); }
});

test('style wax scope excludes slow rebound and preserves all preview-only legacy play', { timeout: 180000 }, async t => {
  const results = [];
  for (const id of styles) for (const material of ['butter']) {
    const { page } = await open(id, material, 'shell');
    try {
      const d = await diagnostic(page); assert.equal(d.enabled, id === 'orb', `${id}/${material}: only the slow-rebound orb joins the local making preview`);
      assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).count(), id === 'orb' ? 1 : 0);
      results.push({ id, material, enabled: d.enabled });
    } finally { await page.close(); }
  }
  const legacyRecipes = [...styles.filter(id => id !== 'orb').map(id => [id, 'clay']), ...styles.map(id => [id, 'marshmallow'])];
  for (const [id, material] of legacyRecipes) {
    const { page } = await open(id, material, 'play');
    try {
      const d = await diagnostic(page); assert.equal(d.enabled, false, `${id} play keeps the original single surface`);
      assert.equal(d.debrisStage.visible, false);
      assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).count(), 0);
      results.push({ id, step: 'play', enabled: d.enabled });
    } finally { await page.close(); }
  }
  t.diagnostic(JSON.stringify(results));
});

test('non-orb damaged preview survives legacy final navigation, rotation, keyboard, misses and rapid configuration', { timeout: 180000 }, async t => {
  const { page, mesh } = await open('donut', 'clay', 'shell');
  try {
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    await pressAt(page, await projectedMeshContact(page, mesh, 'donut')); await page.waitForTimeout(1500); await page.mouse.up();
    await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.living === 0 && s.expired > 0; }, null, { timeout: 15000 });
    const before = await diagnostic(page);
    for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
    await page.waitForSelector('.step-panel[data-step=play]');
    const legacy = await diagnostic(page); assert.equal(legacy.enabled, false); assert.equal(legacy.debrisStage.visible, false);
    assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).count(), 0);
    await page.waitForTimeout(750);
    await page.locator('.step-back').click(); await page.locator('.step-back').click();
    await page.waitForSelector('.step-panel[data-step=shell]');
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    const back = await diagnostic(page); assert.equal(back.enabled, true);
    assert.equal(back.thinWax.detached, before.thinWax.detached); assert.equal(back.thinWax.expired, before.thinWax.expired);
    assert.equal(back.thinWax.cracked, before.thinWax.cracked);
    const matrix = back.debrisStage.matrixWorld; await rotate(page, 30, 12);
    const turned = await diagnostic(page);
    assert.ok(maxChange(matrix, turned.debrisStage.matrixWorld) > .01, 'Existing mouse rotation remains active');
    await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(700);
    const input = page.locator('.orb-input'); await input.focus(); await page.keyboard.down('Space'); await page.waitForTimeout(850); await page.keyboard.up('Space');
    assert.ok((await diagnostic(page)).thinWax.cracked > 0, 'The shared keyboard input also drives the wax');
    await pressAt(page, await projectedMeshContact(page, mesh, 'donut')); await page.mouse.move(1, 1); await page.mouse.up();
    const missed = await diagnostic(page); assert.equal(missed.thinWax.active, false);
    await page.evaluate(() => { for (const value of ['medium', 'thin', 'thick', 'thin']) document.querySelector(`[name=waxThickness][value=${value}]`).click(); });
    await page.waitForFunction(() => !document.querySelector('.thin-wax-restart').disabled && document.querySelector('[name=waxThickness][value=thin]').checked);
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    assert.equal((await diagnostic(page)).thinWax.detached, missed.thinWax.detached, 'Cancelled intermediate choices do not repair an unchanged committed recipe');
    await page.locator('[name=waxThickness][value=medium]').check();
    await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    await page.evaluate(() => { for (const value of ['thin', 'thick', 'thin']) document.querySelector(`[name=waxThickness][value=${value}]`).click(); });
    await page.waitForFunction(() => !document.querySelector('.thin-wax-restart').disabled && document.querySelector('[name=waxThickness][value=thin]').checked);
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    const configured = await diagnostic(page); assert.equal(configured.thinWax.detached, 0); assert.equal(configured.thinWax.expired, 0); geometryOK(await diagnostic(page, { measure: true, exhaustive: true }));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
    t.diagnostic(JSON.stringify({ before: before.thinWax, legacyEnabled: legacy.enabled, preserved: back.thinWax, configured: configured.thinWax }));
  } finally { await page.close(); }
});

test('non-orb thin-wax model failure retries through the shared loader and leaving disposes GPU buffers', { timeout: 60000 }, async () => {
  const { page } = await open('cloud', 'clay', 'shell', { failFirstModel: true });
  try {
    await page.locator('.retry-button').click(); await ready(page);
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    geometryOK(await diagnostic(page, { measure: true, exhaustive: true }));
    assert.ok(await page.evaluate(() => window.waxStyleBuffers.size > 0));
    await page.locator('.toy-mount').evaluate(el => {
      const d = el.thinWaxDiagnostics({ measure: false, surface: true });
      window.waxStyleOwnedLengths = [d.corePositions.length, d.surface.positions.length];
    });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
    await page.waitForFunction(() => window.styleProbe.contexts.every(gl => gl.isContextLost()));
    const disposed = await page.evaluate(() => ({
      contextsLost: window.styleProbe.contexts.map(gl => gl.isContextLost()),
      remaining: [...window.waxStyleBuffers].map(([buffer, v]) => ({ length: v.length, first: Array.from(v.slice(0, 12)),
        ownedGeometry: window.waxStyleOwnedLengths.includes(v.length), validGPUBuffer: window.styleProbe.contexts.some(gl => gl.isBuffer(buffer)) })),
    }));
    assert.ok(disposed.contextsLost.length > 0 && disposed.contextsLost.every(Boolean), JSON.stringify(disposed));
    assert.ok(disposed.remaining.every(b => !b.validGPUBuffer && !b.ownedGeometry), 'Actual GPU handles are invalid and scene-owned core/shell attributes were deleted: ' + JSON.stringify(disposed));
    console.log(JSON.stringify({ modelFailureRetryDisposal: disposed }));
  } finally { await page.close(); }
});
