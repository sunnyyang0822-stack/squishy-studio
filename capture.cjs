const { chromium } = require('playwright');
const fs = require('node:fs');
(async () => {
 fs.mkdirSync('artifacts', { recursive: true });
 const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined), headless: true });
 const screenshot = async (target, path) => {
   fs.writeFileSync(`${path}.tmp`, await target.screenshot());
   fs.renameSync(`${path}.tmp`, path);
 };
 try {
 for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['mobile-short', { width: 320, height: 568 }]]) {
   const context = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: name === 'desktop' ? { dir: 'artifacts', size: viewport } : undefined });
   const page = await context.newPage();
   await page.goto('http://127.0.0.1:4173');
   await page.evaluate(() => document.fonts.ready);
   await page.locator('.brand-stage.is-3d-ready').waitFor({ timeout: 10000 });
   await page.waitForTimeout(650);
   await screenshot(page, `artifacts/${name}-day.png`);
   if (name === 'desktop') await screenshot(page.locator('.theme-toggle'), 'artifacts/toggle-day.png');
   await page.getByRole('button', { name: '切换到夜晚' }).click();
   await page.waitForTimeout(550);
   if (name === 'desktop') await screenshot(page, 'artifacts/desktop-transition.png');
   await page.waitForTimeout(1100);
   await screenshot(page, `artifacts/${name}-night.png`);
   if (name === 'desktop') await screenshot(page.locator('.theme-toggle'), 'artifacts/toggle-night.png');
   if (name === 'desktop') { await page.getByRole('button', { name: '切换到白天' }).click(); await page.waitForTimeout(550); await screenshot(page, 'artifacts/desktop-night-to-day.png'); await page.getByRole('button', { name: '切换到夜晚' }).click(); await page.waitForTimeout(1250); }
   const video = name === 'desktop' ? page.video() : null;
   await context.close();
   if (video) fs.renameSync(await video.path(), 'artifacts/day-night-demo.webm');
 }
 } finally { await browser.close(); }
})();
