const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { comparePng } = require('./scripts/png-comparison.cjs');
const folder = 'artifacts/issue-16-day-color';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4190';
// Substitute only the previous compiled engine in the same browser. The UI,
// palette and model are unchanged, giving a same-device visual comparison.
const baseline = execFileSync('git', ['show', '9a9480e:assets/orb-preview.js']);

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = { date: '2026-10-21', baseline: '9a9480e', browser: browser.version(), host: `${os.platform()} ${os.release()} ${os.arch()}`, mobile: 'Chromium emulation, no physical phone', modelBytes: fs.statSync('assets/models/squishy-orb.glb').size, engineBytes: fs.statSync('assets/orb-preview.js').size, errors: [], comparisons: [] };
  const captures = {};
  try {
    for (const version of ['before', 'after']) for (const theme of ['day', 'night']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => report.errors.push(error.message));
      if (version === 'before') await page.route('**/assets/orb-preview.js', route => route.fulfill({ contentType: 'text/javascript', body: baseline }));
      await page.addInitScript(value => localStorage.setItem('squishy-studio-theme', value), theme);
      await page.goto(base + '/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
      await page.evaluate(() => document.fonts.ready);
      const tiles = [];
      for (const option of await page.locator('[name=color]').all()) {
        await option.check(); await page.waitForTimeout(230);
        const box = await page.locator('.orb-input').boundingBox();
        const png = await page.screenshot({ clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } });
        tiles.push({ id: await option.inputValue(), name: await option.evaluate(input => input.closest('label').textContent), png });
      }
      captures[`${version}-${theme}`] = tiles;
      await page.setViewportSize({ width: 1280, height: 650 });
      await page.setContent('<body style="margin:0;background:#f8f4f6;display:grid;grid-template-columns:repeat(5,256px);font:16px sans-serif;color:#4b3450">' + tiles.map(tile => `<figure style="margin:12px;text-align:center"><img style="width:224px;height:260px;object-fit:contain" src="data:image/png;base64,${tile.png.toString('base64')}"><figcaption>${tile.name}</figcaption></figure>`).join(''));
      await page.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
      await page.screenshot({ path: `${folder}/${version}-${theme}-ten.png` }); await page.close();
    }
    for (const theme of ['day', 'night']) for (let i = 0; i < 10; i++) {
      const before = captures[`before-${theme}`][i], after = captures[`after-${theme}`][i];
      const diff = comparePng(before.png, after.png);
      if (theme === 'day') assert.ok(diff.changedPixels > 100 && diff.maximumChannelDelta > 3, before.id);
      else assert.equal(diff.changedPixels, 0, `Night remains exactly unchanged: ${before.id}`);
      report.comparisons.push({ theme, id: before.id, ...diff });
    }
    for (const [name, width, height] of [['desktop',1440,900],['mobile',390,844],['short',320,568],['landscape',844,390]]) for (const theme of ['day','night']) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600, reducedMotion: 'reduce' });
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(value => localStorage.setItem('squishy-studio-theme', value), theme);
      await page.goto(base + '/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
      await page.locator('[name=color][value=mint]').check(); await page.waitForTimeout(220);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${folder}/${name}-${theme}.png`, fullPage: true });
      const box = await page.locator('.orb-input').boundingBox();
      await page.mouse.move(box.x + box.width * .35, box.y + box.height * .4); await page.mouse.down();
      await page.waitForTimeout(2800); await page.mouse.up(); await page.waitForTimeout(700);
      await page.screenshot({ path: `${folder}/${name}-${theme}-pressed.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ comparisons: report.comparisons.length, nightUnchanged: true, errors: report.errors, engineBytes: report.engineBytes }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
