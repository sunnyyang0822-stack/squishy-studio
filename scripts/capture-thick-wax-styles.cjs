const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('../tests/helpers/squishy-browser.cjs');
const { projectedMeshContact, geometryOK } = require('../tests/helpers/wax-style-probe.cjs');

const supported = ['cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const folder = path.resolve('artifacts/issue-43-styles');
const temporary = path.resolve('.tmp/issue-43-styles-video');
const port = process.env.THICK_WAX_STYLES_CAPTURE_PORT || '4353';
const base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const diagnostics = (page, measure = false) => page.locator('.toy-mount').evaluate((el, measure) => {
  const { corePositions, coreRestPositions, ...d } = el.thinWaxDiagnostics({ measure, exhaustive: measure });
  d.coreMaximumDisplacement = 0;
  for (let i = 0; i < corePositions.length; i += 3) d.coreMaximumDisplacement = Math.max(d.coreMaximumDisplacement, Math.hypot(...[0, 1, 2].map(k => corePositions[i + k] - coreRestPositions[i + k])));
  return d;
}, measure);
async function label(page, text) {
  await page.evaluate(text => {
    let el = document.querySelector('#thick-wax-styles-label');
    if (!el) { el = document.createElement('div'); el.id = 'thick-wax-styles-label'; el.style.cssText = 'position:fixed;top:84px;left:8px;right:8px;z-index:1000;background:#fffe;color:#382b41;padding:8px;font:12px sans-serif;pointer-events:none'; document.body.append(el); }
    el.textContent = text;
  }, text);
}
async function main() {
  const styles = process.env.THICK_WAX_STYLE_CASES ? process.env.THICK_WAX_STYLE_CASES.split(',') : supported;
  assert.ok(styles.every(id => supported.includes(id)), 'Capture only approved non-paw clay styles');
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(temporary, { recursive: true });
  const performanceOnly = process.argv.includes('--performance-only');
  const captureOnly = process.argv.includes('--capture-only');
  const report = performanceOnly ? JSON.parse(fs.readFileSync(`${folder}/comparison-validation.json`, 'utf8')) : { recordedAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), scope: 'clay / cloud,cylinder,donut,pyramid,flower,star / shell-decoration only; paw excluded', physicalPhone: false, visualAcceptance: 'pending product-owner review', speed: 'normal wall time; no clock changes', mobile: '390x844 Chromium viewport and CDP touch; background rotation uses mouse and is labelled', cases: [], performance: [], errors: [], exitCode: 1 };
  assert.equal(report.bundleSha256, digest('assets/orb-preview.js'), 'Capture and performance must share the exact compiled bundle');
  if (performanceOnly) { report.performance = []; report.exitCode = 1; }
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' }); let browser;
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const style of (performanceOnly ? [] : styles)) for (const touch of [false, true]) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
      const device = touch ? 'mobile-emulated' : 'desktop', name = `${style}-clay-${device}-comparison`;
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video(), mesh = await installStyleProbe(page, getSquishyStyle(style));
      const item = { style, name, viewport, modelSha256: digest(`assets/models/squishy-${style}.glb`), operationTheme: touch ? 'night' : 'day', alternateTheme: 'intact appearance screenshot only', measurements: [] }; report.cases.push(item);
      page.on('pageerror', e => report.errors.push({ name, error: e.message }));
      const cdp = touch ? await context.newCDPSession(page) : null;
      const send = async (type, p) => {
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: p.x, y: p.y, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(p.x, p.y);
        else await page.mouse.up();
      };
      const measure = async (stage, geometry = true) => { const d = await diagnostics(page, geometry); if (geometry) geometryOK(d); item.measurements.push({ stage, ...d }); return d; };
      try {
        for (const thickness of ['thin', 'thick']) {
          await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=shell`); await ready(page);
          await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
          for (const theme of ['day', 'night']) {
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            await label(page, `${style} / ${thickness} / ${theme} / ${touch ? '模拟手机触摸；鼠标辅助转动' : '桌面鼠标'} / 正常速度：完整外观`);
            await page.waitForTimeout(150);
            await page.screenshot({ path: `${folder}/${style}-${device}-${thickness}-${theme}-intact.png` });
          }
          const theme = touch ? 'night' : 'day'; await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          const prefix = `${style} / ${thickness} / ${theme} / ${touch ? '模拟触摸，鼠标辅助旋转' : '桌面鼠标'} / 正常速度`;
          const intact = await measure(`${thickness}-intact`); assert.equal(intact.geometry.thickness, thickness === 'thin' ? .014 : .042);
          const hit = await projectedMeshContact(page, mesh, style); item.measurements.push({ stage: `${thickness}-actual-mesh-contact`, contact: hit });
          if (style === 'donut') assert.ok(hit.radialDot < -.03, 'Donut recording pressure targets the actual inner wall');
          await label(page, `${prefix}：短按开裂${style === 'donut' ? '（真实内圈）' : ''}`);
          await send('down', hit); await page.waitForTimeout(140); await send('up'); await page.waitForTimeout(180);
          await measure(`${thickness}-short`, false);
          await page.screenshot({ path: `${folder}/${style}-${device}-${thickness}-${theme}-crack.png` });
          await label(page, `${prefix}：持续深压、分离与大碎片掉落`);
          await send('down', hit); await page.waitForTimeout(1600);
          await page.screenshot({ path: `${folder}/${style}-${device}-${thickness}-${theme}-falling.png` });
          await page.waitForTimeout(1000); await send('up');
          const held = await measure(`${thickness}-released`); assert.ok(held.coreMaximumDisplacement > .01); assert.ok(held.thinWax.detached > 0);
          await label(page, `${prefix}：松开，损伤保留、内芯按原逻辑恢复`); await page.waitForTimeout(500);
          const recovered = await measure(`${thickness}-recovery`); assert.equal(recovered.thinWax.detached, held.thinWax.detached);
          await label(page, `${prefix}：重复深压并拖动${style === 'donut' ? '，检查内圈碎片' : ''}`);
          const next = await projectedMeshContact(page, mesh, style, [.06, .01]);
          await send('down', hit); await page.waitForTimeout(700);
          for (let i = 1; i <= 8; i++) { await send('move', { x: hit.x + (next.x - hit.x) * i / 8, y: hit.y + (next.y - hit.y) * i / 8 }); await page.waitForTimeout(40); }
          await send('up'); await page.waitForTimeout(300); await measure(`${thickness}-drag`);
          await label(page, `${prefix}：侧视局部断面、裂片边缘${style === 'donut' ? '和内环' : ''}`);
          await rotate(page, 48, 12); await measure(`${thickness}-rotated`);
          await page.screenshot({ path: `${folder}/${style}-${device}-${thickness}-${theme}-side.png` }); await page.waitForTimeout(400);
          await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.living === 0, null, { timeout: 15000 });
          const cleared = await measure(`${thickness}-cleared`); assert.equal(cleared.thinWax.expired, cleared.thinWax.detached); assert.equal(cleared.thinWax.settled, 0);
          const damage = cleared.thinWax.detached; await page.locator('.step-next').click(); await page.locator('.step-back').click(); assert.equal((await diagnostics(page)).thinWax.detached, damage);
        }
        await label(page, '快速薄／厚切换：最后选择生效，旧壳与碎片清理');
        if (await page.locator('[data-category=waxThickness]').isVisible()) await page.locator('[data-category=waxThickness]').click();
        await page.locator('[name=waxThickness][value=thin]').check();
        await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().geometry?.thickness === .014);
        await page.evaluate(() => { for (const value of ['thin', 'thick', 'medium', 'thin', 'thick']) document.querySelector(`[name=waxThickness][value=${value}]`).click(); });
        await page.waitForTimeout(850); const switched = await measure('rapid-switch'); assert.equal(switched.geometry.thickness, .042); assert.equal(switched.thinWax.detached, 0);
        await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(850); const reset = await measure('restart'); assert.equal(reset.thinWax.cracked, 0);
        item.numericChecksCompleted = true;
      } finally { await context.close(); await video.saveAs(`${folder}/${name}.webm`); }
      console.log(`${name}: real-mesh pressure, thickness, geometry, cleanup and workflow passed`);
    }
    // Rendering completion intervals, without recording or GPU observation.
    for (const style of (captureOnly ? [] : styles)) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        const page = await context.newPage(); await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thick&step=shell`);
        await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
        const bounds = await page.locator('.orb-input').boundingBox();
        const contact = report.cases.find(c => c.style === style && c.name.includes('mobile-emulated')).measurements.find(m => m.stage === 'thick-actual-mesh-contact').contact;
        await page.evaluate(() => { const el = document.querySelector('.toy-mount'); window.thickStylePerf = { intervals: [], jumps: [], last: null, count: Number(el.dataset.renderCount) }; new MutationObserver(() => { const p = window.thickStylePerf, count = Number(el.dataset.renderCount); if (p.count === count) return; const now = performance.now(); if (p.last !== null) p.intervals.push(now - p.last); p.jumps.push(count - p.count); p.last = now; p.count = count; }).observe(el, { attributes: true, attributeFilter: ['data-render-count'] }); });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: contact.x, y: contact.y, id: 0 }] });
        await page.waitForTimeout(3000);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const raw = await page.evaluate(() => window.thickStylePerf), values = raw.intervals.slice().sort((a, b) => a - b);
        assert.ok(values.length > 3, 'Performance pass must include actual render work');
        report.performance.push({ style, bounds, input: 'CDP touch at matching initial mobile real-mesh structural contact; no video/GPU observer', ...raw, samples: values.length, medianMs: values[Math.floor(values.length * .5)], p95Ms: values[Math.floor(values.length * .95)], maximumMs: values.at(-1), measurement: 'MutationObserver after renderer.render completion; not hardware display FPS' });
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${folder}/comparison-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { diagnostics };
