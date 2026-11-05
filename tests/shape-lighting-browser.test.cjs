const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, surfaceLight, stats } = require('./helpers/squishy-browser.cjs');
const base = 'http://127.0.0.1:4247';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4247' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function open(id, feel, options = {}) {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, ...options });
  const mesh = await installStyleProbe(page, getSquishyStyle(id));
  await page.clock.install(); await page.goto(base);
  await page.setContent('<style>body{margin:0;background:#f9f0f6}.toy-mount{width:100vw;height:100vh;position:relative}.orb-input{position:absolute;opacity:0}</style><div class="toy-mount"></div>');
  await page.evaluate(async ({ id, feel, base }) => {
    const { createOrbPreview } = await import(base + '/assets/orb-preview.js');
    window.preview = createOrbPreview(document.querySelector('.toy-mount'), { styleId: id, presetId: feel });
    (await window.preview.prepare({ color: 'rose', coreColor: 'rose', recipeKey: 'bare' }, { signal: new AbortController().signal })).commit();
  }, { id, feel, base });
  await page.waitForFunction(() => window.styleProbe.positions && window.styleProbe.mainMatrix);
  return { page, mesh };
}
async function cavityPixels(page) {
  const png = await page.screenshot();
  return page.evaluate(async data => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const bytes = ctx.getImageData(260, 260, 120, 120).data;
    return Array.from({ length: bytes.length / 4 }, (_, i) => .2126 * bytes[i * 4] + .7152 * bytes[i * 4 + 1] + .0722 * bytes[i * 4 + 2]);
  }, png.toString('base64'));
}
function darkeningP90(rest, pressed) {
  const values = pressed.map((v, i) => rest[i] - v).sort((a, b) => a - b);
  return values[Math.floor(values.length * .9)];
}
test('all eight models share identical rest coordinates and presentation matrices across the three feels', { timeout: 180000 }, async () => {
  const { squishyStyles } = await import('../src/squishy-styles.mjs');
  for (const id of Object.keys(squishyStyles)) {
    let baseline;
    for (const feel of ['clay', 'marshmallow', 'slow-rebound']) {
      const { page, mesh } = await open(id, feel);
      try {
        const actual = await page.evaluate(() => ({ positions: window.styleProbe.positions, matrix: window.styleProbe.mainMatrix }));
        assert.deepEqual(actual.positions, mesh.positions, `${id}/${feel} never starts stretched or deformed`);
        if (baseline) assert.deepEqual(actual.matrix, baseline, `${id}: feel changes never alter proportions, position or camera`);
        baseline = actual.matrix;
        if (id === 'orb') {
          for (let i = 0; i < actual.positions.length; i += 3) assert.ok(Math.abs(Math.hypot(...actual.positions.slice(i, i + 3)) - 1) < 2e-7);
          for (const j of [0, 4, 8]) assert.ok(Math.abs(Math.hypot(...actual.matrix.slice(j, j + 3)) - 1) < 1e-6);
        }
        await page.evaluate(() => window.preview.dispose());
        assert.equal(await page.locator('canvas').count(), 0);
      } finally { await page.close(); }
    }
  }
});
test('slow-rebound shallow and deep pressure retain visible cavity contrast in day/night and all rotated views stay lit', { timeout: 180000 }, async t => {
  const { page } = await open('orb', 'slow-rebound');
  try {
    const samples = [];
    for (const theme of ['day', 'night']) {
      await surfaceLight(page, theme);
      const restPixels = await cavityPixels(page);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
      const box = await page.locator('.orb-input').boundingBox();
      await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down();
      await page.clock.runFor(400); const shallow = await stats(page);
      const shallowContrast = darkeningP90(restPixels, await cavityPixels(page));
      await page.clock.runFor(1800); const deep = await stats(page);
      const deepContrast = darkeningP90(restPixels, await cavityPixels(page));
      assert.ok(shallow.maximum > .03 && deep.maximum > shallow.maximum + .08);
      assert.ok(shallowContrast > 8 && deepContrast > shallowContrast + 20, JSON.stringify({ theme, shallowContrast, deepContrast }));
      await page.mouse.up(); await page.clock.fastForward(16000);
      assert.equal((await stats(page)).maximum, 0);
      await page.clock.resume();
      for (const [dx, dy] of [[0, 0], [240, 0], [240, 0], [0, 180]]) {
        if (dx || dy) {
          await page.mouse.move(8, 8); await page.mouse.down(); await page.mouse.move(8 + dx, 8 + dy, { steps: 8 }); await page.mouse.up();
        }
        const light = await surfaceLight(page, theme);
        assert.ok(light.p05 > 50 && light.blackFraction < .005, JSON.stringify({ theme, light }));
        samples.push({ theme, light, shallow, deep });
      }
    }
    t.diagnostic(JSON.stringify(samples));
  } finally { await page.close(); }
});
