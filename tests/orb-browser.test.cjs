const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4186';
const path = '/squishy/cloud/';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4186' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const ready = p => p.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');

async function instrument(page) {
  await page.addInitScript(() => {
    window.orbProbe = { contexts: [], frames: 0 };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const result = getContext.call(this, type, ...args);
      if (type === 'webgl2' && result && !window.orbProbe.contexts.includes(result)) window.orbProbe.contexts.push(result);
      return result;
    };
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => request(time => { window.orbProbe.frames++; callback(time); });
  });
}

test('实际静态根返回 GLB 字节与 MIME，不误用 Next public 路径', async () => {
  const response = await fetch(base + '/assets/models/squishy-orb.glb');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync('assets/models/squishy-orb.glb'));
  assert.equal((await fetch(base + '/models/squishy-orb.glb')).status, 404);
});

test('配置、主题、旋转复用真实 WebGL 场景；静止及后台不持续渲染；离页释放', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await instrument(page);
  let loads = 0;
  page.on('request', request => { if (request.url().includes('squishy-orb.glb')) loads++; });
  await page.goto(base + path); await ready(page);
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  const settledFrames = await page.evaluate(() => window.orbProbe.frames);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.orbProbe.frames), settledFrames, 'No idle animation loop');
  for (const index of [1, 4, 7, 2, 9, 0]) await page.locator('[name=color]').nth(index).check();
  await page.evaluate(() => document.documentElement.dataset.theme = 'night');
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
  assert.equal(await page.evaluate(() => window.orbProbe.contexts.length), 1);
  assert.equal(loads, 1);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.evaluate(() => document.documentElement.dataset.theme = 'day');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(before => Number(document.querySelector('.toy-mount').dataset.renderCount) > Number(before), count);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.locator('.toy-mount canvas').count(), 0);
  await page.waitForFunction(() => window.orbProbe.contexts.every(context => context.isContextLost()));
  const disposedFrames = await page.evaluate(() => window.orbProbe.frames);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'night';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.orbProbe.frames), disposedFrames, 'Observers and pending frames removed');
  for (let i = 0; i < 3; i++) {
    await page.goto(base + '/collections/');
    await page.getByRole('link', { name: '体验圆球捏压原型' }).click(); await ready(page);
    assert.equal(await page.locator('.toy-mount canvas').count(), 1);
    assert.equal(await page.evaluate(() => window.orbProbe.contexts.length), 1);
  }
  await page.close();
});

test('真实上下文丢失可重试重建，控件与导航在中断后可用', async () => {
  const page = await browser.newPage(); await instrument(page);
  await page.goto(base + path); await ready(page);
  await page.evaluate(() => window.orbProbe.contexts[0].getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('[data-state=unavailable]');
  await page.locator('[name=color]').nth(3).check();
  // A configuration change is allowed to recover the unavailable renderer.
  await ready(page);
  await page.evaluate(() => window.orbProbe.contexts.at(-1).getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('[data-state=unavailable]');
  await page.getByRole('button', { name: '重新加载' }).click(); await ready(page);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-color'), await page.locator('[name=color]').nth(3).inputValue());
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  assert.equal(await page.getByRole('link', { name: '返回合集' }).isVisible(), true);
  await page.close();
});

test('HTML 伪模型及引擎包失败不会锁住页面，两者均可真实重试', async () => {
  const invalid = await browser.newPage();
  await invalid.route('**/squishy-orb.glb', route => route.fulfill({ contentType: 'text/html', body: '<html>fallback</html>' }));
  await invalid.goto(base + path); await invalid.waitForSelector('[data-state=error]');
  await invalid.unroute('**/squishy-orb.glb');
  await invalid.locator('.retry-button').click(); await ready(invalid); await invalid.close();
  const bundle = await browser.newPage();
  await bundle.route('**/orb-preview.js*', route => route.abort());
  await bundle.goto(base + path); await bundle.waitForSelector('[data-state=error]');
  await bundle.locator('[name=color]').nth(2).check();
  assert.equal(await bundle.locator('[name=color]').nth(2).isChecked(), true);
  assert.equal(await bundle.getByRole('link', { name: '返回合集' }).isVisible(), true);
  await bundle.unroute('**/orb-preview.js*');
  await bundle.locator('.retry-button').click(); await ready(bundle); await bundle.close();
});

test('手机单屏中留白触摸不引发滚页，颜色仍可直接点击', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await page.goto(base + path); await ready(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 20, y: 420 }] });
  for (let y = 400; y >= 180; y -= 20) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y }] });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
  assert.equal(await page.locator('.toy-mount canvas').evaluate(el => getComputedStyle(el).touchAction), 'auto');
  await page.locator('[name=color]').nth(3).check();
  assert.equal(await page.locator('[name=color]').nth(3).isChecked(), true);
  await session.detach(); await page.close();
});
