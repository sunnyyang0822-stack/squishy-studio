const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, stats, ready, point, settle, surfaceLight, rotate } = require('./helpers/squishy-browser.cjs');
const base = 'http://127.0.0.1:4183';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4183' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

for (const id of ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) test(`${id}×clay：真实 GPU 按压、滑动、留痕、换色恢复、旋转、取消及离页释放`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const style = getSquishyStyle(id), page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let modelRequests = 0; page.on('request', r => { if (r.url().endsWith(style.modelUrl)) modelRequests++; });
  const mesh = await installStyleProbe(page, style); await page.goto(`${base}/squishy/cloud/?style=${id}`); await ready(page);
  assert.equal(new URL(page.url()).searchParams.get('style'), id);
  const roseLight = await surfaceLight(page, 'day');
  assert.ok(roseLight.meanRGB[0] - roseLight.meanRGB[1] > 8, `Rose must actually appear pink: ${roseLight.meanRGB}`);
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  const x = id === 'donut' ? .76 : .5, y = .42;
  const p = await point(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(1300);
  const held = await stats(page);
  assert.ok(held.maximum > .03 && held.maximum < .7, JSON.stringify(held));
  assert.ok(held.changed > 10 && held.changed < held.vertices * .6, 'Local deformation'); assert.ok(held.finite);
  await page.mouse.move(p.x + 12, p.y - 8, { steps: 8 }); await page.waitForTimeout(300); await page.mouse.up(); await settle(page);
  const retained = await stats(page); assert.ok(retained.maximum > .02, 'Clay retains a dent');
  if (id === 'donut') {
    const far = await page.evaluate(() => { const p = window.styleProbe; let d = 0; for (let i = 0; i < p.rest.length; i += 3) if (p.rest[i] < -.35) d = Math.max(d, Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k]))); return d; });
    assert.ok(far < .0001, 'Pressing right rim cannot deform opposite side across hole');
  }
  const choose = page.locator('[name=color][value=mint]'); await choose.check();
  await page.waitForFunction(() => window.styleProbe.positions.every((v, i) => Math.abs(v - window.styleProbe.rest[i]) < 1e-6));
  const mintLight = await surfaceLight(page, 'day');
  assert.ok(mintLight.meanRGB[1] - mintLight.meanRGB[0] > 4, `Mint must actually render green: ${mintLight.meanRGB}`);
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true, 'Color change preserves scene'); assert.equal(modelRequests, 1);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  await page.mouse.up(); await settle(page); assert.equal((await stats(page)).maximum, 0, 'Cancellation discards transient dent');
  const before = await page.evaluate(() => window.styleProbe.matrix);
  const center = mesh.low.map((v, k) => (v + mesh.high[k]) / 2);
  const transformedCenter = matrix => [0, 1, 2].map(k => matrix[12 + k] + center.reduce((sum, v, j) => sum + v * matrix[j * 4 + k], 0));
  const initialCenter = transformedCenter(before);
  const box = await page.locator('.toy-stage').boundingBox();
  await page.mouse.move(box.x + 12, box.y + 45); await page.mouse.down();
  for (const [dx, dy] of [[60, 20], [120, -20], [75, 45], [15, 10]]) {
    await page.mouse.move(box.x + dx, box.y + 45 + dy, { steps: 8 }); await page.waitForTimeout(50);
    const current = transformedCenter(await page.evaluate(() => window.styleProbe.matrix));
    assert.ok(Math.hypot(...current.map((v, k) => v - initialCenter[k])) < 1e-5, `Rotation keeps original geometric center fixed: ${initialCenter} -> ${current}`);
  }
  await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => window.styleProbe.matrix), before, 'Background drag rotates actual mesh');
  for (const theme of ['day', 'night']) {
    await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(650);
    for (const [face, dx, dy] of [['front', 0, 0], ['side', 320, 0], ['back', 320, 0], ['bottom', 0, -225]]) {
      if (dx || dy) await rotate(page, dx, dy);
      const light = await surfaceLight(page, theme);
      assert.ok(light.count > 1000 && light.p05 > 30 && light.blackFraction < .005, `${id}/${theme}/${face}: ${JSON.stringify(light)}`);
    }
    await page.locator('[name=color][value=mint]').check(); await page.waitForTimeout(650);
  }
  if (id === 'donut') {
    await page.locator('.orb-input').focus(); await page.keyboard.down('Space'); await page.waitForTimeout(1100);
    assert.ok((await stats(page)).maximum > .02, 'Keyboard fallback hits real ring surface instead of empty center');
    await page.keyboard.up('Space'); await settle(page);
  }
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForFunction(() => window.styleProbe.contexts.every(gl => gl.isContextLost())); assert.equal(await page.locator('.toy-mount canvas').count(), 0);
  assert.deepEqual(errors, []); await page.close();
});

test('新增模型加载失败可重试，快速样式切换只提交最后选择', async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const page = await browser.newPage(); const style = getSquishyStyle('donut');
  await installStyleProbe(page, style);
  await page.route(`**${style.modelUrl}`, route => route.fulfill({ contentType: 'text/html', body: '<html>not a model</html>' }));
  await page.goto(`${base}/squishy/cloud/?style=donut`); await page.waitForSelector('[data-state=error]');
  await page.unroute(`**${style.modelUrl}`); await page.locator('.retry-button').click(); await page.waitForSelector('[data-state=ready]');
  const inputs = page.locator('[name=styleId]');
  assert.ok(await inputs.locator('option').count() >= 8, 'All styles available in production UI');
  await page.route(`**${getSquishyStyle('cloud').modelUrl}`, async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    try { await route.continue(); } catch { /* Aborted old selection has no live route. */ }
  });
  await inputs.selectOption('cloud');
  await inputs.selectOption('star');
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.style === 'star' && document.querySelector('.toy-stage').dataset.state === 'ready');
  await page.waitForTimeout(700); assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), 'star');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.styleProbe.contexts.filter(gl => !gl.isContextLost()).length), 1, 'Old model context is released');
  await page.close();
});
