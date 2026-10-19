const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { comparePng } = require('./scripts/png-comparison.cjs');

(async () => {
  const folder = 'artifacts/issue-8';
  const baseline = JSON.parse(fs.readFileSync(`${folder}/hero-baseline.json`, 'utf8'));
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
  const report = [];
  const save = async (target, name) => {
    const buffer = await target.screenshot();
    fs.writeFileSync(`${folder}/${name}.tmp`, buffer);
    fs.renameSync(`${folder}/${name}.tmp`, `${folder}/${name}`);
    return buffer;
  };
  try {
    for (const item of baseline) {
      const viewport = { width: item.width, height: item.hero.height };
      // Landscape Hero may naturally exceed the viewport: retain its original viewport.
      viewport.height = { desktop: 900, mobile: 844, compact: 667, short: 568, landscape: 390 }[item.name];
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: item.name === 'desktop' ? { dir: folder, size: viewport } : undefined });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4173/');
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.brand-stage.is-3d-ready').waitFor();
      await page.waitForTimeout(700);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.brand-canvas')).opacity === '1');
      const geometry = await page.evaluate(() => ({ hero: document.querySelector('.scene').getBoundingClientRect().toJSON(), brand: document.querySelector('.brand-stage').getBoundingClientRect().toJSON() }));
      assert.deepEqual(geometry, { hero: item.hero, brand: item.brand }, `${item.name} Hero 布局发生变化`);
      const evidence = { viewport, name: item.name, geometryUnchanged: true, hero: {} };
      for (const theme of ['day', 'night']) {
        if (theme === 'night') {
          await page.evaluate(() => scrollTo(0, 0));
          await page.getByRole('button', { name: '切换到夜晚' }).click();
          await page.waitForTimeout(1700);
          await page.waitForFunction(() => !document.querySelector('.scene').classList.contains('is-transitioning') && getComputedStyle(document.querySelector('.scene'), '::before').opacity === '1');
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const hero = await page.screenshot();
        fs.writeFileSync(`${folder}/hero-after-${item.name}-${theme}.png`, hero);
        evidence.hero[theme] = comparePng(fs.readFileSync(`${folder}/hero-before-${item.name}-${theme}.png`), hero);
        console.log(`${item.name} ${theme}: ${JSON.stringify(evidence.hero[theme])}`);
        // GPU compositing may round a color channel by one 8-bit unit.
        assert.ok(evidence.hero[theme].maximumChannelDelta <= 1, `${item.name} ${theme} Hero 存在超出单级舍入的像素变化`);
        await page.evaluate(() => document.getElementById('samples').scrollIntoView({ block: 'start' }));
        await page.locator('.sample-art img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        await page.waitForTimeout(350);
        await save(page.locator('.samples-section'), `samples-${item.name}-${theme}.png`);
      }
      await page.getByRole('link', { name: '去合集大厅挑选' }).click();
      await page.waitForURL('**/collections/');
      await save(page, `hall-${item.name}-night.png`);
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
      await page.getByRole('link', { name: '返回首页样例' }).click();
      await page.waitForFunction(() => Math.abs(document.getElementById('samples').getBoundingClientRect().top) < 5);
      if (item.name === 'desktop') await save(page, 'return-to-samples.png');
      await page.getByRole('button', { name: '切换到白天' }).click();
      await page.waitForTimeout(1700);
      await page.evaluate(() => document.getElementById('samples').scrollIntoView());
      await page.getByRole('link', { name: '去合集大厅挑选' }).click();
      if (['desktop', 'mobile'].includes(item.name)) await save(page, `hall-${item.name}-day.png`);
      const video = page.video();
      await context.close();
      if (video) fs.renameSync(await video.path(), `${folder}/navigation-demo.webm`);
      report.push(evidence);
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/assets/samples/*.svg', route => route.abort());
    await page.goto('http://127.0.0.1:4173/#samples');
    await page.waitForFunction(() => [...document.querySelectorAll('.sample-fallback')].every(el => !el.hidden));
    await save(page.locator('.samples-section'), 'samples-image-failure.png');
    await page.close();
    fs.writeFileSync(`${folder}/hero-regression.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.map(({ name, hero }) => ({ name, hero })), null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
