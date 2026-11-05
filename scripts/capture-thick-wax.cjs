const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('../tests/helpers/squishy-browser.cjs');

// Each thin/thick pair uses the same asset, colors, viewport, camera and input
// sequence. Video uses real wall time. Exhaustive geometry runs after release
// so diagnostic CPU time cannot extend the active press.
const folder = path.resolve('artifacts/issue-43');
const temporary = path.resolve('.tmp/issue-43-video');
const port = process.env.THICK_WAX_CAPTURE_PORT || '4343';
const base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const diagnostics = (page, measure = false) => page.locator('.toy-mount').evaluate((el, measure) => {
  const { corePositions, coreRestPositions, ...d } = el.thinWaxDiagnostics({ measure, exhaustive: measure });
  d.coreMaximumDisplacement = 0;
  for (let i = 0; i < corePositions.length; i += 3) d.coreMaximumDisplacement = Math.max(d.coreMaximumDisplacement, Math.hypot(...[0, 1, 2].map(k => corePositions[i + k] - coreRestPositions[i + k])));
  return d;
}, measure);
function geometryOK(d) {
  assert.ok(d.enabled && d.geometry);
  assert.equal(d.geometry.attachedViolations, 0, JSON.stringify(d.geometry));
  assert.equal(d.geometry.detachedViolations, 0, JSON.stringify(d.geometry));
  assert.ok(d.geometry.attachedMinGap >= d.geometry.gap - d.geometry.tolerance);
  assert.ok(d.geometry.maxThicknessError <= d.geometry.tolerance);
  assert.ok(d.geometry.wallSamples > 0 && d.geometry.attachedSurfaceSamples > 0);
}
async function load(page, thickness) {
  await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=shell`);
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
}
async function label(page, text) {
  await page.evaluate(text => {
    let el = document.querySelector('#thick-wax-capture-label');
    if (!el) { el = document.createElement('div'); el.id = 'thick-wax-capture-label'; el.style.cssText = 'position:fixed;top:84px;left:8px;right:8px;z-index:1000;background:#fffe;color:#382b41;padding:8px;font:12px sans-serif;pointer-events:none'; document.body.append(el); }
    el.textContent = text;
  }, text);
}
async function selectThickness(page, thickness) {
  if (await page.locator('[data-category=waxThickness]').isVisible()) await page.locator('[data-category=waxThickness]').click();
  await page.locator(`[name=waxThickness][value=${thickness}]`).check();
}
(async () => {
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(temporary, { recursive: true });
  const report = { recordedAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), modelSha256: digest('assets/models/squishy-orb.glb'), scope: 'orb / clay / making shell and decoration preview only', physicalPhone: false, mobile: 'Chromium mobile viewport and CDP touch emulation; rotation uses existing mouse background gesture', visualAcceptance: 'pending product-owner review', speed: 'normal wall time, no modified clocks', cases: [], performance: [], errors: [], exitCode: 1 };
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
  let browser;
  try {
    let started = false;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) { started = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
    assert.ok(started, 'Capture server started');
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
    report.browser = browser.version();
    const { squishyStyles } = await import('../src/squishy-styles.mjs');
    for (const touch of [false, true]) for (const thickness of ['thin', 'thick']) {
      const name = `${thickness}-orb-clay-${touch ? 'mobile-emulated' : 'desktop'}`;
      const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video();
      const item = { name, viewport, deviceScaleFactor: 1, measurements: [] }; report.cases.push(item);
      page.on('pageerror', e => report.errors.push({ name, error: e.message }));
      try {
        await installStyleProbe(page, squishyStyles.orb); await load(page, thickness); await ready(page);
        const client = touch ? await context.newCDPSession(page) : null;
        const send = async (type, p) => {
          if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: p.x, y: p.y, id: 0 }] });
          else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
          else if (type === 'move') await page.mouse.move(p.x, p.y);
          else await page.mouse.up();
        };
        const measure = async (stage, geometry = true) => {
          const d = await diagnostics(page, geometry); if (geometry) geometryOK(d);
          item.measurements.push({ stage, ...d }); return d;
        };
        for (const theme of ['day', 'night']) {
          await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(850);
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          const prefix = `${thickness} / ${theme} / 黏土圆球 / ${touch ? '模拟手机触摸，鼠标辅助旋转' : '桌面鼠标'} / 正常速度`;
          await label(page, `${prefix}：完整外观`); await measure(`${theme}-intact`);
          await page.screenshot({ path: `${folder}/${name}-${theme}-intact.png` });
          const hit = await projectedSurfaceContact(page, 0, .03);
          await label(page, `${prefix}：短按开裂`); await send('down', hit); await page.waitForTimeout(140); await send('up');
          await page.waitForTimeout(180); await measure(`${theme}-short-contact`);
          await page.screenshot({ path: `${folder}/${name}-${theme}-crack.png` });
          await label(page, `${prefix}：持续按住，逐步深压、分离与掉落`);
          await page.evaluate(() => {
            window.thickWaxTimeline = [];
            const el = document.querySelector('.toy-mount');
            window.addEventListener('pointerdown', () => {
              const start = performance.now();
              for (const targetMs of [300, 650, 1300, 2600, 4000]) setTimeout(() => {
                const d = el.thinWaxDiagnostics({ measure: false });
                window.thickWaxTimeline.push({ targetMs, actualMs: performance.now() - start, state: d.thinWax, coreState: d.coreState });
              }, targetMs);
            }, { capture: true, once: true });
          });
          await send('down', hit); await page.waitForTimeout(1500);
          await page.screenshot({ path: `${folder}/${name}-${theme}-falling.png` });
          await page.waitForFunction(() => window.thickWaxTimeline.length === 5);
          const held = await diagnostics(page); assert.ok(held.coreMaximumDisplacement > .01 && held.thinWax.detached > 0);
          item.measurements.push({ stage: `${theme}-continuous-hold`, ...held, timeline: await page.evaluate(() => window.thickWaxTimeline) });
          await send('up'); const released = await diagnostics(page);
          await label(page, `${prefix}：松开，内芯按原规则恢复，损伤保留`); await page.waitForTimeout(700);
          const recovered = await measure(`${theme}-recovery`); assert.equal(recovered.thinWax.detached, released.thinWax.detached);
          await label(page, `${prefix}：重复深压及连续拖动`); await send('down', hit); await page.waitForTimeout(1200);
          for (let i = 1; i <= 12; i++) { await send('move', { x: hit.x + i * 2, y: hit.y - i }); await page.waitForTimeout(35); }
          await send('up'); await page.waitForTimeout(400); await measure(`${theme}-drag-recovery`);
          await label(page, `${prefix}：侧视断面、破口与完整边缘`); await rotate(page, 65, 14); await measure(`${theme}-rotated`);
          await page.screenshot({ path: `${folder}/${name}-${theme}-side.png` }); await page.waitForTimeout(650); await rotate(page, -65, -14);
          await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.living === 0, null, { timeout: 15000 });
          const cleared = await measure(`${theme}-cleared`);
          assert.equal(cleared.thinWax.expired, cleared.thinWax.detached); assert.equal(cleared.thinWax.settled, 0); assert.equal(cleared.geometry.debris.gridCells, 0);
        }
        await label(page, '同配方外壳／装饰往返保留损伤；切换厚度建立新壳');
        const damaged = await diagnostics(page); await page.locator('.step-next').click(); await page.locator('.step-back').click();
        assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached);
        await selectThickness(page, thickness === 'thin' ? 'thick' : 'thin'); await page.waitForTimeout(600);
        await page.evaluate(thickness => {
          for (const id of ['thin', 'thick', 'medium', 'thick', 'thin', thickness]) document.querySelector(`[name=waxThickness][value=${id}]`).click();
        }, thickness);
        await page.waitForTimeout(900);
        const switched = await measure('rapid-switch-last-selection'); assert.equal(switched.geometry.thickness, thickness === 'thin' ? .014 : .042); assert.equal(switched.thinWax.detached, 0);
        await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(850);
        const restarted = await measure('restart'); assert.equal(restarted.thinWax.detached, 0); assert.ok(restarted.coreMaximumDisplacement < .00001);
        item.numericChecksCompleted = true;
      } finally { await context.close(); await video.saveAs(`${folder}/${name}.webm`); }
      console.log(`${name}: recorded and geometry/workflow checked`);
    }
    // No video or GPU probe in the performance pass. All completed-render
    // intervals, including stalls, are retained; no display-FPS claim is made.
    for (const thickness of ['thin', 'thick']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        const page = await context.newPage(); await load(page, thickness);
        await page.evaluate(() => {
          const el = document.querySelector('.toy-mount'); window.waxCapturePerf = { intervals: [], jumps: [], last: null, count: Number(el.dataset.renderCount) };
          new MutationObserver(() => { const p = window.waxCapturePerf, count = Number(el.dataset.renderCount); if (count === p.count) return; const now = performance.now(); if (p.last !== null) p.intervals.push(now - p.last); p.jumps.push(count - p.count); p.last = now; p.count = count; }).observe(el, { attributes: true, attributeFilter: ['data-render-count'] });
        });
        const b = await page.locator('.orb-input').boundingBox(), cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 0 }] });
        await page.waitForTimeout(4000); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const perf = await page.evaluate(() => window.waxCapturePerf), values = perf.intervals.slice().sort((a, b) => a - b);
        report.performance.push({ thickness, ...perf, samples: values.length, medianMs: values[Math.floor(values.length * .5)], p95Ms: values[Math.floor(values.length * .95)], maximumMs: values.at(-1), maximumCountJump: Math.max(...perf.jumps), measurement: 'MutationObserver after renderer.render completion; 390x844 Chromium mobile emulation, no video or GPU probe' });
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${folder}/comparison-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
