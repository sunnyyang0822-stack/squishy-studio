const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('./helpers/squishy-browser.cjs');
const port = process.env.THIN_WAX_TEST_PORT || '4228', base = `http://127.0.0.1:${port}`;
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const diagnostics = (page, options = { measure: false }) => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), options);
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
test('thin-wax elevation separates the real core from the tray without moving the bare core or clipping either viewport', { timeout: 60000 }, async t => {
  const measurements = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await open();
    try {
      await page.setViewportSize(viewport); await page.waitForTimeout(150);
      const shell = await diagnostics(page);
      const m = shell.debrisStage.matrixWorld; let coreBottom = Infinity;
      for (let i = 0; i < shell.corePositions.length; i += 3) coreBottom = Math.min(coreBottom, m[1] * shell.corePositions[i] + m[5] * shell.corePositions[i + 1] + m[9] * shell.corePositions[i + 2] + m[13]);
      assert.ok(coreBottom - shell.debrisStage.floorY > .9, `The actual elevated core leaves room for falling chips: ${coreBottom}`);
      assert.equal(shell.debrisStage.floorY, -1.35);
      assert.ok(shell.debrisStage.projectedTray.every(p => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1));
      const canvas = await page.locator('.toy-mount canvas').boundingBox(), input = await page.locator('.orb-input').boundingBox();
      const orbWidthFraction = input.width / canvas.width;
      assert.ok(orbWidthFraction > (viewport.width > 600 ? .53 : .65), `The orb occupies the main view: ${orbWidthFraction}`);
      assert.ok(shell.debrisStage.trayHalfLength > 1.42, 'The actual tray is longer than the original circular base');
      assert.ok(shell.debrisStage.projectedTray[1][0] - shell.debrisStage.projectedTray[0][0] > 1.85, 'The elongated tray spans most of the stage width');
      assert.ok(input.x >= canvas.x - 1 && input.y >= canvas.y - 1 && input.x + input.width <= canvas.x + canvas.width + 1 && input.y + input.height <= canvas.y + canvas.height + 1, 'The entire projected orb remains in the render viewport');
      await page.locator('.step-back').click();
      const bare = await diagnostics(page); assert.equal(bare.enabled, false);
      const elevation = m[13] - bare.debrisStage.matrixWorld[13];
      assert.ok(Math.abs(elevation - .7) < 1e-6, `Only the thin-wax stage adds .7 world units: ${elevation}`);
      await page.locator('.step-next').click();
      const restored = await diagnostics(page); assert.equal(restored.enabled, true);
      assert.ok(Math.abs(restored.debrisStage.matrixWorld[13] - m[13]) < 1e-6, 'Navigation restores the same elevated placement');
      measurements.push({ viewport, coreBottom, floorY: shell.debrisStage.floorY, elevation, projectedTray: shell.debrisStage.projectedTray });
    } finally { await page.close(); }
  }
  t.diagnostic(JSON.stringify(measurements));
});
for (const material of ['clay']) test(`thin wax + ${material}: actual core geometry, timing, release, recovery and independent colors`, { timeout: 90000 }, async t => {
  const page = await open(material);
  try {
    const initial = await diagnostics(page, { measure: true }); geometryOK(initial); assert.notEqual(initial.coreColor, initial.shellColor);
    await press(page); await page.waitForTimeout(300);
    const short = await diagnostics(page); assert.ok(depth(short) > .001, 'Core actually indents beneath the shell'); assert.ok(short.thinWax.cracked > 0); assert.equal(short.thinWax.detached, 0);
    await page.mouse.up(); await page.waitForTimeout(250);
    // Three separate short contacts must never accumulate a long hold.
    for (let i = 0; i < 2; i++) { await press(page); await page.waitForTimeout(250); await page.mouse.up(); await page.waitForTimeout(100); }
    const repeated = await diagnostics(page); assert.equal(repeated.thinWax.detached, 0, JSON.stringify(repeated.thinWax));
    await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(750);
    await page.evaluate(() => {
      window.waxTimedSamples = [];
      window.addEventListener('pointerdown', () => {
        const start = performance.now();
        for (const targetMs of [400, 560, 900, 2600, 5000]) setTimeout(() => {
          const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
          window.waxTimedSamples.push({ targetMs, actualMs: performance.now() - start, thinWax: d.thinWax, coreState: d.coreState });
        }, targetMs);
      }, { capture: true, once: true });
    });
    await press(page); await page.waitForFunction(() => window.waxTimedSamples.length === 5, null, { timeout: 15000 });
    const timed = await page.evaluate(() => window.waxTimedSamples), [beforeThreshold, onset, chain, saturated, held] = timed;
    assert.equal(beforeThreshold.thinWax.detached, 0, JSON.stringify(beforeThreshold));
    assert.ok(onset.thinWax.detached > 0, 'Fragments already start at the 560ms page-local sample: ' + JSON.stringify(onset));
    assert.ok(chain.thinWax.detached > 0 && chain.thinWax.dwell > .5, JSON.stringify(timed));
    assert.ok(chain.thinWax.cracked >= 6 && chain.thinWax.cracked > chain.thinWax.detached, 'The first local chain fracture cracks many more polygons than it drops: ' + JSON.stringify(timed));
    assert.ok(onset.thinWax.attachedPartialBranches >= 4, 'Most attached cracked plates expose partial connected branches rather than complete polygon outlines');
    assert.ok(chain.thinWax.visibleLongCrackEdges < chain.thinWax.cracked * 3, 'Local damage does not trace every polygon edge');
    assert.ok(held.thinWax.cracked - held.thinWax.detached >= 3, 'Long holding preserves visibly attached cracked plates');
    assert.ok(held.thinWax.detached > onset.thinWax.detached, 'Further indentation releases additional chips');
    assert.equal(held.thinWax.localDetached, held.thinWax.localDamaged, 'Deep enough pressure can clear the whole local cohort');
    assert.ok(held.thinWax.living <= 24 && held.thinWax.detached < held.thinWax.panels / 4);
    await page.mouse.up(); const stopped = await diagnostics(page); await page.waitForTimeout(1200);
    const released = await diagnostics(page, { measure: true, exhaustive: true }); assert.equal(released.thinWax.detached, stopped.thinWax.detached); geometryOK(released);
    await page.waitForTimeout(3200);
    const cleaned = await diagnostics(page); assert.equal(cleaned.thinWax.living, 0); assert.equal(cleaned.thinWax.expired, 0); assert.equal(cleaned.thinWax.settled, cleaned.thinWax.detached); assert.equal(cleaned.thinWax.detached, released.thinWax.detached);
    assert.ok(cleaned.resources.geometries <= initial.resources.geometries, 'Settled chips remain in the shared bounded geometry');
    assert.ok(await page.evaluate(() => window.styleProbe.draws > 0 && window.styleProbe.uploads > 1), 'Actual GPU mesh uploads and draw calls occurred');
    const gpuError = await page.evaluate(() => {
      const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }), uploaded = window.styleProbe.positions;
      if (uploaded.length !== d.corePositions.length) return Infinity;
      return Math.max(...uploaded.map((v, i) => Math.abs(v - d.corePositions[i])));
    });
    assert.ok(gpuError <= 1e-6, `Measured live core matches the actual GPU position upload: ${gpuError}`);
    t.diagnostic(JSON.stringify({ material, shortDepth: depth(short), timed, geometry: released.geometry }));
  } finally { await page.close(); }
});
test('rotated real interaction falls in world Y, lands visibly, and its persistent pile never turns with the toy', { timeout: 90000 }, async t => {
  const page = await open(), measurements = [];
  try {
    for (const pose of [[0, 0], [70, 40], [-65, -45]]) {
      await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(750);
      if (pose.some(Boolean)) await rotate(page, ...pose);
      await press(page);
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.detached > 0);
      await page.mouse.up();
      const falling = await page.locator('.toy-mount').evaluate(async el => {
        // Contact correction can slide a shard along the live core. Select a
        // real free-flight interval below the actual core AABB, after the
        // landing-posture rotation has completed, rather than calling that
        // necessary contact response sideways gravity.
        await new Promise(resolve => setTimeout(resolve, 300));
        let first, id, coreBottom, bounds;
        for (let attempt = 0; attempt < 45; attempt++) {
          const d = el.thinWaxDiagnostics({ measure: false, surface: true }), m = d.debrisStage.matrixWorld;
          first = d.surface; coreBottom = Infinity;
          for (let i = 0; i < d.corePositions.length; i += 3) coreBottom = Math.min(coreBottom, m[1] * d.corePositions[i] + m[5] * d.corePositions[i + 1] + m[9] * d.corePositions[i + 2] + m[13]);
          const candidates = new Map();
          for (let i = 0; i < first.panelIds.length; i++) if (first.detached[i] && !first.settled[i]) {
            const panel = first.panelIds[i], b = candidates.get(panel) || { minY: Infinity, maxY: -Infinity };
            b.minY = Math.min(b.minY, first.worldPositions[i * 3 + 1]); b.maxY = Math.max(b.maxY, first.worldPositions[i * 3 + 1]); candidates.set(panel, b);
          }
          const candidate = [...candidates].find(([, b]) => b.maxY < coreBottom - .02 && b.minY > -.55);
          if (candidate) { [id, bounds] = candidate; break; }
          await new Promise(resolve => setTimeout(resolve, 8));
        }
        if (id === undefined) throw Error('No actual airborne shard clears the live core AABB before landing');
        function center(surface) {
          const result = [0, 0, 0], unique = new Set(); let count = 0;
          for (let i = 0; i < surface.panelIds.length; i++) if (surface.panelIds[i] === id && surface.layers[i] === 0) {
            const key = surface.restSupportPositions.slice(i * 3, i * 3 + 3).join(','); if (unique.has(key)) continue; unique.add(key);
            count++; for (let k = 0; k < 3; k++) result[k] += surface.worldPositions[i * 3 + k];
          }
          return { center: result.map(v => v / count), count };
        }
        const before = center(first), start = performance.now();
        await new Promise(resolve => setTimeout(resolve, 30));
        const final = el.thinWaxDiagnostics({ measure: false, surface: true }).surface, after = center(final);
        const landed = final.panelIds.some((panel, i) => panel === id && final.settled[i]);
        let finalTop = -Infinity;
        for (let i = 0; i < final.panelIds.length; i++) if (final.panelIds[i] === id) finalTop = Math.max(finalTop, final.worldPositions[i * 3 + 1]);
        return { panel: id, vertices: before.count, elapsed: performance.now() - start, coreBottom, bounds, finalTop, landed, down: before.center[1] - after.center[1], lateral: Math.hypot(after.center[0] - before.center[0], after.center[2] - before.center[2]) };
      });
      await page.mouse.up();
      assert.equal(falling.landed, false, 'Direction is measured before any floor or pile contact');
      assert.ok(falling.finalTop > -1, 'Direction is measured above the low tray-collection region');
      assert.ok(falling.vertices > 20 && falling.down > .02, JSON.stringify({ pose, ...falling }));
      assert.ok(falling.lateral < .08, 'Toy orientation cannot turn gravity sideways: ' + JSON.stringify({ pose, ...falling }));
      await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.living === 0 && s.settled > 0; }, null, { timeout: 6000 });
      const landed = await page.locator('.toy-mount').evaluate(el => {
        const d = el.thinWaxDiagnostics({ measure: true, exhaustive: true, surface: true });
        window.worldPileBaseline = { positions: d.surface.worldPositions, settled: d.surface.settled, matrix: d.debrisStage.matrixWorld, amount: d.thinWax.settled };
        return { geometry: d.geometry, state: d.thinWax, stage: d.debrisStage };
      });
      geometryOK(landed);
      assert.ok(landed.geometry.debris.minY >= landed.stage.floorY - 1e-5, JSON.stringify(landed.geometry.debris));
      assert.ok(landed.geometry.debris.maxRadius <= landed.stage.radius + .02);
      assert.equal(landed.state.expired, 0); assert.equal(landed.state.detached, landed.state.settled);
      assert.equal(landed.stage.visible, true);
      assert.ok(landed.stage.projectedTray.every(p => Math.abs(p[0]) < 1.02 && Math.abs(p[1]) < 1.02), 'The tray must fit the actual camera viewport');
      await rotate(page, 55, -28); await page.waitForTimeout(1600);
      const stationary = await page.locator('.toy-mount').evaluate(el => {
        const before = window.worldPileBaseline, d = el.thinWaxDiagnostics({ measure: false, surface: true }); let worldError = 0, samples = 0, matrixChange = 0;
        for (let i = 0; i < before.settled.length; i++) if (before.settled[i]) { samples++; for (let k = 0; k < 3; k++) worldError = Math.max(worldError, Math.abs(before.positions[i * 3 + k] - d.surface.worldPositions[i * 3 + k])); }
        for (let i = 0; i < before.matrix.length; i++) matrixChange = Math.max(matrixChange, Math.abs(before.matrix[i] - d.debrisStage.matrixWorld[i]));
        return { worldError, samples, matrixChange, before: before.amount, after: d.thinWax.settled, detached: d.thinWax.detached, expired: d.thinWax.expired };
      });
      assert.ok(stationary.samples > 100 && stationary.matrixChange > .01); assert.ok(stationary.worldError < 1e-6, JSON.stringify(stationary));
      assert.equal(stationary.before, stationary.after); assert.equal(stationary.detached, stationary.after); assert.equal(stationary.expired, 0);
      measurements.push({ pose, falling, debris: landed.geometry.debris, stationary });
    }
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    const reset = await diagnostics(page, { measure: true }); assert.equal(reset.thinWax.settled, 0); assert.equal(reset.thinWax.detached, 0); assert.equal(reset.geometry.debris.gridCells, 0);
    t.diagnostic(JSON.stringify(measurements));
  } finally { await page.close(); }
});
test('detached polygon keeps its actual GPU vertex distances while the live core keeps changing', { timeout: 60000 }, async t => {
  const page = await open();
  try {
    await press(page); await page.waitForTimeout(1200);
    await page.locator('.toy-mount').evaluate(el => {
      const surface = el.thinWaxDiagnostics({ measure: false, surface: true }).surface;
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
      window.rigidWaxBaseline = { panel, ids, positions: uploaded(), core: el.thinWaxDiagnostics({ measure: false }).corePositions };
    });
    await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(250);
    const measured = await page.locator('.toy-mount').evaluate(el => {
      const before = window.rigidWaxBaseline, d = el.thinWaxDiagnostics({ measure: false, surface: true }), current = d.surface;
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
    const liveGeometry = await diagnostics(page, { measure: true, exhaustive: true });
    assert.ok(liveGeometry.geometry.detachedSamples > 0, 'Collision measurement includes still-living detached geometry during core recovery');
    geometryOK(liveGeometry);
    t.diagnostic(JSON.stringify({ ...measured, liveRecoveryGeometry: liveGeometry.geometry }));
  } finally { await page.close(); }
});
test('front damage leaves the untouched back shell positions and normals bitwise unchanged', { timeout: 60000 }, async t => {
  const page = await open();
  try {
    await page.locator('.toy-mount').evaluate(el => { window.waxBackBaseline = el.thinWaxDiagnostics({ measure: false, surface: true }).surface; });
    await press(page); await page.waitForTimeout(2000); await page.mouse.up();
    const back = await page.locator('.toy-mount').evaluate(el => {
      const before = window.waxBackBaseline, after = el.thinWaxDiagnostics({ measure: false, surface: true }).surface;
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
test('leaving a pressed surface ends force but retains normal clay dents and broken wax', { timeout: 60000 }, async t => {
  const page = await open();
  try {
    await press(page); await page.waitForTimeout(1600);
    await page.evaluate(() => window.addEventListener('pointermove', event => {
      if (event.clientX > 10) return;
      window.beforeWaxLeave = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
    }, { capture: true, once: true }));
    await page.mouse.move(5, 5); await page.waitForTimeout(900); await page.mouse.up();
    const result = await page.locator('.toy-mount').evaluate(el => {
      const before = window.beforeWaxLeave, after = el.thinWaxDiagnostics({ measure: false });
      let error = 0, heldDepth = 0, retainedDepth = 0;
      for (let i = 0; i < before.corePositions.length; i++) {
        const rest = before.coreRestPositions[i], delta = before.corePositions[i] - rest;
        error = Math.max(error, Math.abs(after.corePositions[i] - (rest + delta * .85)));
        heldDepth = Math.max(heldDepth, Math.abs(delta)); retainedDepth = Math.max(retainedDepth, Math.abs(after.corePositions[i] - rest));
      }
      return { error, heldDepth, retainedDepth, damageBefore: before.thinWax.detached, damageAfter: after.thinWax.detached, active: after.thinWax.active };
    });
    assert.ok(result.heldDepth > .05 && result.retainedDepth > .04, JSON.stringify(result));
    assert.ok(result.error < 1e-4, 'Leaving uses the existing 85% clay retention, not a reset: ' + JSON.stringify(result));
    assert.ok(result.damageBefore > 0); assert.equal(result.damageAfter, result.damageBefore); assert.equal(result.active, false);
    t.diagnostic(JSON.stringify(result));
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
    assert.equal((await diagnostics(page)).thinWax.cracked, 0); geometryOK(await diagnostics(page, { measure: true }));
    await press(page); await page.waitForTimeout(1400); await page.mouse.up();
    await page.locator('[name=shellColor][data-choice=sky]').check();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().shellColor === 'sky');
    const recolored = await diagnostics(page); assert.equal(recolored.thinWax.detached, 0); assert.equal(recolored.coreColor, 'mint'); assert.equal(recolored.thinWax.living, 0);
    await page.locator('[name=waxThickness][value=medium]').check();
    await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
    await page.locator('[name=waxThickness][value=thin]').check();
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
    assert.equal((await diagnostics(page)).thinWax.detached, 0); geometryOK(await diagnostics(page, { measure: true }));
  } finally { await page.close(); }
});
test('cancellation, blur, hidden document, hit loss and leave stop the same input lifecycle', { timeout: 90000 }, async () => {
  const page = await open();
  try {
    for (const event of ['pointercancel', 'blur', 'hidden']) {
      await press(page); await page.waitForTimeout(250);
      await page.evaluate(event => {
        if (event === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        else window.dispatchEvent(event === 'pointercancel' ? new PointerEvent(event, { pointerId: 1 }) : new Event(event));
      }, event);
      await page.mouse.up(); await page.waitForTimeout(1100);
      assert.equal((await diagnostics(page)).thinWax.detached, 0, event);
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false', event);
      if (event === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    }
    await press(page); await page.waitForTimeout(250); await page.mouse.move(5, 5); await page.waitForTimeout(1200); await page.mouse.up();
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
