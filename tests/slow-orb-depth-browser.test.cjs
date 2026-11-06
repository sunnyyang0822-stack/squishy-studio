const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4327';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4327' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`三种内芯圆球的实际GPU模型尺寸和屏幕范围一致：${viewport.width}px`, async t => {
    const samples = [];
    for (const core of ['clay', 'marshmallow', 'butter']) {
      const page = await browser.newPage({ viewport }); await installOrbProbe(page);
      await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=${core}`);
      await page.waitForSelector('.toy-stage[data-state=ready] .orb-input');
      await page.waitForFunction(() => window.orbMeshProbe.modelViewMatrix);
      const sample = await page.evaluate(() => ({
        matrix: window.orbMeshProbe.modelViewMatrix,
        input: (() => { const b = document.querySelector('.orb-input').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })(),
        canvas: (() => { const b = document.querySelector('.toy-mount canvas').getBoundingClientRect(); return { width: b.width, height: b.height }; })(),
      }));
      samples.push({ core, ...sample }); await page.close();
    }
    for (const sample of samples.slice(1)) {
      assert.deepEqual(sample.matrix, samples[0].matrix, 'Same actual GPU model/view matrix: scale and camera unchanged');
      assert.deepEqual(sample.canvas, samples[0].canvas);
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(sample.input[key] - samples[0].input[key]) < .01, 'Same projected model bounds');
    }
    t.diagnostic(JSON.stringify(samples.map(({ core, input }) => ({ core, input }))));
  });
}

test('实际鼠标中心按压达到1.70以上，松手自然完整恢复且停帧', async t => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await installOrbProbe(page);
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=butter`);
  await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"] .orb-input');
  const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.waitForFunction(() => {
    const p = window.orbMeshProbe;
    if (!p.positions) return false;
    for (let i = 0; i < p.rest.length; i += 3) {
      if (Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k])) > 1.70) return true;
    }
    return false;
  });
  const pressed = await meshStats(page); assert.ok(pressed.maximum > 1.70 && pressed.maximum <= 1.800001);
  await page.screenshot({ path: 'slow-orb-depth-review.png' });
  await page.mouse.up();
  await page.waitForFunction(() => window.orbMeshProbe.positions.every((v, i) => v === window.orbMeshProbe.rest[i]), null, { timeout: 20000 });
  const count = await page.locator('.toy-mount').getAttribute('data-render-count'); await page.waitForTimeout(250);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count);
  t.diagnostic(JSON.stringify({ pressed: pressed.maximum, restored: (await meshStats(page)).maximum })); await page.close();
});

test('四侧可见轮廓内均接受真实按压并明显压深，球体之外不误判', async t => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } }); await installOrbProbe(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=butter`);
  await page.waitForSelector('.toy-stage[data-state=ready] .orb-input');
  const measurements = [];
  for (const [side, x, y] of [['left', .04, .5], ['right', .96, .5], ['top', .5, .04], ['bottom', .5, .96]]) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const box = await page.locator('.orb-input').boundingBox();
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y); await page.mouse.down();
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true', `${side} accepts visible surface contact`);
    await page.waitForFunction(() => {
      const p = window.orbMeshProbe;
      for (let i = 0; i < p.rest.length; i += 3) if (Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k])) > 1.1) return true;
      return false;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(700);
    const sideDepth = (await meshStats(page)).maximum;
    assert.ok(sideDepth > 1.1 && sideDepth < 1.6, `${side}: keeps visible inward travel without the central-depth sideways slit`);
    measurements.push({ side, depth: sideDepth });
    await page.mouse.up(); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.orbMeshProbe.positions.every((v, i) => v === window.orbMeshProbe.rest[i]), null, { timeout: 6000 });
  }
  const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x - 4, box.y + box.height / 2); await page.mouse.down();
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false'); await page.mouse.up();
  assert.equal((await meshStats(page)).maximum, 0, 'No shape change outside the actual toy');
  assert.deepEqual(errors, []); t.diagnostic(JSON.stringify(measurements)); await page.close();
});
