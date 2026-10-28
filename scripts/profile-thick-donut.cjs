const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { buildSync } = require('esbuild');
const { installStyleProbe, ready } = require('../tests/helpers/squishy-browser.cjs');
const { projectedMeshContact } = require('../tests/helpers/wax-style-probe.cjs');
const folder = path.resolve('artifacts/issue-43-performance');
const port = process.env.THICK_DONUT_PROFILE_PORT || '4360';
const base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const counters = ['nearestCalls', 'nearestNodes', 'nearestTriangles', 'sweepCalls', 'sweepNodes', 'sweepTriangles', 'cachedQueries', 'gridQueries', 'attachedNearestSamples', 'detachedNearestSamples'];
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(), total = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], dt = profile.timeDeltas[i] || 0;
    self.set(id, (self.get(id) || 0) + dt);
    for (let current = id; current !== undefined; current = parent.get(current)) total.set(current, (total.get(current) || 0) + dt);
  }
  return [...nodes.values()].map(n => ({ name: n.callFrame.functionName || '(anonymous)', url: n.callFrame.url, line: n.callFrame.lineNumber + 1, column: n.callFrame.columnNumber + 1, selfMs: (self.get(n.id) || 0) / 1000, totalMs: (total.get(n.id) || 0) / 1000 })).sort((a, b) => b.selfMs - a.selfMs);
}
(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const suffix = process.env.THICK_DONUT_PROFILE_LABEL || 'before';
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
  let browser;
  const report = { recordedAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), sourceSha256: digest('src/thin-wax-panels.mjs'), cases: [], errors: [], exitCode: 1 };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const profilingBundle = buildSync({ entryPoints: ['src/orb-preview.js'], bundle: true, format: 'esm', target: 'es2022', minify: false, write: false }).outputFiles[0].text;
    const performanceRepeats = Number(process.env.THICK_DONUT_PERFORMANCE_REPEATS || 1);
    assert.ok(Number.isInteger(performanceRepeats) && performanceRepeats >= 1 && performanceRepeats <= 10);
    for (const mode of (process.argv.includes('--performance-only') ? ['performance'] : ['profile', 'performance'])) for (let repeat = 1; repeat <= (mode === 'performance' ? performanceRepeats : 1); repeat++) for (const thickness of ['thin', 'thick']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        const page = await context.newPage();
        page.on('pageerror', e => report.errors.push(e.message));
        let contact;
        // Coordinate discovery is separate from each actual measured page.
        const mesh = await installStyleProbe(page, getSquishyStyle('donut'));
        await page.goto(`${base}/squishy/cloud/?style=donut&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=shell`);
        await ready(page);
        contact = await projectedMeshContact(page, mesh, 'donut');
        assert.ok(contact.radialDot < -.03);
        await page.close();
        const measured = await context.newPage();
        if (mode === 'profile') await measured.route('**/assets/orb-preview.js', route => route.fulfill({ contentType: 'text/javascript', body: profilingBundle }));
        await measured.goto(`${base}/squishy/cloud/?style=donut&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=shell`);
        await measured.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
        await measured.evaluate(enableCounters => {
          const el = document.querySelector('.toy-mount');
          const p = window.donutProfile = { intervals: [], counters: [], last: null, count: Number(el.dataset.renderCount) };
          if (enableCounters) el.thinWaxDiagnostics({ counters: true });
          new MutationObserver(() => {
            const count = Number(el.dataset.renderCount);
            if (count === p.count) return;
            const now = performance.now();
            if (p.last !== null) p.intervals.push(now - p.last);
            p.last = now; p.count = count;
            if (enableCounters) p.counters.push(el.thinWaxDiagnostics({ counters: true }));
          }).observe(el, { attributes: true, attributeFilter: ['data-render-count'] });
        }, mode === 'profile');
        const cdp = await context.newCDPSession(measured);
        if (mode === 'profile') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: contact.x, y: contact.y, id: 0 }] });
        await measured.waitForTimeout(3000);
        for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: contact.x + i * 2, y: contact.y - i, id: 0 }] }); await measured.waitForTimeout(125); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        let profile;
        if (mode === 'profile') profile = (await cdp.send('Profiler.stop')).profile;
        const raw = await measured.evaluate(() => window.donutProfile);
        const state = await measured.locator('.toy-mount').evaluate(el => { const { corePositions, coreRestPositions, ...rest } = el.thinWaxDiagnostics({ measure: false }); let depth = 0; for (let i = 0; i < corePositions.length; i += 3) depth = Math.max(depth, Math.hypot(...[0, 1, 2].map(k => corePositions[i+k] - coreRestPositions[i+k]))); return { ...rest, depth }; });
        assert.ok(state.depth > .01 && state.thinWax.detached > 0);
        const sorted = raw.intervals.slice().sort((a, b) => a - b);
        const item = { mode, thickness, repeat, contact, state, ...raw, samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maximumMs: sorted.at(-1), observation: mode === 'profile' ? 'CPU profile uses an unminified bundle of identical source and counter observation; these intervals are diagnostic, not benchmark' : 'Shipped minified bundle, no GPU observer/profile/counter sampling; render-completion intervals, not display FPS' };
        if (profile) {
          fs.writeFileSync(`${folder}/${suffix}-${thickness}.cpuprofile`, JSON.stringify(profile));
          item.hotspots = profileSummary(profile).slice(0, 60);
          item.counterTotals = Object.fromEntries(counters.map(key => [key, raw.counters.reduce((sum, c) => sum + (c[key] || 0), 0)]));
          item.counterPerFrame = Object.fromEntries(counters.map(key => [key, item.counterTotals[key] / raw.counters.length]));
        }
        report.cases.push(item);
        console.log(JSON.stringify({ mode, thickness, repeat, samples: item.samples, medianMs: item.medianMs, p95Ms: item.p95Ms, maximumMs: item.maximumMs, hotspots: item.hotspots?.slice(0, 12), counterPerFrame: item.counterPerFrame }));
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []); report.exitCode = 0;
  } finally { fs.writeFileSync(`${folder}/${suffix}-profile.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
