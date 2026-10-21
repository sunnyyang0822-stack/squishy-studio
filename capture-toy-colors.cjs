const { chromium } = require('playwright');
const fs = require('node:fs');
const folder = 'artifacts/toy-colors-motion';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
(async () => {
  fs.mkdirSync(folder,{recursive:true});
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined)});
  try {
    for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
      for (const theme of ['day','night']) {
        const page = await browser.newPage({viewport:{width,height}});
        await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
        await page.goto(base+'/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
        await page.screenshot({path:`${folder}/detail-${name}-${theme}.png`,fullPage:true});
        await page.goto(base+'/#samples');
        await page.locator('.sample-art img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
        await page.evaluate(()=>document.fonts.ready);
        await page.locator('.samples-section').screenshot({path:`${folder}/samples-${name}-${theme}.png`});
        await page.close();
      }
    }
    const context = await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:folder,size:{width:1440,height:900}}});
    const page = await context.newPage(); const video = page.video();
    await page.goto(base+'/squishy/cloud/'); await page.waitForSelector('[data-state=ready]'); await page.waitForTimeout(500);
    for (const [value,pause] of [['mint',180],['lavender',130],['peach',750],['sky',750]]) {
      await page.locator(`[name=color][value=${value}]`).check(); await page.waitForTimeout(pause);
    }
    await page.getByRole('link',{name:'返回合集'}).click(); await page.getByRole('link',{name:'返回首页样例'}).click();
    await page.locator('.sample-art img').evaluateAll(images=>Promise.all(images.map(image=>image.decode()))); await page.waitForTimeout(650);
    await page.locator('.theme-toggle').click(); await page.waitForTimeout(1300);
    await page.evaluate(()=>document.getElementById('samples').scrollIntoView()); await page.waitForTimeout(1000);
    await page.locator('.collection-link').hover(); await page.waitForTimeout(300); await page.locator('.collection-link').click();
    await page.getByRole('link',{name:'体验圆球捏压原型'}).click(); await page.waitForSelector('[data-state=ready]'); await page.waitForTimeout(700);
    await page.locator('[name=color][value=mint]').check(); await page.waitForTimeout(750);
    await context.close(); await video.saveAs(`${folder}/motion-demo.webm`); fs.unlinkSync(await video.path());
    console.log('已生成桌面、手机的昼夜详情／样例截图，以及连续操作录屏。');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
