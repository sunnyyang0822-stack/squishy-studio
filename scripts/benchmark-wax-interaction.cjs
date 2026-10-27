const fs=require('node:fs'),crypto=require('node:crypto'),{chromium}=require('playwright');
(async()=>{
 const localTemp=require('node:path').resolve('.tmp/wax-interaction');fs.mkdirSync(localTemp,{recursive:true});process.env.TEMP=process.env.TMP=process.env.TMPDIR=localTemp;
 const output=process.argv[2],url=process.env.WAX_INTERACTION_URL||'http://127.0.0.1:4382/squishy/cloud/?style=cloud&coreMaterial=butter&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell';
 if(!output)throw Error('Output file required');const digest=b=>crypto.createHash('sha256').update(b).digest('hex'),hash=digest(fs.readFileSync('assets/orb-preview.js')),served=await fetch(new URL('/assets/orb-preview.js',url));if(!served.ok||digest(Buffer.from(await served.arrayBuffer()))!==hash)throw Error('Served bundle mismatch');
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(fs.existsSync(edge)?edge:undefined)});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await page.goto(url);await page.waitForFunction(()=>document.querySelector('.toy-mount').thinWaxDiagnostics?.({measure:false}).enabled);await page.waitForTimeout(400);
  const client=await page.context().newCDPSession(page),box=await page.locator('.orb-input').boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5;
  await page.evaluate(()=>{window.waxIntervals={};window.waxPhase=null;let previous;new MutationObserver(()=>{const now=performance.now();if(previous!==undefined&&window.waxPhase)(window.waxIntervals[window.waxPhase]||=[]).push(now-previous);previous=now;}).observe(document.querySelector('.toy-mount'),{attributes:true,attributeFilter:['data-render-count']});});
  const phase=async name=>page.evaluate(n=>window.waxPhase=n,name),send=(type,px=x,py=y)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:px,y:py,id:0}]});
  await phase('press');await send('touchStart');await page.waitForTimeout(1800);await send('touchEnd');await phase('recovery');await page.waitForTimeout(2500);
  await phase('drag');await send('touchStart',x-box.width*.15);for(let i=0;i<12;i++){await send('touchMove',x-box.width*.15+box.width*.3*i/11);await page.waitForTimeout(35);}await send('touchEnd');await phase('dragRecovery');await page.waitForTimeout(1800);await phase(null);
  const result=await page.evaluate(()=>{const el=document.querySelector('.toy-mount'),gl=el.querySelector('canvas').getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');return{intervals:window.waxIntervals,state:el.thinWaxDiagnostics({measure:false}).thinWax,renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};});
  result.summary=Object.fromEntries(Object.entries(result.intervals).map(([key,a])=>{const s=a.slice().sort((x,y)=>x-y);return[key,{samples:s.length,medianMs:s[Math.floor(s.length*.5)],p95Ms:s[Math.floor(s.length*.95)],maxMs:s.at(-1),above33ms:s.filter(v=>v>33.34).length}]}));
  result.url=url;result.bundleSha256=hash;result.browser=browser.version();result.recordedAt=new Date().toISOString();result.measurement='390x844 real desktop touch emulation; actual press/release/drag/recovery clocks; all render intervals kept; no video/profiler/geometry probes or concurrent task tests';fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
