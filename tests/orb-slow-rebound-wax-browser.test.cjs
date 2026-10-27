const { test, before, after }=require('node:test');
const assert=require('node:assert/strict');
const { spawn }=require('node:child_process');
const { existsSync,mkdirSync }=require('node:fs');
const { chromium }=require('playwright');
const { installStyleProbe,ready,rotate }=require('./helpers/squishy-browser.cjs');
const { installWaxStyleProbe,projectedMeshContact,geometryOK }=require('./helpers/wax-style-probe.cjs');
const { armWaxUploadEnd,readWaxUploadEnd }=require('./helpers/wax-upload-observer.cjs');
const port=process.env.SLOW_WAX_TEST_PORT||'4261',record=process.env.SLOW_WAX_RECORD==='1';let server,browser;
before(async()=>{server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port}});for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(existsSync(edge)?edge:undefined),args:process.env.THIN_WAX_SOFTWARE_GL==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});});
after(async()=>{await browser?.close();server?.kill();});
const diagnostic=(page,options={measure:false})=>page.locator('.toy-mount').evaluate((el,o)=>el.thinWaxDiagnostics(o),options);
const depth=d=>{let v=0;for(let i=0;i<d.corePositions.length;i+=3)v=Math.max(v,Math.hypot(...[0,1,2].map(k=>d.corePositions[i+k]-d.coreRestPositions[i+k])));return v;};
for(const mobile of [false,true])test(`local slow-rebound orb wax: real ${mobile?'touch/night':'mouse/day'} collapse, rebound, persistent damage and configuration`,{timeout:120000},async t=>{
  mkdirSync('.tmp/slow-wax-video',{recursive:true});const viewport=mobile?{width:390,height:844}:{width:1280,height:900};
  const name=`slow-orb-${mobile?'mobile-night':'desktop-day'}`;
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:Number(process.env.THIN_WAX_TEST_DPR||1),...(record?{recordVideo:{dir:'.tmp/slow-wax-video',size:viewport}}:{})});const page=await context.newPage(),video=page.video();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    const { getSquishyStyle }=await import('../src/squishy-styles.mjs');const mesh=await installStyleProbe(page,getSquishyStyle('orb'));await installWaxStyleProbe(page);
    await page.goto(`http://127.0.0.1:${port}/squishy/cloud/?style=orb&coreMaterial=butter&coreColor=mint&shellColor=rose&waxThickness=thin&step=core`);await ready(page);
    if(mobile)await page.evaluate(()=>document.documentElement.dataset.theme='night');
    assert.equal((await diagnostic(page)).enabled,false);const bare=await page.locator('.orb-input').boundingBox(),coreRender=Number(await page.locator('.toy-mount').getAttribute('data-render-count'));await page.locator('.step-next').click();await page.waitForFunction(before=>{const el=document.querySelector('.toy-mount');return el.thinWaxDiagnostics({measure:false}).enabled&&Number(el.dataset.renderCount)>before;},coreRender);
    const shell=await page.locator('.orb-input').boundingBox();for(const k of ['x','y','width','height'])assert.ok(Math.abs(bare[k]-shell[k])<1);
    await page.waitForFunction(()=>{const d=document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false,surface:true});return [...window.waxGPUObserver.buffers.values()].some(b=>b.length===d.surface.positions.length&&b.every((v,i)=>Math.abs(v-d.surface.positions[i])<=1e-6));});
    const initial=await diagnostic(page);assert.notEqual(initial.coreColor,initial.shellColor);assert.equal(initial.debrisStage.visible,false);assert.equal(await page.locator('.toy-mount').getAttribute('data-appearance-id'),'full-matte');
    const client=await context.newCDPSession(page);if(process.env.THIN_WAX_CPU_RATE)await client.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.THIN_WAX_CPU_RATE)});
    async function press(){const p=await projectedMeshContact(page,mesh,'orb');if(mobile)await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:0}]});else{await page.mouse.move(p.x,p.y);await page.mouse.down();}}
    async function release(){if(mobile)await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();}
    await armWaxUploadEnd(page,{minimumDepth:.0001});await press();const short=await readWaxUploadEnd(page);await release();assert.equal(short.state.detached,0);assert.ok(short.state.cracked>0);if(record)await page.screenshot({path:`artifacts/issue-38/${name}-short.png`});
    await page.getByRole('button',{name:'重新开始',exact:true}).click();await page.waitForFunction(()=>{const d=document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false});return !d.coreState.restoring&&d.corePositions.every((v,i)=>v===d.coreRestPositions[i]);});
    await page.locator('.toy-mount').evaluate(el=>{window.slowWaxClock={};const observe=()=>{const s=el.thinWaxDiagnostics({measure:false}).thinWax;if(!s.active)return;if(s.dwell<=.5)window.slowWaxClock.before=s;else if(!window.slowWaxClock.first)window.slowWaxClock.first=s;};window.waxStyleObservers.add(observe);});
    await press();await page.waitForTimeout(1500);const loaded=await diagnostic(page,{exhaustive:true});geometryOK(loaded);assert.ok(depth(loaded)>.3);const timing=await page.evaluate(()=>window.slowWaxClock);assert.equal(timing.before.detached,0);assert.ok(timing.first.dwell>.5&&timing.first.detached>0);if(record)await page.screenshot({path:`artifacts/issue-38/${name}-deep.png`});await release();
    const released=await diagnostic(page),damage=released.thinWax;await page.waitForTimeout(350);const recovering=await diagnostic(page,{exhaustive:true});geometryOK(recovering);assert.ok(depth(recovering)<depth(released)&&depth(recovering)>.001);assert.equal(recovering.thinWax.detached,damage.detached);assert.equal(recovering.thinWax.cracked,damage.cracked);
    await rotate(page,30,8);if(record)await page.screenshot({path:`artifacts/issue-38/${name}-rebound-side.png`});geometryOK(await diagnostic(page,{exhaustive:true}));
    await page.waitForFunction(()=>{const d=document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false});return d.corePositions.every((v,i)=>v===d.coreRestPositions[i]);},null,{timeout:25000});
    const restored=await diagnostic(page,{exhaustive:true,surface:true});geometryOK(restored);assert.equal(restored.thinWax.detached,damage.detached);assert.equal(restored.thinWax.cracked,damage.cracked);assert.equal(restored.thinWax.living,0);
    const gpuError=await page.evaluate(()=>{const d=document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false,surface:true});let error=Infinity;for(const v of window.waxGPUObserver.buffers.values())if(v.length===d.surface.positions.length){let e=0;for(let i=0;i<v.length;i++)e=Math.max(e,Math.abs(v[i]-d.surface.positions[i]));error=Math.min(error,e);}return error;});assert.ok(gpuError<=1e-6);
    if(record)await page.screenshot({path:`artifacts/issue-38/${name}-rebounded.png`});await page.locator('.step-next').click();await page.locator('.step-back').click();await page.waitForTimeout(200);assert.equal((await diagnostic(page)).thinWax.detached,damage.detached);
    await page.getByRole('button',{name:'重新开始',exact:true}).click();await page.waitForTimeout(500);assert.equal((await diagnostic(page)).thinWax.detached,0);assert.deepEqual(errors,[]);
    t.diagnostic(JSON.stringify({mobile,bare,shell,shortMs:short.elapsed,onset:timing.first.dwell,loadedDepth:depth(loaded),releasedDepth:depth(released),recoveringDepth:depth(recovering),reboundedDepth:depth(restored),retainedDetached:damage.detached,gpuError,geometry:restored.geometry}));
  }finally{await context.close();if(record)await video.saveAs(`artifacts/issue-38/${name}.webm`);}
});

