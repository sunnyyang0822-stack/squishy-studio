const { chromium } = require('playwright');
const fs = require('node:fs');
const folder = 'artifacts/style-hall';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4201';
(async()=>{
  fs.mkdirSync(folder,{recursive:true});
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(fs.existsSync(edge)?edge:undefined)});
  try{
    for(const [name,width,height]of[['desktop',1440,900],['mobile',390,844],['short',320,568],['landscape',844,390]]){
      for(const theme of ['day','night']){
        const page=await browser.newPage({viewport:{width,height}});
        await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
        await page.goto(base+'/collections/');
        await page.locator('.style-art img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:`${folder}/hall-${name}-${theme}.png`,fullPage:true});
        await page.locator('#style-cloud a').click();await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');
        await page.screenshot({path:`${folder}/substitute-${name}-${theme}.png`,fullPage:true});
        await page.close();
      }
    }
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('**/assets/style-thumbnails/*.svg',route=>route.abort());await page.goto(base+'/collections/');
    await page.waitForFunction(()=>[...document.querySelectorAll('.style-art-fallback')].every(el=>!el.hidden));
    await page.screenshot({path:`${folder}/image-failure.png`,fullPage:true});await page.close();
    const context=await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:folder,size:{width:390,height:844}}});
    const demo=await context.newPage(),video=demo.video();
    await demo.addInitScript(()=>localStorage.setItem('squishy-studio-theme','night'));
    await demo.goto(base+'/collections/');await demo.waitForTimeout(600);
    for(const id of ['paw','donut','star']){
      await demo.locator(`#style-${id} a`).scrollIntoViewIfNeeded();await demo.waitForTimeout(350);
      await demo.locator(`#style-${id} a`).click();await demo.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');
      await demo.waitForTimeout(600);await demo.reload();await demo.waitForSelector('.toy-stage[data-state=ready]');
      await demo.waitForTimeout(300);await demo.getByRole('link',{name:'返回合集'}).click();await demo.waitForTimeout(500);
    }
    await context.close();await video.saveAs(`${folder}/gallery-demo.webm`);fs.unlinkSync(await video.path());
    console.log('Captured four viewports × day/night gallery and substitute screens, failure state and navigation video.');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
