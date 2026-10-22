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
const matrixDistance = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));

test('同色完整流程在制作步骤结束输入，最终体验复用GPU同步恢复且可再次捏压', async () => {
  const page = await open();
  await idle(page);
  const matrix = await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice());
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  await page.locator('.orb-input').focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(600);
  await page.keyboard.up('Space'); await settled(page);
  await page.mouse.move(100,250); await page.mouse.down();
  await page.mouse.move(280,300,{steps:8}); await page.mouse.up(); await idle(page);
  assert.ok(await page.evaluate(() => window.orbMeshProbe.positions.some((value,i) => Math.abs(value-window.orbMeshProbe.rest[i])>.025)));
  assert.notDeepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()),matrix);
  await page.getByRole('button',{name:'下一步'}).click();
  await page.getByRole('button',{name:'下一步'}).click();
  await page.locator('.orb-input').focus(); await page.keyboard.down('Space');
  await page.locator('.step-next').evaluate(button => button.click());
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'),'false');
  await page.keyboard.up('Space');
  await page.getByRole('button',{name:'开始捏捏'}).click();
  await page.waitForFunction(() => window.orbMeshProbe.positions.every((value,i) => value===window.orbMeshProbe.rest[i]));
  await idle(page);
  assert.deepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()),matrix);
  assert.equal(await canvas.evaluate(el => el===document.querySelector('.toy-mount canvas')),true);
  assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts.length),1);
  await page.locator('.orb-input').focus(); await page.keyboard.down('Space');
  await page.waitForFunction(() => window.orbMeshProbe.positions.some((value,i) => Math.abs(value-window.orbMeshProbe.rest[i])>.025));
  await page.keyboard.up('Space'); await page.close();
});
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

test('换色重置真实GPU凹痕与旋转，快切仍从当前屏幕连续接续且可以重新操作', async () => {
  const page = await open();
  const initialMatrix = await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice());
  let box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .45); await page.mouse.down();
  await page.waitForTimeout(1200); await page.mouse.up(); await settled(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  assert.ok(await page.evaluate(() => window.orbMeshProbe.positions.some((value, index) => Math.abs(value - window.orbMeshProbe.rest[index]) > .05)));
  assert.notDeepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()), initialMatrix);
  const before = await page.evaluate(() => ({ loads: performance.getEntriesByType('resource').filter(resource => resource.name.includes('squishy-orb.glb')).length, contexts: window.orbMeshProbe.contexts.length }));
  await choose(page, 5);
  await page.waitForFunction(() => window.orbMeshProbe.positions.every((value, index) => value === window.orbMeshProbe.rest[index]));
  await idle(page);
  assert.deepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()), initialMatrix);
  const { interrupted, start } = await page.locator('[name=color]').nth(8).evaluate(input => {
    const probe = window.orbMeshProbe;
    const sample = { interrupted: structuredClone(probe.pixelFrames.at(-1)), start: probe.pixelFrames.length };
    input.click(); return sample;
  });
  await page.waitForFunction(start => window.orbMeshProbe.pixelFrames.length > start, start);
  const first = await page.evaluate(start => structuredClone(window.orbMeshProbe.pixelFrames[start]), start);
  for (const sample of ['top', 'middle', 'bottom']) assert.ok(distance(first[sample], interrupted[sample]) < 28, sample + ' does not jump to an earlier color on interruption: ' + JSON.stringify({ interrupted, first }));
  await page.waitForTimeout(100); await choose(page, 2); await idle(page);
  assert.equal(await page.evaluate(() => window.orbMeshProbe.positions.every((value, index) => value === window.orbMeshProbe.rest[index])), true);
  assert.deepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()), initialMatrix);
  assert.deepEqual(await page.evaluate(() => ({ loads: performance.getEntriesByType('resource').filter(resource => resource.name.includes('squishy-orb.glb')).length, contexts: window.orbMeshProbe.contexts.length })), before, 'Reset uses the existing model and renderer');
  box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.waitForFunction(() => window.orbMeshProbe.positions.some((value, index) => Math.abs(value - window.orbMeshProbe.rest[index]) > .04));
  await page.mouse.up(); await settled(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  assert.notDeepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()), initialMatrix, 'Fresh squeezing and rotation work after reset');
  await page.close();
});

test('换色取消键盘、鼠标捏压和正在旋转的owner，旧输入后续事件不会再修改重置模型', async () => {
  const page = await open();
  const initialMatrix = await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice());
  for (const [index, kind] of ['keyboard', 'squeeze', 'rotation'].entries()) {
    const box = await page.locator('.orb-input').boundingBox();
    if (kind === 'keyboard') { await page.locator('.orb-input').focus(); await page.keyboard.down('Space'); }
    else if (kind === 'squeeze') { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); }
    else { await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); }
    if (kind !== 'rotation') {
      await page.waitForFunction(() => window.orbMeshProbe.positions.some((value, index) => Math.abs(value - window.orbMeshProbe.rest[index]) > .025));
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
    } else assert.equal(await page.locator('body').evaluate(element => element.classList.contains('orb-rotating')), true);
    await page.locator('[name=color]').nth(index + 1).evaluate(input => input.click());
    await page.waitForFunction(() => document.querySelector('.orb-input').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('orb-rotating')), false);
    assert.equal(await page.evaluate(() => document.querySelector('.orb-input').hasPointerCapture(1) || document.documentElement.hasPointerCapture(1)), false);
    if (kind === 'keyboard') await page.keyboard.up('Space');
    else { await page.mouse.move(380, 330, { steps: 8 }); await page.mouse.up(); }
    await idle(page);
    assert.equal(await page.evaluate(() => window.orbMeshProbe.positions.every((value, index) => value === window.orbMeshProbe.rest[index])), true, kind + ' cannot leave a stuck owner or reapply a dent');
    assert.deepEqual(await page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice()), initialMatrix, kind + ' cannot resume an old rotation');
  }
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


