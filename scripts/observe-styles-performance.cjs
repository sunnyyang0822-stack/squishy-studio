// Run after the final capture against the same frozen checkout/server.
// Measures completed renderer.render calls, not multi-pass WebGL draw calls.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { point, contactFor } = require('../tests/helpers/squishy-browser.cjs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4199';
const sha = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
(async () => {
  const bundleSHA256 = sha('assets/orb-preview.js');
  const response = await fetch(`${base}/assets/orb-preview.js`);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), bundleSHA256);
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = { date: new Date().toISOString(), bundleSHA256, browser: await browser.version(), method: 'data-render-count MutationObserver: one timestamp per mutation batch while holding 2000 ms. No WebGL probe or video. All intervals retained. Callback timing includes browser scheduling.', environment: 'Desktop Edge, 390x844 touch emulation; concurrent sequential repository tests may share GPU. No physical phone, FPS acceptance, temperature or power measurement.', models: [] };
  try {
    for (const id of ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) {
      const assetSHA256 = sha(`assets/models/squishy-${id}.glb`);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto(`${base}/squishy/cloud/?style=${id}`);
      await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
      await page.waitForFunction(() => Number(document.querySelector('.toy-mount').dataset.renderCount) > 0);
      const touch = await context.newCDPSession(page), p = await point(page, ...contactFor(id));
      await page.evaluate(() => {
        const mount = document.querySelector('.toy-mount');
        const probe = window.renderObservation = { startCount: Number(mount.dataset.renderCount), count: Number(mount.dataset.renderCount), intervals: [], jumps: [], last: null };
        probe.observer = new MutationObserver(records => {
          if (!records.some(r => r.attributeName === 'data-render-count')) return;
          const count = Number(mount.dataset.renderCount), now = performance.now();
          if (count === probe.count) return;
          probe.jumps.push(count - probe.count);
          if (probe.last !== null) probe.intervals.push(now - probe.last);
          probe.last = now; probe.count = count;
        });
        probe.observer.observe(mount, { attributes: true, attributeFilter: ['data-render-count'] });
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] });
      await page.waitForTimeout(2000);
      const observed = await page.evaluate(() => {
        const p = window.renderObservation; p.observer.disconnect();
        return { renderCountDelta: p.count - p.startCount, mutationBatches: p.jumps.length, maximumCountJump: Math.max(...p.jumps), intervalsMs: p.intervals };
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const values = observed.intervalsMs.slice().sort((a,b) => a-b);
      assert.ok(values.length > 10 && values.every(v => Number.isFinite(v) && v >= 0), `${id}: real active renderer completion samples required`);
      report.models.push({ id, assetSHA256, ...observed, summaryMs: { samples: values.length, median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], maximum: values.at(-1) } });
      assert.equal(sha(`assets/models/squishy-${id}.glb`), assetSHA256);
      assert.equal(sha('assets/orb-preview.js'), bundleSHA256);
      await context.close(); console.log(`${id}: renderer completion intervals observed`);
    }
    fs.writeFileSync('artifacts/issue-30/browser/performance.json', JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
