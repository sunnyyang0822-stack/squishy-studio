const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.FINISHED_EVIDENCE === '1') process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.tmp/playwright');
const { chromium } = require('playwright');
const { installStyleProbe } = require('./helpers/squishy-browser.cjs');
const { installWaxStyleProbe, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('./helpers/wax-upload-observer.cjs');
const { maximumDepth } = require('../scripts/capture-thick-nonpaw.cjs');
const { inputFor } = require('../scripts/capture-thick-orb-cores.cjs');
const styles = ['orb', 'cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const cores = ['clay', 'marshmallow', 'butter'];
const cases = process.env.FINISHED_CASES?.split(',').map(value => value.split(':')) || styles.flatMap(s => cores.flatMap(c => ['thin', 'medium', 'thick'].map(w => [s, c, w])));
const devices = process.env.FINISHED_DEVICES?.split(',') || ['desktop', 'mobile'];
const port = process.env.FINISHED_PORT || '4391', base = `http://127.0.0.1:${port}`;
const evidence = process.env.FINISHED_EVIDENCE === '1';
const output = path.resolve('artifacts/wax-product');
let browser, server;
before(async () => {
  fs.mkdirSync(output, { recursive: true });
  const temporary = path.resolve('.tmp/finished-browser'); fs.mkdirSync(temporary, { recursive: true });
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const diagnostic = (page, measure = false) => page.locator('.toy-mount').evaluate((el, measure) => el.thinWaxDiagnostics({ measure, exhaustive: measure }), measure);
const restored = page => page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.thinWax.detached === 0 && d.thinWax.cracked === 0 && d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 30000 });

for (const [style, core, thickness] of cases) for (const device of devices) test(`finished ${style}/${core}/${thickness}/${device}: actual GPU, input, geometry, restore, lifecycle`, { timeout: 180000 }, async t => {
  const mobile = device === 'mobile', name = `${style}-${core}-${thickness}-${device}`;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const capture = evidence && (style === 'orb' || style === 'donut');
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
    ...(capture ? { recordVideo: { dir: path.resolve('.tmp/finished-video'), size: viewport } } : {}) });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const report = { style, core, thickness, device, viewport, dpr: 1, actualPhone: false, browser: browser.version(), complete: false };
  try {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const mesh = await installStyleProbe(page, getSquishyStyle(style)); await installWaxStyleProbe(page);
    await page.goto(`${base}/tests/fixtures/finished-scene.html?style=${style}&core=${core}&thickness=${thickness}`);
    await page.evaluate(() => window.ready);
    await restored(page);
    let d = await diagnostic(page, true); geometryOK(d);
    assert.equal(d.enabled, true); assert.equal(d.presetId, `${thickness}-wax`);
    assert.equal(d.coreColor, 'mint'); assert.equal(d.shellColor, 'rose'); assert.equal(d.debrisStage.collectionEnabled, false);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), core === 'butter' ? 'slow-rebound' : core);
    const send = await inputFor(page, context, mobile);
    const contact = await projectedMeshContact(page, mesh, style); report.contact = contact;
    await armWaxUploadEnd(page, { minimumDepth: .0001 });
    await send('down', contact); const short = await readWaxUploadEnd(page); await send('up', contact);
    assert.ok(short.actualGPU && short.trustedDown && short.gpuCoreError <= 1e-6);
    assert.ok(short.state.cracked > 0); assert.equal(short.state.detached, 0);
    report.short = { elapsed: short.elapsed, detached: short.state.detached, gpuCoreError: short.gpuCoreError };
    await page.locator('#restore').click(); await restored(page);
    await page.evaluate(() => { window.sceneEvents.length = 0; window.frameIntervals = []; let last;
      window.measureFrames = time => { if (last !== undefined) window.frameIntervals.push(time - last); last = time; };
      window.waxStyleObservers.add(window.measureFrames);
    });
    await send('down', contact);
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.thinWax.dwell > 2.1 && d.thinWax.detached > 0 && d.coreState.depth > .03; }, null, { timeout: 30000 });
    // Stop frame collection before exhaustive CPU geometry inspection.
    report.frames = await page.evaluate(() => { window.waxStyleObservers.delete(window.measureFrames); return window.frameIntervals; });
    d = await diagnostic(page, true); geometryOK(d); report.loadedGeometry = d.geometry; report.loadedDepth = maximumDepth(d);
    const unloaded = new Promise(resolve => page.evaluate(() => {
      window.addEventListener('pointerup', () => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); window.releaseSnapshot = { ...d, corePositions: [...d.corePositions] }; }, { once: true });
    }).then(resolve));
    await unloaded; await send('up', contact);
    const release = await page.evaluate(() => window.releaseSnapshot); assert.ok(release); geometryOK(await diagnostic(page, true));
    await page.waitForTimeout(650);
    const recovered = await diagnostic(page, true); geometryOK(recovered);
    assert.equal(recovered.thinWax.detached, release.thinWax.detached);
    if (core === 'marshmallow') assert.deepEqual(recovered.corePositions, release.corePositions);
    else if (core === 'butter') assert.ok(maximumDepth(recovered) < maximumDepth(release));
    else assert.ok(maximumDepth(recovered) >= maximumDepth(release) * .8);
    report.releaseDepth = maximumDepth(release); report.recoveredDepth = maximumDepth(recovered);
    const moveEnd = await projectedMeshContact(page, mesh, style, [.08, .02]);
    await send('down', contact);
    for (let i = 1; i <= 5; i++) {
      await send('move', { x: contact.x + (moveEnd.x - contact.x) * i / 5, y: contact.y + (moveEnd.y - contact.y) * i / 5 });
      geometryOK(await diagnostic(page, true));
    }
    await send('up', moveEnd);
    for (let i = 0; i < 2; i++) { await send('down', contact); await page.waitForTimeout(90); await send('up', contact); }
    geometryOK(await diagnostic(page, true));
    if (capture) await page.screenshot({ path: `${output}/${name}.png` });
    const events = await page.evaluate(() => window.sceneEvents);
    assert.ok(events.some(e => e.type === 'core-deform')); assert.ok(events.some(e => e.type === 'shell-crack')); assert.ok(events.some(e => e.type === 'shell-fracture'));
    if (core === 'marshmallow') assert.ok(!events.some(e => e.type === 'core-recover' && !e.restoring && !e.active));
    report.eventCounts = Object.fromEntries([...new Set(events.map(e => e.type))].map(type => [type, events.filter(e => e.type === type).length]));
    await page.locator('#restore').click(); await restored(page); geometryOK(await diagnostic(page, true));
    assert.deepEqual(await page.evaluate(() => window.finished.getState().recipe), await page.evaluate(() => window.recipe));
    const warmed = (await diagnostic(page)).resources.geometries;
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.finished.update(window.recipe, { signal: new AbortController().signal })); await restored(page); }
    assert.equal((await diagnostic(page)).resources.geometries, warmed); assert.equal(await page.locator('canvas').count(), 1); assert.equal(await page.locator('.orb-input').count(), 1);
    await page.evaluate(() => { window.finished.dispose(); window.afterDisposeCount = window.sceneEvents.length; });
    await page.waitForTimeout(150); assert.equal(await page.locator('canvas').count(), 0); assert.equal(await page.locator('.orb-input').count(), 0);
    assert.equal(await page.evaluate(() => window.sceneEvents.length), await page.evaluate(() => window.afterDisposeCount));
    assert.deepEqual(errors, []); report.complete = true;
    const sorted = report.frames.slice().sort((a, b) => a - b);
    report.performance = { samples: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1), over100ms: sorted.filter(v => v > 100).length, over250ms: sorted.filter(v => v > 250).length };
    delete report.frames; t.diagnostic(JSON.stringify({ name, depth: report.loadedDepth, performance: report.performance }));
  } catch (error) { report.error = { message: error.message, stack: error.stack }; throw error; }
  finally {
    fs.writeFileSync(`${output}/${name}.json`, JSON.stringify(report, null, 2));
    const video = page.video(); await context.close();
    if (capture && video) { await video.saveAs(`${output}/${name}.webm`); await video.delete(); }
  }
});

