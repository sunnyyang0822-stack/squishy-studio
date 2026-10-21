const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats, modelAttribute, settled } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4191';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4191' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  await installOrbProbe(page); await page.goto(base + '/squishy/cloud/');
  await page.waitForFunction(() => window.orbMeshProbe?.modelViewMatrix);
  return page;
}
const matrix = page => page.evaluate(() => window.orbMeshProbe.modelViewMatrix.slice());
const vertices = page => page.evaluate(() => Array.from(window.orbMeshProbe.positions));
const difference = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const rest = modelAttribute('POSITION');
const center = [0, 1, 2].map(k => {
  const values = Array.from({ length: rest.length / 3 }, (_, i) => rest[i * 3 + k]);
  return (Math.min(...values) + Math.max(...values)) / 2;
});
const transformedCenter = m => [0, 1, 2].map(k => m[k] * center[0] + m[k + 4] * center[1] + m[k + 8] * center[2] + m[k + 12]);

test('普通移动不转；按住留白以真实模型中心连续整圈旋转，松开立即停止', async () => {
  const page = await open();
  const original = await matrix(page);
  await page.mouse.move(100, 250); await page.mouse.move(300, 500, { steps: 10 }); await page.waitForTimeout(100);
  assert.deepEqual(await matrix(page), original, 'Hover has no rotation');
  await page.mouse.move(100, 250); await page.mouse.down();
  const centerBefore = transformedCenter(original);
  let quarter;
  for (let turn = 0; turn < 2; turn++) for (let part = 1; part <= 4; part++) {
    await page.mouse.move(100 + (turn * 4 + part) * 360, 250, { steps: 8 });
    await page.waitForTimeout(30);
    const current = await matrix(page);
    assert.ok(difference(transformedCenter(current), centerBefore) < .00001, 'The actual geometry center stays fixed');
    if (part === 1) { assert.ok(difference(current, original) > .5); quarter = current; }
    if (part === 4) assert.ok(difference(current, original) < .00002, 'Full revolution returns to initial orientation without angle clamp');
  }
  for (let part = 1; part <= 4; part++) {
    await page.mouse.move(2980, 250 + part * 225, { steps: 8 }); await page.waitForTimeout(30);
    const current = await matrix(page);
    assert.ok(difference(transformedCenter(current), centerBefore) < .00001);
    if (part === 1) assert.ok(difference(current, original) > .5, 'Vertical drag rotates as well');
    if (part === 4) assert.ok(difference(current, original) < .00002, 'Vertical rotation also allows a complete turn');
  }
  await page.mouse.up();
  const released = await matrix(page); await page.waitForTimeout(240);
  assert.deepEqual(await matrix(page), released, 'No inertia after release');
  await page.mouse.move(200, 300); await page.waitForTimeout(100); assert.deepEqual(await matrix(page), released);
  assert.ok(quarter); await page.close();
});

test('球体捏压与设置不触发旋转；已有凹痕跟随刚体旋转且不上传新位置', async () => {
  const page = await open(); const original = await matrix(page);
  await page.locator('[name=color]').nth(3).check();
  await page.locator('[name=color]').nth(6).focus(); await page.keyboard.press('ArrowRight');
  await settled(page);

  const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .45); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4, { steps: 12 });
  await page.waitForTimeout(500); assert.deepEqual(await matrix(page), original);
  await page.mouse.up(); await settled(page);
  assert.ok((await meshStats(page)).maximum > .03);
  const back = await page.locator('.detail-back').boundingBox();
  await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2); await page.mouse.down();
  await page.mouse.move(300, 170, { steps: 8 }); await page.mouse.up();
  assert.deepEqual(await matrix(page), original, 'Settings do not rotate the model');
  const retained = await vertices(page), uploads = await page.evaluate(() => window.orbMeshProbe.uploads);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(460, 250, { steps: 16 }); await page.mouse.up(); await page.waitForTimeout(100);
  assert.ok(difference(await matrix(page), original) > .5);
  assert.deepEqual(await vertices(page), retained, 'Dents stay in model coordinates');
  assert.equal(await page.evaluate(() => window.orbMeshProbe.uploads), uploads, 'Rotation changes the matrix without deforming vertices');
  await page.close();
});

test('旋转后实际命中对应屏幕侧；取消捏压保持旧痕，旋转中断后可重新拖动', async () => {
  const page = await open();
  let box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down();
  await page.waitForTimeout(500); await page.mouse.up(); await settled(page);
  const retained = await vertices(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(460, 250, { steps: 16 }); await page.mouse.up();
  await page.waitForTimeout(80);
  const rotated = await matrix(page), projectedCenter = transformedCenter(rotated);
  for (const [fraction, sign] of [[.3, -1], [.7, 1]]) {
    box = await page.locator('.orb-input').boundingBox();
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height * .48); await page.mouse.down();
    await page.waitForFunction(baseline => window.orbMeshProbe.positions.some((v, i) => Math.abs(v - baseline[i]) > .05), retained);
    await page.waitForTimeout(250);
    const stats = await meshStats(page, retained), hit = stats.center;
    const viewX = rotated[0] * hit[0] + rotated[4] * hit[1] + rotated[8] * hit[2] + rotated[12];
    assert.ok((viewX - projectedCenter[0]) * sign > .15, 'The newly deformed real vertices are on the pressed screen side');
    assert.deepEqual(await matrix(page), rotated, 'A rotated toy still squeezes without starting rotation');
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up(); await settled(page); assert.deepEqual(await vertices(page), retained);
  }
  for (const kind of ['cancel', 'blur', 'hidden']) {
    await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(240, 250, { steps: 8 }); await page.waitForTimeout(50);
    await page.evaluate(kind => {
      if (kind === 'cancel') window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      if (kind === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, kind);
    const cancelled = await matrix(page);
    await page.mouse.move(360, 250, { steps: 8 }); await page.mouse.up();
    if (kind === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(80); assert.deepEqual(await matrix(page), cancelled, kind + ' stops rotation');
    await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(240, 250, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(80);
    assert.ok(difference(await matrix(page), cancelled) > .1, kind + ' allows a new drag');
    assert.deepEqual(await vertices(page), retained);
  }
  await page.close();
});

test('触屏留白拖动继续滚页并保持模型方向', async () => {
  const page = await open({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const original = await matrix(page), session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 12, y: 430, id: 0 }] });
  for (let y = 410; y >= 180; y -= 20) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 12, y, id: 0 }] }); await page.waitForTimeout(16); }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => scrollY > 40); assert.deepEqual(await matrix(page), original);
  await session.detach(); await page.close();
});