test('clay, marshmallow and slow-rebound share identical real model matrices and bare/shell screen bounds', {timeout:120000}, async t=>{
 const {getSquishyStyle}=await import('../src/squishy-styles.mjs');const measured=[];
 for(const mobile of [false,true]){
  const viewport=mobile?{width:390,height:844}:{width:1280,height:900},page=await browser.newPage({viewport,isMobile:mobile,hasTouch:mobile});await installStyleProbe(page,getSquishyStyle('orb'));
  try{let baseline;
   for(const coreMaterial of ['clay','marshmallow','butter']){
    await page.goto(`http://127.0.0.1:${port}/squishy/cloud/?style=orb&coreMaterial=${coreMaterial}&coreColor=mint&shellColor=rose&waxThickness=thin&step=core`);await ready(page);
    const bare=await page.locator('.orb-input').boundingBox(),matrix=await page.evaluate(()=>window.styleProbe.mainMatrix);
    if(!baseline)baseline={bare,matrix};
    for(const k of ['x','y','width','height'])assert.ok(Math.abs(bare[k]-baseline.bare[k])<.02,`${coreMaterial}/${mobile}/${k}`);
    assert.ok(Math.max(...matrix.map((v,i)=>Math.abs(v-baseline.matrix[i])))<1e-6,'Actual uploaded model-view transforms, including depth proportions, match the established orb');
    if(coreMaterial==='butter'&&record)await page.screenshot({path:`artifacts/issue-38/slow-orb-aligned-${mobile?'mobile':'desktop'}-core.png`});
    await page.locator('.step-next').click();await page.waitForFunction(()=>document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false}).enabled);const shell=await page.locator('.orb-input').boundingBox();for(const k of ['x','y','width','height'])assert.ok(Math.abs(shell[k]-baseline.bare[k])<.02);
    if(coreMaterial==='butter'&&record)await page.screenshot({path:`artifacts/issue-38/slow-orb-aligned-${mobile?'mobile':'desktop'}-shell.png`});measured.push({mobile,coreMaterial,bare,shell,matrix});
   }
  }finally{await page.close();}
 }
 t.diagnostic(JSON.stringify(measured));
});
