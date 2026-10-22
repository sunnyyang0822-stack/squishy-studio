const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installOrbProbe, settled } = require('./helpers/orb-probe.cjs');
const base = 'http://127.0.0.1:4217';
let browser, server, Color;

before(async () => {
  ({ Color } = await import('three'));
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4217' } });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(options = {}, theme = 'day') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  await installOrbProbe(page, { pixels: true });
  // Observe the actual bound GPU attribute after the orb draw; never expose a
  // product test API or infer the pigment from CSS swatches or DOM datasets.
  await page.addInitScript(theme => {
    localStorage.setItem('squishy-studio-theme', theme);
    window.dayColorProbe = { colors: null, draws: 0, bufferChanges: 0 };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = original.call(this, type, ...args);
      if (type !== 'webgl2' || !gl || gl.__dayColorObserved) return gl;
      gl.__dayColorObserved = true;
      let firstBuffer;
      const draw = gl.drawElements.bind(gl);
      gl.drawElements = function(mode, count, ...args) {
        const result = draw(mode, count, ...args);
        if (count !== 15360 || gl.getParameter(gl.FRAMEBUFFER_BINDING)) return result;
        const index = gl.getAttribLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'color');
        if (index < 0) return result;
        const buffer = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
        if (!buffer) return result;
        const previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        const data = new Float32Array(2562 * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.bindBuffer(gl.ARRAY_BUFFER, previous);
        if (!firstBuffer) firstBuffer = buffer;
        if (firstBuffer !== buffer) window.dayColorProbe.bufferChanges++;
        window.dayColorProbe.colors = Array.from(data); window.dayColorProbe.draws++;
        if (window.dayColorProbe.captureNextColorFrame) {
          window.dayColorProbe.firstTransition = Array.from(data);
          window.dayColorProbe.captureNextColorFrame = false;
        }
        return result;
      };
      return gl;
    };
  }, theme);
  await page.goto(base + '/squishy/cloud/');
  await page.waitForFunction(() => window.dayColorProbe.colors && window.orbMeshProbe.modelViewMatrix);
  await idle(page);
  await page.locator('[data-category=coreColor]').click();
  return page;
}

async function idle(page) {
  await page.evaluate(() => { window.dayColorIdle = { draws: -1, at: performance.now() }; });
  await page.waitForFunction(() => {
    const sample = window.dayColorIdle, draws = window.dayColorProbe.draws;
    if (sample.draws !== draws) { sample.draws = draws; sample.at = performance.now(); }
    return performance.now() - sample.at >= 200;
  });
}
const snapshot = page => page.evaluate(() => ({
  samples: ['top', 'middle', 'bottom'].map(key => window.orbMeshProbe.pixelFrames.at(-1)[key].slice(0, 3)),
  colors: window.dayColorProbe.colors.slice(),
  positions: Array.from(window.orbMeshProbe.positions),
  matrix: window.orbMeshProbe.modelViewMatrix.slice(),
  uploads: window.orbMeshProbe.uploads,
  contexts: window.orbMeshProbe.contexts.length,
  bufferChanges: window.dayColorProbe.bufferChanges,
  loads: performance.getEntriesByType('resource').filter(entry => entry.name.includes('squishy-orb.glb')).length,
}));
async function theme(page, value) {
  const draws = await page.evaluate(value => {
    const count = window.dayColorProbe.draws;
    document.documentElement.dataset.theme = value;
    return count;
  }, value);
  await page.waitForFunction(draws => window.dayColorProbe.draws > draws, draws);
  return snapshot(page);
}
async function choose(page, id) {
  await page.locator(`[name=color][value=${id}]`).check();
  await idle(page);
}
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const chroma = rgb => Math.max(...rgb) - Math.min(...rgb);
const daytime = rgb => {
  const light = luminance(rgb);
  return rgb.map(value => Math.max(0, Math.min(1, (light + (value - light) * 1.3) * 1.06)));
};
function assertPigment(data, expected, description) {
  let maximum = 0;
  for (let i = 0; i < data.length; i++) maximum = Math.max(maximum, Math.abs(data[i] - expected[i % 3]));
  assert.ok(maximum < 1e-6, `${description}: max GPU attribute error ${maximum}`);
}
function assertSameShape(actual, expected, label) {
  assert.deepEqual(actual.positions, expected.positions, label + ' retains dents');
  assert.deepEqual(actual.matrix, expected.matrix, label + ' retains rotation');
  assert.equal(actual.uploads, expected.uploads, label + ' does not upload or reset positions');
  assert.equal(actual.contexts, expected.contexts, label + ' reuses WebGL');
  assert.equal(actual.loads, expected.loads, label + ' reuses GLB');
  assert.equal(actual.bufferChanges, 0, label + ' reuses color attribute buffer');
}

