// Capture actual GPU displacement at projected surface vertices, not a maximum
// elsewhere on the toy. Run against this checkout's built preview server.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { installStyleProbe, ready, stats } = require('./tests/helpers/squishy-browser.cjs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4200';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const folder = option('folder') || 'artifacts/issue-30-paw/browser';
const feelIds = option('feel') ? [option('feel')] : ['clay', 'marshmallow'];
assert.ok(feelIds.every(id => ['clay', 'marshmallow'].includes(id)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const regions = [['left-outer-toe', -.76, .36], ['left-inner-toe', -.29, .70], ['right-inner-toe', .29, .70], ['right-outer-toe', .76, .36], ['heart-left', -.24, -.46], ['heart-right', .24, -.46], ['connection', 0, .17]];
const requested = option('region')?.split(',');
const selectedRegions = requested ? regions.filter(([name]) => requested.includes(name)) : regions;
assert.ok(selectedRegions.length && (!requested || requested.every(name => regions.some(([id]) => id === name))), 'Unknown contact region');
async function contact(page, x, y) {
  const box = await page.locator('.toy-mount canvas').boundingBox();
  return page.evaluate(({ box, x, y }) => {
    const p = window.styleProbe; let selected = -1, best = Infinity;
    for (let i = 0; i < p.rest.length; i += 3) {
      if (p.restNormals[i + 2] < .5) continue;
      const distance = (p.rest[i] - x) ** 2 + (p.rest[i + 1] - y) ** 2;
      if (distance < best) { best = distance; selected = i; }
    }
    if (selected < 0 || best > .04) throw Error('No front surface near requested region');
    const local = p.rest.slice(selected, selected + 3), m = p.matrix;
    const view = [0, 1, 2].map(k => m[12 + k] + local.reduce((s, v, j) => s + v * m[j * 4 + k], 0));
    // Same orthographic viewport contract as orb-preview resize().
    const h = Math.max(1.6, 1.48 * box.height / box.width), w = h * box.width / box.height;
    return { index: selected, local, x: box.x + box.width * (.5 + view[0] / (2 * w)), y: box.y + box.height * (.5 - view[1] / (2 * h)) };
  }, { box, x, y });
}
async function depthAt(page, point) {
  return page.evaluate(({ index, local }) => Math.hypot(...local.map((v, k) => window.styleProbe.positions[index + k] - v)), point);
}
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const { getSquishyStyle } = await import('./src/squishy-styles.mjs');
  const style = getSquishyStyle('paw'), assetSHA256 = hash(fs.readFileSync(`.${style.modelUrl}`));
  const bundleSHA256 = hash(fs.readFileSync('assets/orb-preview.js'));
  const served = await fetch(`${base}/assets/orb-preview.js`);
  assert.equal(hash(Buffer.from(await served.arrayBuffer())), bundleSHA256);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const report = { date: new Date().toISOString(), browser: await browser.version(), assetSHA256, bundleSHA256, method: 'Desktop mouse; 2700ms controlled RAF hold; actual GPU buffer displacement at projected contact vertex. Video records actions. Not physical-phone performance.', combinations: [] };
  try {
    for (const feelId of feelIds) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: folder, size: { width: 1280, height: 900 } } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.install(); await installStyleProbe(page, style);
      await page.goto(`${base}/squishy/cloud/?style=paw&coreMaterial=${feelId}`); await ready(page);
      assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), feelId);
      await page.screenshot({ path: `${folder}/paw-${feelId}-rest.png`, fullPage: true });
      const result = { feelId, regions: [] };
      for (const [name, x, y] of selectedRegions) {
        const p = await contact(page, x, y);
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
        await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.clock.runFor(2700);
        const pressed = await depthAt(page, p), held = await stats(page);
        assert.ok(pressed > .06, `${feelId}/${name}: actual contact displacement ${pressed}`);
        await page.screenshot({ path: `${folder}/paw-${feelId}-${name}-pressed.png`, fullPage: true });
        await page.mouse.up(); await page.clock.runFor(1000);
        const retained = await depthAt(page, p), expected = feelId === 'clay' ? .85 : 1;
        assert.ok(Math.abs(retained / pressed - expected) < .025, `${feelId}/${name}: retention ${retained / pressed}`);
        await page.clock.resume();
        result.regions.push({ name, contact: p, pressed, retained, held });
        await page.locator('[name=color][value=mint]').check();
        await page.waitForFunction(() => window.styleProbe.positions.every((v, i) => Math.abs(v - window.styleProbe.rest[i]) < 1e-6));
        await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(700);
      }
      assert.deepEqual(errors, []);
      const video = page.video(); await context.close();
      await video.saveAs(`${folder}/paw-${feelId}-regions.webm`);
      const generated = await video.path(); fs.unlinkSync(generated);
      report.combinations.push(result);
      fs.writeFileSync(`${folder}/contacts.json`, JSON.stringify(report, null, 2));
      console.log(`${feelId}: ${result.regions.length} actual GPU contacts passed`);
    }
    assert.equal(hash(fs.readFileSync(`.${style.modelUrl}`)), assetSHA256);
    assert.equal(hash(fs.readFileSync('assets/orb-preview.js')), bundleSHA256);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
