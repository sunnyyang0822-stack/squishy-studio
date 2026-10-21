const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, settled } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4193';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4193' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  await installOrbProbe(page, { pixels: true }); await page.goto(base + '/squishy/cloud/');
  await page.waitForFunction(() => window.orbMeshProbe?.pixelFrames.length);
  return page;
}
const frame = page => page.evaluate(() => structuredClone(window.orbMeshProbe.pixelFrames.at(-1)));
const distance = (a, b) => Math.max(...a.slice(0, 3).map((value, index) => Math.abs(value - b[index])));
async function idle(page) {
  await page.evaluate(() => { window.orbColorIdle = { draws: -1, time: performance.now() }; });
  await page.waitForFunction(() => {
    const state = window.orbColorIdle, draws = window.orbMeshProbe.orbDraws;
    if (draws !== state.draws) { state.draws = draws; state.time = performance.now(); }
    return performance.now() - state.time > 200;
  });
}
async function choose(page, index) {
  const previous = await page.evaluate(() => window.orbMeshProbe.orbDraws);
  await page.locator('[name=color]').nth(index).check();
  await page.waitForFunction(previous => window.orbMeshProbe.orbDraws > previous, previous);
}

test('真实 GPU 颜色由顶部覆盖到底部，最终整球收束且闲置停止绘制', async () => {
  const page = await open(); await idle(page);
  assert.equal(await page.locator('[name=color]').count(), 10);
  const before = await frame(page), start = await page.evaluate(() => window.orbMeshProbe.pixelFrames.length);
  await choose(page, 5); await idle(page);
  const frames = await page.evaluate(start => window.orbMeshProbe.pixelFrames.slice(start), start);
  assert.ok(frames.every(value => value.top[3] === 255 && value.middle[3] === 255 && value.bottom[3] === 255), 'Samples hit the opaque rendered orb');
  assert.ok(frames.some(value => distance(value.top, before.top) > 12 && distance(value.bottom, before.bottom) < 4), 'A real frame shows changed top while bottom retains its previous color');
  const final = frames.at(-1);
  for (const sample of ['top', 'middle', 'bottom']) assert.ok(distance(final[sample], before[sample]) > 12, sample + ' reaches the new color');
  const draws = await page.evaluate(() => window.orbMeshProbe.orbDraws);
  await page.waitForTimeout(220); assert.equal(await page.evaluate(() => window.orbMeshProbe.orbDraws), draws);
  await page.close();
});

test('快速换色从当前屏幕连续接续，凹痕和旋转不清零', async () => {
  const page = await open(); const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .45); await page.mouse.down();
  await page.waitForTimeout(500); await page.mouse.up(); await settled(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  const baseline = await page.evaluate(() => ({ vertices: Array.from(window.orbMeshProbe.positions), matrix: window.orbMeshProbe.modelViewMatrix.slice(), uploads: window.orbMeshProbe.uploads }));
  const rotatedBefore = await frame(page);
  await choose(page, 5);
  await page.waitForFunction(before => {
    const sample = window.orbMeshProbe.pixelFrames.at(-1);
    const delta = key => Math.max(...sample[key].slice(0, 3).map((value, index) => Math.abs(value - before[key][index])));
    return delta('top') > 12 && delta('bottom') < 4;
  }, rotatedBefore);
  const { interrupted, start } = await page.locator('[name=color]').nth(8).evaluate(input => {
    const probe = window.orbMeshProbe;
    const sample = { interrupted: structuredClone(probe.pixelFrames.at(-1)), start: probe.pixelFrames.length };
    input.click(); return sample;
  });
  await page.waitForFunction(start => window.orbMeshProbe.pixelFrames.length > start, start);
  const first = await page.evaluate(start => structuredClone(window.orbMeshProbe.pixelFrames[start]), start);
  for (const sample of ['top', 'middle', 'bottom']) assert.ok(distance(first[sample], interrupted[sample]) < 28, sample + ' does not jump to an earlier color on interruption: ' + JSON.stringify({ interrupted, first }));
  await page.waitForTimeout(100); await choose(page, 2); await idle(page);
  const after = await page.evaluate(() => ({ vertices: Array.from(window.orbMeshProbe.positions), matrix: window.orbMeshProbe.modelViewMatrix.slice(), uploads: window.orbMeshProbe.uploads }));
  assert.deepEqual(after, baseline, 'Color-only updates preserve dent vertices, orientation and GPU position uploads');
  await page.close();
});

test('减少动态时换色正确收束，动态偏好切换后可继续换色并停帧', async () => {
  const page = await open({ reducedMotion: 'reduce' }); await idle(page);
  await choose(page, 5); await idle(page); const expected = await frame(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await choose(page, 1); await page.waitForTimeout(90);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await choose(page, 5); await idle(page);
  const result = await frame(page);
  for (const sample of ['top', 'middle', 'bottom']) assert.ok(distance(result[sample], expected[sample]) <= 1, sample + ' converges to the requested final color');
  const draws = await page.evaluate(() => window.orbMeshProbe.orbDraws); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.orbMeshProbe.orbDraws), draws);
  await page.close();
});
