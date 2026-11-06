const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
let server, browser;
const base = 'http://127.0.0.1:4270';
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4270' } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
test('queued medium release cannot add fractures; final marshmallow core input still flushes and a fresh hold can fracture', { timeout: 90000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.MEDIUM_WAX_TEST_DPR || .5) });
  const diag = () => page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics({ measure: false }));
  try {
    // Deterministically model an ending input waiting in the browser queue.
    // Native key events still drive the real shared input and core factories.
    await page.addInitScript(() => Object.defineProperty(navigator, 'scheduling', { value: { isInputPending: () => Boolean(window.pendingMediumRelease) } }));
    await page.goto(base + '/squishy/cloud/?style=cloud&coreMaterial=marshmallow&waxThickness=medium&step=shell');
    await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
    await page.waitForFunction(() => { const el = document.querySelector('.toy-mount'); return el.thinWaxDiagnostics?.({ measure: false }).enabled && Number(el.dataset.renderCount) > 0; });
    await page.locator('.orb-input').focus();
    await page.evaluate(() => { window.pendingMediumRelease = true; });
    await page.keyboard.down('Space'); await page.waitForTimeout(650);
    const queued = await diag(); assert.equal(queued.thinWax.active, true); assert.equal(queued.thinWax.detached, 0);
    await page.keyboard.up('Space');
    await page.evaluate(() => { window.pendingMediumRelease = false; });
    await page.waitForFunction(() => !document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.active);
    const ended = await diag(); assert.equal(ended.thinWax.detached, 0); assert.ok(ended.coreState.depth > 0, 'The final pending core segment was committed before release');
    await page.waitForTimeout(150); const frozen = await diag(); assert.deepEqual(frozen.corePositions, ended.corePositions);
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
    await page.keyboard.down('Space');
    try { await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.detached > 0, undefined, { timeout: 15000 }); }
    finally { await page.keyboard.up('Space'); }
    assert.ok((await diag()).thinWax.detached > 0, 'Yielding never disables the next genuine continuous hold');
  } finally { await page.close(); }
});
