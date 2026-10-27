const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats, settled } = require('./helpers/orb-probe.cjs');
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
  if (await page.locator('[data-category=coreColor]').isVisible()) await page.locator('[data-category=coreColor]').click();
  return page;
}
async function point(page, x = .5, y = .5) {
  const box = await page.locator('.orb-input').boundingBox();
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}
async function press(page, x = .5, y = .5) {
  const baseline = await page.evaluate(() => Array.from(window.orbMeshProbe.positions));
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForFunction(baseline => window.orbMeshProbe.positions.some((v, i) => Math.abs(v - baseline[i]) > .025), baseline);
  return p;
}
async function restored(page) {
  await settled(page);
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
}
async function positions(page) { return page.evaluate(() => Array.from(window.orbMeshProbe.positions)); }
async function pristine(page) { assert.equal((await meshStats(page)).maximum, 0); }

test('真实 GPU 顶点：左、右、上命中局部凹陷，远侧不缩放；按住时长增强并有界', async () => {
  const page = await open({ viewport: { width: 1440, height: 900 } });
  for (const [x, y, axis, sign] of [[.27,.5,0,-1],[.73,.5,0,1],[.5,.25,1,1]]) {
    const baseline = await positions(page);
    await press(page, x, y);
    // Measure only after held strength saturates and real GPU position uploads
    // stop. Otherwise work between this snapshot and native pointerup can
    // increase the press and make its retained/earlier-depth ratio misleading.
    await page.waitForTimeout(2800);
    await page.evaluate(() => { window.orbHeldSample = { uploads: -1, stableAt: performance.now() }; });
    await page.waitForFunction(() => {
      const probe = window.orbMeshProbe, sample = window.orbHeldSample;
      if (document.querySelector('.orb-input').getAttribute('aria-pressed') !== 'true') return false;
      if (sample.uploads !== probe.uploads) { sample.uploads = probe.uploads; sample.stableAt = performance.now(); }
      return performance.now() - sample.stableAt >= 180;
    });
    const stats = await meshStats(page, baseline);
    assert.ok(stats.maximum > .30 && stats.maximum < .65, JSON.stringify(stats));
    assert.ok(stats.changed > 100 && stats.changed < 700, 'Local neighborhood, not whole-object scaling');
    assert.ok(stats.center[axis] * sign > .25, JSON.stringify(stats));
    assert.ok(await page.evaluate(() => {
      const p = window.orbMeshProbe;
      return p.rest.every((v, i) => p.rest[Math.floor(i / 3) * 3 + 2] >= -.5 || v === p.positions[i]);
    }), 'Back surface stays unchanged');
    const held = await positions(page);
    await page.mouse.up(); await restored(page);
    const retained = await meshStats(page, baseline);
    assert.ok(retained.maximum > .03 && retained.maximum > stats.maximum * .84 && retained.maximum < stats.maximum * .86, JSON.stringify({ pressed: stats.maximum, retained: retained.maximum, ratio: retained.maximum / stats.maximum }));
    assert.notDeepEqual(await positions(page), held);
  }
  await page.locator('[name=color]').nth(4).check(); await restored(page); await pristine(page);
  await press(page); const early = await meshStats(page);
  await page.waitForTimeout(2700); const held = await meshStats(page);
  assert.ok(held.maximum > early.maximum && held.maximum < .90);
  await page.mouse.up(); await restored(page);
  const frame = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), frame, 'Sleep after the spring settles');
  assert.ok((await meshStats(page)).maximum > .03, 'Settling retains visible deformation');
  const stable = await positions(page); await page.waitForTimeout(250); assert.deepEqual(await positions(page), stable);
  await page.close();
});

