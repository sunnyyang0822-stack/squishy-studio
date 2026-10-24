const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, stats, ready, projectedSurfaceContact } = require('./helpers/squishy-browser.cjs');
const base = 'http://127.0.0.1:4188';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4188' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const contact = (page, id) => projectedSurfaceContact(page, id === 'donut' ? .72 : id === 'paw' ? -.24 : 0, id === 'paw' ? -.46 : .03);
async function assertConfig(page, id) {
  assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), id);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'slow-rebound');
  assert.equal(await page.locator('.toy-mount').getAttribute('data-appearance-id'), 'full-matte');
  assert.match(await page.locator('.orb-input').getAttribute('aria-label'), /缓慢下陷，松开完整回弹/);
  assert.equal(new URL(page.url()).searchParams.get('coreMaterial'), 'butter');
}
async function exactRest(page) {
  assert.equal(await page.evaluate(() => window.styleProbe.positions.every((v, i) => v === window.styleProbe.rest[i])), true, 'Every actual GPU position returns to this asset’s exact rest mesh');
}
async function assertRingIsolation(page, id) {
  if (id === 'donut') assert.equal(await page.evaluate(() => { const p = window.styleProbe; return p.positions.every((v, i) => p.rest[i - i % 3] >= -.35 || v === p.rest[i]); }), true, 'Ring pressure never crosses the empty hole');
}
for (const id of ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) test(`${id}×slow-rebound GPU: staged press, drag, slow complete recovery, cancel, color, centered rotation and lifecycle`, { timeout: 300000 }, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.clock.install(); const mesh = await installStyleProbe(page, getSquishyStyle(id));
    await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=butter`); await ready(page); await assertConfig(page, id);
    const canvas = await page.locator('.toy-mount canvas').elementHandle(), p = await contact(page, id);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const uploads = await page.evaluate(() => window.styleProbe.uploads);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.clock.runFor(80);
    const early = await stats(page); assert.ok(early.maximum > .00001 && early.maximum < .04, JSON.stringify(early));
    await page.clock.runFor(600); const held = await stats(page);
    assert.ok(held.maximum > early.maximum * 2 && held.maximum > .03 && held.maximum <= .460001, JSON.stringify(held));
    assert.ok(held.uploads - uploads >= 25, 'Controlled time executes actual position uploads and GPU draws');
    assert.ok(held.finite && held.changed > 10 && held.changed < held.vertices * .6);
    await assertRingIsolation(page, id);
    await page.mouse.move(p.x + 12, p.y - 5, { steps: 6 }); await page.clock.runFor(200); await page.mouse.up();
    const released = await stats(page); await page.clock.runFor(300); const recovering = await stats(page);
    assert.ok(recovering.maximum > .001 && recovering.maximum < released.maximum * .98, 'Release recovers gradually without instantly clearing or retaining a plastic dent');
    await page.clock.runFor(14000); await exactRest(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.clock.runFor(500);
    const beforeCancel = await stats(page); assert.ok(beforeCancel.maximum > .02);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up(); await page.clock.runFor(150);
    const cancelled = await stats(page); assert.ok(cancelled.maximum > 0 && cancelled.maximum < beforeCancel.maximum, 'Cancellation ends force and continues slow recovery');
    await page.locator('[name=color][value=mint]').check(); await page.clock.runFor(1000); await exactRest(page);
    assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true, 'Color restore keeps the same renderer');
    const before = await page.evaluate(() => window.styleProbe.matrix), center = mesh.low.map((v, k) => (v + mesh.high[k]) / 2);
    const transformedCenter = matrix => [0, 1, 2].map(k => matrix[12 + k] + center.reduce((sum, v, j) => sum + v * matrix[j * 4 + k], 0));
    const pivot = transformedCenter(before), box = await page.locator('.toy-stage').boundingBox();
    await page.mouse.move(box.x + 12, box.y + 45); await page.mouse.down();
    for (const [dx, dy] of [[45, 20], [100, -10], [75, 30]]) {
      await page.mouse.move(box.x + 12 + dx, box.y + 45 + dy, { steps: 5 }); await page.clock.runFor(30);
      const current = transformedCenter(await page.evaluate(() => window.styleProbe.matrix));
      assert.ok(Math.hypot(...current.map((v, k) => v - pivot[k])) < 1e-5, 'Actual mesh rotates around its immutable center');
    }
    await page.mouse.up(); assert.notDeepEqual(await page.evaluate(() => window.styleProbe.matrix), before);
    await page.clock.resume(); await page.reload(); await ready(page); await assertConfig(page, id); await exactRest(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.styleProbe.contexts.every(gl => gl.isContextLost())), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('phone native touch: donut and paw preserve slow recovery, touch cancellation and full-matte preset', { timeout: 300000 }, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  for (const id of ['donut', 'paw']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.clock.install(); await installStyleProbe(page, getSquishyStyle(id));
      await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=butter`); await ready(page); await assertConfig(page, id);
      const session = await context.newCDPSession(page), p = await contact(page, id);
      const touch = (type, x = p.x, y = p.y) => session.send('Input.dispatchTouchEvent', { type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ x, y, id: 0, radiusX: 8, radiusY: 8, force: .5 }] });
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await touch('touchStart'); await page.clock.runFor(80); const early = await stats(page);
      await page.clock.runFor(600); const held = await stats(page);
      assert.ok(early.maximum > 0 && early.maximum < .04 && held.maximum > early.maximum * 2 && held.maximum > .03);
      await assertRingIsolation(page, id);
      await touch('touchMove', p.x + 7, p.y - 3); await page.clock.runFor(150); await touch('touchEnd');
      const released = await stats(page); await page.clock.runFor(300); const recovering = await stats(page);
      assert.ok(recovering.maximum > .001 && recovering.maximum < released.maximum);
      await page.clock.runFor(14000); await exactRest(page);
      await touch('touchStart'); await page.clock.runFor(500); const before = await stats(page);
      await touch('touchCancel'); await page.clock.runFor(150); const cancelled = await stats(page);
      assert.ok(cancelled.maximum > 0 && cancelled.maximum < before.maximum);
      await page.clock.resume(); await page.reload(); await ready(page); await assertConfig(page, id); await exactRest(page);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      assert.equal(await page.locator('.toy-mount canvas').count(), 0); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
