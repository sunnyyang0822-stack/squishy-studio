const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { installStyleProbe, stats, surfaceLight } = require('../tests/helpers/squishy-browser.cjs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4246';
const folder = 'artifacts/slow-shape-lighting';
const hash = b => createHash('sha256').update(b).digest('hex');
async function pixels(page, bytes) {
  return page.evaluate(async data => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const p = ctx.getImageData(c.width / 2 - 60, c.height / 2 - 60, 120, 120).data;
    return Array.from({ length: p.length / 4 }, (_, i) => .2126 * p[i * 4] + .7152 * p[i * 4 + 1] + .0722 * p[i * 4 + 2]);
  }, bytes.toString('base64'));
}
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const report = { bundleSHA256: hash(fs.readFileSync('assets/orb-preview.js')), baseline: 'a9315d9 lighting on the SAME new round sphere geometry', measurements: [], views: [] };
  try {
    for (const variant of ['before', 'after']) for (const theme of ['day', 'night']) {
      const context = await browser.newContext({ viewport: { width: 640, height: 640 }, recordVideo: variant === 'after' && theme === 'day' ? { dir: '.tmp/lighting-video', size: { width: 640, height: 640 } } : undefined });
      const page = await context.newPage(); const video = page.video();
      if (variant === 'before') await page.route('**/assets/orb-preview.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('.tmp/baseline-preview.js') }));
      await installStyleProbe(page, getSquishyStyle('orb')); await page.clock.install(); await page.goto(base);
      await page.setContent('<style>body{margin:0;background:#f9f0f6}.toy-mount{position:relative;width:640px;height:640px}.orb-input{position:absolute;opacity:0}</style><div class="toy-mount"></div>');
      await page.evaluate(async ({ base, theme }) => { document.documentElement.dataset.theme = theme; const { createOrbPreview } = await import(base + '/assets/orb-preview.js'); window.preview = createOrbPreview(document.querySelector('.toy-mount'), { presetId: 'slow-rebound' }); (await window.preview.prepare({ color: 'rose', recipeKey: 'bare' }, { signal: new AbortController().signal })).commit(); }, { base, theme });
      await page.waitForFunction(() => window.styleProbe.positions && window.styleProbe.draws);
      const rest = await page.screenshot({ path: `${folder}/${variant}-${theme}-rest.png` }), restPixels = await pixels(page, rest);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
      const box = await page.locator('.orb-input').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      for (const [state, elapsed] of [['shallow', 400], ['deep', 1800]]) {
        await page.clock.runFor(elapsed);
        const snapshot = await stats(page), b = await page.screenshot({ path: `${folder}/${variant}-${theme}-${state}.png` }), held = await pixels(page, b);
        const darkening = held.map((v, i) => restPixels[i] - v).sort((a, b) => a - b);
        report.measurements.push({ variant, theme, state, ...snapshot, darkeningP90: darkening[Math.floor(darkening.length * .9)], darkeningMean: darkening.reduce((s, n) => s + n, 0) / darkening.length });
      }
      await page.mouse.up(); await page.clock.fastForward(16000); assert.equal((await stats(page)).maximum, 0); await page.clock.resume();
      for (const [face, dx, dy] of [['front', 0, 0], ['side', 160, 0], ['back', 160, 0], ['bottom', 0, 160]]) {
        if (dx || dy) { await page.mouse.move(8, 8); await page.mouse.down(); await page.mouse.move(8 + dx, 8 + dy, { steps: 10 }); await page.mouse.up(); }
        const light = await surfaceLight(page, theme);
        if (variant === 'after') { assert.ok(light.p05 > 50 && light.blackFraction < .005); await page.screenshot({ path: `${folder}/${theme}-${face}.png` }); }
        report.views.push({ variant, theme, face, light });
      }
      await page.evaluate(() => window.preview.dispose()); await context.close();
      if (video) await video.saveAs(`${folder}/slow-rebound-press-release.webm`);
    }
    fs.writeFileSync(`${folder}/lighting-comparison.json`, JSON.stringify(report, null, 2));
    for (const theme of ['day', 'night']) {
      const before = report.measurements.find(x => x.variant === 'before' && x.theme === theme && x.state === 'deep');
      const after = report.measurements.find(x => x.variant === 'after' && x.theme === theme && x.state === 'deep');
      assert.ok(after.darkeningP90 > before.darkeningP90 + 3, `${theme}: deep cavity contrast improves ${before.darkeningP90} -> ${after.darkeningP90}`);
    }
    fs.writeFileSync(`${folder}/lighting-comparison.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.measurements.map(({ variant, theme, state, maximum, darkeningP90, darkeningMean }) => ({ variant, theme, state, maximum, darkeningP90, darkeningMean })), null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
