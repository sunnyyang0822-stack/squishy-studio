const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve('artifacts/issue-50/conditional-rim');
let browser,server;
before(async()=>{
 fs.mkdirSync(out,{recursive:true});process.env.TEMP=path.resolve('.tmp/runtime');process.env.TMP=process.env.TEMP;
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4254'}});
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:4254')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge)?edge:undefined)});
});
after(async()=>{await browser?.close();server?.kill();});
for(const core of ['clay','marshmallow','butter']) for (const sameColor of [true, false]) test(`${core}: ${sameColor ? 'same pigment has rims' : 'different pigments have no rims'} without changing real apertures`,{timeout:40000},async()=>{
 const renders=[];
 for(const rim of [false,true]){
  const p=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});const errors=[];
  p.on('pageerror',e=>errors.push(String(e)));p.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await p.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  if(!rim)await p.route('**/assets/orb-preview.js*',async route=>{
   const response=await route.fetch(),body=await response.text();
   assert.ok(body.includes('diffuseColor.rgb*=1.-rim*polishRimEnabled;'));
   await route.fulfill({response,body:body.replace('diffuseColor.rgb*=1.-rim*polishRimEnabled;','diffuseColor.rgb*=1.;')});
  });
  await p.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){const g=get.call(this,type,...args);if(type==='webgl2')window.sameColorGL=g;return g;};
   const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(time=>{
    callback(time);if(!window.sampleSameColor)return;window.sampleSameColor=false;
    const gl=window.sameColorGL,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,data=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);window.sameColorPixels=Array.from(data);
   });
  });
  await p.goto(`http://127.0.0.1:4254/squishy/cloud/?style=orb&coreMaterial=${core}&shellMaterial=polish&step=shell${sameColor ? '' : '&coreColor=mint&shellColor=rose'}`);
  await p.waitForFunction(()=>document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  const box=await p.locator('.orb-input').boundingBox();await p.mouse.move(box.x+box.width*.5,box.y+box.height*.46);await p.mouse.down();
  await p.waitForTimeout(3300);
  await p.evaluate(()=>{window.rimRest={count:document.querySelector('.toy-mount').dataset.renderCount,since:performance.now()};});
  await p.waitForFunction(()=>{const now=performance.now(),count=document.querySelector('.toy-mount').dataset.renderCount;
    if(count!==window.rimRest.count)window.rimRest={count,since:now};return now-window.rimRest.since>200;});
  await p.setViewportSize({width:1281,height:900});await p.waitForTimeout(150);
  await p.evaluate(()=>{window.sampleSameColor=true;document.documentElement.dataset.theme='day';});await p.waitForFunction(()=>window.sameColorPixels);
  const d=await p.locator('.toy-mount').evaluate(e=>{const d=e.polishDiagnostics();return {enabled:d.enabled,state:d.state,metrics:d.metrics,core:d.coreColor,shell:d.shellColor};});
  assert.equal(d.core,sameColor ? 'rose' : 'mint');assert.equal(d.shell,'rose');assert.equal(d.enabled,true);assert.equal(d.state.rimEnabled,sameColor);assert.equal(d.metrics.violations,0);
  await p.screenshot({path:path.join(out,`${core}-${sameColor?'same':'different'}-${rim?'visible-rim':'rim-disabled-control'}.png`)});
  renders.push({pixels:await p.evaluate(()=>window.sameColorPixels),state:d.state});assert.deepEqual(errors,[]);await p.mouse.up();await p.close();
 }
 let darker=0,opaque=0,alphaMismatch=0;
 const a=renders[0].pixels,b=renders[1].pixels;assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i+=4){if(a[i+3]!==b[i+3])alphaMismatch++;if(a[i+3]<254||b[i+3]<254)continue;opaque++;
  const delta=(a[i]+a[i+1]+a[i+2]-b[i]-b[i+1]-b[i+2])/3;if(delta>12)darker++;
 }
 if (sameColor) assert.ok(darker>100,`Same-color visible edge pixels ${darker}`);
 else assert.equal(darker,0,'Different colors exactly match the rendering with rim shading disabled');
 assert.ok(darker/opaque<.04,'Only narrow crack rims change, not broad surface darkness');
 assert.equal(alphaMismatch,0,'Contrast treatment does not make holes through the core or enlarge silhouette');
 assert.ok(Math.abs(renders[0].state.maxDamage-renders[1].state.maxDamage)<.001);
 fs.writeFileSync(path.join(out,`${core}-${sameColor?'same':'different'}.json`),JSON.stringify({darkerPixels:darker,opaque,alphaMismatch,states:renders.map(r=>r.state)},null,2));
});
