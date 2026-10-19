const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const { createHash } = require('node:crypto');

let server;
let browser;
const url = 'http://127.0.0.1:4174';

before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: '4174' } });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined), headless: true });
});

after(async () => { await browser?.close(); server?.kill(); });

test('桌面首屏可读且昼夜切换可连续操作', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('h1').textContent(), 'Squishy Studio');
  await page.locator('.brand-stage.is-3d-ready').waitFor();
  assert.equal(await page.locator('.brand-canvas').evaluate(el => !!el.getContext('webgl2')), true);
  assert.equal(await page.locator('.brand-face').first().evaluate(el => getComputedStyle(el).stroke), 'none');
  assert.equal(await page.locator('.brand-depth-mid').count(), 2);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'day');
  const firstSwitch = await page.evaluate(() => {
    const scene = document.querySelector('.scene');
    const before = Number(getComputedStyle(scene, '::before').opacity);
    document.querySelector('.theme-toggle').click();
    return { before, after: Number(getComputedStyle(scene, '::before').opacity), transitioning: scene.classList.contains('is-transitioning') };
  });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.equal(firstSwitch.transitioning, true);
  assert.equal(await page.locator('.theme-toggle__label').textContent(), '夜晚');
  assert.ok(Math.abs(firstSwitch.after - firstSwitch.before) < .05, '切换开始时背景亮度不跳变');
  await page.waitForTimeout(180);
  const { beforeReverse, afterReverse } = await page.evaluate(() => {
    const scene = document.querySelector('.scene');
    const before = Number(getComputedStyle(scene, '::before').opacity);
    document.querySelector('.theme-toggle').click();
    return { beforeReverse: before, afterReverse: Number(getComputedStyle(scene, '::before').opacity) };
  });
  assert.ok(Math.abs(afterReverse - beforeReverse) < .05, `反向切换不应重置亮度：${beforeReverse} → ${afterReverse}`);
  await page.getByRole('button', { name: '切换到夜晚' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.equal(await page.locator('.theme-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
});

test('夜间切回白天时文字快速清晰，连续切换不会重置颜色', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(url);
    await page.locator('.brand-stage.is-3d-ready').waitFor();
    await page.getByRole('button', { name: '切换到夜晚' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-note')).color === 'rgb(230, 198, 231)', null, { timeout: 15000 });
    await page.getByRole('button', { name: '切换到白天' }).click();
    const styles = await page.evaluate(() => ['.eyebrow', '.hero-line', '.hero-note', '.studio-mark', '.scene-footer', '.theme-toggle__label'].map(selector => {
      const css = getComputedStyle(document.querySelector(selector));
      return { shadow: css.textShadow, filter: css.filter, property: css.transitionProperty, duration: css.transitionDuration, opacity: css.opacity };
    }));
    for (const css of styles) assert.deepEqual(css, { shadow: 'none', filter: 'none', property: 'color', duration: '0.42s', opacity: '1' });
    await page.waitForTimeout(100);
    const reverse = await page.evaluate(() => {
      const note = document.querySelector('.hero-note');
      const before = getComputedStyle(note).color;
      document.querySelector('.theme-toggle').click();
      return { before, after: getComputedStyle(note).color, shadow: getComputedStyle(note).textShadow };
    });
    assert.equal(reverse.after, reverse.before);
    assert.equal(reverse.shadow, 'none');
    await page.getByRole('button', { name: '切换到白天' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-note')).color === 'rgb(129, 92, 118)', null, { timeout: 15000 });
    await page.close();
  }
});

test('字标与主题逻辑保留用户确认的 5b5e8c7 版本', () => {
  const approved = {
    'src/brand3d.js': '2cd86dc6938f0bd76fc5b7a4071c43924bbdaff35af0eadb635df7817e868e24',
    'main.js': '83487c120bdc19ab9513ebcd344338b9b48d387f9bb8591ef065402e9928c740',
  };
  for (const [path, expected] of Object.entries(approved)) {
    const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, `${path} 应与确认版完全一致`);
  }
});

test('昼夜开关显示云朵与星星，太阳连续变成月牙且反向操作不跳变', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.locator('.brand-stage.is-3d-ready').waitFor();
  const control = page.locator('.theme-toggle');
  const dayBox = await control.boundingBox();
  assert.equal(await page.locator('.theme-toggle__cloud').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('.theme-toggle__star').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.equal(await page.locator('.theme-toggle__thumb circle[mask]').getAttribute('mask'), 'url(#theme-moon-cutout)');
  assert.equal(await page.locator('.theme-toggle__cutout').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41), 0);
  await control.click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.theme-toggle__star')).opacity === '1'
    && new DOMMatrix(getComputedStyle(document.querySelector('.theme-toggle__cutout')).transform).m41 === -20
    && getComputedStyle(document.querySelector('.theme-toggle__track')).getPropertyValue('--toggle-track-a').trim() === 'rgb(46, 41, 95)', null, { timeout: 15000 });
  assert.equal(await page.locator('.theme-toggle__cloud').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.equal(await page.locator('.theme-toggle__thumb').evaluate(el => getComputedStyle(el).filter), 'none');
  assert.equal(await page.locator('.theme-toggle__star').evaluate(el => getComputedStyle(el).color), 'rgb(168, 244, 244)');
  assert.equal(await page.locator('.theme-toggle__star').evaluate(el => getComputedStyle(el).filter), 'none');
  assert.deepEqual(await control.boundingBox(), dayBox);
  await control.click();
  await page.waitForTimeout(120);
  const reverse = await page.evaluate(() => {
    const cutout = document.querySelector('.theme-toggle__cutout');
    const before = new DOMMatrix(getComputedStyle(cutout).transform).m41;
    document.querySelector('.theme-toggle').click();
    return { before, after: new DOMMatrix(getComputedStyle(cutout).transform).m41 };
  });
  assert.ok(Math.abs(reverse.after - reverse.before) < .05, '月牙反向过渡应从当前形状继续');
  await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('.theme-toggle__cutout')).transform).m41 === -20, null, { timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await control.boundingBox();
  assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390);
  assert.equal(await control.getAttribute('aria-pressed'), 'true');
  await page.close();
});

