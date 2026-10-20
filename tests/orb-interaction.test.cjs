const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4187';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4187' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(options = {}) {
  const page = await browser.newPage(options);
  await installOrbProbe(page);
  await page.goto(base + '/squishy/cloud/');
  await page.waitForFunction(() => window.orbMeshProbe?.positions);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function point(page, x = .5, y = .5) {
  const box = await page.locator('.orb-input').boundingBox();
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}
async function press(page, x = .5, y = .5) {
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForFunction(() => window.orbMeshProbe.positions.some((v, i) => Math.abs(v - window.orbMeshProbe.rest[i]) > .05));
  return p;
}
async function restored(page) {
  await page.waitForFunction(() => window.orbMeshProbe.positions.every((v, i) => Math.abs(v - window.orbMeshProbe.rest[i]) < .000001));
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
}

test('真实 GPU 顶点：左、右、上命中局部凹陷，远侧不缩放；按住时长增强并有界', async () => {
  const page = await open({ viewport: { width: 1440, height: 900 } });
  const originalPixels = await page.locator('.toy-mount canvas').screenshot();
  for (const [x, y, axis, sign] of [[.27,.5,0,-1],[.73,.5,0,1],[.5,.25,1,1]]) {
    await press(page, x, y); await page.waitForTimeout(350);
    const stats = await meshStats(page);
    assert.ok(stats.maximum > .15 && stats.maximum <= .361, JSON.stringify(stats));
    assert.ok(stats.changed > 100 && stats.changed < 700, 'Local neighborhood, not whole-object scaling');
    assert.ok(stats.center[axis] * sign > .25, JSON.stringify(stats));
    assert.ok(await page.evaluate(() => {
      const p = window.orbMeshProbe;
      return p.rest.every((v, i) => p.rest[Math.floor(i / 3) * 3 + 2] >= -.5 || v === p.positions[i]);
    }), 'Back surface stays unchanged');
    await page.mouse.up(); await restored(page);
  }
  await press(page); const early = await meshStats(page);
  await page.waitForTimeout(900); const held = await meshStats(page);
  assert.ok(held.maximum > early.maximum && held.maximum <= .361);
  await page.mouse.up(); await restored(page);
  const frame = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), frame, 'Sleep after the spring settles');
  assert.deepEqual(await page.locator('.toy-mount canvas').screenshot(), originalPixels, 'Restoring positions and original normals restores the approved image');
  await page.close();
});

test('连续拖动、回弹中再次按压、移出松开和键盘操作；缩放主题不重建控制', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  await press(page, .27, .45); await page.waitForTimeout(300);
  let previous = (await meshStats(page)).center[0];
  for (const fraction of [.4, .5, .6, .73]) {
    const p = await point(page, fraction, .45); await page.mouse.move(p.x, p.y, { steps: 4 }); await page.waitForTimeout(80);
    const current = (await meshStats(page)).center[0];
    assert.ok(current >= previous - .02 && current - previous < .4, 'Continuous following'); previous = current;
  }
  assert.ok(previous > .25);
  await page.locator('[value=sugar]').evaluate(el => el.click());
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.material === 'sugar');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true', 'Preference changes do not detach the captured input surface');
  await page.evaluate(() => document.documentElement.dataset.theme = 'night');
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
  assert.equal((await meshStats(page)).contexts, 1);
  await page.mouse.move(5, 5, { steps: 4 }); await page.mouse.up(); await restored(page);
  for (let i = 0; i < 3; i++) {
    await press(page, i % 2 ? .65 : .35, .5); await page.waitForTimeout(150);
    await page.mouse.up(); await page.waitForTimeout(60);
  }
  await restored(page);
  await page.locator('.orb-input').focus(); await page.keyboard.down('Space');
  await page.waitForFunction(() => window.orbMeshProbe.positions.some((v, i) => Math.abs(v - window.orbMeshProbe.rest[i]) > .1));
  await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true', 'Only the initiating key can end its press');
  await page.keyboard.up('Space'); await restored(page);
  await page.close();
});

test('pointercancel、丢失捕获、窗口失焦、后台和离页均释放输入与网格', async () => {
  const page = await open();
  for (const kind of ['cancel', 'capture', 'blur', 'hidden']) {
    await press(page); await page.waitForTimeout(100);
    await page.evaluate(kind => {
      if (kind === 'cancel') window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      if (kind === 'capture') document.querySelector('.orb-input').releasePointerCapture(1);
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      if (kind === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, kind);
    await page.mouse.up();
    if (kind === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await restored(page);
  }
  await press(page);
  await page.getByRole('link', { name: '返回合集' }).evaluate(el => el.click());
  await page.waitForURL('**/collections/');
  await page.goBack(); await page.waitForFunction(() => window.orbMeshProbe?.positions);
  await restored(page);
  await press(page);
  await page.evaluate(() => window.orbMeshProbe.contexts.at(-1).getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('[data-state=unavailable]');
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.waitForSelector('.toy-mount[data-render-count] .orb-input'); await restored(page);
  await page.close();
});

test('真实模拟触摸：圆球内拖动不滚页，第二触点不夺取输入，外部留白可以滚动', async () => {
  const page = await open({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const session = await page.context().newCDPSession(page);
  const p = await point(page, .4, .45);
  const first = { x: p.x, y: p.y, id: 0 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  await page.waitForTimeout(300);
  const before = await meshStats(page);
  const second = { x: p.x + 50, y: p.y + 20, id: 1 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, { ...second, x: second.x + 20 }] });
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
  assert.ok(Math.abs((await meshStats(page)).center[0] - before.center[0]) < .03, 'Extra finger does not move the anchor');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [first] });
  for (let i = 1; i <= 8; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, x: first.x + i * 6 }] });
  assert.equal(await page.evaluate(() => scrollY), 0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await restored(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 12, y: 430, id: 2 }] });
  for (let y = 410; y >= 180; y -= 20) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 12, y, id: 2 }] }); await page.waitForTimeout(16); }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => scrollY > 40);
  await session.detach(); await page.close();
});

test('减少动态仍有局部反馈，偏好可在按住期间切换并恢复', async () => {
  const page = await open({ reducedMotion: 'reduce' });
  await press(page); await page.waitForTimeout(400);
  assert.ok((await meshStats(page)).maximum > .2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.up(); await restored(page);
  assert.equal((await meshStats(page)).contexts, 1);
  await page.close();
});