test('十色真实GPU：白天首帧和night→day→night提升色度与明度，夜间精确恢复', async () => {
  const { orbColors } = await import('../detail/orb-colors.mjs');
  const page = await open({ reducedMotion: 'reduce' });
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  assertPigment((await snapshot(page)).colors, daytime(new Color(orbColors[0].hex).toArray()), 'initial day rose');
  await theme(page, 'night');
  for (const color of orbColors) {
    await choose(page, color.id);
    const night = await snapshot(page), rgb = new Color(color.hex).toArray();
    assertPigment(night.colors, rgb, color.id + ' original night pigment');
    const day = await theme(page, 'day');
    const average = (values, metric) => values.reduce((sum, rgb) => sum + metric(rgb), 0) / values.length;
    assert.ok(average(day.samples, chroma) > average(night.samples, chroma) * 1.2, color.id + ' has visibly more chroma in rendered pixels');
    assert.ok(average(day.samples, rgb => Math.max(...rgb)) > average(night.samples, rgb => Math.max(...rgb)) + 8, color.id + ' has brighter dominant pigment in rendered pixels');
    assertPigment(day.colors, daytime(rgb), color.id + ' day pigment');
    const dayRGB = day.colors.slice(0, 3), nightRGB = night.colors.slice(0, 3);
    assert.ok(chroma(dayRGB) > chroma(nightRGB) * 1.2, color.id + ' has more chroma');
    assert.ok(luminance(dayRGB) > luminance(nightRGB) * 1.025 && luminance(dayRGB) <= luminance(nightRGB) * 1.061, color.id + ' gets a modest brightness lift');
    assertSameShape(day, night, color.id + ' day');
    const returned = await theme(page, 'night');
    assert.deepEqual(returned.colors, night.colors, color.id + ' restores exact original night GPU data');
    assert.deepEqual(returned.samples, night.samples, color.id + ' restores exact night lighting/tone mapping pixels');
    assertSameShape(returned, night, color.id + ' night');
  }
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
  await page.close();
});

test('主题颜色校正保留真实GPU凹痕、AO、旋转姿态与既有场景', async () => {
  const page = await open({}, 'night');
  const original = await snapshot(page), canvas = await page.locator('.toy-mount canvas').elementHandle();
  const box = await page.locator('.orb-input').boundingBox();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .45); await page.mouse.down();
  await page.waitForFunction(() => window.orbMeshProbe.positions.some((value, index) => Math.abs(value - window.orbMeshProbe.rest[index]) > .15));
  await page.mouse.up(); await settled(page);
  await page.mouse.move(100, 250); await page.mouse.down(); await page.mouse.move(280, 300, { steps: 8 }); await page.mouse.up(); await idle(page);
  const night = await snapshot(page);
  assert.notDeepEqual(night.positions, original.positions); assert.notDeepEqual(night.matrix, original.matrix);
  const { orbColors } = await import('../detail/orb-colors.mjs');
  const rgb = new Color(orbColors[0].hex).toArray(), pigment = daytime(rgb);
  const day = await theme(page, 'day');
  assertSameShape(day, night, 'deformed day');
  // AO remains a scalar after compensation; read depth from the real uploaded
  // positions and compare every color component, including cavity vertices.
  let deepest = 0;
  for (let i = 0; i < day.colors.length; i += 3) {
    const depth = Math.hypot(...[0,1,2].map(k => original.positions[i + k] - day.positions[i + k]));
    deepest = Math.max(deepest, depth);
    const visibility = 1 - Math.min(.24, depth);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(night.colors[i + k] - rgb[k] * visibility) < 1e-6, 'night preserves original cavity AO');
      assert.ok(Math.abs(day.colors[i + k] - pigment[k] * visibility) < 1e-6, 'day applies the same cavity AO after pigment correction');
    }
  }
  assert.ok(deepest > .05);
  const returned = await theme(page, 'night');
  assert.deepEqual(returned.colors, night.colors); assertSameShape(returned, night, 'deformed night');
  assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
  await page.close();
});

for (const reducedMotion of ['no-preference', 'reduce']) test(`白天换色继续覆盖并收束到正确GPU色值，保留减少动态选择：${reducedMotion}`, async () => {
  const page = await open({ reducedMotion });
  const originalColors = (await snapshot(page)).colors;
  const before = await page.evaluate(() => structuredClone(window.orbMeshProbe.pixelFrames.at(-1)));
  const start = await page.locator('[name=color][value=mint]').evaluate(input => {
    window.dayColorProbe.captureNextColorFrame = true;
    const count = window.orbMeshProbe.pixelFrames.length; input.click(); return count;
  });
  await idle(page);
  const frames = await page.evaluate(start => window.orbMeshProbe.pixelFrames.slice(start), start);
  assert.ok(frames.length > 1, 'Real intermediate frames remain available');
  const distance = (a,b) => Math.max(...a.slice(0,3).map((value,index) => Math.abs(value - b[index])));
  if (reducedMotion === 'no-preference') {
    // The first color frame uses the renderer's fixed initial dt, independent
    // of later OS/GPU contention. Inspect its highest and lowest real vertices
    // instead of requiring the runner to sample a fleeting pixel phase.
    const first = await page.evaluate(() => ({ colors: window.dayColorProbe.firstTransition, rest: window.orbMeshProbe.rest }));
    let highest = 0, lowest = 0;
    for (let i = 0; i < first.rest.length; i += 3) {
      if (first.rest[i + 1] > first.rest[highest + 1]) highest = i;
      if (first.rest[i + 1] < first.rest[lowest + 1]) lowest = i;
    }
    assert.ok(distance(first.colors.slice(highest, highest + 3), originalColors.slice(highest, highest + 3)) > 1e-5, 'Top GPU pigment begins changing on the first color frame');
    assert.deepEqual(first.colors.slice(lowest, lowest + 3), originalColors.slice(lowest, lowest + 3), 'Bottom GPU pigment retains its previous color on that frame');
  }
  for (const sample of ['top','middle','bottom']) assert.ok(distance(frames.at(-1)[sample], before[sample]) > 12, sample + ' reaches mint');
  const { orbColors } = await import('../detail/orb-colors.mjs');
  assertPigment((await snapshot(page)).colors, daytime(new Color(orbColors.find(color => color.id === 'mint').hex).toArray()), 'day mint after transition');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), reducedMotion === 'reduce');
  const draws = await page.evaluate(() => window.dayColorProbe.draws);
  await page.waitForTimeout(180); assert.equal(await page.evaluate(() => window.dayColorProbe.draws), draws, 'No idle animation loop');
  await page.close();
});
