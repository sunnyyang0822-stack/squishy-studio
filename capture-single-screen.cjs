const { chromium } = require('playwright');
const fs = require('node:fs');
const phase = process.argv[2] || 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after');
const folder = 'artifacts/single-screen';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4195';
(async () => {
  fs.mkdirSync(folder, { recursive:true });
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = [];
  try {
    for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['compact',375,667],['short',320,568],['landscape',844,390]]) {
      for (const theme of ['day','night']) {
        const page = await browser.newPage({ viewport:{width,height} });
        await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
        await page.goto(base+'/squishy/cloud/');
        await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:`${folder}/${phase}-${name}-${theme}.png`});
        report.push(await page.evaluate(({name,theme})=>({name,theme,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,stage:document.querySelector('.toy-stage').getBoundingClientRect().toJSON(),settings:document.querySelector('.customization').getBoundingClientRect().toJSON()}),{name,theme}));
        await page.close();
      }
    }
    fs.writeFileSync(`${folder}/${phase}.json`,JSON.stringify(report,null,2));
    if (phase === 'after') {
      const context = await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:folder,size:{width:390,height:844}}});
      const page = await context.newPage(); const video = page.video();
      await page.goto(base+'/squishy/cloud/'); await page.waitForSelector('.toy-stage[data-state=ready] .orb-input');
      await page.waitForTimeout(500);
      for (const height of [667,568,744,844]) {
        await page.setViewportSize({width:390,height}); await page.waitForTimeout(600);
        await page.locator('[value=lemon]').check(); await page.waitForTimeout(300);
        await page.locator('[value=rose]').check();
      }
      const toy = await page.locator('.orb-input').boundingBox();
      await page.mouse.move(toy.x+toy.width*.45,toy.y+toy.height*.45); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); await page.waitForTimeout(450);
      await context.close(); await video.saveAs(`${folder}/viewport-demo.webm`); fs.unlinkSync(await video.path());
    }
    console.log(report.map(({name,theme,height,scrollHeight})=>({name,theme,height,scrollHeight})));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
