const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installStyleProbe } = require('../tests/helpers/squishy-browser.cjs');
const { projectedMeshContact } = require('../tests/helpers/wax-style-probe.cjs');
const { inputFor } = require('./capture-thick-orb-cores.cjs');
const { load, diagnostic, maximumDepth } = require('./capture-thick-nonpaw.cjs');
function summarize(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], p99Ms: sorted[Math.floor(sorted.length * .99)], maximumMs: sorted.at(-1) };
}
(async () => {
  const folder = path.resolve(process.env.THICK_NONPAW_OUTPUT || 'artifacts/issue-43-nonpaw'); fs.mkdirSync(folder, { recursive: true });
  const temporary = path.resolve('.tmp/browser'); fs.mkdirSync(temporary, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
  const port = process.env.THICK_NONPAW_PERF_PORT || '4383', base = `http://127.0.0.1:${port}`;
  const repeats = Number(process.env.THICK_NONPAW_PERF_REPEATS || 3); assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5);
  const baseline = process.env.THICK_NONPAW_PERF_BASELINE && fs.readFileSync(process.env.THICK_NONPAW_PERF_BASELINE);
  const selectedCores = (process.env.THICK_NONPAW_CORES || 'clay,marshmallow,butter').split(',');
  assert.ok(selectedCores.every(core => ['clay', 'marshmallow', 'butter'].includes(core)));
  const drag = process.env.THICK_NONPAW_PERF_DRAG === '1';
  const device = process.env.THICK_NONPAW_PERF_DEVICE || 'mobile-emulated';
  assert.ok(['desktop', 'mobile-emulated'].includes(device));
  const touch = device === 'mobile-emulated';
  const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const contextOptions = { viewport, hasTouch: touch, isMobile: touch };
  const input = touch ? '390x844 Chromium CDP touch emulation' : '1280x900 Chromium desktop mouse';
  const report = { repeats, createdAt: new Date().toISOString(), bundleSha256: crypto.createHash('sha256').update(fs.readFileSync('assets/orb-preview.js')).digest('hex'), conditions: `${input}, day, same colors and GLB inner-ring contact, four-second real hold, no profiler/video/GPU observers during measurement; render completion MutationObserver intervals are not physical display FPS`, device, viewport, drag, actualPhone: false, cases: [], exitCode: 1 };
  if (baseline) report.baselineBundleSha256 = crypto.createHash('sha256').update(baseline).digest('hex');
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' }); let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const core of selectedCores) {
      const probeContext = await browser.newContext(contextOptions), probePage = await probeContext.newPage();
      const mesh = await installStyleProbe(probePage, getSquishyStyle('donut')); await load(probePage, base, 'donut', core); const contact = await projectedMeshContact(probePage, mesh, 'donut'); assert.ok(contact.radialDot < -.03);
      const dragEnd = drag ? await projectedMeshContact(probePage, mesh, 'donut', [.06, .02]) : null;
      await probeContext.close();
      const variants = baseline ? ['baseline', 'thick'] : ['thin', 'thick'];
      for (let repeat = 0; repeat < repeats; repeat++) for (const variant of repeat % 2 ? [...variants].reverse() : variants) {
        const thickness = variant === 'baseline' ? 'thick' : variant;
        const context = await browser.newContext(contextOptions), page = await context.newPage();
        try {
          if (variant === 'baseline') await page.route('**/assets/orb-preview.js*', route => route.fulfill({ body: baseline, contentType: 'text/javascript' }));
          await load(page, base, 'donut', core, thickness); await page.evaluate(() => document.documentElement.dataset.theme = 'day');
          await page.evaluate(() => {
            const el = document.querySelector('.toy-mount');
            const p = window.nonpawPerf = { frames: [], count: Number(el.dataset.renderCount), phase: 'hold', press: null, last: null, firstRenderMs: null };
            window.addEventListener('pointerdown', () => { p.press = performance.now(); }, { once: true, capture: true });
            window.addEventListener('pointerup', () => observer.disconnect(), { once: true, capture: true });
            const observer = new MutationObserver(() => {
              const count = Number(el.dataset.renderCount);
              if (count === p.count || p.press === null) return;
              const now = performance.now();
              const elapsedMs = now - p.press;
              if (p.last === null) p.firstRenderMs = elapsedMs;
              else p.frames.push({ ms: now - p.last, elapsedMs, phase: p.phase, jump: count - p.count });
              p.last = now; p.count = count;
            });
            observer.observe(el, { attributes: true, attributeFilter: ['data-render-count'] });
          });
          const send = await inputFor(page, context, touch);
          await send('down', contact);
          await page.waitForTimeout(4000);
          const loaded = await diagnostic(page);
          if (dragEnd) {
            await page.evaluate(() => { window.nonpawPerf.phase = 'drag'; });
            for (let step = 1; step <= 12; step++) {
              await send('move', { x: contact.x + (dragEnd.x - contact.x) * step / 12, y: contact.y + (dragEnd.y - contact.y) * step / 12 });
              await page.waitForTimeout(40);
            }
          }
          await send('up');
          const { frames, firstRenderMs } = await page.evaluate(() => window.nonpawPerf);
          const hold = frames.filter(frame => frame.phase === 'hold' && frame.elapsedMs <= 4000);
          const holdIntervals = hold.map(frame => frame.ms);
          assert.ok(hold.length > 5 && firstRenderMs > 0 && loaded.thinWax.detached > 0 && maximumDepth(loaded) > .03);
          const phases = {
            beforeDwell: summarize(hold.filter(frame => frame.elapsedMs <= 500).map(frame => frame.ms)),
            sustainedHold: summarize(hold.filter(frame => frame.elapsedMs > 500).map(frame => frame.ms)),
            drag: summarize(frames.filter(frame => frame.phase === 'drag').map(frame => frame.ms)),
          };
          const timing = summarize(holdIntervals);
          report.cases.push({ style: 'donut', core, thickness, variant, repeat, contact, dragEnd, ...timing, firstRenderMs, phases, frames, depth: maximumDepth(loaded), actualDwellSeconds: loaded.thinWax.dwell, detached: loaded.thinWax.detached, resources: loaded.resources });
          console.log(JSON.stringify({ core, variant, repeat, ...timing, firstRenderMs, phases }));
        } finally { await context.close(); }
      }
    }
    report.exitCode = 0;
  } finally { fs.writeFileSync(`${folder}/performance-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