for (const reducedMotion of ['no-preference', 'reduce']) test(`真实GPU形态与颜色同步复原，首帧无跳变、同帧完成并停帧：${reducedMotion}`, async () => {
  const page = await open({ reducedMotion }); await idle(page);
  const initial = await frame(page), box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .45); await page.mouse.down();
  await page.waitForTimeout(1200); await page.mouse.up(); await settled(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  const { before, start } = await page.locator('[name=color]').nth(5).evaluate(input => {
    const probe = window.orbMeshProbe;
    const result = { before: structuredClone(probe.pixelFrames.at(-1)), start: probe.pixelFrames.length };
    input.click(); return result;
  });
  assert.ok(before.maxDepth > .05);
  assert.ok(matrixDistance(before.matrix, initial.matrix) > .1);
  await idle(page);
  const frames = await page.evaluate(start => window.orbMeshProbe.pixelFrames.slice(start), start);
  const first = frames[0], final = frames.at(-1);
  assert.ok(first.maxDepth > before.maxDepth * .25 && first.maxDepth < before.maxDepth, 'The first color frame keeps a dent and starts restoring it: ' + JSON.stringify({ before: before.maxDepth, first: first.maxDepth }));
  assert.ok(matrixDistance(first.matrix, initial.matrix) > .01, 'The first color frame keeps part of the previous pose');
  assert.ok(matrixDistance(first.matrix, before.matrix) < matrixDistance(before.matrix, initial.matrix), 'Pose starts moving toward identity on that frame');
  assert.ok(distance(first.hue, before.hue) > 1e-10, 'Actual GPU color attributes begin changing on the first restoring frame');
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].maxDepth <= frames[i - 1].maxDepth + .000001, 'Dent depth decreases monotonically with the color clock');
  // Reduced motion lasts 120ms: a busy GPU may present only the first partial
  // frame and the endpoint. Verify real partial restoration, not a frame at
  // an arbitrary halfway depth that the display is allowed to skip.
  assert.ok(frames.some(value => value.maxDepth > .00001 && value.maxDepth < before.maxDepth && distance(value.hue, before.hue) > 1e-10), 'A real frame shows partial restoration and color change together');
  assert.equal(final.maxDepth, 0);
  assert.deepEqual(final.matrix, initial.matrix);
  // Cubic easing becomes smaller than Float32 position precision just before
  // its exact endpoint. The shared final frame must finish both, then sleep.
  assert.ok(frames.findIndex(value => value.maxDepth === 0) >= frames.length - 2, 'Only final-frame Float32 rounding may reach rest slightly early');
  const draws = await page.evaluate(() => window.orbMeshProbe.orbDraws); await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.orbMeshProbe.orbDraws), draws);
  await page.close();
});

test('新捏压或旋转中断自动复原，快速换色及减少动态切换从当前形态接续', async () => {
  const page = await open(); await idle(page);
  const initial = await frame(page);
  const dent = async () => {
    const box = await page.locator('.orb-input').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.waitForTimeout(1000); await page.mouse.up(); await settled(page);
  };
  await dent();
  await choose(page, 5); await page.waitForTimeout(70);
  const interrupted = await frame(page);
  assert.ok(interrupted.maxDepth > 0);
  const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.waitForTimeout(850); await page.mouse.up(); await settled(page); await idle(page);
  assert.ok((await frame(page)).maxDepth > .05, 'New physical input prevents the color clock from erasing the new dent');
  await choose(page, 8); await page.waitForTimeout(70);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  const rotated = await frame(page);
  assert.ok(rotated.maxDepth > 0, 'Rotation interruption keeps the current partially restored shape');
  assert.ok(matrixDistance(rotated.matrix, initial.matrix) > .1, 'New rotation survives color completion');
  const { before, start } = await page.locator('[name=color]').nth(2).evaluate(input => {
    const probe = window.orbMeshProbe, result = { before: structuredClone(probe.pixelFrames.at(-1)), start: probe.pixelFrames.length };
    input.click(); return result;
  });
  await page.waitForFunction(start => window.orbMeshProbe.pixelFrames.length > start, start);
  const first = await page.evaluate(start => structuredClone(window.orbMeshProbe.pixelFrames[start]), start);
  assert.ok(first.maxDepth > 0 && first.maxDepth <= before.maxDepth);
  for (const sample of ['top', 'middle', 'bottom']) assert.ok(distance(first[sample], before[sample]) < 35, 'Retarget keeps the current visible color and shape');
  await page.waitForTimeout(70); await page.emulateMedia({ reducedMotion: 'reduce' }); await idle(page);
  const final = await frame(page);
  assert.equal(final.maxDepth, 0); assert.deepEqual(final.matrix, initial.matrix);
  await page.close();
});