test('手机和短屏仍能看到主体与切换控件', async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport, isMobile: true, deviceScaleFactor: 1 });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.brand-stage.is-3d-ready').waitFor();
    const result = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return { brand: box('.brand-stage').toJSON(), letters: [...document.querySelectorAll('.brand-face')].map(el => el.getBoundingClientRect().toJSON()), toggle: box('.theme-toggle').toJSON(), note: box('.hero-note').toJSON(), width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.ok(result.brand.left >= -16 && result.brand.right <= result.width + 16, JSON.stringify(result));
    assert.ok(result.letters.every(rect => rect.left >= 0 && rect.right <= result.width), JSON.stringify(result));
    assert.ok(result.toggle.top >= 0 && result.toggle.right <= result.width, JSON.stringify(result));
    assert.ok(result.note.bottom <= result.height, JSON.stringify(result));
    assert.ok(result.scrollWidth <= result.width, JSON.stringify(result));
    await page.close();
  }
});

test('减少动态效果时仍能切换', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(url);
  await page.getByRole('button', { name: '切换到夜晚' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  const duration = await page.locator('.scene').evaluate(el => getComputedStyle(el).transitionDuration);
  assert.match(duration, /0\.18s/);
  for (const selector of ['.theme-toggle__thumb', '.theme-toggle__cutout', '.theme-toggle__cloud', '.theme-toggle__star']) {
    assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).transitionDuration), /0\.18s/);
  }
  await page.close();
});

test('WebGL 不可用时保留可读的备用字标', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto(url);
  assert.equal(await page.locator('.brand-stage').evaluate(el => el.classList.contains('is-3d-ready')), false);
  assert.equal(await page.locator('.brand-fallback').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('h1').textContent(), 'Squishy Studio');
  await page.close();
});
