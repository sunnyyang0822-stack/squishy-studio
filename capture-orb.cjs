const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = 'artifacts/issue-16';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4190';
const ready = page => page.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');
const sizes = [['desktop',1440,900],['mobile',390,844],['compact',375,667],['short',320,568],['landscape',844,390]];
const shot = (page, name) => page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = { browser: browser.version(), os: `${os.platform()} ${os.release()} ${os.arch()}`, device: 'Desktop host, headless browser; mobile viewports are emulation, not physical phones', modelBytes: fs.statSync('assets/models/squishy-orb.glb').size, viewports: [], errors: [] };
  try {
    for (const [name,width,height] of sizes) {
      const context = await browser.newContext({ viewport:{width,height}, hasTouch:width < 600, reducedMotion:'reduce' });
      for (const theme of ['day','night']) {
        const page = await context.newPage();
        page.on('pageerror', e => report.errors.push(e.message));
        await page.addInitScript(t => localStorage.setItem('squishy-studio-theme', t), theme);
        await page.goto(base + '/squishy/cloud/'); await ready(page); await page.evaluate(() => document.fonts.ready);
        await shot(page, `${name}-${theme}`);
        const metrics = await page.evaluate(() => {
          const canvas=document.querySelector('.toy-mount canvas');
          const gl=canvas.getContext('webgl2');
          const debug=gl.getExtension('WEBGL_debug_renderer_info');
          const model=performance.getEntriesByType('resource').find(item=>item.name.endsWith('squishy-orb.glb'));
          const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
          return {stage:box('.toy-stage'), settings:box('.customization'), canvas:[canvas.width,canvas.height], dpr:devicePixelRatio, renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER), modelLoadMs:model?.duration, renderCount:document.querySelector('.toy-mount').dataset.renderCount, overflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert.equal(metrics.overflow,false);
        report.viewports.push({name,width,height,theme,...metrics});
        const count=metrics.renderCount;
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'),count);
        if(name==='desktop'&&theme==='day') {
          await page.locator('.toy-stage').evaluate(el=>{el.style.width='800px';el.style.height='640px';el.style.maxWidth='none';});
          await page.waitForTimeout(100);
          await page.locator('.toy-stage').screenshot({path:`${folder}/browser-orb.png`});
        }
        await page.close();
      }
      await context.close();
    }
    const failure=await browser.newPage({viewport:{width:390,height:844}});
    await failure.route('**/squishy-orb.glb',r=>r.abort());
    await failure.goto(base+'/squishy/cloud/');await failure.waitForSelector('[data-state=error]');await shot(failure,'load-failure');
    await failure.unroute('**/squishy-orb.glb');await failure.locator('.retry-button').click();await ready(failure);await failure.close();
    const unavailable=await browser.newPage({viewport:{width:390,height:844}});
    await unavailable.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};});
    await unavailable.goto(base+'/squishy/cloud/');await unavailable.waitForSelector('[data-state=unavailable]');await shot(unavailable,'webgl-unavailable');await unavailable.close();

    // Side-by-side comparison uses real Blender render and real browser capture.
    const comparison=await browser.newPage({viewport:{width:1200,height:550},deviceScaleFactor:1});
    const data=file=>'data:image/png;base64,'+fs.readFileSync(`${folder}/${file}`).toString('base64');
    await comparison.setContent(`<html lang="zh-CN"><style>body{margin:0;background:#f4eaf0;color:#493954;font:18px sans-serif}main{display:flex}figure{width:50%;margin:0}h2{font-size:20px;margin:24px}img{width:100%;height:450px;object-fit:contain}p{font-size:14px;margin:0 24px}</style><main><figure><h2>Blender 4.4 · 同一资产</h2><img src="${data('blender-orb.png')}"/></figure><figure><h2>浏览器 · Three.js GLB</h2><img src="${data('browser-orb.png')}"/></figure></main><p>轮廓与顶点色来自同一网格；灯光、环境和色调映射不同。浏览器接触阴影由场景补充。</p></html>`);
    await comparison.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    await shot(comparison,'blender-browser-comparison');await comparison.close();

    const tempVideo=fs.mkdtempSync(path.join(os.tmpdir(),'squishy-orb-video-'));
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,recordVideo:{dir:tempVideo,size:{width:390,height:844}}});
    const page=await context.newPage();const video=page.video();
    await page.goto(base+'/collections/');await page.waitForTimeout(400);
    await page.getByRole('link',{name:'体验圆球捏压原型'}).click();await ready(page);await page.waitForTimeout(800);
    for(const value of ['rose','mint','sky','lavender','cream']) {await page.locator(`[name=color][value=${value}]`).check();await page.waitForTimeout(700);}
    await page.evaluate(()=>{localStorage.setItem('squishy-studio-theme','night');document.documentElement.dataset.theme='night';});await page.waitForTimeout(800);
    await page.route('**/squishy-orb.glb',r=>r.abort());await page.reload();await page.waitForSelector('[data-state=error]');await page.waitForTimeout(650);
    await page.unroute('**/squishy-orb.glb');await page.locator('.retry-button').click();await ready(page);await page.waitForTimeout(800);
    await page.getByRole('link',{name:'返回合集'}).click();await page.waitForTimeout(400);
    await context.close();await video.saveAs(`${folder}/appearance-walkthrough.webm`);
    fs.unlinkSync(await video.path());fs.rmdirSync(tempVideo);
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(`${folder}/environment.json`,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({screenshots:report.viewports.length,modelBytes:report.modelBytes,browser:report.browser,errors:report.errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
