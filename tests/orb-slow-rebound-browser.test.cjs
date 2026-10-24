const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4205';
let server, browser;
test('慢回弹原圆球边缘沿按入方向凹陷，旋转后不向球心拉扯且完整恢复', { timeout: 120000 }, async () => {
  const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('./helpers/squishy-browser.cjs');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.clock.install(); await installStyleProbe(page, getSquishyStyle('orb'));
    await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=butter`); await ready(page);
    for (const pose of ['initial', 'rotated']) {
      if (pose === 'rotated') await rotate(page, 55, 16);
      const hit = await projectedSurfaceContact(page, .6, .05);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await page.mouse.move(hit.x, hit.y); await page.mouse.down();
      for (let i = 0; i < 26; i++) await page.clock.fastForward(50);
      const delta = await page.evaluate(({ index }) => {
        const p = window.styleProbe, d = [0, 1, 2].map(k => p.positions[index + k] - p.rest[index + k]);
        return [0, 1, 2].map(k => d.reduce((s, v, j) => s + v * p.matrix[j * 4 + k], 0));
      }, hit);
      assert.ok(Math.hypot(delta[0], delta[1]) < 1e-5 && delta[2] < -.02, `${pose}: ${delta}`);
      await page.mouse.up();
      for (let i = 0; i < 20; i++) await page.clock.fastForward(50);
      const recovering = await page.evaluate(() => {
        const p = window.styleProbe; let maximum = 0;
        for (let i = 0; i < p.rest.length; i += 3) maximum = Math.max(maximum, Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k])));
        return maximum;
      });
      assert.ok(recovering > 0 && recovering < Math.abs(delta[2]), 'Actual GPU recovery progresses gradually before its idle tail');
      await page.clock.fastForward(13000);
      assert.equal(await page.evaluate(() => window.styleProbe.positions.every((v, i) => v === window.styleProbe.rest[i])), true);
      await page.clock.resume();
    }
  } finally { await page.close(); }
});
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4205' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(options = {}, probeOptions = {}) {
  const page = await browser.newPage(options);
  if (process.env.SLOW_REBOUND_CPU_RATE) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SLOW_REBOUND_CPU_RATE) });
  }
  await installOrbProbe(page, probeOptions);
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
async function reachesDepth(page, minimum) {
  await page.waitForFunction(minimum => {
    const p = window.orbMeshProbe;
    for (let i = 0; i < p.rest.length; i += 3) if (Math.hypot(p.positions[i] - p.rest[i], p.positions[i + 1] - p.rest[i + 1], p.positions[i + 2] - p.rest[i + 2]) > minimum) return true;
    return false;
  }, minimum, { timeout: 30000 });
}
async function recovered(page) {
  await page.waitForFunction(() => {
    const p = window.orbMeshProbe; return p.positions?.every((v, i) => v === p.rest[i]);
  }, null, { timeout: 18000, polling: 100 });
  const count = await page.locator('.toy-mount').getAttribute('data-render-count');
  await page.waitForTimeout(200); assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count);
  assert.equal((await meshStats(page)).maximum, 0);
}

test('正常鼠标滑动时实际GPU左右路径均可见，终点驻留达到限深且全路径自然回弹', async t => {
  const page = await open({ viewport: { width: 1440, height: 900 } });
  const start = await point(page, .32), end = await point(page, .68);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  const started = Date.now();
  let progress = 0;
  while (progress < 1) {
    progress = Math.min(1, (Date.now() - started) / 800);
    await page.mouse.move(start.x + (end.x - start.x) * progress, start.y);
    if (progress < 1) await page.waitForTimeout(16);
  }
  const path = await page.evaluate(() => {
    const { positions: p, rest: r } = window.orbMeshProbe;
    const depths = [0, 0];
    for (let i = 0; i < r.length; i += 3) {
      if (r[i + 2] < .5 || Math.abs(r[i + 1] - .0175) > .25) continue;
      const side = r[i] < 0 ? 0 : 1;
      depths[side] = Math.max(depths[side], Math.hypot(p[i] - r[i], p[i + 1] - r[i + 1], p[i + 2] - r[i + 2]));
    }
    return depths;
  });
  for (const depth of path) assert.ok(depth > .08 && depth < .46, `Clearly visible bounded GPU path: ${path}`);
  const sliding = (await meshStats(page)).maximum;
  // A slow host may already have yielded deeply before automation returns.
  // Dwell must reach the bounded target, without asking it to exceed the limit.
  await reachesDepth(page, .44);
  t.diagnostic(JSON.stringify({ slidingLeftRight: path, slidingMaximum: sliding, dwellMaximum: (await meshStats(page)).maximum }));
  await page.mouse.up(); await recovered(page); await page.close();
});

test('慢回弹真实鼠标渐进下陷、自然完整恢复停帧；默认黏土仍留痕且切页实例隔离', async t => {
  const page = await open({ viewport: { width: 1440, height: 900 } }, { frames: true }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await press(page, 120); await reachesDepth(page, .10);
  const early = await page.evaluate(() => window.orbMeshProbe.positionFrames.find(frame => frame.maximum > 0));
  assert.ok(early.maximum > .0004 && early.maximum < .0007, `Gentle actual first GPU frame: ${JSON.stringify(early)}`);
  const pressingFrames = await page.evaluate(() => window.orbMeshProbe.positionFrames.filter(frame => frame.pressed && frame.maximum > 0).slice(0, 2));
  assert.equal(pressingFrames.length, 2);
  const onsetIntegral = t => t < .12 ? t * t / (.12 * 2) : t - .12 / 2;
  const secondElapsed = 1 / 60 + Math.min(.1, (pressingFrames[1].time - early.time) / 1000);
  const expectedSecond = early.maximum * onsetIntegral(secondElapsed) / onsetIntegral(1 / 60);
  assert.ok(Math.abs(pressingFrames[1].maximum - expectedSecond) < .000002, 'Actual GPU follows gentle onset then uniform speed, without exponential ease-out');
  const held = (await meshStats(page)).maximum;
  assert.ok(held > .10 && held < .46);
  await page.mouse.up();
  await page.waitForFunction(() => window.orbMeshProbe.positionFrames.some(frame => !frame.pressed));
  const release = await page.evaluate(() => {
    const frames = window.orbMeshProbe.positionFrames, index = frames.findIndex(frame => !frame.pressed);
    return { before: frames[index - 1], after: frames[index] };
  });
  const expected = release.before.maximum * Math.exp(-.8 * (release.after.time - release.before.time) / 1000);
  assert.ok(release.after.maximum > 0 && release.after.maximum < release.before.maximum);
  assert.ok(Math.abs(release.after.maximum - expected) < .000002, `Actual GPU release follows elapsed frame time: ${JSON.stringify(release)}`);
  t.diagnostic(JSON.stringify({ firstGpuFrame: early, release, expectedReleaseDepth: expected }));
  await recovered(page);
  await page.locator('[name=coreMaterial][value=clay]').check(); await page.waitForSelector('.toy-mount[data-feel-id=clay][data-render-count] canvas');
  await press(page, 0); await reachesDepth(page, .12); await page.mouse.up(); await page.waitForTimeout(1800);
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

test('新质感沿用换色时钟与姿态恢复；颜色恢复中输入接管后全网格自然归零', async t => {
  const page = await open({}, { frames: true }); await press(page, 0); await reachesDepth(page, .12);
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  // Run the interruption after the first real restoration upload, inside the
  // browser. Remote automation latency cannot skip the 650ms transition.
  await page.evaluate(() => {
    document.addEventListener('orb-probe-position', event => {
      const depth = event.detail.maximum;
      queueMicrotask(() => {
        const probe = window.orbMeshProbe, before = Array.from(probe.positions), surface = document.querySelector('.orb-input');
        surface.focus(); surface.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        window.restoreInterruption = { depth, before, after: Array.from(probe.positions), pressed: surface.getAttribute('aria-pressed') };
      });
    }, { once: true });
    document.querySelectorAll('[name=color]')[4].click();
  });
  await page.waitForFunction(() => window.restoreInterruption);
  const interruption = await page.evaluate(() => window.restoreInterruption);
  assert.ok(interruption.depth > .005); assert.equal(interruption.pressed, 'true');
  assert.deepEqual(interruption.before, interruption.after, 'Input takes over the actual current GPU shape without a reset');
  t.diagnostic(JSON.stringify({ interruptedGpuDepth: interruption.depth, inputAccepted: interruption.pressed, immediatePositionError: 0 }));
  await page.mouse.up(); await reachesDepth(page, interruption.depth + .02); await page.keyboard.up('Space');
  await recovered(page);
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
  assert.equal((await meshStats(page)).contexts, 2);
  await press(page, 0); await reachesDepth(page, .06);
  await page.evaluate(() => document.querySelectorAll('[name=color]')[7].click()); await page.mouse.up();
  await recovered(page);
  assert.match(await page.locator('canvas').getAttribute('aria-label'), /完整回弹/);
  await page.close();
});

test('pointercancel、失焦、后台结束施力；后台暂停且前台连续恢复，离页释放', async () => {
  const page = await open({}, { frames: true }); await press(page, 700);
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
  const resumeFrom = await page.evaluate(() => ({ count: window.orbMeshProbe.positionFrames.length, depth: window.orbMeshProbe.positionFrames.at(-1).maximum }));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(count => window.orbMeshProbe.positionFrames.length >= count + 2, resumeFrom.count);
  const resumed = await page.evaluate(count => window.orbMeshProbe.positionFrames.slice(count), resumeFrom.count);
  let expected = resumeFrom.depth;
  for (let i = 0; i < resumed.length; i++) {
    const elapsed = i === 0 ? 1 / 60 : (resumed[i].time - resumed[i - 1].time) / 1000;
    expected *= Math.exp(-.8 * elapsed);
    assert.ok(Math.abs(resumed[i].maximum - expected) < .000002, 'Foreground integrates only visible frame time, never the hidden 1.3 seconds');
  }
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

test('连续切换质感最后选择生效；保留独立棉花糖且所有旧上下文释放', async () => {
  const page = await open();
  for (const material of ['clay', 'butter', 'marshmallow', 'butter']) await page.locator(`[name=coreMaterial][value=${material}]`).check();
  await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
  await page.waitForFunction(() => window.orbMeshProbe.contexts.filter(gl => !gl.isContextLost()).length === 1);
  assert.equal((await meshStats(page)).maximum, 0);
  await page.locator('[name=coreMaterial][value=marshmallow]').check();
  await page.waitForSelector('.toy-mount[data-feel-id=marshmallow][data-render-count] canvas');
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
