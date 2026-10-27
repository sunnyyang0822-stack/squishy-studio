const { chromium } = require('playwright');
const { existsSync, mkdirSync, mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const assert = require('node:assert/strict');
const { installOrbProbe, meshStats, settled } = require('./orb-probe.cjs');
module.exports = async function run({ capture = false, folder = 'artifacts/issue-26' } = {}) {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer(); probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port; probe.close(() => resolve(value));
    });
  });
  const base = 'http://127.0.0.1:' + port;
  if (capture) mkdirSync(folder, { recursive: true });
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let browser;
  const report = { phone: 'CDP native touch emulation; no physical phone tested', observations: [], errors: [] };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
    report.browser = browser.version();
    for (const touch of [false, true]) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const name = touch ? 'mobile-touch' : 'desktop';
      const temp = capture ? mkdtempSync(join(tmpdir(), 'marshmallow-')) : null;
      const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, ...(capture ? { recordVideo: { dir: temp, size: viewport } } : {}) });
      const page = await context.newPage(), video = page.video();
      page.on('pageerror', e => report.errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /THREE|shader/i.test(m.text())) report.errors.push(m.text()); });
      await installOrbProbe(page, { frames: true });
      await page.goto(base + '/squishy/cloud/');
      await page.waitForFunction(() => window.orbMeshProbe?.positions);
      await page.evaluate(() => document.fonts.ready);
      // Same color, camera, lighting, pose and undented geometry for optical comparison.
      for (const feel of ['clay', 'marshmallow']) {
        if (feel === 'marshmallow') {
          await page.locator('[name=coreMaterial][value=marshmallow]').check();
          await page.waitForFunction(() => document.querySelector('.orb-input')?.getAttribute('aria-label').includes('棉花糖'));
          assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts[0].isContextLost()), true);
        }
        for (const theme of ['day', 'night']) {
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForTimeout(180);
          if (capture) await page.screenshot({ path: `${folder}/${name}-${feel}-${theme}.png` });
        }
      }
      await page.evaluate(() => document.documentElement.dataset.theme = 'day');
      const input = page.locator('.orb-input');
      const box = await input.boundingBox();
      const at = (x, y = .48) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
      const session = touch ? await context.newCDPSession(page) : null;
      const send = async (type, point) => {
        if (touch) await session.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[type], touchPoints: ['up', 'cancel'].includes(type) ? [] : [{ ...point, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(point.x, point.y);
        else if (type === 'cancel') {
          // pointerdown intentionally prevents default focus: explicitly focus the
          // interaction surface so Escape really exercises its cancel handler.
          await page.locator('.orb-input').focus(); await page.keyboard.press('Escape');
          assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
          await page.mouse.up();
        }
        else await page.mouse.up();
      };
      const snapshot = () => page.evaluate(() => Array.from(window.orbMeshProbe.positions));
      async function freeze(label, wait = 800) {
        await settled(page); const frozen = await snapshot();
        await page.waitForTimeout(wait);
        assert.deepEqual(await snapshot(), frozen, label + ': no post-release motion');
        // Color may still finish its independent .65s coating after shape takeover.
        const count = await page.locator('.toy-mount').getAttribute('data-render-count');
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count, 'Static dents sleep');
        report.observations.push({ name, label, ...await meshStats(page) });
      }
      await input.evaluate(el => {
        el.addEventListener('pointerdown', () => { window.marshmallowShortStart = performance.now(); }, { once: true, capture: true });
        el.addEventListener('pointerup', () => { window.marshmallowShortDuration = performance.now() - window.marshmallowShortStart; }, { once: true, capture: true });
      });
      await send('down', at(.5)); await page.waitForTimeout(45);
      // A concurrent browser suite can delay rAF beyond the nominal 45ms.
      // Observe the first actual loaded frame; fixed-time response is measured
      // separately by the real-GLB kernel tests, independent of host scheduling.
      await page.waitForFunction(() => {
        const p = window.orbMeshProbe;
        return p.positions?.some((v, i) => Math.abs(v - p.rest[i]) > .003);
      });
      await send('up');
      const shortDuration = await page.evaluate(() => window.marshmallowShortDuration);
      assert.ok(Number.isFinite(shortDuration) && shortDuration > 0);
      report.observations.push({ name, label: 'short press actual input duration', milliseconds: shortDuration });
      await freeze('short press');
      const shortStats = await meshStats(page);
      // CI may spend hundreds of ms dispatching nominal 45ms input. Check
      // against its actual held duration; strict 100ms bounds live in GLB tests.
      const shortBound = .70 * -Math.expm1(-(.03 + .58 * Math.min(shortDuration / 2000, 1)) / .70) + .008;
      assert.ok(shortStats.maximum > .003 && shortStats.maximum < Math.min(.43, shortBound),
        'Press depth matches real held time: ' + JSON.stringify({ maximum: shortStats.maximum, shortDuration, shortBound }));
      await input.evaluate(el => el.addEventListener('pointerdown', () => {
        window.marshmallowHeldStart = performance.now();
        window.marshmallowPressFrames = [];
        const observe = () => {
          const p = window.orbMeshProbe;
          let maximum = 0;
          for (let i = 0; i < p.rest.length; i += 3)
            maximum = Math.max(maximum, Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k])));
          window.marshmallowPressFrames.push({ milliseconds: performance.now() - window.marshmallowHeldStart, maximum });
          if (el.getAttribute('aria-pressed') === 'true') requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }, { once: true, capture: true }));
      await send('down', at(.32));
      const stages = [], elapsedMilliseconds = [];
      for (const wait of [100, 200, 300, 600]) {
        await page.waitForTimeout(wait); stages.push((await meshStats(page)).maximum);
        elapsedMilliseconds.push(await page.evaluate(() => performance.now() - window.marshmallowHeldStart));
        if (capture) await page.screenshot({ path: folder + '/' + name + '-press-stage-' + stages.length + '.png' });
      }
      report.observations.push({ name, label: 'progressive held press at nominal 100/300/600/1200ms', depths: stages, elapsedMilliseconds });
      const frames = await page.evaluate(() => window.marshmallowPressFrames);
      const largestIncrease = Math.max(...frames.slice(1).map((f, i) => f.maximum - frames[i].maximum));
      assert.ok(frames.length >= 3 && frames.at(-1).maximum > frames[0].maximum + .01, 'Real GPU hold has multiple visible stages');
      assert.ok(frames[0].maximum < shortStats.maximum + .02 && largestIncrease < .025, 'GPU press cannot jump to full depth in one frame: ' + JSON.stringify({first:frames[0], shortStats, largestIncrease}));
      assert.ok(stages[3] < .5, 'One held press stays below the safety boundary');
      report.observations.push({ name, label: 'actual GPU progressive frames', count: frames.length, first: frames[0], last: frames.at(-1), largestIncrease });
      await send('up'); await freeze('long press', 2200);
      await send('down', at(.24)); await page.waitForTimeout(350);
      for (let i = 1; i <= 18; i++) { await send('move', at(.24 + .52 * i / 18)); await page.waitForTimeout(16); }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const beforeDwell = await snapshot();
      await page.waitForTimeout(800);
      const afterDwell = await snapshot();
      const localDwell = await page.evaluate(({ before, after }) => {
        const rest = window.orbMeshProbe.rest, changed = []; let frozenDented = 0;
        for (let i = 0; i < rest.length; i += 3) {
          const delta = Math.hypot(...[0,1,2].map(k => after[i+k] - before[i+k]));
          if (delta > .00001) changed.push(rest.slice(i,i+3));
          else if (Math.hypot(...[0,1,2].map(k => before[i+k] - rest[i+k])) > .001) frozenDented++;
        }
        let diameter = 0;
        for (const a of changed) for (const b of changed)
          diameter = Math.max(diameter, Math.hypot(...a.map((v,k) => v-b[k])));
        return { changed: changed.length, frozenDented, diameter };
      }, { before: beforeDwell, after: afterDwell });
      assert.ok(localDwell.changed > 0 && localDwell.frozenDented > 0, 'Endpoint deepens while departed dents freeze');
      assert.ok(localDwell.diameter <= .801, 'Only one .40 footprint deepens while holding');
      report.observations.push({ name, label: 'local endpoint dwell', ...localDwell });
      await send('up'); await freeze('dwell endpoints and slide', 1400);
      for (const [label, duration, reverse] of [['fast swipe', 100, false], ['long swipe', 700, false], ['retrace kneading', 180, true]]) {
        await send('down', at(.2, .6));
        for (let round = 0; round < (reverse ? 4 : 1); round++) for (let i = 1; i <= 12; i++) {
          await send('move', at(round % 2 ? .8 - .6 * i / 12 : .2 + .6 * i / 12, .6)); await page.waitForTimeout(duration / 12);
        }
        await send('up'); await freeze(label);
      }
      for (const cancellation of ['cancel', 'blur', 'hidden']) {
        await send('down', at(.5, .3)); await page.waitForTimeout(80);
        if (cancellation === 'cancel') await send('cancel');
        if (cancellation === 'blur') { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await send('up'); }
        if (cancellation === 'hidden') {
          await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
          const positions = await snapshot(); await page.waitForTimeout(200); assert.deepEqual(await snapshot(), positions);
          await send('up');
          await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        }
        await freeze(cancellation);
      }
      if (capture) for (const theme of ['day', 'night']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForTimeout(150);
        await page.screenshot({ path: `${folder}/${name}-dents-${theme}.png` });
      }
      const contextsBefore = await page.evaluate(() => window.orbMeshProbe.contexts.length);
      if (touch) await page.locator('[data-category=coreColor]').click();
      // Catch the actual first restoring upload inside the browser; remote
      // automation latency must not skip the entire 650ms restoration.
      await page.evaluate(() => {
        document.addEventListener('orb-probe-position', event => {
          const depth = event.detail.maximum;
          queueMicrotask(() => {
            const p = window.orbMeshProbe, before = Array.from(p.positions);
            const surface = document.querySelector('.orb-input'); surface.focus();
            surface.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            window.marshmallowRestoreTakeover = {
              depth, before, after: Array.from(p.positions),
              pressed: surface.getAttribute('aria-pressed')
            };
          });
        }, { once: true });
        document.querySelector('[name=color][value=mint]').click();
      });
      await page.waitForFunction(() => window.marshmallowRestoreTakeover);
      const takeover = await page.evaluate(() => window.marshmallowRestoreTakeover);
      assert.ok(takeover.depth > 0, 'Actual restoration frame remains deformed');
      assert.deepEqual(takeover.after, takeover.before, 'Input takeover cannot teleport vertices');
      assert.equal(takeover.pressed, 'true');
      await page.waitForTimeout(100); await page.keyboard.up('Space');
      await freeze('interrupt explicit color restoration'); assert.ok((await meshStats(page)).maximum > .1);
      await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(850);
      assert.equal((await meshStats(page)).maximum, 0, 'Explicit color restore completes');
      assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts.length), contextsBefore);
      // Real pointer ownership, then a sparse move and release in one browser
      // task: no rAF can run in between. beforeRelease must flush this path.
      await input.evaluate(el => el.addEventListener('pointerdown', event => {
        window.marshmallowFastPointer = event.pointerId;
      }, { once: true, capture: true }));
      await send('down', at(.25));
      const end = at(.75);
      const burst = await page.evaluate(end => {
        const pointerId = window.marshmallowFastPointer;
        window.dispatchEvent(new PointerEvent('pointermove', { ...end, clientX:end.x, clientY:end.y, pointerId, isPrimary:true, buttons:1 }));
        window.dispatchEvent(new PointerEvent('pointerup', { ...end, clientX:end.x, clientY:end.y, pointerId, isPrimary:true, buttons:0 }));
        const p=window.orbMeshProbe, points=[];
        for(let i=0;i<p.rest.length;i+=3) {
          const depth=Math.hypot(...[0,1,2].map(k=>p.positions[i+k]-p.rest[i+k]));
          if(depth>.0001) points.push({x:p.rest[i],depth});
        }
        const low=Math.min(...points.map(p=>p.x)), high=Math.max(...points.map(p=>p.x));
        const samples=Array.from({length:7},(_,i)=>{
          const x=low+(high-low)*(.2+.1*i);
          return Math.max(0,...points.filter(p=>Math.abs(p.x-x)<.06).map(p=>p.depth));
        });
        return { changed:points.length, samples, pressed:document.querySelector('.orb-input').getAttribute('aria-pressed') };
      }, end);
      await send('up');
      assert.equal(burst.pressed,'false');
      assert.ok(burst.changed>100 && burst.samples.every(d=>d>.015), 'Subframe move/release leaves a continuous GPU trail: '+JSON.stringify(burst));
      report.observations.push({name,label:'sparse move and release in one task',...burst});
      await freeze('subframe sparse swipe');
      // Carry the selected feel through settings and final play.
      for (let i = 0; i < 4; i++) { await page.locator('.step-next').click(); await page.waitForTimeout(120); }
      await page.waitForSelector('.orb-input'); assert.match(await input.getAttribute('aria-label'), /棉花糖/);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.waitForFunction(() => window.orbMeshProbe.contexts.every(gl => gl.isContextLost()));
      // A different style/host can instantiate the ready-to-use preset directly
      // through the public scene API, with its own material and lifecycle.
      await page.evaluate(async () => {
        const { createOrbPreview } = await import('/assets/orb-preview.js');
        const mount = document.querySelector('.toy-mount');
        window.marshmallowPresetScene = createOrbPreview(mount, { presetId:'marshmallow' });
        const handle = await window.marshmallowPresetScene.prepare({color:'mint'}, {signal:new AbortController().signal});
        handle.commit();
      });
      await page.waitForFunction(() => document.querySelector('.orb-input')?.getAttribute('aria-label').includes('棉花糖'));
      assert.equal(await page.locator('.toy-mount canvas').count(),1);
      await page.evaluate(() => window.marshmallowPresetScene.dispose());
      await page.waitForFunction(() => window.orbMeshProbe.contexts.every(gl => gl.isContextLost()));
      report.observations.push({name,label:'direct marshmallow preset creates independent scene and releases GPU resources'});
      await session?.detach(); await context.close();
      if (capture) { await video.saveAs(`${folder}/${name}.webm`); unlinkSync(await video.path()); rmdirSync(temp); }
    }
    assert.deepEqual(report.errors, []); return report;
  } finally { await browser?.close(); server.kill(); }
};
