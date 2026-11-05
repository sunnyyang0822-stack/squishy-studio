const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('../tests/helpers/squishy-browser.cjs');
const folder = path.resolve(process.env.THICK_ORB_CORE_OUTPUT || 'artifacts/issue-43-orb-cores');
const temporary = path.resolve('.tmp/thick-orb-cores-video');
const port = process.env.THICK_ORB_CORE_CAPTURE_PORT || '4365';
const base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const diagnostics = (page, measure = false, positions = false) => page.locator('.toy-mount').evaluate((el, { measure, positions }) => {
  const { corePositions, coreRestPositions, ...d } = el.thinWaxDiagnostics({ measure, exhaustive: measure });
  d.coreMaximumDisplacement = 0;
  for (let i = 0; i < corePositions.length; i += 3) d.coreMaximumDisplacement = Math.max(d.coreMaximumDisplacement, Math.hypot(...[0, 1, 2].map(k => corePositions[i + k] - coreRestPositions[i + k])));
  if (positions) d.corePositions = corePositions;
  return d;
}, { measure, positions });
function geometryOK(d, thickness) {
  assert.ok(d.enabled && d.geometry);
  assert.equal(d.geometry.attachedViolations, 0, JSON.stringify(d.geometry));
  assert.equal(d.geometry.detachedViolations, 0, JSON.stringify(d.geometry));
  assert.ok(d.geometry.attachedMinGap >= d.geometry.gap - d.geometry.tolerance);
  assert.ok(d.geometry.maxThicknessError < 1e-5);
  if (thickness) assert.equal(d.geometry.thickness, thickness === 'thin' ? .014 : .042);
}
async function load(page, origin, core, thickness, step = 'shell') {
  await page.goto(`${origin}/squishy/cloud/?style=orb&coreMaterial=${core}&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=${step}`);
  await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics);
  if (step === 'shell') await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
}
async function label(page, text) {
  await page.evaluate(text => {
    let el = document.querySelector('#thick-orb-capture-label');
    if (!el) { el = document.createElement('div'); el.id = 'thick-orb-capture-label'; el.style.cssText = 'position:fixed;top:84px;left:8px;right:8px;z-index:1000;background:#fffe;color:#382b41;padding:8px;font:12px sans-serif;pointer-events:none'; document.body.append(el); }
    el.textContent = text;
  }, text);
}
async function inputFor(page, context, touch) {
  const client = touch ? await context.newCDPSession(page) : null;
  return async (type, p) => {
    if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: p.x, y: p.y, id: 0 }] });
    else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
    else if (type === 'move') await page.mouse.move(p.x, p.y);
    else await page.mouse.up();
  };
}
async function restart(page) {
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.thinWax.detached === 0 && !d.coreState.restoring && d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 20000 });
}
async function workflow(page, thickness) {
  const damaged = await diagnostics(page);
  await page.locator('.step-next').click(); await page.locator('.step-back').click();
  assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached);
  for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
  await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
  assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).isVisible(), false);
  await page.locator('.step-back').click(); await page.locator('.step-back').click();
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
  assert.equal((await diagnostics(page)).thinWax.detached, damaged.thinWax.detached, 'Returning from bare-core final play preserves making shell damage');
  if (await page.locator('[data-category=waxThickness]').isVisible()) await page.locator('[data-category=waxThickness]').click();
  await page.locator(`[name=waxThickness][value=${thickness === 'thin' ? 'thick' : 'thin'}]`).check();
  await page.waitForFunction(expected => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === expected, thickness === 'thin' ? .042 : .014);
  await page.evaluate(thickness => { for (const value of ['thin', 'thick', 'medium', 'thin', thickness]) document.querySelector(`[name=waxThickness][value=${value}]`).click(); }, thickness);
  await page.waitForFunction(expected => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics(); return d.enabled && d.geometry.thickness === expected && d.thinWax.detached === 0; }, thickness === 'thin' ? .014 : .042);
  await restart(page);
  return diagnostics(page, true);
}
async function main() {
  const cores = process.env.THICK_ORB_CORES ? process.env.THICK_ORB_CORES.split(',') : ['marshmallow', 'butter'];
  assert.ok(cores.every(c => ['marshmallow', 'butter'].includes(c)));
  const performanceOnly = process.argv.includes('--performance-only'), captureOnly = process.argv.includes('--capture-only');
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(temporary, { recursive: true });
  const report = performanceOnly ? JSON.parse(fs.readFileSync(`${folder}/comparison-validation.json`, 'utf8')) : { recordedAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), modelSha256: digest('assets/models/squishy-orb.glb'), scope: 'orb marshmallow/slow-rebound making shell and decoration only; legacy final play remains bare core', physicalPhone: false, mobile: 'Chromium 390x844 mobile/CDP touch emulation; background rotation uses existing mouse gesture and is labelled', speed: 'normal wall time, no modified clocks', cases: [], performance: [], errors: [], exitCode: 1 };
  assert.equal(report.bundleSha256, digest('assets/orb-preview.js'), 'Recording and performance bundle bytes must match');
  if (performanceOnly) { report.performance = []; report.exitCode = 1; }
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' }); let browser;
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const core of (performanceOnly ? [] : cores)) for (const touch of [false, true]) {
      const device = touch ? 'mobile-emulated' : 'desktop', name = `${core}-orb-${device}-comparison`, viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video(), item = { core, name, viewport, operationThemes: ['day', 'night'], initialState: 'fresh navigation for each thickness/theme; same asset/colors/view', measurements: [] }; report.cases.push(item);
      page.on('pageerror', error => report.errors.push({ name, error: error.message }));
      try {
        await installStyleProbe(page, getSquishyStyle('orb')); const send = await inputFor(page, context, touch);
        const measure = async (stage, geometry = true) => { const d = await diagnostics(page, geometry); if (geometry) geometryOK(d); item.measurements.push({ stage, ...d }); return d; };
        for (const thickness of ['thin', 'thick']) for (const theme of ['day', 'night']) {
          await load(page, base, core, thickness); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          const prefix = `${core === 'butter' ? '慢回弹' : '棉花糖'} / ${thickness} / ${theme} / ${touch ? '模拟手机触摸，鼠标辅助旋转' : '桌面鼠标'} / 正常速度`;
          await label(page, `${prefix}：完整外观（每段重新初始化）`); const intact = await measure(`${thickness}-${theme}-intact`); geometryOK(intact, thickness);
          await page.screenshot({ path: `${folder}/${core}-${device}-${thickness}-${theme}-intact.png` });
          const hit = await projectedSurfaceContact(page, 0, .03); item.measurements.push({ stage: `${thickness}-${theme}-contact`, contact: hit });
          await label(page, `${prefix}：短按开裂`); await send('down', hit); await page.waitForTimeout(140); await send('up'); await page.waitForTimeout(180);
          const short = await measure(`${thickness}-${theme}-short`, false); assert.ok(short.thinWax.cracked > 0); assert.equal(short.thinWax.detached, 0);
          await page.screenshot({ path: `${folder}/${core}-${device}-${thickness}-${theme}-crack.png` });
          await label(page, `${prefix}：持续按压、局部加深、分离掉落`); await send('down', hit); await page.waitForTimeout(1600);
          await page.screenshot({ path: `${folder}/${core}-${device}-${thickness}-${theme}-falling.png` });
          await page.waitForTimeout(1000); await send('up');
          const released = await diagnostics(page, false, true); assert.ok(released.coreMaximumDisplacement > .05 && released.thinWax.detached > 0);
          await measure(`${thickness}-${theme}-release`); await label(page, `${prefix}：松手${core === 'butter' ? '完整慢恢复，破口保留' : '形态完全留痕，破口保留'}`); await page.waitForTimeout(700);
          const recovered = await diagnostics(page, true, true); geometryOK(recovered); assert.equal(recovered.thinWax.detached, released.thinWax.detached);
          if (core === 'marshmallow') assert.deepEqual(recovered.corePositions, released.corePositions, 'Marshmallow retains every released coordinate');
          else { assert.ok(recovered.coreMaximumDisplacement < released.coreMaximumDisplacement); await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 25000 }); }
          await measure(`${thickness}-${theme}-recovery`);
          await label(page, `${prefix}：破口边缘重复深压并连续拖动`); await send('down', hit); await page.waitForTimeout(900);
          for (let i = 1; i <= 10; i++) { await send('move', { x: hit.x + i * 2, y: hit.y - i }); await page.waitForTimeout(35); }
          await send('up'); await page.waitForTimeout(350); await measure(`${thickness}-${theme}-drag`);
          await label(page, `${prefix}：侧面局部厚度、裂片边缘与内芯`); await rotate(page, 48, 12); await measure(`${thickness}-${theme}-rotated`);
          await page.screenshot({ path: `${folder}/${core}-${device}-${thickness}-${theme}-side.png` }); await page.waitForTimeout(400);
          await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.living === 0, null, { timeout: 15000 });
          const cleaned = await measure(`${thickness}-${theme}-cleared`); assert.equal(cleaned.thinWax.expired, cleaned.thinWax.detached); assert.equal(cleaned.thinWax.settled, 0);
          await label(page, `${prefix}：导航保留损伤、最终裸芯、薄厚快切与重开`);
          const reset = await workflow(page, thickness); item.measurements.push({ stage: `${thickness}-${theme}-workflow-reset`, ...reset });
        }
        item.numericChecksCompleted = true;
      } finally { await context.close(); await video.saveAs(`${folder}/${name}.webm`); }
      console.log(`${name}: four full thin/thick day/night sequences passed`);
    }
    for (const core of (captureOnly ? [] : cores)) for (const thickness of ['thin', 'thick']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        const page = await context.newPage(); await load(page, base, core, thickness);
        await page.evaluate(() => document.documentElement.dataset.theme = 'day');
        const contact = report.cases.find(c => c.core === core && c.name.includes('mobile-emulated')).measurements.find(m => m.stage === `${thickness}-day-contact`).contact;
        await page.evaluate(() => { const el = document.querySelector('.toy-mount'); window.orbCorePerf = { intervals: [], jumps: [], last: null, count: Number(el.dataset.renderCount) }; new MutationObserver(() => { const p = window.orbCorePerf, count = Number(el.dataset.renderCount); if (count === p.count) return; const now = performance.now(); if (p.last !== null) p.intervals.push(now - p.last); p.jumps.push(count - p.count); p.last = now; p.count = count; }).observe(el, { attributes: true, attributeFilter: ['data-render-count'] }); });
        const send = await inputFor(page, context, true); await send('down', contact); await page.waitForTimeout(4000); await send('up');
        const raw = await page.evaluate(() => window.orbCorePerf), values = raw.intervals.slice().sort((a, b) => a - b), pressed = await diagnostics(page);
        assert.ok(pressed.coreMaximumDisplacement > .05 && pressed.thinWax.detached > 0 && values.length > 5);
        report.performance.push({ core, thickness, contact, ...raw, samples: values.length, medianMs: values[Math.floor(values.length * .5)], p95Ms: values[Math.floor(values.length * .95)], maximumMs: values.at(-1), coreMaximumDisplacement: pressed.coreMaximumDisplacement, detached: pressed.thinWax.detached, resources: pressed.resources, measurement: '4s real CDP touch; no video/GPU observer/profiler; render completion MutationObserver intervals, not hardware display FPS' });
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${folder}/comparison-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { diagnostics, geometryOK, inputFor, load, restart, workflow };
