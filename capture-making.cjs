const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');

const folder = join(__dirname, 'artifacts', 'issue-22');
const base = 'http://127.0.0.1:4192';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
async function main() {
  mkdirSync(folder, { recursive: true });
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4192' } });
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || edge, headless: true });
    for (const [name, width, height] of [['desktop',1440,900],['mobile',390,844],['small',320,568],['landscape',844,390]]) {
      for (const theme of ['day','night']) {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600, reducedMotion: 'reduce' });
        await page.addInitScript(t => localStorage.setItem('squishy-studio-theme', t), theme);
        await page.goto(base + '/squishy/cloud/?style=orb');
        await page.waitForSelector('.toy-stage[data-state=ready]');
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(folder, `${name}-${theme}.png`), fullPage: true });
        await page.close();
      }
    }
    const trial = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: folder, size: { width: 1440, height: 900 } } });
    const trialPage = await trial.newPage(), trialVideo = trialPage.video();
    await trialPage.goto(base + '/squishy/cloud/');
    await trialPage.waitForSelector('.toy-stage[data-state=ready]');
    const trialBox = await trialPage.locator('.orb-input').boundingBox();
    await trialPage.mouse.move(trialBox.x + trialBox.width * .4, trialBox.y + trialBox.height * .5);
    await trialPage.mouse.down(); await trialPage.waitForTimeout(700);
    await trialPage.mouse.move(trialBox.x + trialBox.width * .6, trialBox.y + trialBox.height * .45, { steps: 12 });
    await trialPage.mouse.up(); await trialPage.waitForTimeout(500);
    await trialPage.mouse.move(100,250); await trialPage.mouse.down(); await trialPage.mouse.move(280,300,{steps:12}); await trialPage.mouse.up();
    await trialPage.locator('[name=color][value=mint]').check(); await trialPage.waitForTimeout(800);
    await trialPage.locator('[name=color][value=sky]').check(); await trialPage.waitForTimeout(100);
    await trialPage.locator('[name=color][value=lavender]').check(); await trialPage.waitForTimeout(800);
    await trial.close();
    await trialVideo.saveAs(join(folder,'core-squeeze-color.webm'));
    unlinkSync(await trialVideo.path());
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: folder, size: { width: 1440, height: 900 } } });
    const page = await context.newPage();
    const video = page.video();
    await page.goto(base + '/collections/');
    await page.getByRole('link', { name: '选择奶油圆球开始制作' }).click();
    await page.waitForSelector('.toy-stage[data-state=ready]');
    const surface = page.locator('.orb-input');
    const box = await surface.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
    await page.locator('[name=color][value=mint]').check();
    await page.waitForTimeout(900);
    await page.locator('[name=coreMaterial][value=marshmallow]').check();
    await page.locator('[name=filling][value=rice]').check();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.locator('[name=shellColor][value=shell-sky]').check();
    await page.locator('[name=shellMaterial][value=polish]').check();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(folder,'desktop-shell.png'), fullPage: true });
    await page.getByRole('button', { name: '下一步' }).click();
    await page.locator('[name=decoration][value=two]').check();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(folder,'desktop-decoration.png'), fullPage: true });
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(folder,'desktop-making.png'), fullPage: true });
    await page.getByRole('button', { name: '开始捏捏' }).click();
    await page.waitForSelector('.toy-stage[data-state=ready]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(folder,'desktop-play.png'), fullPage: true });
    const final = await surface.boundingBox();
    await page.mouse.move(final.x + final.width / 2, final.y + final.height / 2);
    await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
    await page.waitForTimeout(600);
    await context.close();
    await video.saveAs(join(folder, 'full-flow.webm'));
    unlinkSync(await video.path());
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
