const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact } = require('./helpers/squishy-browser.cjs');
const port = process.env.THICK_WAX_TEST_PORT || '4346';
const base = `http://127.0.0.1:${port}`;
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const diag = page => page.locator('.toy-mount').evaluate(el => {
  const { corePositions, coreRestPositions, ...d } = el.thinWaxDiagnostics({ exhaustive: true }); return d;
});
function geometryOK(d) {
  assert.equal(d.geometry.thickness, .042); assert.equal(d.geometry.patches, 36);
  assert.equal(d.geometry.attachedViolations, 0); assert.equal(d.geometry.detachedViolations, 0);
  assert.ok(d.geometry.maxThicknessError < 1e-5);
}
test('thick clay orb final play preserves making damage, collects real fragments, returns and restarts', { timeout: 60000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  await installStyleProbe(page, getSquishyStyle('orb'));
  try {
    await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thick&step=shell`);
    await ready(page); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
    const hit = await projectedSurfaceContact(page, 0, .03);
    await page.mouse.move(hit.x, hit.y); await page.mouse.down(); await page.waitForTimeout(1100); await page.mouse.up();
    const damaged = await diag(page); geometryOK(damaged); assert.ok(damaged.thinWax.detached > 0);
    for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().debrisStage.collectionEnabled);
    const play = await diag(page); geometryOK(play);
    assert.equal(play.thinWax.detached, damaged.thinWax.detached); assert.equal(play.debrisStage.visible, true);
    const playHit = await projectedSurfaceContact(page, .22, .1);
    await page.mouse.move(playHit.x, playHit.y); await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up();
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.thinWax.living === 0 && d.thinWax.settled > 0; }, null, { timeout: 12000 });
    const settled = await diag(page); geometryOK(settled); assert.ok(settled.thinWax.settled > 0);
    assert.ok(settled.geometry.debris.minY >= settled.geometry.debris.floorY - 1e-5);
    await page.locator('.step-back').click(); await page.locator('.step-back').click();
    await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics().debrisStage.collectionEnabled);
    const returned = await diag(page); geometryOK(returned); assert.equal(returned.thinWax.detached, settled.thinWax.detached);
    await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(850);
    const reset = await diag(page); geometryOK(reset); assert.equal(reset.thinWax.detached, 0); assert.equal(reset.thinWax.cracked, 0);
    t.diagnostic(JSON.stringify({ makingDetached: damaged.thinWax.detached, playSettled: settled.thinWax.settled, returnedDetached: returned.thinWax.detached, resetDetached: reset.thinWax.detached, geometry: settled.geometry }));
  } finally { await page.close(); }
});
