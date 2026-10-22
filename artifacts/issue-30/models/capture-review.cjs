// Run from the repository root after Blender generation.
const { chromium } = require('../../../node_modules/playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 848, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'review.html')).href);
    await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    await page.screenshot({ path: path.join(__dirname, 'review.png'), fullPage: true });
  } finally { await browser.close(); }
})();
