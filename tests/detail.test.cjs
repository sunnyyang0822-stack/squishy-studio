const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4180';
const path = '/squishy/cloud/';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4180' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const ready = page => page.waitForSelector('.toy-stage[data-state="ready"]');

test('详情直达、刷新、导航、十色界面与旧控件移除', async () => {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/collections/`);
  await page.getByRole('link', { name: '体验圆球捏压原型' }).click(); await ready(page);
  assert.equal(page.url(), `${base}${path}`);
  await page.reload(); await ready(page);
  assert.equal(await page.getByText('捏压原型', { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('group', { name: '挑个喜欢的颜色' }).count(), 1);
  assert.equal(await page.locator('input[type=radio][name=color]').count(), 10);
  assert.equal(await page.locator('[name=thickness],[name=material],.sound-tool,#volume,audio').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /脆皮厚度|脆皮材质|音量|静音|仅记录偏好/);
  assert.equal(await page.locator('.configuration-summary').evaluate(el => el.getBoundingClientRect().width), 1);
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  await page.getByRole('link', { name: 'Squishy Studio', exact: true }).click(); assert.equal(page.url(), `${base}/`);
  await page.goto(`${base}/squishy/cloud`); await ready(page); assert.equal(page.url(), `${base}${path}`);
  await page.getByRole('link', { name: '返回合集' }).click(); assert.equal(page.url(), `${base}/collections/`);
  assert.deepEqual(errors, []); await page.close();
});

test('十色逐项应用、快速连续选择、原生键盘选择与稳定画布', async () => {
  const { orbColors } = await import('../detail/orb-colors.mjs');
  const page = await browser.newPage(); await page.goto(base + path); await ready(page);
  const originalSize = await page.locator('.toy-mount canvas').boundingBox();
  for (const { id, name } of orbColors) {
    await page.getByRole('radio', { name, exact: true }).check();
    await page.waitForFunction(id => document.querySelector('.toy-mount').dataset.color === id, id);
    assert.equal(await page.locator('.configuration-summary').innerText(), `已选择：${name}`);
    assert.equal(await page.locator('input:checked').count(), 1);
  }
  await page.evaluate(() => { for (const value of ['rose','mint','sky']) { const input = document.querySelector(`[value=${value}]`); input.checked = true; input.dispatchEvent(new Event('change')); } });
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.color === 'sky');
  await page.locator('[value=sky]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('[value=aqua]').isChecked(), true);
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.color === 'aqua');
  assert.equal(await page.locator('[value=aqua]').evaluate(el => el.matches(':focus-visible')), true);
  assert.deepEqual(await page.locator('.toy-mount canvas').boundingBox(), originalSize);
  assert.equal(await page.locator('.toy-mount canvas').count(), 1); await page.close();
});

test('模型失败、加载中及WebGL不可用时仍可换色，重试应用最后选择', async () => {
  const page = await browser.newPage();
  await page.route('**/squishy-orb.glb', route => route.abort());
  await page.goto(base + path); await page.waitForSelector('[data-state=error]');
  await page.locator('[value=mint]').check();
  assert.match(await page.locator('.configuration-summary').innerText(), /薄荷绿/);
  await page.waitForSelector('[data-state=error]');
  await page.unroute('**/squishy-orb.glb'); await page.getByRole('button', { name: '重新加载' }).click(); await ready(page);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-color'), 'mint');
  await page.close();
  const pending = await browser.newPage(); let release;
  const gate = new Promise(resolve => release = resolve);
  await pending.route('**/squishy-orb.glb', async route => { await gate; await route.continue().catch(() => {}); });
  await pending.goto(base + path, { waitUntil: 'domcontentloaded' });
  await pending.waitForSelector('[data-state=loading]');
  assert.equal(await pending.locator('.toy-stage').getAttribute('aria-busy'), 'true');
  await pending.locator('[value=sky]').check(); await pending.locator('[value=lemon]').check();
  assert.match(await pending.locator('.configuration-summary').innerText(), /柠檬黄/);
  release(); await ready(pending);
  assert.equal(await pending.locator('.toy-mount').getAttribute('data-color'), 'lemon'); await pending.close();
  const unavailable = await browser.newPage();
  await unavailable.addInitScript(() => { const getContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : getContext.call(this, type, ...args); }; });
  await unavailable.goto(base + path); await unavailable.waitForSelector('[data-state=unavailable]');
  await unavailable.locator('[value=lavender]').check();
  assert.match(await unavailable.locator('.configuration-summary').innerText(), /薰衣紫/);
  assert.equal(await unavailable.getByRole('link', { name: '返回合集' }).isVisible(), true);
  await unavailable.close();
});

test('五种尺寸昼夜单屏：手机5×2、桌面10×1、44px触控与导航主题连续', async () => {
  for (const [width,height] of [[1440,900],[390,844],[375,667],[320,568],[844,390]]) {
    const context = await browser.newContext({ viewport: { width,height }, hasTouch: width < 600, reducedMotion: 'reduce' });
    for (const theme of ['day','night']) {
      const page = await context.newPage();
      await page.addInitScript(theme => localStorage.setItem('squishy-studio-theme', theme), theme);
      await page.goto(base + path); await ready(page);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${theme} overflow`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, `${width}×${height} ${theme} must fit one screen`);
      for (const item of await page.locator('.detail-back,.detail-brand,.color-choice input').all()) {
        const box = await item.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
        assert.ok(box.y >= 0 && box.y + box.height <= height + 1, '所有导航及颜色项都在屏内：' + JSON.stringify(box));
      }
      const toy = await page.locator('.toy-stage').boundingBox(), settings = await page.locator('.customization').boundingBox();
      const image = await page.locator('.toy-mount canvas').boundingBox();
      assert.ok(image.y >= toy.y && image.y + image.height <= toy.y + toy.height + 1);
      assert.ok(settings.y >= toy.y + toy.height + 7, '紧凑单屏仍保留主体与选择区间隔');
      assert.ok(settings.y + settings.height <= height);
      assert.ok(toy.height >= 150, '最短视口仍有清楚可用的主体展示空间');
      const boxes = await page.locator('.color-choice').evaluateAll(items => items.map(el => el.getBoundingClientRect().toJSON()));
      const rows = new Map(); for (const box of boxes) rows.set(box.y, (rows.get(box.y) || 0) + 1);
      assert.deepEqual([...rows.values()], width <= 600 ? [5,5] : [10]);
      await page.getByRole('link', { name: '返回合集' }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.close();
    }
    await context.close();
  }
});

test('动态高度、横竖屏与安全留白变化：页面不滚动、画布复用且颜色不丢失', async () => {
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.goto(base+path); await ready(page);
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  await page.locator('[value=lemon]').check();
  for (const viewport of [{width:390,height:600},{width:390,height:744},{width:844,height:390},{width:390,height:844},{width:320,height:568}]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => {
      const stage = document.querySelector('.toy-stage').getBoundingClientRect();
      const canvas = document.querySelector('.toy-mount canvas');
      return Math.abs(canvas.width/canvas.height-stage.width/stage.height) < .02;
    });
    assert.equal(await canvas.evaluate(el=>el===document.querySelector('.toy-mount canvas')),true);
    assert.equal(await page.locator('[value=lemon]').isChecked(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth),true);
    await page.evaluate(()=>scrollTo(0,1000));
    assert.equal(await page.evaluate(()=>scrollY),0);
  }
  await page.addStyleTag({content:'.detail-topbar{padding-top:32px}.detail-main{padding-bottom:34px}'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight <= innerHeight),true);
  const items = await page.locator('.color-choice').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().toJSON()));
  assert.ok(items.every(box=>box.y>=0 && box.bottom<=568));
  await page.close();
});
