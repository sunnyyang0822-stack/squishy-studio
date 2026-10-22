const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4205';
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4205' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(options = {}, probeOptions = {}) {
  const page = await browser.newPage(options); await installOrbProbe(page, probeOptions);
  await page.goto(base + '/squishy/cloud/');
  await page.waitForSelector('.toy-stage[data-state=ready] canvas');
  await page.locator('[name=coreMaterial][value=butter]').check();
  await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
  await page.waitForFunction(() => window.orbMeshProbe.positions);
  return page;
}
async function point(page, x = .5, y = .5) {
  const b = await page.locator('.orb-input').boundingBox(); return { x: b.x + b.width * x, y: b.y + b.height * y };
}
async function press(page, ms = 700) { const p = await point(page); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); }
async function recovered(page) {
  await page.waitForFunction(() => {
    const p = window.orbMeshProbe; return p.positions?.every((v, i) => v === p.rest[i]);
  }, null, { timeout: 18000, polling: 100 });
  const count = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.waitForTimeout(200); assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count);
  assert.equal((await meshStats(page)).maximum, 0);
}

test('慢回弹真实鼠标渐进下陷、自然完整恢复停帧；默认黏土仍留痕且切页实例隔离', async () => {
  const page = await open({ viewport: { width: 1440, height: 900 } }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await press(page, 120); const early = (await meshStats(page)).maximum;
  assert.ok(early > .002 && early < .06);
  await page.waitForTimeout(1800); const held = (await meshStats(page)).maximum;
  assert.ok(held > early * 3 && held < .34);
  await page.mouse.up(); await page.waitForTimeout(300);
  assert.ok((await meshStats(page)).maximum > held * .55);
  await recovered(page);
  await page.locator('[name=coreMaterial][value=clay]').check(); await page.waitForSelector('.toy-mount[data-feel-id=clay][data-render-count] canvas');
  await press(page, 1000); await page.mouse.up(); await page.waitForTimeout(1800);
  assert.ok((await meshStats(page)).maximum > .07);
  await page.locator('[name=coreMaterial][value=butter]').check(); await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
  assert.equal((await meshStats(page)).maximum, 0);
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts.filter(gl => !gl.isContextLost()).length), 1);
  for (let i = 0; i < 4; i++) await page.locator('.step-next').click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'play');
  assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'slow-rebound');
  await press(page, 1000); await page.mouse.up(); await recovered(page);
  assert.deepEqual(errors, []); await page.close();
});

test('新质感沿用换色时钟与姿态恢复；颜色恢复中输入接管后全网格自然归零', async () => {
  const page = await open(); await press(page, 1500); await page.mouse.up();
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  await page.locator('[name=color]').nth(4).check(); await page.waitForTimeout(110);
  assert.ok((await meshStats(page)).maximum > .005);
  await press(page, 1000); await page.mouse.up();
  assert.ok((await meshStats(page)).maximum > .04);
  await recovered(page);
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
  assert.equal((await meshStats(page)).contexts, 2);
  await press(page, 1000); await page.mouse.up(); await page.locator('[name=color]').nth(7).check();
  await page.waitForTimeout(1000); assert.equal((await meshStats(page)).maximum, 0);
  assert.match(await page.locator('canvas').getAttribute('aria-label'), /完整回弹/);
  await page.close();
});

test('pointercancel、失焦、后台结束施力；后台暂停且前台连续恢复，离页释放', async () => {
  const page = await open(); await press(page, 700);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false'); await page.mouse.up();
  const canceled = (await meshStats(page)).maximum; await page.waitForTimeout(300);
  assert.ok((await meshStats(page)).maximum < canceled);
  await press(page, 500); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
  await press(page, 500);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const snapshot = await page.evaluate(() => Array.from(window.orbMeshProbe.positions));
  const count = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count);
  assert.deepEqual(await page.evaluate(() => Array.from(window.orbMeshProbe.positions)), snapshot);
  await page.mouse.up();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(100);
  const delta = await page.evaluate(before => Math.max(...window.orbMeshProbe.positions.map((v, i) => Math.abs(v - before[i]))), snapshot);
  assert.ok(delta > 0 && delta < .04, `Foreground has no hidden-time jump: ${delta}`);
  await recovered(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.locator('.toy-mount canvas').count(), 0);
  await page.waitForFunction(() => window.orbMeshProbe.contexts.every(gl => gl.isContextLost()));
  await page.close();
});

