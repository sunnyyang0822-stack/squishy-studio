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

test('大厅真实制作中入口、详情直达、刷新和返回合集', async () => {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/collections/`);
  assert.equal(await page.getByText('制作中', { exact: true }).isVisible(), true);
  await page.getByRole('link', { name: '体验圆球捏压原型' }).click(); await ready(page);
  assert.equal(page.url(), `${base}${path}`);
  await page.reload(); await ready(page);
  assert.equal(await page.getByText('捏压原型', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('.preview-note').count(), 0);
  assert.ok(await page.locator('.configuration-note').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 12);
  assert.match(await page.locator('.configuration-note').innerText(), /仅记录偏好/);
  assert.equal(await page.locator('.configuration-summary').evaluate(el => el.getBoundingClientRect().width), 1, '配置摘要仅供辅助技术读取，不显示底部小字');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  assert.equal(await page.locator('audio').count(), 0);
  await page.getByRole('link', { name: '返回合集' }).click(); assert.equal(page.url(), `${base}/collections/`);
  await page.goto(`${base}/squishy/cloud`); await ready(page); assert.equal(page.url(), `${base}${path}`);
  assert.deepEqual(errors, []); await page.close();
});

test('浏览器九种配置、连续选择、键盘单选与清晰反馈', async () => {
  const page = await browser.newPage(); await page.goto(base + path); await ready(page);
  const originalSize = await page.locator('.toy-mount canvas').boundingBox();
  for (const [thickness, name] of [['thin','薄'],['medium','中'],['thick','厚']]) for (const [material, label] of [['wax','蜡'],['polish','指甲油'],['sugar','糖']]) {
    await page.locator(`[name=thickness][value=${thickness}]`).check();
    await page.locator(`[name=material][value=${material}]`).check();
    await page.waitForFunction(({thickness,material}) => document.querySelector('.toy-mount').dataset.thickness === thickness && document.querySelector('.toy-mount').dataset.material === material, { thickness, material });
    assert.equal(await page.locator('.configuration-summary').innerText(), `已选择：${name}厚度 · ${label}`);
    assert.equal(await page.locator('input:checked').count(), 2);
  }
  await page.evaluate(() => { for (const value of ['wax','polish','sugar']) { const input = document.querySelector(`[value=${value}]`); input.checked = true; input.dispatchEvent(new Event('change')); } });
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.material === 'sugar');
  await page.locator('[name=thickness][value=thick]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('[name=thickness][value=medium]').isChecked(), true);
  assert.equal(await page.locator('[name=material][value=sugar]').isChecked(), true);
  assert.deepEqual(await page.locator('.toy-mount canvas').boundingBox(), originalSize, '厚度选择不缩放玩具');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1); await page.close();
});

test('音量面板：键盘滑杆、静音恢复、Esc、关闭、外部焦点', async () => {
  const page = await browser.newPage(); await page.goto(base + path); await ready(page);
  const entry = page.getByRole('button', { name: '音量：已静音，打开调节面板' });
  await entry.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#volume').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#volume').inputValue(), '0');
  await page.getByRole('button', { name: '解除静音', exact: true }).click();
  assert.equal(await page.locator('#volume-value').innerText(), '50%');
  await page.locator('#volume').focus(); await page.keyboard.press('End');
  assert.equal(await page.locator('#volume-value').innerText(), '100%');
  await page.keyboard.press('Home'); assert.equal(await page.getByRole('button', { name: '解除静音', exact: true }).isVisible(), true);
  await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#volume-value').innerText(), '1%');
  const range = await page.locator('#volume').boundingBox();
  await page.mouse.move(range.x + 8, range.y + range.height / 2); await page.mouse.down();
  await page.mouse.move(range.x + range.width * .7, range.y + range.height / 2, { steps: 8 }); await page.mouse.up();
  const dragged = Number(await page.locator('#volume').inputValue()); assert.ok(dragged >= 60 && dragged <= 80);
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await page.getByRole('button', { name: '解除静音', exact: true }).click();
  assert.equal(await page.locator('#volume-value').innerText(), `${dragged}%`);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#sound-panel').isVisible(), false);
  assert.equal(await page.locator('.sound-trigger').evaluate(el => el === document.activeElement), true);
  await page.locator('.sound-trigger').click(); await page.getByRole('button', { name: '关闭音量面板' }).click();
  await page.locator('#sound-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#sound-panel').isVisible(), false);
  await page.locator('.sound-trigger').click(); await page.locator('[value=thin]').click();
  assert.equal(await page.locator('#sound-panel').isVisible(), false);
  assert.equal(await page.locator('[value=thin]').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('audio').count(), 0); await page.close();
});

test('真实模型失败与重试，挂起加载及不可用状态不阻塞控件', async () => {
  const page = await browser.newPage();
  await page.route('**/squishy-orb.glb', route => route.abort());
  await page.goto(base + path); await page.waitForSelector('[data-state=error]');
  await page.locator('[value=sugar]').check();
  assert.match(await page.locator('.configuration-summary').innerText(), /糖/);
  await page.waitForSelector('[data-state=error]');
  await page.unroute('**/squishy-orb.glb'); await page.getByRole('button', { name: '重新加载' }).click(); await ready(page);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-material'), 'sugar');
  await page.close();
  const pending = await browser.newPage(); let release;
  await pending.route('**/squishy-orb.glb', async route => { await new Promise(resolve => release = resolve); await route.continue().catch(() => {}); });
  await pending.goto(base + path, { waitUntil: 'domcontentloaded' });
  await pending.waitForSelector('[data-state=loading]');
  assert.equal(await pending.locator('.toy-stage').getAttribute('aria-busy'), 'true');
  await pending.locator('.sound-trigger').click(); await pending.getByRole('button', { name: '解除静音', exact: true }).click();
  assert.equal(await pending.locator('#volume-value').innerText(), '50%');
  release(); await ready(pending); await pending.close();
  const unavailable = await browser.newPage();
  await unavailable.addInitScript(() => { const getContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : getContext.call(this, type, ...args); }; });
  await unavailable.goto(base + path); await unavailable.waitForSelector('[data-state=unavailable]');
  await unavailable.locator('[value=thick]').check();
  assert.match(await unavailable.locator('.configuration-summary').innerText(), /厚厚度/);
  assert.equal(await unavailable.getByRole('link', { name: '返回合集' }).isVisible(), true);
  await unavailable.close();
});

test('五种尺寸昼夜、触控目标、面板不遮挡、减少动态与跨页主题', async () => {
  for (const [width,height] of [[1440,900],[390,844],[375,667],[320,568],[844,390]]) {
    const context = await browser.newContext({ viewport: { width,height }, hasTouch: width < 600, reducedMotion: 'reduce' });
    for (const theme of ['day','night']) {
      const page = await context.newPage();
      await page.addInitScript(theme => localStorage.setItem('squishy-studio-theme', theme), theme);
      await page.goto(base + path); await ready(page);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${theme} overflow`);
      for (const item of await page.locator('.detail-back,.sound-trigger,.choice-group input').all()) {
        const box = await item.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
      }
      const toy = await page.locator('.toy-stage').boundingBox(); const settings = await page.locator('.customization').boundingBox();
      const image = await page.locator('.toy-mount canvas').boundingBox();
      assert.ok(image.y >= toy.y && image.y + image.height <= toy.y + toy.height + 1, `${width} image must stay inside its stage`);
      assert.ok(settings.y >= toy.y + toy.height + 35, `${width} settings need breathing room`);
      if (width === 1440) assert.ok(settings.y + settings.height >= height - 40, '桌面设置区位于页面底部');
      const triggerBefore = await page.locator('.sound-trigger').boundingBox();
      await page.locator('.sound-trigger').click();
      assert.deepEqual(await page.locator('.sound-trigger').boundingBox(), triggerBefore, '展开面板不移动音量入口');
      const panel = await page.locator('#sound-panel').boundingBox(); const shownToy = await page.locator('.toy-stage').boundingBox();
      assert.ok(panel.y + panel.height <= shownToy.y || panel.x >= shownToy.x + shownToy.width || panel.x + panel.width <= shownToy.x, `${width} sound overlap`);
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: '返回合集' }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.close();
    }
    await context.close();
  }
});
