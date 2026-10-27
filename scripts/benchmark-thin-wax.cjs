// Run with the preview server already listening. Keep other browser/test jobs
// stopped. These are desktop render-completion intervals, not phone FPS.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

(async () => {
  const output = process.argv[2] || '.tmp/issue-38/benchmark.json';
  const url = process.env.THIN_WAX_BENCHMARK_URL || 'http://127.0.0.1:4380/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell';
  const contact = { x: Number(process.env.THIN_WAX_BENCHMARK_X || .5), y: Number(process.env.THIN_WAX_BENCHMARK_Y || .5) };
  if (![contact.x, contact.y].every(v => Number.isFinite(v) && v > 0 && v < 1)) throw Error('Benchmark contact must lie inside the input bounds');
  const bundleSha256 = crypto.createHash('sha256').update(fs.readFileSync('assets/orb-preview.js')).digest('hex');
  const served = await fetch(new URL('/assets/orb-preview.js', url));
  if (!served.ok || crypto.createHash('sha256').update(Buffer.from(await served.arrayBuffer())).digest('hex') !== bundleSha256) throw Error('Preview server does not serve the local build being measured');
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.({ measure: false }).enabled);
    await page.waitForTimeout(350);
    const client = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      const mount = document.querySelector('.toy-mount'); window.frameSamples = []; let previous = null;
      new MutationObserver(() => {
        const time = performance.now(); if (previous !== null) window.frameSamples.push(time - previous); previous = time;
      }).observe(mount, { attributes: true, attributeFilter: ['data-render-count'] });
    });
    const box = await page.locator('.orb-input').boundingBox();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * contact.x, y: box.y + box.height * contact.y, id: 0 }] });
    await page.waitForTimeout(4000);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const result = await page.evaluate(() => ({ intervals: window.frameSamples, state: document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax }));
    const sorted = result.intervals.slice().sort((a, b) => a - b);
    if (!sorted.length || result.state.detached < 3) throw new Error('Benchmark did not exercise a real wax fracture');
    result.summary = { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maximumMs: sorted.at(-1), above33ms: sorted.filter(value => value > 33.34).length };
    result.browser = browser.version(); result.recordedAt = new Date().toISOString(); result.url = url; result.contact = contact;
    result.bundleSha256 = bundleSha256;
    result.gpu = await page.evaluate(() => {
      const gl = document.querySelector('.toy-mount canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : gl.VENDOR) };
    });
    result.measurement = '390x844 desktop touch emulation, fresh recipe, actual 4-second hold; MutationObserver after renderer completion; all intervals retained, no recording or CPU profiler';
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result.summary));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
