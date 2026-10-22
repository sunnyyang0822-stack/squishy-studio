const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4230';
const gallery = import('../collections/styles.mjs');
let browser, server;
before(async () => {
  server = spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4230'}});
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();server?.kill()});
const ready=page=>page.waitForSelector('.toy-stage[data-state=ready] .toy-mount[data-render-count] canvas');

test('八种样式登记与静态入口一致；展示ID不进入真实模型登记或配方',async()=>{
  const {galleryStyles,galleryHref,previewStyle}=await gallery;
  assert.equal(galleryStyles.length,8);
  assert.equal(new Set(galleryStyles.map(s=>s.id)).size,8);
  assert.equal(galleryStyles.filter(s=>s.placeholder).length,7);
  assert.equal(previewStyle('missing'),undefined);assert.equal(previewStyle('orb'),undefined);
  const {styleNames,defaultRecipe}=await import('../detail/state.mjs');
  assert.deepEqual(Object.keys(styleNames),['orb']);assert.equal(defaultRecipe.styleId,'orb');
  const page=await browser.newPage();await page.goto(base+'/collections/');
  assert.equal(await page.locator('.style-card').count(),8);
  for(const style of galleryStyles){
    const card=page.locator(`#style-${style.id}`);
    assert.equal(await card.getByRole('heading').innerText(),style.name);
    assert.equal(await card.locator('a').getAttribute('href'),galleryHref(style));
    assert.equal(await card.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    assert.match(await card.locator('.style-state').innerText(),style.placeholder?/准备中/:/可制作/);
    assert.equal(await card.locator('img').evaluate(img=>getComputedStyle(img).filter),'none');
  }
  assert.equal(await page.locator('canvas').count(),0,'大厅不新增WebGL场景');
  assert.equal(await page.locator('.collection-pending').count(),0,'已删除旧合集占位卡片');
  assert.equal(await page.getByText('柔软的一刻',{exact:true}).count(),0);
  for(const style of galleryStyles){
    const svg=readFileSync(`assets/style-thumbnails/${style.id}.svg`,'utf8');
    assert.ok(!/<script|(?:xlink:)?href=["']https?:|<image|<foreignObject/.test(svg),'原创SVG没有外部依赖');
  }
  await page.close();
});

test('七个新入口均进入真实圆球；刷新、返回原样式、昼夜状态一致',async()=>{
  const {galleryStyles}=await gallery;
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('squishy-studio-theme','night'));
  for(const style of galleryStyles.filter(s=>s.placeholder)){
    const models=[];const onRequest=request=>{if(request.url().includes('.glb'))models.push(new URL(request.url()).pathname)};
    page.on('request',onRequest);
    await page.goto(base+'/collections/');await page.locator(`#style-${style.id} a`).click();await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('preview'),style.id);
    assert.equal(new URL(page.url()).searchParams.get('style'),'orb');
    assert.match(await page.locator('.style-placeholder-note').innerText(),new RegExp(`${style.name}造型准备中.*圆球`));
    assert.equal(await page.locator('.toy-area').getAttribute('aria-label'),'奶油圆球');
    assert.deepEqual([...new Set(models)],['/assets/models/squishy-orb.glb']);
    await page.reload();await ready(page);
    assert.equal(await page.locator('.style-placeholder-note').isVisible(),true);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
    await page.getByRole('link',{name:'返回合集'}).click();
    assert.equal(new URL(page.url()).hash,`#style-${style.id}`);
    assert.equal(await page.locator(`#style-${style.id}`).isVisible(),true);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
    page.off('request',onRequest);
  }
  await page.goto(base+'/squishy/cloud/?style=orb');await ready(page);
  assert.equal(await page.locator('.style-placeholder-note').isVisible(),false);
  assert.equal(await page.getByRole('link',{name:'返回合集'}).getAttribute('href'),'/collections/');
  await page.goto(base+'/squishy/cloud/?style=orb&preview=%3Cscript%3E');await ready(page);
  assert.equal(new URL(page.url()).searchParams.has('preview'),false);
  assert.equal(await page.locator('.style-placeholder-note').isVisible(),false);
  assert.deepEqual(errors,[]);await page.close();
});

test('占位样式保留五步制作及试捏入口，不改变模板；浏览器返回保留提示',async()=>{
  const page=await browser.newPage({reducedMotion:'reduce'});
  await page.goto(base+'/squishy/cloud/?style=orb&preview=paw');await ready(page);
  const canvas=await page.locator('.toy-mount canvas').elementHandle();
  for(const step of ['shell','decoration','making']){
    await page.getByRole('button',{name:'下一步'}).click();
    assert.equal(await page.locator(`.workflow-progress [data-step=${step}]`).getAttribute('aria-current'),'step');
    assert.match(page.url(),/preview=paw/);
    assert.equal(await page.locator('.style-placeholder-note').isVisible(),true);
  }
  await page.getByRole('button',{name:'开始捏捏'}).click();await ready(page);
  assert.equal(await page.locator('.workflow-progress [data-step=play]').getAttribute('aria-current'),'step');
  assert.equal(await canvas.evaluate(el=>el===document.querySelector('.toy-mount canvas')),true);
  await page.getByRole('button',{name:'返回修改'}).click();
  assert.equal(await page.locator('.workflow-progress [data-step=decoration]').getAttribute('aria-current'),'step');
  await page.goBack();
  assert.equal(await page.locator('.style-placeholder-note').isVisible(),true);
  await page.close();
});

test('五种尺寸昼夜大厅无溢出、入口44px；详情提示不重叠；键盘与触屏可进入',async()=>{
  for(const [width,height]of[[1440,900],[390,844],[375,667],[320,568],[844,390]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<600,reducedMotion:'reduce'});
    const page=await context.newPage();
    for(const theme of ['day','night']){
      await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
      await page.goto(base+'/collections/');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const link of await page.locator('.style-entry').all()){
        const box=await link.boundingBox();assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));
      }
      const link=page.locator('#style-star a');await link.scrollIntoViewIfNeeded();
      if(width===390){await Promise.all([page.waitForURL('**/squishy/cloud/**'),link.tap()])}
      else{await link.focus();assert.equal(await page.locator('#style-star').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.keyboard.press('Enter')}
      await ready(page);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      const geometry=await page.locator('.style-placeholder-note,.toy-stage,.step-panel').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
      assert.ok(geometry[0].bottom<=geometry[1].top+1,'提示不盖住画布');
      assert.ok(geometry[1].right<=geometry[2].left||geometry[1].bottom<=geometry[2].top,'主体和设置不重叠');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const before=await page.locator('.style-placeholder-note').innerText();await page.reload();await ready(page);
      assert.equal(await page.locator('.style-placeholder-note').innerText(),before);
    }
    await context.close();
  }
});

test('缩略图全部失败时仍有名称与完整入口，布局不塌陷；无JavaScript时静态大厅仍可用',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/assets/style-thumbnails/*.svg',route=>route.abort());
  await page.goto(base+'/collections/');
  await page.waitForFunction(()=>[...document.querySelectorAll('.style-art-fallback')].every(el=>!el.hidden));
  assert.equal(await page.locator('.style-entry').count(),8);
  for(const art of await page.locator('.style-art').all()){const box=await art.boundingBox();assert.ok(box.height>90)}
  await page.locator('#style-donut a').click();await ready(page);
  assert.match(await page.locator('.style-placeholder-note').innerText(),/甜甜圈/);await page.close();
  const noJs=await browser.newPage({javaScriptEnabled:false});await noJs.goto(base+'/collections/');
  assert.equal(await noJs.getByRole('heading',{name:'云朵',exact:true}).isVisible(),true);
  assert.equal(await noJs.locator('.style-entry').count(),8);await noJs.close();
});
