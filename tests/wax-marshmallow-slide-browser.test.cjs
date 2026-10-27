const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('./helpers/squishy-browser.cjs');
const { regions, installWaxStyleProbe, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const styles = process.env.WAX_MM_SLIDE_STYLE?.split(',') || Object.keys(regions).filter(id => id !== 'orb');
const record = process.env.WAX_MM_SLIDE_RECORD === '1', port = process.env.WAX_MM_SLIDE_PORT || '4246';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

function renderedOpenings() {
  const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false, surface: true }), s = d.surface, groups = new Map();
  for (let r = 0; r < s.layers.length; r++) {
    if (s.layers[r] !== 1 || !s.boundaryVertex[r] || s.detached[r]) continue;
    if (s.positions[r * 3] === 0 && s.positions[r * 3 + 1] === 0 && s.positions[r * 3 + 2] === 0) continue;
    const key = [0, 1, 2].map(k => Math.round(s.restSupportPositions[r * 3 + k] * 1e6)).join(',');
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
  }
  let visiblePairs = 0, maxTangentGap = 0, allPairs = 0;
  for (const records of groups.values()) for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) {
    const i = records[a], j = records[b]; if (s.panelIds[i] === s.panelIds[j]) continue;
    const n = [0, 1, 2].map(k => s.restSupportNormals[i * 3 + k] + s.restSupportNormals[j * 3 + k]), length = Math.hypot(...n);
    if (!length) continue; for (let k = 0; k < 3; k++) n[k] /= length;
    const delta = [0, 1, 2].map(k => s.positions[i * 3 + k] - s.positions[j * 3 + k]), projected = delta.reduce((v, value, k) => v + value * n[k], 0);
    const tangent = Math.sqrt(Math.max(0, delta.reduce((v, value) => v + value * value, 0) - projected * projected)); allPairs++;
    if ((s.openBoundary[i] || s.openBoundary[j]) && (s.damage[i] || s.damage[j])) { maxTangentGap = Math.max(maxTangentGap, tangent); if (tangent > .001) visiblePairs++; }
  }
  let gpuError = Infinity;
  for (const values of window.waxGPUObserver.buffers.values()) if (values.length === s.positions.length) {
    let error = 0; for (let i = 0; i < values.length; i++) error = Math.max(error, Math.abs(values[i] - s.positions[i])); gpuError = Math.min(gpuError, error);
  }
  let depth = 0; for (let i = 0; i < d.corePositions.length; i += 3) depth = Math.max(depth, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k])));
  return { allPairs, visiblePairs, maxTangentGap, gpuError, depth, state: d.thinWax };
}

for (const style of styles) test(`${style} marshmallow fast sliding creates actual uploaded fissures before any chip drops`, { timeout: 120000 }, async t => {
  assert.ok(regions[style]);
  const viewport = { width: 1280, height: 900 };
  if (record) mkdirSync('.tmp/mm-slide-video', { recursive: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1), ...(record ? { recordVideo: { dir: '.tmp/mm-slide-video', size: viewport } } : {}) });
  const page = await context.newPage(), video = page.video();
  try {
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const mesh = await installStyleProbe(page, getSquishyStyle(style)); await installWaxStyleProbe(page);
    await page.goto(`http://127.0.0.1:${port}/squishy/cloud/?style=${style}&coreMaterial=marshmallow&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`); await ready(page);
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
    const initial = await page.evaluate(renderedOpenings); assert.equal(initial.visiblePairs, 0);
    const points = [];
    for (const x of [-.22, 0, .22]) points.push(await projectedMeshContact(page, mesh, style, [x, 0]));
    await page.evaluate(() => {
      window.waxSlideInput = { moves: 0 };
      window.addEventListener('pointerdown', event => { window.waxSlideInput.started = performance.now(); window.waxSlideInput.trustedDown = event.isTrusted; }, { once: true, capture: true });
      window.addEventListener('pointermove', event => { if (event.buttons === 1) window.waxSlideInput.moves++; }, { capture: true });
      window.addEventListener('pointerup', event => { window.waxSlideInput.elapsed = performance.now() - window.waxSlideInput.started; window.waxSlideInput.trustedUp = event.isTrusted; }, { once: true, capture: true });
    });
    await page.mouse.move(points[0].x, points[0].y);
    const client = await context.newCDPSession(page), pending = [];
    // One ordered native protocol queue: waiting for each renderer ACK would
    // stretch a short gesture into a stationary hold on a slow machine.
    for (const [type, point] of [['mousePressed', points[0]], ['mouseMoved', points[1]], ['mouseMoved', points[2]], ['mouseReleased', points[2]]]) pending.push(client.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 }));
    await Promise.all(pending);
    await page.waitForTimeout(150);
    const after = await page.evaluate(renderedOpenings), nativeInput = await page.evaluate(() => window.waxSlideInput);
    assert.ok(nativeInput.trustedDown && nativeInput.trustedUp && nativeInput.moves > 0);
    assert.ok(nativeInput.elapsed < 500, `The actual native sliding gesture must end before the fracture threshold: ${JSON.stringify(nativeInput)}`);
    assert.ok(after.depth > .001, 'The original marshmallow core really responds to the same native sliding input');
    assert.equal(after.state.detached, 0, 'A brief moving contact must not be treated as a long stationary hold');
    assert.ok(after.visiblePairs > 0 && after.maxTangentGap > .001, `Actual uploaded boundary separation, not just a cracked flag: ${JSON.stringify(after)}`);
    assert.ok(after.gpuError <= 1e-6, `The visible fissure geometry must match a real native GPU buffer: ${after.gpuError}`);
    const d = await page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics({ exhaustive: true })); geometryOK(d);
    t.diagnostic(JSON.stringify({ style, nativeInput, ...after, geometry: d.geometry }));
    if (record) {
      await page.screenshot({ path: `artifacts/issue-38/${style}-marshmallow-slide-cracks.png` }); await page.waitForTimeout(600);
      const contact = await projectedMeshContact(page, mesh, style); await page.mouse.move(contact.x, contact.y); await page.mouse.down(); await page.waitForTimeout(1800); await page.mouse.up();
      await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.detached > 0 && s.living === 0; }, null, { timeout: 15000 });
      geometryOK(await page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics({ exhaustive: true })));
      await rotate(page, 40, 8); await page.waitForTimeout(350); await page.screenshot({ path: `artifacts/issue-38/${style}-marshmallow-slide-side.png` });
    }
  } finally {
    await context.close(); if (record) await video.saveAs(`artifacts/issue-38/${style}-marshmallow-slide-and-fracture.webm`);
  }
});
