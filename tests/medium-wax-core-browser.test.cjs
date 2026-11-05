const {test,before,after}=require('node:test');const {spawn}=require('node:child_process');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {installStyleProbe,ready,rotate}=require('./helpers/squishy-browser.cjs');
const {projectedMeshContact,geometryOK}=require('./helpers/wax-style-probe.cjs');
const output='.tmp/issue-41/medium-wax-core-browser',runtime=path.resolve('.tmp/issue-41/runtime');fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(output,{recursive:true});process.env.TEMP=process.env.TMP=runtime;
const diag=(page,measure=false)=>page.locator('.toy-mount').evaluate((el,measure)=>el.thinWaxDiagnostics({measure,exhaustive:measure}),measure);
let server;before(async()=>{server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4254'}});for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4254')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Preview server did not start');});after(()=>server?.kill());
test('medium wax non-paw marshmallow and slow rebound native input and full geometry',{timeout:600000},async()=>{
 const {getSquishyStyle}=await import('../src/squishy-styles.mjs'),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),results=[];
 try{for(const style of process.env.STYLES_REVIEW_CASE?process.env.STYLES_REVIEW_CASE.split(','):['cloud','cylinder','donut','pyramid','flower','star'])for(const core of process.env.STYLES_REVIEW_CORE?[process.env.STYLES_REVIEW_CORE]:['marshmallow','butter'])for(const mobile of process.env.STYLES_REVIEW_MOBILE==='1'?[true]:process.env.STYLES_REVIEW_MOBILE==='0'?[false]:[false,true]){
  const theme=mobile?'night':'day',name=`${style}-${core}-${mobile?'mobile':'desktop'}-${theme}`,viewport=mobile?{width:390,height:844}:{width:1280,height:900};
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,...(process.env.MEDIUM_WAX_CAPTURE==='1'?{recordVideo:{dir:path.join(output,'raw-video'),size:viewport}}:{})}),page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   const mesh=await installStyleProbe(page,getSquishyStyle(style));await page.goto(`http://127.0.0.1:4254/squishy/cloud/?style=${style}&coreMaterial=${core}&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell`);await ready(page);await page.waitForFunction(()=>document.querySelector('.toy-mount').thinWaxDiagnostics?.({measure:false}).enabled);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(500);
   const initial=await diag(page,true);geometryOK(initial);assert.equal(initial.geometry.thickness,.028);assert.equal(initial.geometry.patches,96);assert.equal(initial.debrisStage.visible,false);await page.screenshot({path:path.join(output,name+'-intact.png')});
   const hit=await projectedMeshContact(page,mesh,style),client=await context.newCDPSession(page);
   async function down(){if(mobile)await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y,id:0}]});else{await page.mouse.move(hit.x,hit.y);await page.mouse.down();}}
   async function up(){if(mobile)await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();}
   // Send release on the wall clock without waiting for the press render ACK.
   // Otherwise a costly initial frame can turn a 160ms tap into a long hold.
   if(!mobile)await page.mouse.move(hit.x,hit.y);
   await page.evaluate(()=>{window.shortInputEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend'])window.addEventListener(type,e=>window.shortInputEvents.push({type,time:performance.now(),timestamp:e.timeStamp,trusted:e.isTrusted}),{capture:true});});
   const shortStart=Date.now();
   const pressed=mobile?client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y,id:0}]}):client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
   const ended=new Promise((resolve,reject)=>setTimeout(()=>{const p=mobile?client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});p.then(resolve,reject);},160));
   await Promise.all([pressed,ended]);const shortState=await diag(page);console.log(JSON.stringify({shortInput:name,elapsed:Date.now()-shortStart,events:await page.evaluate(()=>window.shortInputEvents),detached:shortState.thinWax.detached}));assert.equal(shortState.thinWax.detached,0);
   await down();await page.waitForTimeout(900);const first=await diag(page,true);geometryOK(first);assert.ok(first.thinWax.detached>0);await page.screenshot({path:path.join(output,name+'-falling.png')});await page.waitForTimeout(700);
   if(mobile)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:hit.x+10,y:hit.y+3,id:0}]});else await page.mouse.move(hit.x+18,hit.y+5,{steps:3});await up();const released=await diag(page,true);geometryOK(released);await page.waitForTimeout(650);const after=await diag(page);assert.equal(after.thinWax.detached,released.thinWax.detached);if(core==='marshmallow')assert.deepEqual(after.corePositions,released.corePositions);else assert.ok(after.coreState.depth<released.coreState.depth);
   await rotate(page,75,15);geometryOK(await diag(page,true));await page.screenshot({path:path.join(output,name+'-side.png')});await page.getByRole('button',{name:'重新开始',exact:true}).click();await page.waitForFunction(()=>{const d=document.querySelector('.toy-mount').thinWaxDiagnostics({measure:false});return d.thinWax.detached===0&&d.coreState.depth<.00001;});geometryOK(await diag(page,true));assert.deepEqual(errors,[]);
   const r={style,core,mobile,theme,physicalPhone:false,thickness:.028,partitions:96,firstDetached:first.thinWax.detached,attachedViolations:0,detachedViolations:0,restart:true};results.push(r);console.log(JSON.stringify(r));
  }finally{await context.close();if(video)await video.saveAs(path.join(output,name+'.webm'));}
 }
 const page=await browser.newPage();try{for(const core of ['marshmallow','butter']){await page.goto(`http://127.0.0.1:4254/squishy/cloud/?style=paw&coreMaterial=${core}&waxThickness=medium&step=shell`);await page.waitForFunction(()=>typeof document.querySelector('.toy-mount')?.thinWaxDiagnostics==='function');assert.equal((await diag(page)).enabled,false);console.log(JSON.stringify({core,pawExcluded:true}));}}finally{await page.close();}
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
});
