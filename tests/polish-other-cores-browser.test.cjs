const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const port = process.env.POLISH_OTHER_CORES_PORT || '4252';
const base = `http://127.0.0.1:${port}`;
const out = resolve('artifacts/issue-50/three-cores');
let browser, server;
before(async () => {
  mkdirSync(out, { recursive: true }); mkdirSync('.tmp/runtime', { recursive: true });
  process.env.TEMP = resolve('.tmp/runtime'); process.env.TMP = process.env.TEMP;
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
async function installPixels(page) {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = get.call(this, type, ...args);
      if (type === 'webgl2' && gl) {
        window.polishOtherGL = gl;
        if (!gl.polishOtherDrawHook) {
          gl.polishOtherDrawHook = true;
          const draw = gl.drawElements.bind(gl);
          gl.drawElements = (...a) => { const result = draw(...a); window.otherDrawRevision = (window.otherDrawRevision || 0) + 1; return result; };
        }
      }
      return gl;
    };
    const frame = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => frame(time => {
      callback(time);
      // An unrelated rAF may run after WebGL's default framebuffer was cleared.
      // Only sample the callback which actually submitted a fresh scene draw.
      if (!window.captureOtherPixels || !window.polishOtherGL || !(window.otherDrawRevision > window.otherCaptureAfterRevision)) return;
      window.captureOtherPixels = false;
      const gl = window.polishOtherGL, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const p = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
      let opaque = 0, green = 0, pink = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] < 254) continue; opaque++;
        if (p[i + 1] > p[i] + 7 && p[i + 1] > p[i + 2] + 4) green++;
        if (p[i] > p[i + 1] + 8 && p[i + 2] > p[i + 1] + 2) pink++;
      }
      window.otherPixels = { opaque, green, pink, width: w, height: h };
    });
  });
}
async function open(core, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: 1,
    isMobile: mobile, hasTouch: mobile, reducedMotion: mobile ? 'reduce' : 'no-preference',
    ...(!mobile ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } } : {}) });
  const page = await context.newPage(), errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await installPixels(page);
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=${core}&shellMaterial=polish&coreColor=mint&shellColor=rose&step=shell`);
  await page.waitForSelector('.toy-stage[data-state="ready"] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics?.().enabled);
  await page.evaluate(mobile => { document.documentElement.dataset.theme = mobile ? 'night' : 'day'; }, mobile);
  await page.waitForTimeout(150);
  return { context, page, errors };
}
const diag = page => page.locator('.toy-mount').evaluate(el => el.polishDiagnostics());
function depth(d) { let max = 0; for (let i = 0; i < d.corePositions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return max; }
async function pixels(page) {
  await page.evaluate(() => { window.otherPixels = null; window.captureOtherPixels = true; window.otherCaptureAfterRevision = window.otherDrawRevision || 0; });
  const v = page.viewportSize(); await page.setViewportSize({ ...v, width: v.width + 1 });
  await page.waitForFunction(() => window.otherPixels); const r = await page.evaluate(() => window.otherPixels); await page.setViewportSize(v); return r;
}
async function point(page, x = .5, y = .46) { const b = await page.locator('.orb-input').boundingBox(); return { x: b.x + b.width * x, y: b.y + b.height * y }; }
async function press(page, ms, x, y) { const p = await point(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(ms); return p; }
async function shot(page, name) { await page.screenshot({ path: resolve(out, `${name}.png`) }); }
function filmOK(d) {
  assert.equal(d.state.detached, 0); assert.equal(d.state.falling, 0); assert.equal(d.state.fragmentCount, 0);
  assert.equal(d.metrics.violations, 0, JSON.stringify(d.metrics)); assert.ok(d.metrics.samples > 10000);
  assert.ok(d.metrics.minGap > 0); assert.ok(d.metrics.maxGap < .004);
}
async function restart(page) { await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(1000); }
async function waitRecovered(page, timeout = 22000) {
  await page.waitForFunction(() => {
    const d = document.querySelector('.toy-mount').polishDiagnostics();
    let max = 0; for (let i = 0; i < d.corePositions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k])));
    return max === 0;
  }, null, { timeout, polling: 500 });
}
for (const core of ['marshmallow', 'butter']) {
  test(`${core} polish actual GPU exposure and original core lifecycle, normal-speed desktop`, { timeout: 200000 }, async () => {
    const { context, page, errors } = await open(core);
    const report = { core, environment: 'Windows Edge headless desktop 1280x900 DPR1; not hardware phone' };
    try {
      const intact = await diag(page), beforePixels = await pixels(page);
      assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), core === 'butter' ? 'slow-rebound' : core);
      assert.equal(intact.coreColor, 'mint'); assert.equal(intact.shellColor, 'rose'); assert.equal(beforePixels.green, 0); filmOK(intact);
      await shot(page, `${core}-intact`);
      await press(page, 180); const shallow = await diag(page); await shot(page, `${core}-shallow-held`);
      await page.waitForTimeout(1200); const deep = await diag(page), opened = await pixels(page); filmOK(deep);
      assert.ok(depth(deep) > depth(shallow) + .03); assert.ok(opened.green > beforePixels.green + 20, JSON.stringify(opened));
      assert.equal(deep.state.maxLocalContacts, 1, 'Long first contact counted exactly once'); await shot(page, `${core}-first-deep-held`);
      await page.mouse.up(); await page.waitForTimeout(180); const released = await diag(page);
      await page.waitForTimeout(600); const waiting = await diag(page); filmOK(waiting);
      if (core === 'marshmallow') assert.deepEqual(waiting.corePositions, released.corePositions, 'Marshmallow retains released geometry exactly');
      else assert.ok(depth(waiting) < depth(released) * .85, 'Slow rebound follows its existing recovery rather than retaining a plastic dent');
      assert.equal(waiting.state.maxDamage, released.state.maxDamage, 'Recovery preserves film damage');
      await shot(page, `${core}-released-waiting`);
      for (let i = 0; i < 2; i++) { await press(page, 500); await page.mouse.up(); await page.waitForTimeout(150); }
      const repeated = await diag(page); assert.ok(repeated.state.maxDamage >= released.state.maxDamage); assert.equal(repeated.state.maxLocalContacts, 3); filmOK(repeated); await shot(page, `${core}-repeated`);
      await press(page, 450, .7, .42); await page.mouse.up(); await page.waitForTimeout(200); await shot(page, `${core}-neighbor-region`);
      await press(page, 1300, .42, .54); const end = await point(page, .69, .5); await page.mouse.move(end.x, end.y, { steps: 35 }); await page.waitForTimeout(250); await page.mouse.up();
      await page.waitForTimeout(250); const slid = await diag(page); filmOK(slid); await shot(page, `${core}-long-hold-slide`);
      const stage = await page.locator('.toy-stage').boundingBox();
      await page.mouse.move(stage.x + 10, stage.y + 20); await page.mouse.down(); await page.mouse.move(stage.x + 150, stage.y + 25, { steps: 24 }); await page.mouse.up();
      await page.locator('.toy-mount canvas').screenshot({ path: resolve(out, `${core}-side-rotated-closeup.png`) });
      filmOK(await diag(page));
      await page.mouse.move(stage.x + 150, stage.y + 25); await page.mouse.down(); await page.mouse.move(stage.x + 10, stage.y + 20, { steps: 24 }); await page.mouse.up();
      await page.locator('.step-back').click(); await page.waitForFunction(() => !document.querySelector('.toy-mount').polishDiagnostics().enabled);
      await page.locator('.step-next').click(); await page.waitForFunction(() => document.querySelector('.toy-mount').polishDiagnostics().enabled);
      const navigation = await diag(page); assert.equal(navigation.state.maxDamage, slid.state.maxDamage); assert.equal(navigation.state.cycle, slid.state.cycle);
      assert.ok((await pixels(page)).green > 0, 'Actual reopened coating still shows historical damaged region');
      if (core === 'butter') { await waitRecovered(page); const recovered = await diag(page); assert.ok(depth(recovered) < .00002); assert.equal(recovered.state.maxDamage, slid.state.maxDamage); filmOK(recovered); await page.locator('.toy-mount canvas').screenshot({ path: resolve(out, `${core}-fully-recovered-closeup.png`) }); report.recovered = { depth: depth(recovered), state: recovered.state, metrics: recovered.metrics }; await shot(page, `${core}-fully-recovered-history`); }
      else { await page.waitForTimeout(500); const frozen = await diag(page); assert.deepEqual(frozen.corePositions, navigation.corePositions); }
      const count = await page.locator('.toy-mount').getAttribute('data-render-count'); await page.waitForTimeout(300); assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count, 'Settled original core and shell stop rendering');
      await restart(page); const reset = await diag(page); assert.ok(depth(reset) < .00002); assert.equal(reset.state.maxDamage, 0); filmOK(reset); await shot(page, `${core}-restart`);
      await press(page, 650); await page.mouse.up(); await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(80); await press(page, 300);
      const takeover = await diag(page); assert.equal(takeover.state.active, true); assert.ok(depth(takeover) > .01); filmOK(takeover); await page.mouse.up();
      await restart(page);
      await page.evaluate(core => {
        const choose = (name, value) => { const input = document.querySelector(`input[name="${name}"][data-choice="${value}"]`); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); };
        // Synchronous native change events stress the same async controller, without reloads.
        choose('coreMaterial', core === 'butter' ? 'marshmallow' : 'butter'); choose('shellColor', 'sky'); choose('coreMaterial', 'clay'); choose('shellColor', 'cream'); choose('coreMaterial', core); choose('shellColor', 'rose');
      }, core);
      await page.waitForFunction(core => { const m = document.querySelector('.toy-mount'), d = m.polishDiagnostics?.(); return m.dataset.feelId === (core === 'butter' ? 'slow-rebound' : core) && d?.enabled && d.shellColor === 'rose' && !document.querySelector('.thin-wax-restart').disabled; }, core);
      assert.equal(await page.locator('.toy-mount canvas').count(), 1); const latest = await diag(page); assert.equal(latest.coreColor, 'mint'); assert.equal(latest.shellColor, 'rose'); filmOK(latest); assert.deepEqual(errors, []);
      Object.assign(report, { beforePixels, openedPixels: opened, shallowDepth: depth(shallow), deepDepth: depth(deep), first: released.state, repeat: repeated.state, releasedDepth: depth(released), afterWaitingDepth: depth(waiting), slidingMetrics: slid.metrics, navigation: navigation.state, reset: reset.state, takeover: takeover.state, latest: latest.state });
      writeFileSync(resolve(out, `${core}-desktop.json`), JSON.stringify(report, null, 2));
    } finally { const video = page.video(); await context.close(); await video.saveAs(resolve(out, `${core}-desktop-normal-speed.webm`)); await video.delete(); }
  });
  test(`${core} polish mobile emulation night reduced motion real touch and cancellation`, { timeout: 45000 }, async () => {
    const { context, page, errors } = await open(core, true);
    try {
      const beforePixels = await pixels(page), p = await point(page), cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await page.waitForTimeout(1400);
      const held = await diag(page), opened = await pixels(page); filmOK(held); assert.ok(depth(held) > .03); assert.ok(opened.green > beforePixels.green + 5, JSON.stringify(opened));
      await shot(page, `${core}-mobile-emulated-night-reduced-held`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await page.waitForTimeout(250); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false'); const cancelled = await diag(page); filmOK(cancelled);
      if (core === 'butter') await waitRecovered(page, 8000); else { const frozen = await diag(page); await page.waitForTimeout(300); assert.deepEqual((await diag(page)).corePositions, frozen.corePositions); }
      const recovered = await diag(page); assert.ok(recovered.state.maxDamage > 0); filmOK(recovered); await shot(page, `${core}-mobile-emulated-night-reduced-released`);
      assert.equal(await page.locator('.toy-mount canvas').count(), 1); assert.deepEqual(errors, []);
      writeFileSync(resolve(out, `${core}-mobile-emulated.json`), JSON.stringify({ hardwarePhoneTested: false, environment: 'Windows Edge phone emulation 390x844 DPR1, night, prefers-reduced-motion; CDP touch', beforePixels, openedPixels: opened, heldDepth: depth(held), held: held.state, cancelled: cancelled.state, finalDepth: depth(recovered), final: recovered.state, metrics: recovered.metrics }, null, 2));
    } finally { await context.close(); }
  });
}
