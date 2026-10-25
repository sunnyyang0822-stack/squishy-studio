const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('./helpers/squishy-browser.cjs');
const port = process.env.THIN_WAX_TEST_PORT || '4228', base = `http://127.0.0.1:${port}`;
let server, browser, reportedRenderProfile = false;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined),
    args: process.env.THIN_WAX_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
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
  // CI software rasterization may need fewer pixels to observe real subsecond
  // interactions. CSS layout, meshes, shadows, depth and clocks stay intact.
  const deviceScaleFactor = Number(process.env.THIN_WAX_TEST_DPR || 1);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  await installStyleProbe(page, getSquishyStyle(style));
  await installWaxUploadProbe(page);
  await page.addInitScript(() => {
    // Observe completed real render callbacks; neither clocks nor animation
    // deltas are replaced. Transport latency cannot delay these samples.
    window.waxFrameObservers = new Set();
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => frame(time => {
      callback(time);
      for (const observer of [...window.waxFrameObservers]) observer(time);
    });
  });
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${coreMaterial}&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`);
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
  if (!reportedRenderProfile) {
    reportedRenderProfile = true;
    console.log(JSON.stringify({ browserRasterEnvironment: await page.evaluate(() => {
      const canvas = document.querySelector('.toy-mount canvas'), gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { devicePixelRatio, viewport: [innerWidth, innerHeight], cssCanvas: [canvas.clientWidth, canvas.clientHeight],
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        measuredPerformance: false, resources: document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).resources };
    }) }));
  }
  if (process.env.THIN_WAX_CPU_RATE) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THIN_WAX_CPU_RATE) });
  }
  return page;
}
async function press(page, style = 'orb') {
  const hit = await projectedSurfaceContact(page, style === 'donut' ? .72 : style === 'paw' ? -.24 : 0, style === 'paw' ? -.46 : .03);
  await page.mouse.move(hit.x, hit.y); await page.mouse.down(); return hit;
}
async function shortContact(page, action = 'pointerup', milliseconds = 60) {
  await page.evaluate(({ action, milliseconds }) => {
    window.waxShortContact = null;
    window.addEventListener('pointerdown', event => {
      const start = performance.now(), surface = document.querySelector('.orb-input');
      setTimeout(() => {
        const before = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
        const elapsed = performance.now() - start, captured = surface.hasPointerCapture(event.pointerId);
        if (action === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        else if (action === 'miss') window.dispatchEvent(new PointerEvent('pointermove', { pointerId: event.pointerId, clientX: 5, clientY: 5 }));
        else window.dispatchEvent(action === 'blur' ? new Event('blur') : new PointerEvent(action, { pointerId: event.pointerId }));
        window.waxShortContact = { before, elapsed, captured, trustedDown: event.isTrusted };
      }, milliseconds);
    }, { capture: true, once: true });
  }, { action, milliseconds });
  await press(page);
  await page.waitForFunction(() => window.waxShortContact !== null);
  await page.mouse.up();
  const result = await page.evaluate(() => window.waxShortContact);
  assert.ok(result.elapsed < 500, `A short contact really ended before the fracture threshold: ${result.elapsed}ms`);
  assert.equal(result.trustedDown, true); assert.equal(result.captured, true);
  assert.ok(depth(result.before) > .001, 'A short contact includes real nonzero core deformation before ending');
  return result;
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
    const shortSample = await shortContact(page), short = shortSample.before;
    t.diagnostic(JSON.stringify({ shortContact: { elapsed: shortSample.elapsed, captured: shortSample.captured, trustedDown: shortSample.trustedDown } }));
    assert.ok(depth(short) > .001, 'Core actually indents beneath the shell'); assert.ok(short.thinWax.cracked > 0); assert.equal(short.thinWax.detached, 0);
    await page.waitForTimeout(250);
    // Three separate short contacts must never accumulate a long hold.
    for (let i = 0; i < 2; i++) { await shortContact(page); await page.waitForTimeout(100); }
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
      await page.locator('.toy-mount').evaluate(el => {
        window.waxFlight = null;
        let lastRender, pointerId, released = false, panelIds;
        const baselines = new Map(), metadata = el.thinWaxDiagnostics({ measure: false, surface: true }).surface;
        const records = new Map(), uniqueRecords = new Map();
        for (let i = 0; i < metadata.panelIds.length; i++) {
          const id = metadata.panelIds[i]; if (!records.has(id)) { records.set(id, []); uniqueRecords.set(id, new Map()); }
          records.get(id).push(i);
          if (metadata.layers[i] === 0) uniqueRecords.get(id).set(metadata.restSupportPositions.slice(i * 3, i * 3 + 3).join(','), i);
        }
        let gpu;
        for (const values of window.waxUploadProbe.buffers.values()) {
          if (values.length !== metadata.positions.length) continue;
          let same = true; for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - metadata.positions[i]) > 1e-6) { same = false; break; }
          if (same) { gpu = values; break; }
        }
        if (!gpu) throw Error('No actual GPU shell position upload for free-flight observation');
        window.addEventListener('pointerdown', e => { pointerId = e.pointerId; }, { capture: true, once: true });
        const observe = () => {
          if (lastRender === el.dataset.renderCount) return; lastRender = el.dataset.renderCount;
          const d = el.thinWaxDiagnostics({ measure: false });
          if (!d.thinWax.detached) return;
          if (!released) {
            released = true;
            const first = el.thinWaxDiagnostics({ measure: false, surface: true }).surface;
            panelIds = [...new Set(first.panelIds.filter((id, i) => first.detached[i]))];
            window.dispatchEvent(new PointerEvent('pointerup', { pointerId }));
          }
          const m = d.debrisStage.matrixWorld; let coreBottom = Infinity;
          for (let i = 0; i < d.corePositions.length; i += 3) coreBottom = Math.min(coreBottom, m[1] * d.corePositions[i] + m[5] * d.corePositions[i + 1] + m[9] * d.corePositions[i + 2] + m[13]);
          const world = i => [0, 1, 2].map(k => m[k] * gpu[i * 3] + m[4 + k] * gpu[i * 3 + 1] + m[8 + k] * gpu[i * 3 + 2] + m[12 + k]);
          for (const id of panelIds) {
            let minY = Infinity, maxY = -Infinity;
            for (const i of records.get(id)) { const y = world(i)[1]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            // Only pairs with BOTH ends below the actual live core and above
            // tray collection are admissible. No wall-time sleep or assumed
            // frame rate chooses the window; rotating corner offsets cancel
            // in the centroid of unique real body vertices.
            if (maxY >= coreBottom - .02 || maxY <= -1 || minY <= d.debrisStage.floorY + .05) { baselines.delete(id); continue; }
            const ids = [...uniqueRecords.get(id).values()], center = [0, 0, 0];
            for (const i of ids) { const p = world(i); for (let k = 0; k < 3; k++) center[k] += p[k] / ids.length; }
            const before = baselines.get(id);
            if (before) {
              const down = before.center[1] - center[1];
              if (down > .02) {
                const final = el.thinWaxDiagnostics({ measure: false, surface: true }).surface;
                window.waxFlight = { panel: id, vertices: ids.length, elapsed: performance.now() - before.time, coreBottom: before.coreBottom,
                  bounds: before.bounds, finalCoreBottom: coreBottom, finalTop: maxY, finalMinY: minY,
                  landed: final.panelIds.some((panel, i) => panel === id && final.settled[i]), actualGPU: true,
                  down, lateral: Math.hypot(center[0] - before.center[0], center[2] - before.center[2]) };
                window.waxFrameObservers.delete(observe); return;
              }
            } else baselines.set(id, { center, bounds: { minY, maxY }, coreBottom, time: performance.now() });
          }
        };
        window.waxFrameObservers.add(observe);
      });
      await press(page);
      await page.waitForFunction(() => window.waxFlight !== null, null, { timeout: 15000 });
      await page.mouse.up();
      const falling = await page.evaluate(() => window.waxFlight);
      t.diagnostic(JSON.stringify({ pose, freeFlight: falling }));
      assert.equal(falling.actualGPU, true);
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
    await page.locator('.toy-mount').evaluate(el => {
      window.waxRigidResult = null;
      let baseline, pointerId, lastRender;
      window.addEventListener('pointerdown', e => { pointerId = e.pointerId; }, { capture: true, once: true });
      function uploaded(surface) {
        for (const values of window.waxUploadProbe.buffers.values()) {
          if (values.length !== surface.positions.length) continue;
          let same = true; for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - surface.positions[i]) > 1e-6) { same = false; break; }
          if (same) return values.slice();
        }
        throw Error('The diagnostic shell does not match any actual GPU position buffer');
      }
      const observe = () => {
        if (lastRender === el.dataset.renderCount) return; lastRender = el.dataset.renderCount;
        const state = el.thinWaxDiagnostics({ measure: false });
        if (!state.thinWax.detached) return;
        const d = el.thinWaxDiagnostics({ measure: false, surface: true });
        if (!baseline) {
          const first = d.surface.detached.findIndex(Boolean), panel = d.surface.panelIds[first], ids = [];
          for (let i = 0; i < d.surface.panelIds.length; i++) if (d.surface.panelIds[i] === panel) ids.push(i);
          baseline = { panel, ids, positions: uploaded(d.surface), core: d.corePositions, time: performance.now() };
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId }));
          return;
        }
        let coreChange = 0;
        for (let i = 0; i < baseline.core.length; i++) coreChange = Math.max(coreChange, Math.abs(baseline.core[i] - d.corePositions[i]));
        if (coreChange <= .005) return;
        const gpu = uploaded(d.surface), anchor = baseline.ids[0]; let distanceError = 0;
        const distance = (array, a, b) => Math.hypot(...[0, 1, 2].map(k => array[a * 3 + k] - array[b * 3 + k]));
        for (const id of baseline.ids) distanceError = Math.max(distanceError, Math.abs(distance(baseline.positions, anchor, id) - distance(gpu, anchor, id)));
        window.waxRigidResult = { panel: baseline.panel, sampledVertices: baseline.ids.length, distanceError, coreChange, elapsed: performance.now() - baseline.time,
          geometry: el.thinWaxDiagnostics({ measure: true, exhaustive: true }).geometry };
        window.waxFrameObservers.delete(observe);
      };
      window.waxFrameObservers.add(observe);
    });
    await press(page);
    await page.waitForFunction(() => window.waxRigidResult !== null, null, { timeout: 15000 });
    await page.mouse.up();
    const measured = await page.evaluate(() => window.waxRigidResult);
    assert.ok(measured.sampledVertices > 10, JSON.stringify(measured)); assert.ok(measured.coreChange > .005, JSON.stringify(measured)); assert.ok(measured.distanceError < 1e-5, JSON.stringify(measured));
    const liveGeometry = { geometry: measured.geometry };
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
test('cancellation, blur, hidden document, hit loss and leave stop the same input lifecycle', { timeout: 90000 }, async t => {
  const page = await open();
  try {
    for (const event of ['pointercancel', 'blur', 'hidden']) {
      const contact = await shortContact(page, event);
      t.diagnostic(JSON.stringify({ action: event, elapsed: contact.elapsed, captured: contact.captured, trustedDown: contact.trustedDown }));
      await page.mouse.up(); await page.waitForTimeout(1100);
      assert.equal((await diagnostics(page)).thinWax.detached, 0, event);
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false', event);
      if (event === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    }
    await shortContact(page, 'miss'); await page.mouse.move(5, 5); await page.waitForTimeout(1200); await page.mouse.up();
    assert.equal((await diagnostics(page)).thinWax.detached, 0, 'No damage keeps running at a stale hit');
    await press(page); await page.waitForTimeout(1250);
    const fresh = await projectedSurfaceContact(page, .6, .03);
    await page.locator('.toy-mount').evaluate((el, fresh) => {
      // Full triangle diagnostics can take hundreds of milliseconds on a
      // software GPU. Sample the two endpoints in the browser itself and
      // release within this task, so transport overhead cannot become dwell.
      window.waxSweep = null;
      window.addEventListener('pointermove', event => {
        if (Math.hypot(event.clientX - fresh.x, event.clientY - fresh.y) > 2) return;
        // This bubble listener runs after the product window pointermove handler.
        const start = performance.now(), before = el.thinWaxDiagnostics({ measure: false }).thinWax;
        setTimeout(() => {
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId: event.pointerId }));
          window.waxSweep = { before, after: el.thinWaxDiagnostics({ measure: false }).thinWax, elapsed: performance.now() - start };
        }, 120);
      }, { once: true });
    }, fresh);
    await page.mouse.move(fresh.x, fresh.y);
    await page.waitForFunction(() => window.waxSweep !== null);
    const swept = await page.evaluate(() => window.waxSweep);
    t.diagnostic(JSON.stringify({ sweep: swept }));
    assert.ok(swept.elapsed < 500, `Fresh-region contact really ended before fracture: ${swept.elapsed}ms`);
    assert.ok(swept.before.dwell < .5, 'Crossing into a fresh region resets local continuous dwell');
    assert.equal(swept.after.detached, swept.before.detached, 'A long hold cannot immediately shatter a newly swept region');
    await page.mouse.up();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
  } finally { await page.close(); }
});
