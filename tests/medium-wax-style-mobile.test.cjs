const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('./helpers/squishy-browser.cjs');
const { regions, projectedMeshContact, geometryOK } = require('./helpers/wax-style-probe.cjs');
const base = 'http://127.0.0.1:4245'; let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4245' } });
  for (let i=0;i<80;i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
for (const id of Object.keys(regions).filter(id=>id!=='paw')) test(`${id} medium wax: mobile CDP touch day/night, geometry and rotation`, { timeout: 120000 }, async t => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const context = await browser.newContext({ viewport: {width:390,height:844}, hasTouch:true, isMobile:true });
  const page = await context.newPage(), client = await context.newCDPSession(page), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    const mesh = await installStyleProbe(page, getSquishyStyle(id));
    await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell`); await ready(page);
    for (const theme of ['day','night']) {
      await page.getByRole('button',{name:'重新开始',exact:true}).click(); await page.waitForTimeout(700);
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const hit = await projectedMeshContact(page,mesh,id);
      await page.evaluate(()=>{window.mediumFrameTimes=[];const request=requestAnimationFrame;window.requestAnimationFrame=callback=>request(time=>{callback(time);if(window.mediumRecording)window.mediumFrameTimes.push(time);});window.mediumRecording=true;});
      await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y,id:0}]});
      await page.waitForTimeout(1400);
      await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const timing = await page.evaluate(()=>{window.mediumRecording=false; const v=window.mediumFrameTimes; return v.slice(1).map((x,i)=>x-v[i]).filter(x=>x>0).sort((a,b)=>a-b);});
      const d = await page.locator('.toy-mount').evaluate(el=>el.thinWaxDiagnostics({measure:true,exhaustive:true}));
      assert.equal(d.presetId,'medium-wax'); assert.equal(d.geometry.thickness,.028); assert.ok(d.thinWax.detached>0); geometryOK(d);
      await rotate(page,55,12); const turned=await page.locator('.toy-mount').evaluate(el=>el.thinWaxDiagnostics({measure:true,exhaustive:true})); geometryOK(turned);
      assert.ok(timing.length>0); assert.deepEqual(errors,[]);
      t.diagnostic(JSON.stringify({id,theme,physicalPhone:false,input:'CDP touch pressure / mouse rotation',frames:timing.length,medianFrameMs:timing[Math.floor(timing.length*.5)],p95FrameMs:timing[Math.floor(timing.length*.95)],maxFrameMs:timing.at(-1),detached:d.thinWax.detached,geometry:{attached:turned.geometry.attachedViolations,detached:turned.geometry.detachedViolations}}));
    }
  } finally { await context.close(); }
});
