const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('../tests/helpers/squishy-browser.cjs');
const folder = path.resolve('artifacts/issue-38'), temporary = path.resolve('.tmp/issue-38-video');
const port = process.env.THIN_WAX_CAPTURE_PORT || '4229', base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const performanceOnly = process.argv.includes('--performance-only'), captureOnly = process.argv.includes('--capture-only');
const diag = (page, options = { measure: false }) => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), options);
function brief(d) { const { corePositions, coreRestPositions, ...rest } = d; let depth = 0; for (let i = 0; i < corePositions.length; i += 3) depth = Math.max(depth, Math.hypot(...[0, 1, 2].map(k => corePositions[i + k] - coreRestPositions[i + k]))); return { ...rest, coreMaximumDisplacement: depth }; }
(async () => {
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(temporary, { recursive: true });
  const report = performanceOnly ? JSON.parse(fs.readFileSync(`${folder}/validation.json`, 'utf8')) : { recordedAt: new Date().toISOString(), visualAcceptance: 'pending user review; numeric checks are insufficient for visual acceptance', speed: 'normal wall time; no accelerated clocks', physicalPhone: false, mobile: 'Chromium 390×844 CDP touch emulation on this desktop', bundleSha256: digest('assets/orb-preview.js'), cases: [], errors: [], exitCode: 1 };
  assert.equal(report.bundleSha256, digest('assets/orb-preview.js'), 'Performance and visual evidence must use the same bundle');
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } }); let browser;
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { squishyStyles } = await import('../src/squishy-styles.mjs');
    // Complete the sphere's vertical slice first, then each currently supported combination.
    const styles = performanceOnly ? [] : ['orb'];
    for (const style of styles) for (const material of ['clay']) for (const touch of [false, true]) {
      const feel = material === 'butter' ? 'slow-rebound' : material;
      if (!squishyStyles[style].supportedFeels.includes(feel)) continue;
      const name = `${style}-${material}-${touch ? 'mobile' : 'desktop'}`, viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video(), item = { name, style, feel, modelSha256: digest(`assets/models/squishy-${style}.glb`), viewport, measurements: [] }; report.cases.push(item);
      page.on('pageerror', e => report.errors.push({ name, error: e.message }));
      try {
        await installStyleProbe(page, squishyStyles[style]);
        await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${material}&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`); await ready(page);
        await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
        await page.evaluate(() => { const el = document.createElement('div'); el.id = 'wax-capture-label'; el.style.cssText = 'position:fixed;top:90px;left:12px;z-index:1000;background:#fffE;color:#412f46;padding:8px;font:13px sans-serif;pointer-events:none'; document.body.append(el); });
        const label = text => page.locator('#wax-capture-label').evaluate((el, text) => el.textContent = text + ' · 正常速度', text);
        const client = touch ? await context.newCDPSession(page) : null;
        const hit = await projectedSurfaceContact(page, style === 'donut' ? .72 : style === 'paw' ? -.24 : 0, style === 'paw' ? -.46 : .03);
        async function send(type, p = hit) {
          if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: p.x, y: p.y, id: 0 }] });
          else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); } else if (type === 'move') await page.mouse.move(p.x, p.y); else await page.mouse.up();
        }
        async function measure(stage, { geometry = false } = {}) {
          const d = brief(await diag(page, { measure: geometry, exhaustive: geometry }));
          if (geometry) { assert.ok(d.geometry.attachedMinGap >= d.geometry.gap - d.geometry.tolerance, JSON.stringify(d.geometry)); assert.equal(d.geometry.attachedViolations, 0); assert.equal(d.geometry.detachedViolations, 0); }
          item.measurements.push({ stage, time: await page.evaluate(() => performance.now()), ...d }); return d;
        }
        for (const theme of ['day', 'night']) {
          await page.getByRole('button', { name: '重新开始', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().thinWax.detached === 0);
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await label(`${theme} / ${style} / ${feel}：短按裂缝`);
          await page.screenshot({ path: `${folder}/${name}-${theme}-intact.png` });
          await send('down'); await page.waitForTimeout(260); await send('up'); await measure(`${theme}-short`); await page.waitForTimeout(250);
          await page.screenshot({ path: `${folder}/${name}-${theme}-crack.png` });
          await label('按住600ms：保持局部起裂，尚不脱落');
          await send('down'); await page.waitForTimeout(600); await send('up'); const lifting = await measure(`${theme}-lifting`); assert.equal(lifting.thinWax.detached, 0);
          await page.screenshot({ path: `${folder}/${name}-${theme}-lifting.png` });
          if (!touch) { await rotate(page, 48, 8); await page.screenshot({ path: `${folder}/${name}-${theme}-lifting-side.png` }); await rotate(page, -48, -8); }
          await label('持续挤压：局部瞬间连锁裂开，多数碎片仍附着，仅少量落下');
          await page.evaluate(() => {
            window.waxCaptureTimeline = [];
            window.addEventListener('pointerdown', () => {
              const start = performance.now();
              for (const targetMs of [600, 760, 1100, 2600, 5000]) setTimeout(() => {
                const d = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false });
                window.waxCaptureTimeline.push({ targetMs, actualMs: performance.now() - start, thinWax: d.thinWax, coreState: d.coreState });
              }, targetMs);
            }, { capture: true, once: true });
          });
          await send('down'); await page.waitForFunction(() => window.waxCaptureTimeline.length >= 2);
          await page.screenshot({ path: `${folder}/${name}-${theme}-burst.png` });
          await page.waitForFunction(() => window.waxCaptureTimeline.length === 5);
          const timeline = await page.evaluate(() => window.waxCaptureTimeline);
          item.measurements.push({ stage: `${theme}-continuous-timeline`, timeline });
          assert.equal(timeline[0].thinWax.detached, 0);
          assert.ok(timeline[2].thinWax.cracked > timeline[2].thinWax.detached * 2, 'Most chain-fractured wax remains attached');
          assert.ok(timeline[4].thinWax.cracked - timeline[4].thinWax.detached >= 3);
          assert.ok(timeline[4].thinWax.detached - timeline[3].thinWax.detached <= 1, 'Steady saturated pressure does not keep mechanically ejecting plates');
          await page.screenshot({ path: `${folder}/${name}-${theme}-held.png` });
          await label('松开：内芯按原规则恢复，附着裂片保留，少量碎屑继续下落'); await send('up'); const stopped = await measure(`${theme}-mouseup`); await page.waitForTimeout(800); const released = await measure(`${theme}-release`, { geometry: true }); assert.equal(released.thinWax.detached, stopped.thinWax.detached, 'Release never propagates new damage');
          await label('重复深压破损边缘，连续拖动'); await send('down'); await page.waitForTimeout(1400);
          for (let i = 1; i <= 12; i++) { await send('move', { x: hit.x + i * 2, y: hit.y - i }); await page.waitForTimeout(35); }
          await measure(`${theme}-drag`); await send('up'); await page.waitForTimeout(700); await measure(`${theme}-drag-geometry`, { geometry: true });
          if (!touch) { await label('侧面旋转检查断面与内芯'); await rotate(page, 48, 8); await page.screenshot({ path: `${folder}/${name}-${theme}-side.png` }); await rotate(page, -48, -8); }
        }
        await label('同配方进入最终试捏，再返回：破损保留');
        const preserved = (await diag(page)).thinWax.detached;
        for (let i = 0; i < 3; i++) await page.locator('.step-next').click();
        await page.waitForTimeout(400); assert.equal((await diag(page)).thinWax.detached, preserved);
        await page.locator('.step-back').click(); await page.locator('.step-back').click();
        await measure('workflow-return');
        await label('重新开始：清空压痕、裂纹和碎片');
        await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(750);
        const restarted = await measure('restart', { geometry: true }); assert.equal(restarted.thinWax.detached, 0);
        await page.screenshot({ path: `${folder}/${name}-restarted.png` });
        await label('切换厚度：中厚保持原占位；重新选薄创建新壳');
        if (await page.locator('[data-category=waxThickness]').isVisible()) await page.locator('[data-category=waxThickness]').click();
        await page.locator('[name=waxThickness][value=medium]').check(); await page.waitForTimeout(400); assert.equal((await diag(page)).enabled, false);
        await page.locator('[name=waxThickness][value=thin]').check(); await page.waitForTimeout(750); await measure('reconfigured');
        await label('换壳色保持薄荷绿内芯；快速配置切换只提交最后选择');
        if (await page.locator('[data-category=shellColor]').isVisible()) await page.locator('[data-category=shellColor]').click();
        await page.locator('[name=shellColor][data-choice=sky]').check(); await page.waitForTimeout(750);
        const colorChange = await measure('shell-color'); assert.equal(colorChange.coreColor, 'mint'); assert.equal(colorChange.shellColor, 'sky');
        await page.evaluate(() => { for (const id of ['medium', 'thin', 'thick', 'thin']) document.querySelector(`[name=waxThickness][value=${id}]`).click(); });
        await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().enabled);
        await page.waitForTimeout(750); await measure('rapid-configuration'); await page.screenshot({ path: `${folder}/${name}-reconfigured.png` });
        item.pageScrollY = await page.evaluate(() => scrollY); item.gpuUploads = await page.evaluate(() => window.styleProbe.uploads);
        item.numericChecksCompleted = true;
      } finally { await context.close(); await video.saveAs(`${folder}/${name}.webm`); }
      console.log(`${name}: recorded`);
    }
    // A separate unrecorded context avoids conflating capture/probe costs with
    // renderer-completion intervals. This remains desktop touch emulation.
    if (!captureOnly) {
    const perfContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      const page = await perfContext.newPage();
      await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&waxThickness=thin&step=shell`);
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
      await page.evaluate(() => {
        const mount = document.querySelector('.toy-mount'); window.waxPerformance = { intervals: [], jumps: [], last: null, count: Number(mount.dataset.renderCount) };
        new MutationObserver(() => { const p = window.waxPerformance, n = Number(mount.dataset.renderCount); if (n === p.count) return; const now = performance.now(); if (p.last !== null) p.intervals.push(now - p.last); p.jumps.push(n - p.count); p.count = n; p.last = now; }).observe(mount, { attributes: true, attributeFilter: ['data-render-count'] });
      });
      const b = await page.locator('.orb-input').boundingBox(), client = await perfContext.newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 0 }] });
      await page.waitForTimeout(4000);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      report.performance = await page.evaluate(() => window.waxPerformance);
      report.performance.recordedAt = new Date().toISOString();
      const sorted = report.performance.intervals.slice().sort((a, b) => a - b);
      report.performance.summary = { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maximumMs: sorted.at(-1), maximumCountJump: Math.max(...report.performance.jumps), measurement: 'MutationObserver after renderer.render completion; all intervals retained; no video/GPU buffer probe' };
    } finally { await perfContext.close(); }
    }
    assert.deepEqual(report.errors, []); report.exitCode = 0;
  } catch (error) { report.exitCode = 1; report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
