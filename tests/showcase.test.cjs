const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const { createHash } = require('node:crypto');

const base = 'http://127.0.0.1:4176';
let browser;
let server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4176' } });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined), headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

const scrollSamples = async page => {
  await page.evaluate(() => document.getElementById('samples').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => document.fonts.ready);
};

test('原有 Hero 样式文件保持基线原样', () => {
  const css = readFileSync('styles.css', 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(css).digest('hex'), '3b957aaa4eb763352cc8d964fbb6a779b9d7005d0a7f0733831dd296feaa56c4');
});

test('Hero 后通过原生滚动到达四只独立样例和真实大厅链接', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const geometry = await page.evaluate(() => ({ hero: document.querySelector('.scene').getBoundingClientRect().toJSON(), samples: document.getElementById('samples').getBoundingClientRect().toJSON() }));
  assert.equal(geometry.hero.height, 900);
  assert.equal(geometry.samples.top, geometry.hero.bottom);
  assert.equal(await page.locator('canvas').count(), 1);
  await scrollSamples(page);
  assert.ok(await page.evaluate(() => scrollY >= 850));
  assert.equal(await page.getByRole('heading', { name: '先看看，想捏哪一个' }).isVisible(), true);
  assert.equal(await page.locator('.sample').count(), 4);
  for (const sample of await page.locator('.sample').all()) {
    assert.equal(await sample.evaluate(el => el.closest('a,button') === null), true);
    assert.notEqual(await sample.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    assert.equal(await sample.locator('img').getAttribute('loading'), 'lazy');
  }
  const entry = page.getByRole('link', { name: '去合集大厅挑选' });
  assert.equal(await entry.getAttribute('href'), '/collections/');
  await entry.focus();
  assert.equal(await entry.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await Promise.all([page.waitForURL('**/collections/'), page.keyboard.press('Enter')]);
  assert.equal(await page.getByRole('heading', { name: '合集大厅', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.style-card').count(), 8);
  assert.equal(await page.locator('.collection-pending').count(), 0, '按用户要求移除合集制作中占位');
  assert.equal(await page.getByText('柔软的一刻', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button').count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.reload();
  assert.equal(await page.getByRole('heading', { name: '合集大厅', exact: true }).isVisible(), true);
  await page.getByRole('link', { name: '返回首页样例' }).click();
  await page.waitForFunction(() => {
    const samples = document.getElementById('samples');
    return samples && Math.abs(samples.getBoundingClientRect().top) < 5;
  });
  assert.match(page.url(), /\/#samples$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('大厅直接访问、无尾斜线跳转和浏览器返回均有效', async () => {
  const page = await browser.newPage();
  const response = await page.goto(`${base}/collections`);
  assert.equal(response.status(), 200);
  assert.equal(page.url(), `${base}/collections/`);
  await page.goto(base);
  await scrollSamples(page);
  await page.getByRole('link', { name: '去合集大厅挑选' }).click();
  await page.goBack();
  await page.waitForFunction(() => {
    const samples = document.getElementById('samples');
    return samples && Math.abs(samples.getBoundingClientRect().top) < 5;
  });
  assert.equal(await page.getByRole('link', { name: '去合集大厅挑选' }).isVisible(), true);
  await page.close();
});

test('昼夜选择跨导航、刷新和返回保持一致，样例过渡可反向连续操作', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: '切换到夜晚' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('squishy-studio-theme')), 'night');
  await scrollSamples(page);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('samples')).getPropertyValue('--sample-top').trim() === 'rgb(75, 86, 133)', null, { timeout: 15000 });
  assert.equal(await page.locator('.sample-art img').first().evaluate(el => getComputedStyle(el).filter), 'none', '夜间保留玩具原色');
  await page.getByRole('link', { name: '去合集大厅挑选' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#241849');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  await page.getByRole('link', { name: '返回首页样例' }).click();
  assert.equal(await page.getByRole('button', { name: '切换到白天' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '切换到白天' }).click();
  const continuity = await page.evaluate(() => {
    const section = document.getElementById('samples');
    const before = getComputedStyle(section).getPropertyValue('--sample-top');
    document.querySelector('.theme-toggle').click();
    return { before, after: getComputedStyle(section).getPropertyValue('--sample-top') };
  });
  assert.equal(continuity.after, continuity.before);
  await page.getByRole('button', { name: '切换到白天' }).click();
  await scrollSamples(page);
  await page.getByRole('link', { name: '去合集大厅挑选' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'day');
  await page.close();
});

test('手机、短屏和横屏：样例未裁切，主入口可触达，没有水平溢出', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width === 390 });
    await page.goto(base);
    await scrollSamples(page);
    const shapes = await page.locator('.sample-art').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()));
    assert.ok(shapes.every(box => box.left >= 0 && box.right <= viewport.width && box.width >= 115), JSON.stringify({ viewport, shapes }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const link = page.getByRole('link', { name: '去合集大厅挑选' });
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height);
    await Promise.all([page.waitForURL('**/collections/'), viewport.width === 390 ? link.tap() : link.click()]);
    assert.equal(await page.getByRole('heading', { name: '奶油圆球', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.style-card').count(), 8);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const back = await page.getByRole('link', { name: '返回首页样例' }).boundingBox();
    assert.ok(back.height >= 44);
    await page.close();
  }
});

test('样例图片失败时占位尺寸稳定，仍能进入大厅', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/#samples`);
  await page.evaluate(() => document.fonts.ready);
  const before = await page.locator('.sample-art').evaluateAll(elements => elements.map(el => ({ width: el.offsetWidth, height: el.offsetHeight })));
  await page.route('**/assets/samples/*.svg', route => route.abort());
  await page.reload();
  await scrollSamples(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.sample-fallback')].every(el => !el.hidden));
  const after = await page.locator('.sample-art').evaluateAll(elements => elements.map(el => ({ width: el.offsetWidth, height: el.offsetHeight })));
  assert.deepEqual(after, before);
  assert.equal(await page.locator('.sample-fallback:visible').count(), 4);
  await page.getByRole('link', { name: '去合集大厅挑选' }).click();
  // Navigation can commit before the new heading has been parsed/painted.
  await page.getByRole('heading', { name: '合集大厅', exact: true }).waitFor({ state: 'visible' });
  await page.close();
});

test('主题存储被禁用时页面、图片和导航仍可用', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('disabled', 'SecurityError'); } }));
  await page.goto(base);
  await page.getByRole('button', { name: '切换到夜晚' }).click();
  await scrollSamples(page);
  await page.getByRole('link', { name: '去合集大厅挑选' }).click();
  assert.equal(await page.getByRole('heading', { name: '合集大厅', exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});
