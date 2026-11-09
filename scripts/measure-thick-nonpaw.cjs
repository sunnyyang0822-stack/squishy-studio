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
(async () => {
  const folder = path.resolve(process.env.THICK_NONPAW_OUTPUT || 'artifacts/issue-43-nonpaw'); fs.mkdirSync(folder, { recursive: true });
  const temporary = path.resolve('.tmp/browser'); fs.mkdirSync(temporary, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.TMPDIR = temporary;
  const port = process.env.THICK_NONPAW_PERF_PORT || '4383', base = `http://127.0.0.1:${port}`;
  const repeats = Number(process.env.THICK_NONPAW_PERF_REPEATS || 3); assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5);
  const baseline = process.env.THICK_NONPAW_PERF_BASELINE && fs.readFileSync(process.env.THICK_NONPAW_PERF_BASELINE);
  const selectedCores = (process.env.THICK_NONPAW_CORES || 'clay,marshmallow,butter').split(',');
  assert.ok(selectedCores.every(core => ['clay', 'marshmallow', 'butter'].includes(core)));
  const report = { repeats, createdAt: new Date().toISOString(), bundleSha256: crypto.createHash('sha256').update(fs.readFileSync('assets/orb-preview.js')).digest('hex'), conditions: '390x844 Chromium CDP touch emulation, day, same colors and GLB inner-ring contact, four-second real hold, no profiler/video/GPU observers during measurement; render completion MutationObserver intervals are not physical display FPS', actualPhone: false, cases: [], exitCode: 1 };
  if (baseline) report.baselineBundleSha256 = crypto.createHash('sha256').update(baseline).digest('hex');
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' }); let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const core of selectedCores) {
      const probeContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }), probePage = await probeContext.newPage();
      const mesh = await installStyleProbe(probePage, getSquishyStyle('donut')); await load(probePage, base, 'donut', core); const contact = await projectedMeshContact(probePage, mesh, 'donut'); assert.ok(contact.radialDot < -.03); await probeContext.close();
      const variants = baseline ? ['baseline', 'thick'] : ['thin', 'thick'];
      for (let repeat = 0; repeat < repeats; repeat++) for (const variant of repeat % 2 ? [...variants].reverse() : variants) {
        const thickness = variant === 'baseline' ? 'thick' : variant;
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }), page = await context.newPage();
        try {
          if (variant === 'baseline') await page.route('**/assets/orb-preview.js*', route => route.fulfill({ body: baseline, contentType: 'text/javascript' }));
          await load(page, base, 'donut', core, thickness); await page.evaluate(() => document.documentElement.dataset.theme = 'day');
          await page.evaluate(() => { const el = document.querySelector('.toy-mount'); window.nonpawPerf = { intervals: [], jumps: [], count: Number(el.dataset.renderCount), last: null }; new MutationObserver(() => { const p = window.nonpawPerf, count = Number(el.dataset.renderCount); if (count === p.count) return; const now = performance.now(); if (p.last !== null) p.intervals.push(now - p.last); p.jumps.push(count - p.count); p.last = now; p.count = count; }).observe(el, { attributes: true, attributeFilter: ['data-render-count'] }); });
          const send = await inputFor(page, context, true); await send('down', contact); await page.waitForTimeout(4000); const loaded = await diagnostic(page); await send('up');
          const { intervals, jumps } = await page.evaluate(() => window.nonpawPerf), values = intervals.slice().sort((a, b) => a - b); assert.ok(values.length > 5 && loaded.thinWax.detached > 0 && maximumDepth(loaded) > .03);
          report.cases.push({ style: 'donut', core, thickness, variant, repeat, contact, samples: values.length, medianMs: values[Math.floor(values.length * .5)], p95Ms: values[Math.floor(values.length * .95)], p99Ms: values[Math.floor(values.length * .99)], maximumMs: values.at(-1), intervals, jumps, depth: maximumDepth(loaded), actualDwellSeconds: loaded.thinWax.dwell, detached: loaded.thinWax.detached, resources: loaded.resources });
          const { samples, p95Ms, p99Ms, maximumMs } = report.cases.at(-1);
          console.log(JSON.stringify({ core, variant, repeat, samples, p95Ms, p99Ms, maximumMs }));
        } finally { await context.close(); }
      }
    }
    report.exitCode = 0;
  } finally { fs.writeFileSync(`${folder}/performance-validation.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
