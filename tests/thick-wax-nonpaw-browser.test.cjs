const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { installStyleProbe, rotate } = require('./helpers/squishy-browser.cjs');
const { installWaxStyleProbe, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('./helpers/wax-upload-observer.cjs');
const { styles, cores, diagnostic, maximumDepth, load, restart, armRelease, waitLoaded, settled, naturalRestore, workflow } = require('../scripts/capture-thick-nonpaw.cjs');
const selectedStyles = process.env.THICK_NONPAW_STYLES?.split(',') || styles;
const selectedCores = process.env.THICK_NONPAW_CORES?.split(',') || cores;
const port = process.env.THICK_NONPAW_TEST_PORT || '4382', base = `http://127.0.0.1:${port}`; let browser, server;
before(async () => {
  const temporary = path.resolve('.tmp/browser'); fs.mkdirSync(temporary, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined), args: process.env.THIN_WAX_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
});
after(async () => { await browser?.close(); server?.kill(); });
for (const style of selectedStyles) for (const core of selectedCores) test(`${style}/${core} thick wax: real GPU, brittle input, full volume, core release and lifecycle`, { timeout: 180000 }, async t => {
  assert.ok(styles.includes(style) && cores.includes(core));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const mesh = await installStyleProbe(page, getSquishyStyle(style)); await installWaxStyleProbe(page);
    await load(page, base, style, core, 'thick', 'core'); const coreBox = await page.locator('.orb-input').boundingBox(); assert.equal((await diagnostic(page)).enabled, false);
    await page.locator('.step-next').click(); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    const box = await page.locator('.orb-input').boundingBox(); for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(coreBox[k] - box[k]) < 1);
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false, surface: true }); return [...window.waxGPUObserver.buffers.values()].some(b => b.length === d.surface.positions.length && b.every((v, i) => Math.abs(v - d.surface.positions[i]) <= 1e-6)); });
    const intact = await diagnostic(page, true); geometryOK(intact); assert.equal(intact.geometry.thickness, .042); assert.equal(intact.debrisStage.visible, false);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), core === 'butter' ? 'slow-rebound' : core);
    const press = async () => { const p = await projectedMeshContact(page, mesh, style); if (style === 'donut') assert.ok(p.radialDot < -.03); await page.mouse.move(p.x, p.y); await page.mouse.down(); return p; };
    await armWaxUploadEnd(page, { minimumDepth: .0001 }); const contact = await press(); const short = await readWaxUploadEnd(page); await page.mouse.up();
    assert.ok(short.actualGPU && short.trustedDown && short.gpuCoreError <= 1e-6); assert.ok(short.state.cracked > 0); assert.equal(short.state.detached, 0);
    await restart(page);
    await page.locator('.toy-mount').evaluate(el => { window.nonpawTiming = {}; const observe = () => { const s = el.thinWaxDiagnostics({ measure: false }).thinWax; if (!s.active) return; if (s.dwell <= .5) window.nonpawTiming.before = s; else if (!window.nonpawTiming.onset) window.nonpawTiming.onset = s; }; window.waxStyleObservers.add(observe); window.stopNonpawTiming = () => window.waxStyleObservers.delete(observe); });
    await armRelease(page); await press(); await waitLoaded(page); const loaded = await diagnostic(page, true); geometryOK(loaded); assert.ok(maximumDepth(loaded) > .03);
    await page.mouse.up(); const released = await page.evaluate(() => window.nonpawRelease); assert.ok(released.trusted); assert.ok(maximumDepth(released) > .03);
    const timing = await page.evaluate(() => { window.stopNonpawTiming(); return window.nonpawTiming; }); assert.ok(timing.before && timing.onset); assert.equal(timing.before.detached, 0); assert.ok(timing.onset.dwell > .5 && timing.onset.detached > 0);
    await page.waitForTimeout(600); const recovered = await diagnostic(page, true); geometryOK(recovered); assert.equal(recovered.thinWax.detached, released.thinWax.detached);
    if (core === 'butter') { assert.ok(maximumDepth(recovered) < maximumDepth(released)); await naturalRestore(page); } else if (core === 'marshmallow') assert.deepEqual(recovered.corePositions, released.corePositions);
    else { assert.ok(maximumDepth(recovered) >= maximumDepth(released) * .8); assert.ok(maximumDepth(recovered) < maximumDepth(released)); }
    await rotate(page, 32, 8); geometryOK(await diagnostic(page, true)); await settled(page); const clean = await diagnostic(page, true); geometryOK(clean); assert.equal(clean.thinWax.expired, clean.thinWax.detached);
    const dragStart = await projectedMeshContact(page, mesh, style), dragEnd = await projectedMeshContact(page, mesh, style, [.06, .02]);
    await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 }); await page.waitForTimeout(250); await page.mouse.up();
    geometryOK(await diagnostic(page, true));
    await workflow(page); const warmed = (await diagnostic(page)).resources.geometries;
    await page.evaluate(() => { for (const value of ['thin', 'thick', 'medium', 'thin', 'thick']) document.querySelector(`[name=waxThickness][value=${value}]`).click(); });
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics(); return d.enabled && d.geometry.thickness === .042 && d.thinWax.detached === 0; });
    assert.equal((await diagnostic(page)).resources.geometries, warmed);
    assert.deepEqual(errors, []); t.diagnostic(JSON.stringify({ style, core, contact, shortMs: short.elapsed, onset: timing.onset.dwell, depth: maximumDepth(released), recovered: maximumDepth(recovered), loadedGeometry: loaded.geometry, resources: warmed }));
  } finally { await page.close(); }
});
// A large cylindrical plate can contain the clicked surface while its center
// lies outside the starter radius. The initial click must still crack that
// actual plate, before strain-driven cracking can conceal a missed pick.
if (selectedStyles.includes('cylinder')) for (const core of selectedCores.filter(core => ['clay', 'butter'].includes(core))) test(`cylinder/${core} first trusted click cracks its large plate before core strain`, { timeout: 60000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  try {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const mesh = await installStyleProbe(page, getSquishyStyle('cylinder')); await installWaxStyleProbe(page);
    await load(page, base, 'cylinder', core, 'thick');
    await page.evaluate(() => window.addEventListener('pointerdown', event => {
      const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
      window.cylinderFirstClick = { trusted: event.isTrusted, state: d.thinWax, coreState: d.coreState };
    }, { once: true }));
    await armWaxUploadEnd(page, { minimumDepth: .0001 });
    const contact = await projectedMeshContact(page, mesh, 'cylinder');
    await page.mouse.move(contact.x, contact.y); await page.mouse.down();
    const short = await readWaxUploadEnd(page); await page.mouse.up();
    const initial = await page.evaluate(() => window.cylinderFirstClick);
    assert.ok(initial.trusted && initial.state.active);
    assert.ok(initial.coreState.depth < .004, 'The click is observed before deformation-driven strain cracks');
    assert.ok(initial.state.cracked > 0, 'The actual clicked plate must crack immediately even when its center is outside the starter radius');
    assert.equal(initial.state.detached, 0);
    assert.ok(short.state.cracked > 0 && short.actualGPU && short.trustedDown);
    assert.equal(short.state.detached, 0);
    t.diagnostic(JSON.stringify({ core, contact, initial, shortMs: short.elapsed, uploadedDepth: short.gpuDepth }));
  } finally { await page.close(); }
});

test('thick wax excludes all paw cores and unrelated shell materials', { timeout: 120000 }, async () => {
  const page = await browser.newPage();
  try {
    for (const core of cores) { await load(page, base, 'paw', core); assert.equal((await diagnostic(page)).enabled, false, `paw/${core}`); }
    for (const material of ['polish', 'sugar']) { await page.goto(`${base}/squishy/cloud/?style=donut&coreMaterial=butter&shellMaterial=${material}&waxThickness=thick&step=shell`); await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas'); assert.equal((await diagnostic(page)).enabled, false, material); }
  } finally { await page.close(); }
});
