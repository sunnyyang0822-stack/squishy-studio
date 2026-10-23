const { chromium } = require('playwright');
const fs = require('node:fs');
const folder = 'artifacts/home-sample-links';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4202';
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  try {
    for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['compact',375,667],['short',320,568],['landscape',844,390]]) {
      const page = await browser.newPage({ viewport:{width,height}, reducedMotion:'reduce' });
      for (const theme of ['day','night']) {
        await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
        await page.goto(base); await page.evaluate(()=>document.fonts.ready);
        await page.locator('.brand-stage.is-3d-ready').waitFor();
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.brand-canvas')).opacity==='1');
        if (name==='desktop'||name==='mobile') await page.screenshot({path:`${folder}/hero-${name}-${theme}.png`});
        await page.locator('#samples').scrollIntoViewIfNeeded();
        await page.locator('.sample-art img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
        await page.locator('#samples').screenshot({path:`${folder}/samples-${name}-${theme}.png`});
      }
      await page.close();
    }
    const context=await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:folder,size:{width:390,height:844}}});
    const page=await context.newPage(); const video=page.video();
    await page.goto(base+'/#samples');
    for(const id of ['cloud','paw','donut','flower']) {
      await page.locator(`.sample a[href$="preview=${id}"]`).click();
      await page.locator('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas').waitFor();
      await page.waitForTimeout(350); await page.goBack();
    }
    await context.close(); await video.saveAs(`${folder}/sample-navigation.webm`); fs.unlinkSync(await video.path());
    console.log('Captured five viewports, day/night and four sample navigation video.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
