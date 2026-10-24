const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact } = require('./helpers/squishy-browser.cjs');
const port = process.env.THIN_WAX_TEST_PORT || '4228', base = `http://127.0.0.1:${port}`;
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const diagnostics = page => page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics());
const depth = d => Math.max(...d.corePositions.filter((_, i) => i % 3 === 0).map((_, vertex) => Math.hypot(...[0, 1, 2].map(k => d.corePositions[vertex * 3 + k] - d.coreRestPositions[vertex * 3 + k]))));
async function installWaxUploadProbe(page) {
  await page.addInitScript(() => {
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = nativeContext.call(this, type, ...args);
      if (type !== 'webgl2' || !gl || gl.waxUploadProbe) return gl;
      const probe = window.waxUploadProbe = gl.waxUploadProbe = { buffers: new Map(), uploads: 0 };
      let bound;
      const bind = gl.bindBuffer.bind(gl), data = gl.bufferData.bind(gl), sub = gl.bufferSubData.bind(gl), dispose = gl.deleteBuffer.bind(gl);
      gl.bindBuffer = (...a) => { if (a[0] === gl.ARRAY_BUFFER) bound = a[1]; return bind(...a); };
      gl.bufferData = (...a) => { const result = data(...a); if (a[0] === gl.ARRAY_BUFFER && a[1] instanceof Float32Array) { probe.buffers.set(bound, a[1].slice()); probe.uploads++; } return result; };
      gl.bufferSubData = (...a) => { const result = sub(...a), target = probe.buffers.get(bound); if (a[0] === gl.ARRAY_BUFFER && target && a[2] instanceof Float32Array) { const offset = a[3] || 0, length = a[4] || a[2].length - offset; target.set(a[2].subarray(offset, offset + length), a[1] / 4); probe.uploads++; } return result; };
      gl.deleteBuffer = buffer => { probe.buffers.delete(buffer); return dispose(buffer); };
      return gl;
    };
  });
}
async function open(coreMaterial = 'clay', style = 'orb') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  await installStyleProbe(page, getSquishyStyle(style));
  await installWaxUploadProbe(page);
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${coreMaterial}&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`);
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
  return page;
}
async function press(page, style = 'orb') {
  const hit = await projectedSurfaceContact(page, style === 'donut' ? .72 : style === 'paw' ? -.24 : 0, style === 'paw' ? -.46 : .03);
  await page.mouse.move(hit.x, hit.y); await page.mouse.down(); return hit;
}
function geometryOK(d) {
  assert.ok(d.geometry, 'A real geometry measurement must be available');
  assert.ok(d.geometry.thickness > 0, JSON.stringify(d.geometry));
  assert.ok(d.geometry.attachedSamples > 0);
  assert.ok(d.geometry.attachedMinGap >= d.geometry.gap - d.geometry.tolerance, JSON.stringify(d.geometry));
  assert.ok(d.geometry.maxThicknessError <= d.geometry.tolerance, JSON.stringify(d.geometry));
  assert.equal(d.geometry.attachedViolations, 0);
  assert.equal(d.geometry.detachedViolations, 0);
  assert.ok(d.geometry.attachedSurfaceSamples > 0, 'Real face/edge samples supplement support-normal vertex clearance');
  assert.ok(d.geometry.attachedMinSignedDistance >= -d.geometry.tolerance, JSON.stringify(d.geometry));
  assert.ok(d.geometry.detachedMinSignedDistance == null || d.geometry.detachedMinSignedDistance >= -1e-5, JSON.stringify(d.geometry));
}
for (const material of ['clay']) test(`thin wax + ${material}: actual core geometry, timing, release, recovery and independent colors`, { timeout: 90000 }, async t => {
  const page = await open(material);
  try {
    const initial = await diagnostics(page); geometryOK(initial); assert.notEqual(initial.coreColor, initial.shellColor);
    await press(page); await page.waitForTimeout(300);
    const short = await diagnostics(page); assert.ok(depth(short) > .001, 'Core actually indents beneath the shell'); assert.ok(short.thinWax.cracked > 0); assert.equal(short.thinWax.detached, 0); geometryOK(short);
    await page.mouse.up(); await page.waitForTimeout(250);
    // Three separate short contacts must never accumulate a long hold.
    for (let i = 0; i < 2; i++) { await press(page); await page.waitForTimeout(250); await page.mouse.up(); await page.waitForTimeout(100); }
    const repeated = await diagnostics(page); assert.equal(repeated.thinWax.detached, 0, JSON.stringify(repeated.thinWax));
    await press(page); await page.waitForTimeout(650);
    assert.equal((await diagnostics(page)).thinWax.detached, 0);
    await page.waitForTimeout(650);
    const onset = await diagnostics(page); assert.ok(onset.thinWax.detached > 0); assert.ok(onset.thinWax.dwell > 1); assert.equal(onset.thinWax.firstBurst, 3); assert.ok(onset.thinWax.maxOutwardOffset > .02, 'First chips visibly separate outward'); geometryOK(onset);
    await page.waitForTimeout(1500);
    const continued = await diagnostics(page); assert.ok(continued.thinWax.detached > onset.thinWax.detached); assert.ok(continued.thinWax.detached <= 24); geometryOK(continued);
    await page.mouse.up(); const stopped = await diagnostics(page); await page.waitForTimeout(1200);
    const released = await diagnostics(page); assert.equal(released.thinWax.detached, stopped.thinWax.detached); geometryOK(released);
    await page.waitForTimeout(3200);
    const cleaned = await diagnostics(page); assert.equal(cleaned.thinWax.living, 0); assert.equal(cleaned.thinWax.expired, cleaned.thinWax.detached); assert.equal(cleaned.thinWax.detached, released.thinWax.detached);
    assert.ok(cleaned.resources.geometries <= initial.resources.geometries, 'Expired chips do not allocate accumulating GPU geometries');
    assert.ok(await page.evaluate(() => window.styleProbe.draws > 0 && window.styleProbe.uploads > 1), 'Actual GPU mesh uploads and draw calls occurred');
    const gpuError = await page.evaluate(() => {
      const d = document.querySelector('.toy-mount').thinWaxDiagnostics(), uploaded = window.styleProbe.positions;
      if (uploaded.length !== d.corePositions.length) return Infinity;
      return Math.max(...uploaded.map((v, i) => Math.abs(v - d.corePositions[i])));
    });
    assert.ok(gpuError <= 1e-6, `Measured live core matches the actual GPU position upload: ${gpuError}`);
    t.diagnostic(JSON.stringify({ material, shortDepth: depth(short), onset: onset.thinWax, continued: continued.thinWax, geometry: released.geometry }));
  } finally { await page.close(); }
});
test('detached polygon keeps its actual GPU vertex distances while the live core keeps changing', { timeout: 60000 }, async t => {
  const page = await open();
  try {
    await press(page); await page.waitForTimeout(1200);
    await page.locator('.toy-mount').evaluate(el => {
      const surface = el.thinWaxDiagnostics({ surface: true }).surface;
      function uploaded() {
        for (const values of window.waxUploadProbe.buffers.values()) {
          if (values.length !== surface.positions.length) continue;
          let same = true; for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - surface.positions[i]) > 1e-6) { same = false; break; }
          if (same) return values.slice();
        }
        throw Error('The diagnostic shell does not match any actual GPU position buffer');
      }
      const first = surface.detached.findIndex(Boolean); if (first < 0) throw Error('No polygon has detached');
      const panel = surface.panelIds[first], ids = [];
      for (let i = 0; i < surface.panelIds.length; i++) if (surface.panelIds[i] === panel) ids.push(i);
      window.rigidWaxBaseline = { panel, ids, positions: uploaded(), core: el.thinWaxDiagnostics().corePositions };
    });
    await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(250);
    const measured = await page.locator('.toy-mount').evaluate(el => {
      const before = window.rigidWaxBaseline, d = el.thinWaxDiagnostics({ surface: true }), current = d.surface;
      let gpu;
      for (const values of window.waxUploadProbe.buffers.values()) {
        if (values.length !== current.positions.length) continue;
        let same = true; for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - current.positions[i]) > 1e-6) { same = false; break; }
        if (same) { gpu = values; break; }
      }
      if (!gpu) throw Error('Updated polygon geometry was not uploaded to GPU');
      const distance = (array, a, b) => Math.hypot(...[0, 1, 2].map(k => array[a * 3 + k] - array[b * 3 + k]));
      let distanceError = 0, coreChange = 0;
      const anchor = before.ids[0];
      for (const id of before.ids) distanceError = Math.max(distanceError, Math.abs(distance(before.positions, anchor, id) - distance(gpu, anchor, id)));
      for (let i = 0; i < before.core.length; i++) coreChange = Math.max(coreChange, Math.abs(before.core[i] - d.corePositions[i]));
      return { panel: before.panel, sampledVertices: before.ids.length, distanceError, coreChange };
    });
    assert.ok(measured.sampledVertices > 10); assert.ok(measured.coreChange > .005); assert.ok(measured.distanceError < 1e-5, JSON.stringify(measured));
    t.diagnostic(JSON.stringify(measured));
  } finally { await page.close(); }
});
test('front damage leaves the untouched back shell positions and normals bitwise unchanged', { timeout: 60000 }, async t => {
  const page = await open();
  try {
    await page.locator('.toy-mount').evaluate(el => { window.waxBackBaseline = el.thinWaxDiagnostics({ surface: true }).surface; });
    await press(page); await page.waitForTimeout(2000); await page.mouse.up();
    const back = await page.locator('.toy-mount').evaluate(el => {
      const before = window.waxBackBaseline, after = el.thinWaxDiagnostics({ surface: true }).surface;
      let samples = 0, positionError = 0, normalError = 0, damaged = 0;
      for (let i = 0; i < before.positions.length; i += 3) {
        if (before.restSupportPositions[i + 2] >= -.4) continue;
        samples++; damaged += after.damage[i / 3];
        for (let k = 0; k < 3; k++) { positionError = Math.max(positionError, Math.abs(after.positions[i + k] - before.positions[i + k])); normalError = Math.max(normalError, Math.abs(after.normals[i + k] - before.normals[i + k])); }
      }
      return { samples, damaged, positionError, normalError };
    });
    assert.ok(back.samples > 100); assert.equal(back.damaged, 0); assert.equal(back.positionError, 0); assert.equal(back.normalError, 0);
    t.diagnostic(JSON.stringify(back));
  } finally { await page.close(); }
});
test('same recipe survives full workflow; restart, color and configuration reset only their own state', { timeout: 90000 }, async () => {
  const page = await open();
  try {
    const canvas = await page.locator('.toy-mount canvas').elementHandle();
    await press(page); await page.waitForTimeout(1550); await page.mouse.up();
    const damaged = await diagnostics(page); assert.ok(damaged.thinWax.detached > 0);
    for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
    await page.waitForSelector('.step-panel[data-step=play]');
    assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached);
    await page.locator('.step-back').click(); await page.locator('.step-back').click();
    assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'shell');
    assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached);
    await page.locator('.step-back').click(); assert.equal((await diagnostics(page)).enabled, false, 'Core step is naked');
    await page.locator('.step-next').click(); assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached);
    assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true, 'Navigation reuses the same live scene');
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().thinWax.detached === 0);
    assert.equal((await diagnostics(page)).thinWax.cracked, 0); geometryOK(await diagnostics(page));
    await press(page); await page.waitForTimeout(1400); await page.mouse.up();
    await page.locator('[name=shellColor][data-choice=sky]').check();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().shellColor === 'sky');
    const recolored = await diagnostics(page); assert.equal(recolored.thinWax.detached, 0); assert.equal(recolored.coreColor, 'mint'); assert.equal(recolored.thinWax.living, 0);
    await page.locator('[name=waxThickness][value=medium]').check();
    await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
    await page.locator('[name=waxThickness][value=thin]').check();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
    assert.equal((await diagnostics(page)).thinWax.detached, 0); geometryOK(await diagnostics(page));
  } finally { await page.close(); }
});
test('cancellation, blur, hidden document, hit loss and leave stop the same input lifecycle', { timeout: 90000 }, async () => {
  const page = await open();
  try {
    for (const event of ['pointercancel', 'blur', 'hidden']) {
      await press(page); await page.waitForTimeout(400);
      await page.evaluate(event => {
        if (event === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        else window.dispatchEvent(event === 'pointercancel' ? new PointerEvent(event, { pointerId: 1 }) : new Event(event));
      }, event);
      await page.mouse.up(); await page.waitForTimeout(1100);
      assert.equal((await diagnostics(page)).thinWax.detached, 0, event);
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false', event);
      if (event === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    }
    await press(page); await page.waitForTimeout(500); await page.mouse.move(5, 5); await page.waitForTimeout(1200); await page.mouse.up();
    assert.equal((await diagnostics(page)).thinWax.detached, 0, 'No damage keeps running at a stale hit');
    await press(page); await page.waitForTimeout(1250);
    const fresh = await projectedSurfaceContact(page, .6, .03);
    await page.mouse.move(fresh.x, fresh.y);
    const swept = await page.locator('.toy-mount').evaluate(async el => {
      // Full triangle diagnostics can take hundreds of milliseconds on a
      // software GPU. Sample the two endpoints in the browser itself and
      // release within this task, so transport overhead cannot become dwell.
      const before = el.thinWaxDiagnostics({ measure: false }).thinWax;
      await new Promise(resolve => setTimeout(resolve, 180));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      const after = el.thinWaxDiagnostics({ measure: false }).thinWax;
      return { before, after };
    });
    assert.ok(swept.before.dwell < .5, 'Crossing into a fresh region resets local continuous dwell');
    assert.equal(swept.after.detached, swept.before.detached, 'A long hold cannot immediately shatter a newly swept region');
    await page.mouse.up();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
  } finally { await page.close(); }
});




