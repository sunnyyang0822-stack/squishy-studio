const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {installStyleProbe,ready,rotate}=require('../tests/helpers/squishy-browser.cjs');
const {projectedMeshContact,geometryOK}=require('../tests/helpers/wax-style-probe.cjs');
const folder=path.resolve('.tmp/issue-41/cavities'),base='http://127.0.0.1:4242';
(async()=>{
  fs.mkdirSync(folder,{recursive:true});
  const old=execFileSync('git',['show','47ece9e:assets/orb-preview.js']),{getSquishyStyle}=await import('../src/squishy-styles.mjs');
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),report=[];
  try{for(const id of ['donut','paw'])for(const version of ['before','after']){
    const context=await browser.newContext({viewport:{width:1280,height:900},recordVideo:{dir:folder,size:{width:1280,height:900}}});
    const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      if(version==='before')await page.route('**/assets/orb-preview.js',route=>route.fulfill({contentType:'text/javascript',body:old}));
      const mesh=await installStyleProbe(page,getSquishyStyle(id));
      await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell`);await ready(page);await page.waitForTimeout(700);
      const hit=await projectedMeshContact(page,mesh,id);
      await page.screenshot({path:path.join(folder,`${id}-${version}-intact.png`)});
      await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.waitForTimeout(720);
      await page.screenshot({path:path.join(folder,`${id}-${version}-falling.png`)});
      await page.waitForTimeout(800);await page.mouse.up();
      const d=await page.locator('.toy-mount').evaluate(el=>el.thinWaxDiagnostics({measure:true,exhaustive:true}));geometryOK(d);
      await rotate(page,60,12);await page.waitForTimeout(150);await page.screenshot({path:path.join(folder,`${id}-${version}-side.png`)});
      if(errors.length)throw Error(errors.join('\n'));
      report.push({id,version,baseline:version==='before'?'47ece9e':'current local build',actualContact:hit,physicalPhone:false,detached:d.thinWax.detached,panels:d.geometry.patches,thickness:d.geometry.thickness,attachedViolations:d.geometry.attachedViolations,detachedViolations:d.geometry.detachedViolations});
    }finally{await context.close();await video.saveAs(path.join(folder,`${id}-${version}.webm`));}
  }}finally{await browser.close();}
  fs.writeFileSync(path.join(folder,'measurements.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(folder,'review.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>凹陷与内环碎块对照</title><style>body{font:16px/1.6 system-ui;background:#faf7f8;color:#382b36;margin:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}img,video{width:100%}figure{margin:0}a{color:#943d70}@media(max-width:650px){main{grid-template-columns:1fr}}</style><h1>甜甜圈内环与猫爪凹陷：实际大块对照</h1><p>左：上一版中蜡（47ece9e）；右：本次中蜡。厚度均0.028，同模型、颜色、相机和正常速度按压。图像未放大碎片。</p>${['donut','paw'].map(id=>`<h2>${id==='donut'?'甜甜圈内环':'猫爪趾根凹陷'}</h2><p><a target="_blank" href="/squishy/cloud/?style=${id}&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell">打开新版交互</a></p><main>${['before','after'].map(v=>`<figure><figcaption>${v==='before'?'上一版':'新版'}</figcaption><img src="${id}-${v}-falling.png"><video controls muted playsinline preload="metadata" src="${id}-${v}.webm"></video><img src="${id}-${v}-side.png"></figure>`).join('')}</main>`).join('')}`);
  console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
