const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('./helpers/squishy-browser.cjs');
const { projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const { diagnostics } = require('../scripts/capture-thick-wax-styles.cjs');
const port = process.env.THICK_WAX_STYLES_TEST_PORT || '4354';
const base = `http://127.0.0.1:${port}`;
const styles = process.env.THICK_WAX_STYLE_CASES ? process.env.THICK_WAX_STYLE_CASES.split(',') : ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(style, core = 'clay', step = 'shell') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const mesh = await installStyleProbe(page, getSquishyStyle(style));
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${core}&coreColor=mint&shellColor=rose&waxThickness=thick&step=${step}`); await ready(page);
  return { page, mesh };
}
for (const style of styles) test(`${style} thick wax: real structural input, local thickness, cleanup and scope`, { timeout: 90000 }, async t => {
  const { page, mesh } = await open(style);
  try {
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
    const initial = await diagnostics(page, true); geometryOK(initial); assert.equal(initial.geometry.thickness, .042); assert.equal(initial.thinWax.collectionEnabled, false);
    const hit = await projectedMeshContact(page, mesh, style);
    if (style === 'donut') assert.ok(hit.radialDot < -.03, 'Pressure must reach the real inner wall, not the outer ring');
    await page.mouse.move(hit.x, hit.y); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
    const pressed = await diagnostics(page, true); geometryOK(pressed); assert.ok(pressed.coreMaximumDisplacement > .01); assert.ok(pressed.thinWax.detached > 0);
    const damage = pressed.thinWax.detached;
    await page.waitForTimeout(450); await rotate(page, 35, 9);
    const rotated = await diagnostics(page, true); geometryOK(rotated); assert.equal(rotated.thinWax.detached, damage);
    await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.living === 0 && s.expired === s.detached; }, null, { timeout: 15000 });
    const cleaned = await diagnostics(page, true); geometryOK(cleaned); assert.equal(cleaned.thinWax.settled, 0); assert.equal(cleaned.geometry.debris.gridCells, 0);
    await page.locator('.step-next').click(); await page.locator('.step-back').click(); assert.equal((await diagnostics(page)).thinWax.detached, damage);
    // Non-orb final play keeps its original bare-core behavior; returning must
    // preserve the making shell rather than silently repairing it.
    for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
    await page.waitForSelector('.step-panel[data-step=play]');
    const play = await diagnostics(page); assert.equal(play.enabled, false); assert.equal(play.debrisStage.visible, false);
    await page.locator('.step-back').click(); await page.locator('.step-back').click();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
    const returned = await diagnostics(page, true); geometryOK(returned); assert.equal(returned.thinWax.detached, damage);
    await page.locator('[name=waxThickness][value=thin]').check();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .014);
    await page.evaluate(() => { for (const thickness of ['thin', 'thick', 'medium', 'thin', 'thick']) document.querySelector(`[name=waxThickness][value=${thickness}]`).click(); });
    await page.waitForTimeout(700);
    const switched = await diagnostics(page, true); geometryOK(switched); assert.equal(switched.geometry.thickness, .042); assert.equal(switched.thinWax.detached, 0);
    // First legacy play renders the previously hidden floor for the first
    // time. Its GPU geometry remains owned by the scene after returning.
    // Compare after that complete lifecycle rather than before its upload.
    assert.equal(returned.resources.geometries, initial.resources.geometries + 1, 'Legacy bare play uploads its one existing floor geometry');
    assert.equal(switched.resources.geometries, returned.resources.geometries, 'Switching releases the old shell after the full scene lifecycle');
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.locator('[name=waxThickness][value=thin]').check();
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .014);
      await page.locator('[name=waxThickness][value=thick]').check();
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .042);
      await page.waitForTimeout(150);
      const cycleState = await diagnostics(page);
      assert.equal(cycleState.resources.geometries, returned.resources.geometries, 'Repeated committed thin/thick switches cannot grow GPU geometry count');
    }
    t.diagnostic(JSON.stringify({ style, contact: hit, thickness: pressed.geometry.thickness, maxThicknessError: pressed.geometry.maxThicknessError, detached: damage, cleanup: cleaned.thinWax.expired, initialResources: initial.resources, afterFirstFloorUploadResources: returned.resources, switchedResources: switched.resources }));
  } finally { await page.close(); }
});
test('thick wax remains excluded for paw and other cores', { timeout: 90000 }, async () => {
  for (const [style, core] of [['paw', 'clay'], ['donut', 'marshmallow'], ['donut', 'butter']]) {
    const { page } = await open(style, core);
    try { assert.equal((await diagnostics(page)).enabled, false, `${style}/${core}`); }
    finally { await page.close(); }
  }
});
