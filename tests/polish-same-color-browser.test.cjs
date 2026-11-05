const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const captureEvidence = process.env.CI !== 'true';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve('artifacts/issue-50/conditional-rim');
const port=process.env.POLISH_RIM_PORT||'4254',base='http://127.0.0.1:'+port;
let browser,server;
before(async()=>{
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync('.tmp/runtime',{recursive:true});process.env.TEMP=path.resolve('.tmp/runtime');process.env.TMP=process.env.TEMP;
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port}});
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();server?.kill();});
for(const core of ['clay','marshmallow','butter']) for(const sameColor of [true,false]) test(core+': '+(sameColor?'same pigment has rims':'different pigments have no rims')+' without changing real apertures',{timeout:90000},async()=>{
 const p=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1}),errors=[];
 try{
  p.on('pageerror',e=>errors.push(String(e)));p.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await p.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  await p.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);
    if(type==='webgl2'&&gl&&!gl.sameColorDrawHook){
     window.sameColorGL=gl;gl.sameColorDrawHook=true;
     const draw=gl.drawElements.bind(gl),originals=new WeakMap();
     gl.drawElements=(...a)=>{
      const program=gl.getParameter(gl.CURRENT_PROGRAM),location=gl.getUniformLocation(program,'polishRimEnabled');
      if(location!==null){
       if(!originals.has(program))originals.set(program,gl.getUniform(program,location));
       // Compare both treatments on one frozen mesh. Separate presses can
       // differ by a frame even with identical wall-clock durations.
       window.sameColorOriginalRim=originals.get(program);
       gl.uniform1f(location,window.disableSameColorRim?0:originals.get(program));
      }
      const result=draw(...a);window.sameColorDrawRevision=(window.sameColorDrawRevision||0)+1;return result;
     };
    }
    return gl;
   };
   const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(time=>{
    callback(time);if(!window.sampleSameColor||!(window.sameColorDrawRevision>window.sameColorAfterRevision))return;
    window.sampleSameColor=false;const gl=window.sameColorGL,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,data=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);window.sameColorPixels=Array.from(data);
   });
  });
  await p.goto(base+'/squishy/cloud/?style=orb&coreMaterial='+core+'&shellMaterial=polish&step=shell'+(sameColor?'':'&coreColor=mint&shellColor=rose'));
  await p.waitForFunction(()=>document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  const box=await p.locator('.orb-input').boundingBox();await p.mouse.move(box.x+box.width*.5,box.y+box.height*.46);await p.mouse.down();
  await p.waitForTimeout(3300);await p.mouse.up();
  if(core==='butter')await p.waitForFunction(()=>{const d=document.querySelector('.toy-mount').polishDiagnostics();return d.corePositions.every((v,i)=>v===d.coreRestPositions[i]);},null,{timeout:25000});
  else await p.waitForTimeout(500);
  await p.evaluate(()=>{window.rimRest={count:document.querySelector('.toy-mount').dataset.renderCount,since:performance.now()};});
  await p.waitForFunction(()=>{const now=performance.now(),count=document.querySelector('.toy-mount').dataset.renderCount;
   if(count!==window.rimRest.count)window.rimRest={count,since:now};return now-window.rimRest.since>200;});
  const geometryBefore=await p.locator('.toy-mount').evaluate(e=>e.polishDiagnostics().corePositions),renders=[];
  for(const rim of [false,true]){
   await p.evaluate(rim=>{window.disableSameColorRim=!rim;window.sameColorPixels=null;window.sampleSameColor=true;window.sameColorAfterRevision=window.sameColorDrawRevision||0;document.documentElement.dataset.theme='day';},rim);
   await p.waitForFunction(()=>window.sameColorPixels);
   assert.equal(await p.evaluate(()=>window.sameColorOriginalRim),sameColor?1:0,'Actual material uniform follows pigment equality');
   const d=await p.locator('.toy-mount').evaluate(e=>{const d=e.polishDiagnostics();return {enabled:d.enabled,state:d.state,metrics:d.metrics,core:d.coreColor,shell:d.shellColor,positions:d.corePositions};});
   assert.equal(d.core,sameColor?'rose':'mint');assert.equal(d.shell,'rose');assert.equal(d.enabled,true);assert.equal(d.state.rimEnabled,sameColor);assert.equal(d.metrics.violations,0);
   assert.deepEqual(d.positions,geometryBefore,'Both GPU treatments use the exact same core surface');
   if (captureEvidence) await p.screenshot({path:path.join(out,core+'-'+(sameColor?'same':'different')+'-'+(rim?'visible-rim':'rim-disabled-control')+'.png')});
   renders.push({pixels:await p.evaluate(()=>window.sameColorPixels),state:d.state});
  }
  let darker=0,opaque=0,alphaMismatch=0;
  const a=renders[0].pixels,b=renders[1].pixels;assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i+=4){if(a[i+3]!==b[i+3])alphaMismatch++;if(a[i+3]<254||b[i+3]<254)continue;opaque++;
   const delta=(a[i]+a[i+1]+a[i+2]-b[i]-b[i+1]-b[i+2])/3;if(delta>12)darker++;
  }
  assert.ok(opaque>10000,'Read an actual opaque rendered core');
  if(sameColor)assert.ok(darker>100,'Same-color visible edge pixels '+darker);
  else assert.equal(darker,0,'Different colors exactly match the rendering with rim shading disabled');
  assert.ok(darker/opaque<.04,'Only narrow crack rims change, not broad surface darkness');
  assert.equal(alphaMismatch,0,'Contrast treatment does not make holes through the core or enlarge silhouette');
  assert.deepEqual(renders[0].state,renders[1].state,'Pigment treatment preserves all damage and aperture state');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,core+'-'+(sameColor?'same':'different')+'.json'),JSON.stringify({darkerPixels:darker,opaque,alphaMismatch,states:renders.map(r=>r.state)},null,2));
 }finally{await p.close();}
});
