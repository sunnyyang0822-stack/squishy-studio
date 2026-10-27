const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready } = require('./helpers/squishy-browser.cjs');
const { regions, installWaxStyleProbe, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('./helpers/wax-upload-observer.cjs');
const port = process.env.ORB_MM_WAX_TEST_PORT || '4242', base = `http://127.0.0.1:${port}`;
let server, browser;
const styles = process.env.WAX_MM_STYLE ? process.env.WAX_MM_STYLE.split(',') : Object.keys(regions);
for (const id of styles) assert.ok(regions[id], `Unknown marshmallow wax case: ${id}`);
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined),
    args: process.env.THIN_WAX_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
});
after(async () => { await browser?.close(); server?.kill(); });
const diagnostic = (page, options = { measure: false }) => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), options);
function maxChange(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; }
function depth(d) { let value = 0; for (let i = 0; i < d.corePositions.length; i += 3) value = Math.max(value, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return value; }
function sameDamage(a, b) { for (const key of ['cracked', 'detached', 'expired']) assert.equal(a[key], b[key], key); }
async function open(style) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const mesh = await installStyleProbe(page, getSquishyStyle(style)); await installWaxStyleProbe(page);
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=marshmallow&coreColor=mint&shellColor=rose&waxThickness=thin&step=core`);
  await ready(page); return { page, mesh };
}
async function press(page, mesh, style) {
  const p = await projectedMeshContact(page, mesh, style);
  if (style === 'donut') assert.ok(p.radialDot < -.03, 'The actual GLB contact belongs to the inner wall');
  if (style === 'paw') assert.ok(Math.abs(p.point[0]) < .15 && p.point[1] > .08 && p.point[1] < .3, 'Contact is in the palm-to-toe connection');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
}
async function enabled(page, value = true) { await page.waitForFunction(value => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled === value, value); }
async function restart(page) {
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.enabled && !d.coreState.restoring && d.corePositions.every((v, i) => Math.abs(v - d.coreRestPositions[i]) < 1e-6); });
}
async function damage(page, mesh, style) {
  await page.locator('.toy-mount').evaluate(el => {
    window.mmWaxHold = null; let started, lastRender, shallow, beforeThreshold, onset;
    window.addEventListener('pointerdown', event => { started = { time: performance.now(), id: event.pointerId, trusted: event.isTrusted }; }, { capture: true, once: true });
    const observe = () => {
      if (!started || lastRender === el.dataset.renderCount) return; lastRender = el.dataset.renderCount;
      const d = el.thinWaxDiagnostics({ measure: false }), s = d.thinWax;
      if (!s.active) return;
      const sample = { dwell: s.dwell, elapsed: performance.now() - started.time, state: s, core: d.corePositions, rest: d.coreRestPositions };
      if (!shallow && s.dwell >= .1) shallow = sample;
      if (s.dwell <= .5) beforeThreshold = sample;
      else if (!onset) onset = sample; // First completed post-threshold frame, never selected by damage.
      if (s.dwell >= 1.8) {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: started.id }));
        const released = el.thinWaxDiagnostics({ measure: false });
        window.mmWaxHold = { shallow, beforeThreshold, onset, deep: sample, released: released.corePositions, releasedState: released.thinWax, trusted: started.trusted };
        window.waxStyleObservers.delete(observe);
      }
    }; window.waxStyleObservers.add(observe);
  });
  await press(page, mesh, style); await page.waitForFunction(() => window.mmWaxHold !== null, null, { timeout: 20000 });
  await page.mouse.up(); return page.evaluate(() => window.mmWaxHold);
}

for (const style of styles) test(`${style} marshmallow wax preserves progressive retained core, real uploads, threshold and preview alignment`, { timeout: 120000 }, async t => {
  const { page, mesh } = await open(style);
  try {
    const bare = await diagnostic(page); assert.equal(bare.enabled, false);
    assert.equal(await page.locator('[name=coreMaterial][value=marshmallow]').isChecked(), true);
    const bareBox = await page.locator('.orb-input').boundingBox();
    await page.locator('.step-next').click(); await enabled(page);
    const shellBox = await page.locator('.orb-input').boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(bareBox[key] - shellBox[key]) < 1, `${key}: ${bareBox[key]} vs ${shellBox[key]}`);
    const initial = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(initial);
    assert.notEqual(initial.coreColor, initial.shellColor); assert.equal(initial.debrisStage.visible, false); assert.equal(initial.thinWax.collectionEnabled, false);
    await armWaxUploadEnd(page); await press(page, mesh, style); const short = await readWaxUploadEnd(page); await page.mouse.up();
    assert.equal(short.state.detached, 0); assert.ok(short.state.cracked > 0);
    await page.waitForTimeout(600); const retainedShort = await diagnostic(page);
    assert.deepEqual(retainedShort.corePositions, short.before.corePositions, 'Marshmallow release preserves every current core coordinate');
    await restart(page);
    const hold = await damage(page, mesh, style);
    assert.equal(hold.trusted, true); assert.ok(hold.beforeThreshold && hold.beforeThreshold.state.detached === 0, JSON.stringify(hold.beforeThreshold));
    assert.ok(hold.onset.state.dwell > .5 && hold.onset.state.detached > 0, JSON.stringify(hold.onset.state));
    const shallowDepth = depth({ corePositions: hold.shallow.core, coreRestPositions: hold.shallow.rest });
    const deepDepth = depth({ corePositions: hold.deep.core, coreRestPositions: hold.deep.rest });
    assert.ok(shallowDepth > .001 && deepDepth > shallowDepth + .01, `Original progressive marshmallow: ${shallowDepth} -> ${deepDepth}`);
    // The existing marshmallow beforeRelease hook synchronously commits a
    // pending real input frame. Freeze the completed release, not its prior frame.
    assert.ok(depth({ corePositions: hold.released, coreRestPositions: hold.deep.rest }) >= deepDepth);
    await page.waitForTimeout(900);
    const retained = await diagnostic(page, { measure: true, exhaustive: true }); geometryOK(retained);
    assert.deepEqual(retained.corePositions, hold.released, 'No clay-like recovery or extra pressure follows release');
    assert.equal(retained.thinWax.detached, hold.releasedState.detached); assert.equal(retained.thinWax.cracked, hold.releasedState.cracked);
    const gpuError = await page.evaluate(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return Math.max(...d.corePositions.map((v, i) => Math.abs(v - window.styleProbe.positions[i]))); });
    assert.ok(gpuError <= 1e-6);
    await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.living === 0 && s.expired === s.detached; }, null, { timeout: 15000 });
    const clear = await diagnostic(page); assert.equal(clear.thinWax.settled, 0); assert.equal(clear.thinWax.debris.gridCells, 0);
    t.diagnostic(JSON.stringify({ style, bareBox, shellBox, shortMs: short.elapsed, shortGPU: short.gpuDepth, shallowDepth, deepDepth, onset: hold.onset.state, gpuError, geometry: retained.geometry, cleared: clear.thinWax }));
  } finally { await page.close(); }
});

for (const style of styles) test(`${style} marshmallow preview damage survives navigation and legacy play, resets only on restart or committed configuration`, { timeout: 120000 }, async t => {
  const { page, mesh } = await open(style);
  try {
    await page.locator('.step-next').click(); await enabled(page); await damage(page, mesh, style);
    await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.detached > 0 && s.living === 0; }, null, { timeout: 15000 });
    const original = await diagnostic(page);
    await page.locator('.step-next').click(); sameDamage((await diagnostic(page)).thinWax, original.thinWax);
    await page.locator('.step-back').click(); sameDamage((await diagnostic(page)).thinWax, original.thinWax);
    for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
    await page.waitForSelector('.step-panel[data-step=play]'); await enabled(page, false);
    const play = await diagnostic(page); assert.equal(play.debrisStage.visible, false);
    assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).count(), 0);
    await page.waitForTimeout(750);
    await page.locator('.step-back').click(); await page.locator('.step-back').click(); await enabled(page);
    const returned = await diagnostic(page); sameDamage(returned.thinWax, original.thinWax);
    await restart(page); const restarted = await diagnostic(page); assert.equal(restarted.thinWax.cracked, 0); assert.equal(restarted.thinWax.detached, 0); assert.equal(restarted.thinWax.expired, 0);
    await damage(page, mesh, style);
    await page.locator('[name=shellColor][data-choice=sky]').check();
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.enabled && d.thinWax.cracked === 0 && !document.querySelector('.thin-wax-restart').disabled; });
    const recolored = await diagnostic(page); assert.equal(recolored.coreColor, original.coreColor); assert.notEqual(recolored.shellColor, original.shellColor);
    assert.equal(recolored.thinWax.detached, 0); assert.equal(recolored.thinWax.expired, 0);
    await page.locator('[name=waxThickness][value=medium]').check(); await enabled(page, false);
    await page.locator('[name=waxThickness][value=thin]').check(); await enabled(page);
    const configured = await diagnostic(page); assert.equal(configured.thinWax.cracked, 0); assert.equal(configured.thinWax.detached, 0); geometryOK(await diagnostic(page, { measure: true, exhaustive: true }));
    t.diagnostic(JSON.stringify({ style, original: original.thinWax, legacyPlay: play.enabled, returned: returned.thinWax, restarted: restarted.thinWax, recolored: recolored.thinWax, configured: configured.thinWax }));
  } finally { await page.close(); }
});
