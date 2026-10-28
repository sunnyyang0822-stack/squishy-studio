const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { installStyleProbe, ready } = require('../tests/helpers/squishy-browser.cjs');
const { projectedMeshContact } = require('../tests/helpers/wax-style-probe.cjs');
const folder = path.resolve('artifacts/issue-43-performance');
const port = '4361', base = `http://127.0.0.1:${port}`;
const injection = `
    let twinTime = performance.now() / 1000;
    const optimized = createWaxShell({ ...shellOptions, clock: () => twinTime, detachedCollisionIterations: options.detachedCollisionIterations ?? 40, detachedClearanceCertificates: true, collectionEnabled: options.collectionEnabled ?? false }, thickWaxParameters);
    const reference = createWaxShell({ ...shellOptions, clock: () => twinTime, detachedCollisionIterations: options.detachedCollisionIterations ?? 40, detachedClearanceCertificates: false, collectionEnabled: options.collectionEnabled ?? false }, thickWaxParameters);
    const audit = { frames: 0, methods: [], firstDifference: null, maxDelta: 0, samplesCompared: 0 };
    const compare = method => {
      for (const attribute of ['position', 'normal']) {
        const a = optimized.group.children[0].geometry.attributes[attribute].array;
        const b = reference.group.children[0].geometry.attributes[attribute].array;
        for (let i = 0; i < a.length; i++) {
          audit.samplesCompared++;
          if (a[i] !== b[i]) {
            audit.maxDelta = Math.max(audit.maxDelta, Math.abs(a[i] - b[i]));
            audit.firstDifference ||= { method, frame: audit.frames, attribute, index: i, actual: a[i], expected: b[i], optimizedState: optimized.getState(), referenceState: reference.getState(), optimizedMetrics: optimized.getMetrics({exhaustive:true}), referenceMetrics: reference.getMetrics({exhaustive:true}) };
          }
        }
      }
    };
    const mutators = new Set(['begin','move','end','release','cancel','sync','step','reset','dispose','setWorldMatrix','setCollectionEnabled','setGravity','setReducedMotion']);
    const wax = new Proxy(optimized, { get(target, key) {
      if (!mutators.has(key)) return target[key];
      return (...args) => {
        twinTime = performance.now() / 1000;
        const result = target[key](...args);
        reference[key](...args);
        if (key === 'step') { audit.frames++; audit.methods.push({dt:args[0], time:twinTime}); }
        if (key !== 'dispose') compare(key);
        return result;
      };
    }});
    globalThis.donutTwinAudit = { audit, check() { return { ...audit, optimizedMetrics: optimized.getMetrics({exhaustive:true}), referenceMetrics: reference.getMetrics({exhaustive:true}), optimizedState: optimized.getState(), referenceState: reference.getState() }; } };
`;
(async () => {
  fs.mkdirSync(folder, {recursive:true});
  const bundle = await build({entryPoints:['src/orb-preview.js'],bundle:true,format:'esm',target:'es2022',minify:false,write:false,plugins:[{name:'diagnostic-runtime-twins',setup(build){build.onLoad({filter:/wax-presets\.mjs$/},async args=>{
    const source=fs.readFileSync(args.path,'utf8');
    const expression=/    const wax = createWaxShell\(\{[\s\S]*?\}, thickWaxParameters\);\r?\n/;
    assert.ok(expression.test(source),'Locate thick shell factory');
    return {contents:source.replace(expression,injection),loader:'js'};
  });}}]});
  const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:port},stdio:'ignore'});
  let browser;
  const report={cases:[],errors:[],exitCode:1,description:'Diagnostic twin instances share real deformed core and per-call frozen wall clock; emitted geometry compared every mutating API call; no product source edits'};
  try{
    for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_BROWSER_PATH||(fs.existsSync(edge)?edge:undefined)});
    const {getSquishyStyle}=await import('../src/squishy-styles.mjs');
    for(let repeat=1;repeat<=Number(process.env.DONUT_RUNTIME_REPEATS || 3);repeat++){
      const page=await browser.newPage({viewport:{width:1280,height:900}});
      try{
        page.on('pageerror',e=>report.errors.push(e.message));
        const mesh=await installStyleProbe(page,getSquishyStyle('donut'));
        await page.route('**/assets/orb-preview.js',r=>r.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}));
        await page.goto(`${base}/squishy/cloud/?style=donut&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thick&step=shell`);await ready(page);
        await page.waitForFunction(()=>globalThis.donutTwinAudit);
        await page.evaluate(()=>document.documentElement.dataset.theme='night');
        const hit=await projectedMeshContact(page,mesh,'donut');
        const stages=[];
        const check=async stage=>{const result=await page.evaluate(()=>globalThis.donutTwinAudit.check());stages.push({stage,...result});console.log(JSON.stringify({repeat,stage,frames:result.frames,difference:result.firstDifference,optimizedViolations:result.optimizedMetrics.detachedViolations,referenceViolations:result.referenceMetrics.detachedViolations,optimizedMin:result.optimizedMetrics.detachedMinSignedDistance,referenceMin:result.referenceMetrics.detachedMinSignedDistance}));};
        await check('intact');
        await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.waitForTimeout(140);await page.mouse.up();await page.waitForTimeout(180);await check('short');
        await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.waitForTimeout(1600);await page.screenshot({path:folder+'/runtime-night-falling.png'});await page.waitForTimeout(Number(process.env.DONUT_RUNTIME_REMAINING_MS || 1000));await page.mouse.up();await check('held-released');
        await page.waitForTimeout(500);await check('recovery');
        await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.waitForTimeout(700);
        const next=await projectedMeshContact(page,mesh,'donut',[.06,.01]);
        for(let i=1;i<=8;i++){await page.mouse.move(hit.x+(next.x-hit.x)*i/8,hit.y+(next.y-hit.y)*i/8);await page.waitForTimeout(40);}
        await page.mouse.up();await check('drag');await page.waitForTimeout(500);await check('drag-recovery');
        report.cases.push({repeat,hit,stages});
      }finally{await page.close();}
    }
    assert.deepEqual(report.errors,[]);report.exitCode=0;
  }finally{fs.writeFileSync(`${folder}/${process.env.DONUT_RUNTIME_LABEL || 'runtime-twin-check'}.json`,JSON.stringify(report,null,2)+'\n');await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
