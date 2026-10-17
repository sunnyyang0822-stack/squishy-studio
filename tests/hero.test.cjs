const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { chromium } = require('playwright');

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
  const toggle = page.getByRole('button', { name: '切换到夜晚' });
  await toggle.click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#17243d');
  assert.equal(await page.locator('.scene').evaluate(el => el.classList.contains('is-transitioning')), true);
  assert.equal(await page.locator('.theme-toggle__label').textContent(), '夜晚');
  const midOpacity = await page.locator('.scene').evaluate(el => Number(getComputedStyle(el, '::before').opacity));
  assert.ok(midOpacity < 1, `背景应连续过渡，得到 ${midOpacity}`);
  assert.equal(await page.locator('.hero-note').evaluate(el => getComputedStyle(el).textShadow), 'none');
  await page.waitForTimeout(180);
  const { beforeReverse, afterReverse } = await page.evaluate(() => {
    const scene = document.querySelector('.scene');
    const before = Number(getComputedStyle(scene, '::before').opacity);
    document.querySelector('.theme-toggle').click();
    return { beforeReverse: before, afterReverse: Number(getComputedStyle(scene, '::before').opacity) };
  });
  assert.ok(Math.abs(afterReverse - beforeReverse) < .05, `反向切换不应重置亮度：${beforeReverse} → ${afterReverse}`);
  assert.equal(await page.locator('.hero-note').evaluate(el => getComputedStyle(el).textShadow), 'none');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.hero-note').evaluate(el => getComputedStyle(el).color), 'rgb(129, 92, 118)');
  await page.getByRole('button', { name: '切换到夜晚' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.equal(await page.locator('.theme-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
});

test('品牌曲面细分更平滑，交叠更轻，保留磨砂层次', () => {
  const source = readFileSync('src/brand3d.js', 'utf8');
  assert.match(source, /new TextGeometry\(char/);
  assert.match(source, /curveSegments: 36/);
  assert.match(source, /bevelEnabled: true, bevelThickness: \.22, bevelSize: \.125, bevelSegments: 16/);
  assert.doesNotMatch(source, /TubeGeometry/);
  assert.match(source, /letter\.position\.set\(cursor, 0, 0\)/);
  assert.doesNotMatch(source, /letter\.rotation\.y/);
  assert.match(source, /color: 0xe3297f, roughness: \.49, metalness: 0, clearcoat: \.5/);
  assert.match(source, /color: 0x9f2b65, roughness: \.56, metalness: 0, clearcoat: \.25/);
  const saturation = hex => {
    const channels = [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    return Math.max(...channels) - Math.min(...channels);
  };
  assert.ok(saturation(0xe3297f) < saturation(0xf72489));
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