test('finished adapter rejects paused recipes, aborts races, and reports load failure without bare-core fallback', { timeout: 90000 }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/tests/fixtures/finished-scene.html`); await page.evaluate(() => window.ready);
    const result = await page.evaluate(async () => {
      const invalid = { ...window.recipe, styleId: 'paw' };
      let code; try { await window.finished.update(invalid); } catch (error) { code = error.code; }
      const aborted = new AbortController(); aborted.abort(); let abortedName;
      try { await window.finished.update(window.recipe, { signal: aborted.signal }); } catch (error) { abortedName = error.name; }
      const late = window.finished.update({ ...window.recipe, styleId: 'cloud' }).catch(e => e.name);
      await window.finished.update({ ...window.recipe, styleId: 'star' });
      return { supports: window.finished.supports(invalid), code, abortedName, late: await late, state: window.finished.getState() };
    });
    assert.equal(result.supports, false); assert.equal(result.code, 'UNSUPPORTED_RECIPE'); assert.equal(result.abortedName, 'AbortError'); assert.equal(result.late, 'AbortError'); assert.equal(result.state.recipe.styleId, 'star');
    await page.route('**/assets/models/squishy-cloud.glb', route => route.abort());
    const failure = await page.evaluate(async () => { try { await window.finished.update({ ...window.recipe, styleId: 'cloud' }); } catch { return window.finished.getState().state; } });
    assert.equal(failure, 'failed'); assert.equal(await page.locator('canvas').count(), 1);
    await page.evaluate(() => window.finished.dispose());
  } finally { await page.close(); }
});

test('finished polish regression retains the confirmed film for all seven styles and three cores', { timeout: 180000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await page.goto(`${base}/tests/fixtures/finished-scene.html?shell=polish`); await page.evaluate(() => window.ready);
    for (const styleId of styles) for (const coreMaterial of cores) {
      await page.evaluate(({ styleId, coreMaterial }) => window.finished.update({ ...window.recipe, styleId, coreMaterial, shellMaterial: 'polish', waxThickness: null }), { styleId, coreMaterial });
      const initial = await page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
      assert.ok(initial.enabled && initial.supported); assert.equal(initial.state.id, 'polish-shell'); assert.equal(initial.metrics.violations, 0);
      const button = page.locator('.orb-input'); await button.focus(); await page.keyboard.down('Space');
      await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics().state.maxDamage > .045);
      await page.keyboard.up('Space');
      const loaded = await page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
      assert.equal(loaded.metrics.violations, 0); assert.equal(loaded.state.detached, 0); assert.ok(loaded.state.damagedVertices > 0);
      await page.locator('#restore').click();
      await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').polishDiagnostics(); return d.state.maxDamage === 0 && d.corePositions.every((v, i) => v === d.coreRestPositions[i]); });
    }
    await page.evaluate(() => window.finished.dispose());
  } finally { await page.close(); }
});
