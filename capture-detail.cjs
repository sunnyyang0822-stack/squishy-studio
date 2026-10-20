const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { comparePng } = require('./scripts/png-comparison.cjs');
const folder = 'artifacts/issue-10';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const baselineUrl = process.env.BASELINE_URL;
const sizes = [['desktop',1440,900],['mobile',390,844],['compact',375,667],['short',320,568],['landscape',844,390]];
const screenshot = (page, name) => page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = [];
  try {
    for (const [name,width,height] of sizes) {
      const context = await browser.newContext({ viewport: { width,height }, hasTouch: width < 600 });
      for (const theme of ['day','night']) {
        const page = await context.newPage();
        await page.addInitScript(t => localStorage.setItem('squishy-studio-theme', t), theme);
        await page.goto(`${base}/squishy/cloud/`); await page.waitForSelector('[data-state=ready]');
        await page.evaluate(() => document.fonts.ready);
        await screenshot(page, `detail-${name}-${theme}`);
        if (['desktop','mobile','short'].includes(name)) {
          await page.locator('.sound-trigger').click(); await screenshot(page, `volume-${name}-${theme}`);
          await page.keyboard.press('Escape');
        }
        const geometry = await page.evaluate(() => ({ viewport: [innerWidth,innerHeight], document: [document.documentElement.scrollWidth,document.documentElement.scrollHeight], stage: document.querySelector('.toy-stage').getBoundingClientRect().toJSON(), settings: document.querySelector('.customization').getBoundingClientRect().toJSON() }));
        report.push({ name,theme,...geometry });
        await page.close();
      }
      await context.close();
    }
    const failure = await browser.newPage({ viewport: { width:390,height:844 } });
    await failure.route('**/squishy-orb.glb', route => route.abort());
    await failure.goto(`${base}/squishy/cloud/`); await failure.waitForSelector('[data-state=error]');
    await screenshot(failure, 'resource-failure');
    await failure.unroute('**/squishy-orb.glb'); await failure.locator('.retry-button').click(); await failure.waitForSelector('[data-state=ready]');
    await failure.close();
    const context = await browser.newContext({ viewport: { width:1440,height:900 }, recordVideo: { dir:folder,size:{width:1440,height:900} } });
    const page = await context.newPage(); const video = page.video();
    await page.goto(`${base}/collections/`); await page.waitForTimeout(650);
    await page.getByRole('link', { name:'查看圆球外观预览' }).click(); await page.waitForSelector('[data-state=ready]'); await page.waitForTimeout(600);
    for (const value of ['thin','thick','medium','polish','sugar','wax']) { await page.locator(`[value=${value}]`).check(); await page.waitForTimeout(450); }
    await page.locator('.sound-trigger').click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name:'解除静音',exact:true }).click(); await page.waitForTimeout(600);
    const slider = await page.locator('#volume').boundingBox();
    await page.mouse.move(slider.x+slider.width*.5,slider.y+slider.height/2); await page.mouse.down();
    await page.mouse.move(slider.x+slider.width*.82,slider.y+slider.height/2,{steps:24}); await page.mouse.up(); await page.waitForTimeout(600);
    await page.getByRole('button', { name:'静音',exact:true }).click(); await page.waitForTimeout(350);
    await page.getByRole('button', { name:'解除静音',exact:true }).click(); await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name:'返回合集' }).click(); await page.getByRole('link', { name:'返回首页样例' }).click();
    await page.locator('.theme-toggle').click(); await page.waitForTimeout(1600);
    await page.getByRole('link', { name:'去合集大厅挑选' }).click(); await page.getByRole('link', { name:'查看圆球外观预览' }).click();
    await page.waitForSelector('[data-state=ready]'); assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
    await page.waitForTimeout(900); await page.locator('.sound-trigger').click(); await page.waitForTimeout(700); await page.keyboard.press('Escape');
    await page.getByRole('link', { name:'返回合集' }).click(); await page.waitForTimeout(500);
    await context.close(); await video.saveAs(`${folder}/detail-walkthrough.webm`); fs.unlinkSync(await video.path());
    // Capture an explicit origin/main worktree in the same browser/environment,
    // after all light transitions settle. Never overwrite the approved baseline.
    const heroReport = [];
    for (const [name,width,height] of sizes.filter(s => ['desktop','mobile'].includes(s[0]))) {
      for (const theme of ['day','night']) {
        const buffers = [];
        for (const [label,url] of [['before',baselineUrl],['after',base]]) {
          if (!url) throw new Error('Set BASELINE_URL to an origin/main worktree server for Hero comparison');
          const p = await browser.newPage({ viewport: { width,height } });
          await p.goto(url); await p.locator('.brand-stage.is-3d-ready').waitFor(); await p.evaluate(() => document.fonts.ready);
          if (theme === 'night') await p.locator('.theme-toggle').click();
          await p.waitForTimeout(3200);
          const buffer = await p.screenshot(); fs.writeFileSync(`${folder}/hero-${label}-${name}-${theme}.png`,buffer);
          buffers.push(buffer); await p.close();
        }
        const result = comparePng(buffers[0],buffers[1]);
        heroReport.push({name,theme,...result}); assert.ok(result.maximumChannelDelta <= 1, JSON.stringify(result));
      }
    }
    fs.writeFileSync(`${folder}/visual-check.json`, JSON.stringify({viewports:report,hero:heroReport},null,2));
    console.log(JSON.stringify({screenshots:report.length,hero:heroReport},null,2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