test('手机CDP原生触摸驻留滑动与昼夜外观；减少动态后恢复加速，色卡和页面可用', async () => {
  const page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await page.context().newCDPSession(page), a = await point(page, .28), b = await point(page, .72);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await page.waitForTimeout(1500);
  for (let i = 1; i <= 15; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 15, y: a.y }] }); await page.waitForTimeout(25);
  }
  await page.waitForTimeout(1200); await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await meshStats(page)).maximum > .08); assert.equal(await page.evaluate(() => scrollY), 0);
  await page.evaluate(() => document.documentElement.dataset.theme = 'night');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await recovered(page);
  await page.locator('[data-category=coreColor]').click();
  await page.locator('[name=color]').nth(3).check(); await page.waitForTimeout(250);
  assert.equal(await page.locator('[name=color]').nth(3).isChecked(), true);
  await client.detach(); await page.close();
});

test('连续切换质感最后选择生效；棉花糖继续clay且所有旧上下文释放', async () => {
  const page = await open();
  for (const material of ['clay', 'butter', 'marshmallow', 'butter']) await page.locator(`[name=coreMaterial][value=${material}]`).check();
  await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
  await page.waitForFunction(() => window.orbMeshProbe.contexts.filter(gl => !gl.isContextLost()).length === 1);
  assert.equal((await meshStats(page)).maximum, 0);
  await page.locator('[name=coreMaterial][value=marshmallow]').check();
  await page.waitForSelector('.toy-mount[data-feel-id=clay][data-render-count] canvas');
  assert.equal(await page.locator('[name=coreMaterial][value=marshmallow]').isChecked(), true);
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  await page.close();
});

test('厚实体型真实GPU矩阵生效；十色在昼夜统一小幅加深，黏土与棉花糖保持原外观', async () => {
  const page = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, { pixels: true });
  const { orbColors } = await import('../detail/orb-colors.mjs');
  async function idle() {
    await page.evaluate(() => { window.appearanceIdle = { draws: -1, at: performance.now() }; });
    await page.waitForFunction(() => {
      const sample = window.appearanceIdle, draws = window.orbMeshProbe.orbDraws;
      if (sample.draws !== draws) { sample.draws = draws; sample.at = performance.now(); }
      return performance.now() - sample.at >= 220;
    });
  }
  const sample = async () => {
    await idle(); return page.evaluate(() => window.orbMeshProbe.pixelFrames.at(-1));
  };
  const scaled = await sample();
  for (const [k, expected] of [1, 1.06, 1.10].entries()) assert.ok(Math.abs(Math.hypot(...scaled.matrix.slice(k * 4, k * 4 + 3)) - expected) < 1e-5);
  for (const theme of ['day', 'night']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const standard = new Map();
    await page.locator('[name=coreMaterial][value=clay]').check();
    await page.waitForSelector('.toy-mount[data-appearance-id=matte][data-render-count] canvas');
    for (const color of orbColors) {
      await page.locator(`[name=color][value=${color.id}]`).check(); standard.set(color.id, await sample());
    }
    await page.locator('[name=coreMaterial][value=butter]').check();
    await page.waitForSelector('.toy-mount[data-appearance-id="full-matte"][data-render-count] canvas');
    for (const color of orbColors) {
      await page.locator(`[name=color][value=${color.id}]`).check(); const full = await sample(), base = standard.get(color.id);
      assert.ok(Math.abs(full.pigmentTotal / base.pigmentTotal - .94) < .000001, `${theme}/${color.id} pigment gain`);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(full.hue[k] - base.hue[k]) < .000001, 'Deepening preserves hue');
    }
    await page.locator('[name=coreMaterial][value=marshmallow]').check();
    await page.waitForSelector('.toy-mount[data-appearance-id=matte][data-render-count] canvas');
    const marshmallow = await sample(), base = standard.get('cream');
    assert.ok(Math.abs(marshmallow.pigmentTotal - base.pigmentTotal) < .001);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(Math.hypot(...marshmallow.matrix.slice(k * 4, k * 4 + 3)) - 1) < 1e-5);
  }
  await page.close();
});
