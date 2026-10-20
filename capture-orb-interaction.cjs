const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { installOrbProbe, meshStats, settled } = require('./tests/helpers/orb-probe.cjs');
const folder = 'artifacts/issue-16-plastic';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4190';
const sizes = [['desktop',1440,900],['mobile',390,844],['compact',375,667],['short',320,568],['landscape',844,390]];
const ready = page => page.waitForFunction(() => window.orbMeshProbe?.positions && document.querySelector('.toy-stage').dataset.state === 'ready');
const restored = settled;
const shot = (page,name) => page.screenshot({ path:`${folder}/${name}.png`,fullPage:true });
async function point(page,x=.5,y=.5) {const b=await page.locator('.orb-input').boundingBox();return {x:b.x+b.width*x,y:b.y+b.height*y};}
(async()=>{
  fs.mkdirSync(folder,{recursive:true});
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(fs.existsSync(edge)?edge:undefined)});
  const report={date:'2026-10-20',browser:browser.version(),host:`${os.platform()} ${os.release()} ${os.arch()}`,device:'Desktop host; all mobile touch is Chromium CDP emulation, not physical phones',modelBytes:fs.statSync('assets/models/squishy-orb.glb').size,engineBytes:fs.statSync('assets/orb-preview.js').size,errors:[],viewports:[],recordings:[]};
  try {
    for(const [name,width,height] of sizes)for(const theme of ['day','night']){
      const page=await browser.newPage({viewport:{width,height},hasTouch:width<600,reducedMotion:'reduce'});
      await installOrbProbe(page);page.on('pageerror',e=>report.errors.push(e.message));
      await page.addInitScript(t=>localStorage.setItem('squishy-studio-theme',t),theme);
      await page.goto(base+'/squishy/cloud/');await ready(page);await page.evaluate(()=>document.fonts.ready);
      await shot(page,`${name}-${theme}`);
      const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,stage:document.querySelector('.toy-stage').getBoundingClientRect().toJSON(),input:document.querySelector('.orb-input').getBoundingClientRect().toJSON(),settings:document.querySelector('.customization').getBoundingClientRect().toJSON(),canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height]}));
      assert.equal(geometry.overflow,false);
      if(name==='desktop'||name==='mobile'){
        const p=await point(page,.35,.4);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(800);
        const pressed=await meshStats(page);assert.ok(pressed.maximum>.2&&pressed.changed<700);
        await shot(page,`${name}-${theme}-pressed`);await page.mouse.up();await restored(page);
        await shot(page,`${name}-${theme}-retained`);
        geometry.pressed=pressed;geometry.retained=await meshStats(page);
      }
      report.viewports.push({name,width,height,theme,...geometry});await page.close();
    }
    for(const [name,width,height,touch] of [['desktop',1440,900,false],['mobile-touch',390,844,true]]){
      const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orb-1b-video-'));
      const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,recordVideo:{dir:temp,size:{width,height}}});
      const page=await context.newPage();const video=page.video();await installOrbProbe(page);
      page.on('pageerror',e=>report.errors.push(e.message));
      await page.goto(base+'/squishy/cloud/');await ready(page);await page.waitForTimeout(500);
      const session=touch?await context.newCDPSession(page):null;
      const observations=[];
      for(const [label,x,y] of [['left',.26,.48],['upper',.5,.25],['right',.72,.5]]){
        const p=await point(page,x,y);
        if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});
        else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
        await page.waitForTimeout(900);observations.push({label,held:await meshStats(page)});
        if(label==='left'){
          const target=await point(page,.7,.5);
          for(let step=1;step<=20;step++){
            const q={x:p.x+(target.x-p.x)*step/20,y:p.y+(target.y-p.y)*step/20};
            if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...q,id:0}]});else await page.mouse.move(q.x,q.y);
            await page.waitForTimeout(25);
          }
          await page.waitForTimeout(200);observations.push({label:'dragged-right',held:await meshStats(page)});
        }
        if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
        await restored(page);await page.waitForTimeout(300);observations.push({label:`${label}-retained`,rest:await meshStats(page)});
      }
      if (!touch) {
        // Native mouse drag on page whitespace rotates the retained dents.
        await page.mouse.move(80, 250); await page.mouse.down();
        for (let step=1;step<=48;step++) {
          await page.mouse.move(80+width*step/48,250); await page.waitForTimeout(35);
        }
        await page.mouse.up(); await page.waitForTimeout(400);
        await page.mouse.move(80,250); await page.mouse.down();
        await page.mouse.move(80+width/4,250,{steps:24}); await page.mouse.up();
        await page.waitForTimeout(500); await shot(page,'desktop-retained-rotated');
        observations.push({label:'retained-rotated',mesh:await meshStats(page),matrix:await page.evaluate(()=>window.orbMeshProbe.modelViewMatrix)});
      }
      // Real continuous interaction remains available after a theme change.
      await page.evaluate(()=>document.documentElement.dataset.theme='night');
      const p=await point(page,.5,.5);
      if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
      await page.waitForTimeout(600);
      if(touch)await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else{await page.mouse.move(8,8,{steps:8});await page.mouse.up();}
      await restored(page);await page.waitForTimeout(500);
      const renderer=await page.evaluate(()=>{const gl=window.orbMeshProbe.contexts.at(-1);const debug=gl.getExtension('WEBGL_debug_renderer_info');return debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
      report.recordings.push({name,touch:'Browser emulated '+(touch?'native CDP touch events':'mouse events'),renderer,observations,retained:await meshStats(page)});
      await session?.detach();await context.close();await video.saveAs(`${folder}/${name}-interaction.webm`);fs.unlinkSync(await video.path());fs.rmdirSync(temp);
    }
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(`${folder}/validation.json`,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({viewports:report.viewports.length,recordings:report.recordings.length,errors:report.errors,modelBytes:report.modelBytes,engineBytes:report.engineBytes},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