test('连续拖动、回弹中再次按压、移出松开和键盘操作；缩放主题不重建控制', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  await press(page, .27, .45); await page.waitForTimeout(300);
  let previous = (await meshStats(page)).center[0];
  const firstCenter = previous;
  for (const fraction of [.4, .5, .6, .73]) {
    const p = await point(page, fraction, .45); await page.mouse.move(p.x, p.y, { steps: 4 }); await page.waitForTimeout(80);
    const current = (await meshStats(page)).center[0];
    assert.ok(current >= previous - .02 && current - previous < .4, 'Continuous following'); previous = current;
  }
  assert.ok(previous > firstCenter + .12, 'The continuous stroke extends toward the dragged side');
  const trail = await page.evaluate(() => {
    const probe = window.orbMeshProbe;
    return [-.35, 0, .35].map(x => {
      let depth = 0;
      for (let i = 0; i < probe.rest.length; i += 3) if (Math.abs(probe.rest[i] - x) < .14 && probe.rest[i + 2] > .65) {
        depth = Math.max(depth, Math.hypot(...[0, 1, 2].map(k => probe.positions[i + k] - probe.rest[i + k])));
      }
      return depth;
    });
  });
  assert.ok(trail.every(depth => depth > .05), 'The entire traversed left/center/right path remains deformed: ' + JSON.stringify(trail));
  const chosenColor = await page.locator('[name=color]').nth(3).inputValue();
  await page.locator('[name=color]').nth(3).evaluate(el => el.click());
  await page.waitForFunction(value => document.querySelector('.toy-mount').dataset.color === value, chosenColor);
  await page.waitForFunction(() => window.orbMeshProbe.positions.every((value, index) => value === window.orbMeshProbe.rest[index]));
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false', 'A different color cancels the captured gesture and resets dents');
  await page.mouse.up();
  await press(page);
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

test('pointercancel、丢失捕获、窗口失焦、后台和离页均释放输入并保留已完成凹痕', async () => {
  const page = await open();
  await press(page, .3, .4); await page.waitForTimeout(400); await page.mouse.up(); await settled(page);
  const retained = await positions(page);
  assert.ok((await meshStats(page)).maximum > .02);
  for (const kind of ['cancel', 'capture', 'blur', 'hidden']) {
    await press(page); await page.waitForTimeout(100);
    if (kind === 'capture') {
      // Activate pending pointer capture before deliberately losing it.
      const p = await point(page); await page.mouse.move(p.x + 2, p.y);
    }
    await page.evaluate(kind => {
      if (kind === 'cancel') window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      if (kind === 'capture') document.querySelector('.orb-input').releasePointerCapture(1);
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      if (kind === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, kind);
    if (kind === 'capture') {
      // The platform processes pending capture changes on the next pointer event.
      const p = await point(page); await page.mouse.move(p.x, p.y);
      await page.waitForFunction(() => document.querySelector('.orb-input').getAttribute('aria-pressed') === 'false');
    }
    await page.mouse.up();
    if (kind === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await restored(page);
    assert.deepEqual(await positions(page), retained, kind + ' preserves prior dents and discards transient input');
  }
  await press(page);
  await page.getByRole('link', { name: '返回合集' }).evaluate(el => el.click());
  await page.waitForURL('**/collections/');
  await page.goBack(); await page.waitForFunction(() => window.orbMeshProbe?.positions);
  await restored(page); await pristine(page);
  await press(page);
  await page.evaluate(() => window.orbMeshProbe.contexts.at(-1).getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('[data-state=unavailable]');
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.waitForSelector('.toy-mount[data-render-count] .orb-input'); await restored(page); await pristine(page);
  await page.close();
});

test('真实模拟触摸：圆球拖动不滚页，第二触点不夺取输入，设置面板可滚动', async () => {
  const page = await open({ viewport: { width: 390, height: 450 }, isMobile: true, hasTouch: true });
  const session = await page.context().newCDPSession(page);
  const p = await point(page, .4, .45);
  const scrollBeforeToy = await page.evaluate(() => scrollY);
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
  assert.equal(await page.evaluate(() => scrollY), scrollBeforeToy);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await restored(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const blank = await page.locator('.toy-stage').boundingBox();
  const scrollBeforeBlank = await page.evaluate(() => scrollY);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: blank.x + 6, y: blank.y + blank.height / 2, id: 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(() => scrollY), scrollBeforeBlank);
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(before => scrollY > before, scrollBeforeBlank);
  await session.detach(); await page.close();
});

test('减少动态仍有局部反馈，偏好可在按住期间切换并恢复', async () => {
  const page = await open({ reducedMotion: 'reduce' });
  await press(page); await page.waitForTimeout(1200);
  assert.ok((await meshStats(page)).maximum > .15);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.up(); await restored(page);
  assert.ok((await meshStats(page)).maximum > .03);
  assert.equal((await meshStats(page)).contexts, 1);
  await page.close();
});


test('轻点明显浅于长按；真实GPU长按和重复按压可以超过旧0.30硬上限', async () => {
  const page = await open();
  const p = await point(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up(); await restored(page);
  const tap = (await meshStats(page)).maximum;
  assert.ok(tap < .08, 'A light click stays shallow: ' + tap);
  await page.locator('[name=color]').nth(1).check(); await restored(page); await pristine(page);
  await press(page); await page.waitForTimeout(3200); await page.mouse.up(); await restored(page);
  const long = (await meshStats(page)).maximum;
  assert.ok(long > .30 && long > tap * 3, JSON.stringify({ tap, long }));
  await press(page); await page.waitForTimeout(3200); await page.mouse.up(); await restored(page);
  const repeated = (await meshStats(page)).maximum;
  assert.ok(repeated > long + .08 && repeated < .95, JSON.stringify({ long, repeated }));
  assert.ok(await page.evaluate(() => {
    const probe = window.orbMeshProbe;
    return probe.positions.every(Number.isFinite);
  }), 'Large deformation remains finite');
  await page.close();
});
