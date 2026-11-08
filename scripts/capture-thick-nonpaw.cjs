const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, rotate } = require('../tests/helpers/squishy-browser.cjs');
const { projectedMeshContact, geometryOK } = require('../tests/helpers/wax-style-probe.cjs');
const { inputFor } = require('./capture-thick-orb-cores.cjs');
const styles = ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const cores = ['clay', 'marshmallow', 'butter'];
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const diagnostic = (page, measure = false, surface = false) => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), { measure, exhaustive: measure, surface });
const maximumDepth = d => { let depth = 0; for (let i = 0; i < d.corePositions.length; i += 3) depth = Math.max(depth, Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k]))); return depth; };
async function load(page, base, style, core, thickness = 'thick', step = 'shell') {
  await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${core}&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=${step}`);
  await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics);
  if (step === 'shell' && style !== 'paw') await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
}
async function restart(page) {
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.thinWax.detached === 0 && !d.coreState.restoring && d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 25000 });
}
async function armRelease(page) {
  await page.evaluate(() => {
    window.nonpawRelease = null;
    window.addEventListener('pointerup', event => {
      const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
      window.nonpawRelease = { ...d, corePositions: Array.from(d.corePositions), coreRestPositions: Array.from(d.coreRestPositions), trusted: event.isTrusted };
    }, { once: true });
  });
}
async function waitLoaded(page, minimum = .03, minimumDwell = .7) {
  await page.waitForFunction(({ minimum, minimumDwell }) => {
    const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
    if (!d.thinWax.active || !d.thinWax.detached || d.thinWax.dwell < minimumDwell) return false;
    for (let i = 0; i < d.corePositions.length; i += 3) if (Math.hypot(...[0, 1, 2].map(k => d.corePositions[i + k] - d.coreRestPositions[i + k])) > minimum) return true;
    return false;
  }, { minimum, minimumDwell }, { timeout: 25000 });
}
async function settled(page) {
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.living === 0, null, { timeout: 20000 });
}
async function naturalRestore(page) {
  await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }); return d.corePositions.every((v, i) => v === d.coreRestPositions[i]); }, null, { timeout: 35000 });
}
async function workflow(page) {
  const damaged = await diagnostic(page);
  await page.locator('.step-next').click(); await page.locator('.step-back').click();
  assert.equal((await diagnostic(page)).thinWax.detached, damaged.thinWax.detached);
  for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
  await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
  assert.equal(await page.getByRole('button', { name: '重新开始', exact: true }).isVisible(), false);
  await page.locator('.step-back').click(); await page.locator('.step-back').click();
  await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled);
  assert.equal((await diagnostic(page)).thinWax.detached, damaged.thinWax.detached);
  await restart(page);
}
async function main() {
  const selectedStyles = process.env.THICK_NONPAW_STYLES?.split(',') || styles;
  const selectedCores = process.env.THICK_NONPAW_CORES?.split(',') || cores;
  const selectedDevices = process.env.THICK_NONPAW_DEVICES?.split(',') || ['desktop', 'mobile-emulated'];
  assert.ok(selectedStyles.every(s => styles.includes(s))); assert.ok(selectedCores.every(s => cores.includes(s)));
  assert.ok(selectedDevices.every(device => ['desktop', 'mobile-emulated'].includes(device)));
  const output = path.resolve(process.env.THICK_NONPAW_OUTPUT || 'artifacts/issue-43-nonpaw');
  const temporary = path.resolve('.tmp/thick-nonpaw-video'); fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(temporary, { recursive: true });
  const browserTemporary = path.resolve('.tmp/browser'); fs.mkdirSync(browserTemporary, { recursive: true });
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = browserTemporary;
  const port = process.env.THICK_NONPAW_CAPTURE_PORT || '4381', base = `http://127.0.0.1:${port}`;
  const resume = process.argv.includes('--resume'), reportPath = `${output}/comparison-validation.json`;
  if (fs.existsSync(reportPath) && !resume) throw Error('Comparison report exists; use --resume with the same bundle or a new THICK_NONPAW_OUTPUT directory');
  const report = resume && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { createdAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), actualPhone: false, fixedColors: { coreColor: 'mint', shellColor: 'rose' }, operationTiming: 'Unmodified wall clock; deep hold reaches at least 2.1s continuous dwell; release snapshot is copied in the trusted pointerup task; slow rebound waits for exact natural rest', mobile: 'Chromium/CDP touch emulation 390x844; background rotations use existing mouse gesture', clocks: 'normal wall time', cases: [], errors: [], exitCode: 1 };
  assert.equal(report.bundleSha256, digest('assets/orb-preview.js'), 'Resumed captures must use exactly the same built script');
  report.selection = { styles: selectedStyles, cores: selectedCores, devices: selectedDevices };
  report.exitCode = 1; report.previousAttempts ||= [];
  report.previousFailures ||= [];
  if (report.failure) { report.previousFailures.push(report.failure); delete report.failure; }
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' }); let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const style of selectedStyles) for (const core of selectedCores) for (const device of selectedDevices) {
      const mobile = device === 'mobile-emulated';
      const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, name = `${style}-${core}-${mobile ? 'mobile-emulated' : 'desktop'}`;
      const previous = report.cases.find(item => item.name === name);
      if (previous?.complete) continue;
      if (previous) { report.previousAttempts.push(previous); report.cases = report.cases.filter(item => item.name !== name); }
      const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, recordVideo: { dir: temporary, size: viewport } }); const page = await context.newPage(), video = page.video();
      const item = { name, style, core, mobile, viewport, deviceScaleFactor: 1, modelSha256: digest('.' + getSquishyStyle(style).modelUrl), stages: [] }; report.cases.push(item); page.on('pageerror', e => report.errors.push({ name, error: e.message }));
      try {
        const mesh = await installStyleProbe(page, getSquishyStyle(style)), send = await inputFor(page, context, mobile);
        for (const thickness of ['thin', 'thick']) for (const theme of ['day', 'night']) {
          const stage = `${thickness}-${theme}`; await load(page, base, style, core, thickness); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          await page.evaluate(text => { const label = document.createElement('div'); label.textContent = text; label.style.cssText = 'position:fixed;top:78px;left:8px;right:8px;padding:6px;background:#fffe;color:#322039;font:12px sans-serif;z-index:1000;pointer-events:none'; document.body.append(label); }, `${style} / ${core} / ${thickness} / ${theme} / ${mobile ? '模拟触摸' : '桌面鼠标'}`);
          const contact = await projectedMeshContact(page, mesh, style); if (style === 'donut') assert.ok(contact.radialDot < -.03);
          const intact = await diagnostic(page, true); geometryOK(intact); assert.equal(intact.geometry.thickness, thickness === 'thin' ? .014 : .042);
          await page.screenshot({ path: `${output}/${name}-${stage}-intact.png` }); item.stages.push({ stage: `${stage}-intact`, contact, geometry: intact.geometry });
          await armRelease(page); await send('down', contact); await page.waitForTimeout(110); await page.screenshot({ path: `${output}/${name}-${stage}-crack.png` });
          await waitLoaded(page, .03, 2.1); const loaded = await diagnostic(page, true); geometryOK(loaded); await page.screenshot({ path: `${output}/${name}-${stage}-deep.png` });
          await send('up'); const released = await page.evaluate(() => window.nonpawRelease); assert.ok(released.trusted); await page.waitForTimeout(600); const recovered = await diagnostic(page, true); geometryOK(recovered);
          if (core === 'butter') { assert.ok(maximumDepth(recovered) < maximumDepth(released)); await naturalRestore(page); } else if (core === 'marshmallow') assert.deepEqual(recovered.corePositions, released.corePositions);
    else { assert.ok(maximumDepth(recovered) >= maximumDepth(released) * .8); assert.ok(maximumDepth(recovered) < maximumDepth(released)); }
          await settled(page);
          const dragStart = await projectedMeshContact(page, mesh, style), dragEnd = await projectedMeshContact(page, mesh, style, [.06, .02]);
          await send('down', dragStart); for (let i = 1; i <= 8; i++) { await send('move', { x: dragStart.x + (dragEnd.x - dragStart.x) * i / 8, y: dragStart.y + (dragEnd.y - dragStart.y) * i / 8 }); await page.waitForTimeout(30); }
          await send('up'); geometryOK(await diagnostic(page, true));
          if (core === 'butter') await naturalRestore(page);
          await rotate(page, 30, 8); const side = await diagnostic(page, true); geometryOK(side); await page.screenshot({ path: `${output}/${name}-${stage}-side.png` });
          item.stages.push({ stage: `${stage}-deep`, depth: maximumDepth(loaded), detached: loaded.thinWax.detached, geometry: loaded.geometry }, { stage: `${stage}-released`, depth: maximumDepth(released), damage: released.thinWax.detached }, { stage: `${stage}-recovered`, depth: maximumDepth(recovered), geometry: recovered.geometry }, { stage: `${stage}-side`, geometry: side.geometry });
        }
        item.complete = true;
      } finally { await context.close(); await video.saveAs(`${output}/${name}.webm`); fs.writeFileSync(`${output}/comparison-validation.json`, JSON.stringify(report, null, 2) + '\n'); }
    }
    assert.deepEqual(report.errors, []); assert.ok(report.cases.every(item => item.complete), 'Every retained capture case must be complete'); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error;
  } finally { fs.writeFileSync(`${output}/comparison-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { styles, cores, diagnostic, maximumDepth, load, restart, armRelease, waitLoaded, settled, naturalRestore, workflow };
