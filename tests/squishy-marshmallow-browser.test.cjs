const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { installStyleProbe, stats, ready, point, settle, contactFor } = require('./helpers/squishy-browser.cjs');
const base = 'http://127.0.0.1:4187';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4187' } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
for (const id of ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) test(`${id}×marshmallow preset GPU: visible pressure stages, frozen unload, color restore, recipe and disposal`, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.clock.install();
    await installStyleProbe(page, getSquishyStyle(id));
    await page.goto(`${base}/squishy/cloud/?style=${id}&coreMaterial=marshmallow`); await ready(page);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'marshmallow');
    const canvas = await page.locator('.toy-mount canvas').elementHandle();
    const [x, y] = contactFor(id), p = await point(page, x, y);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.clock.runFor(80);
    const early = await stats(page); assert.ok(early.maximum > .0001 && early.maximum < .04, JSON.stringify(early));
    await page.clock.runFor(500); const pressed = await stats(page);
    assert.ok(pressed.maximum > early.maximum * 2 && pressed.maximum <= .700001 && pressed.changed > 10 && pressed.changed < pressed.vertices * .5);
    await page.mouse.move(p.x + 10, p.y - 6, { steps: 6 }); await page.clock.runFor(100); await page.mouse.up();
    await page.clock.resume(); await settle(page);
    const released = await page.evaluate(() => window.styleProbe.positions.slice());
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => window.styleProbe.positions), released, 'Release retains every actual GPU position');
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(150);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up(); await settle(page); const cancelled = await page.evaluate(() => window.styleProbe.positions.slice());
    await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(() => window.styleProbe.positions), cancelled);
    if (id === 'donut') assert.equal(await page.evaluate(() => { const p = window.styleProbe; return p.positions.every((v, i) => p.rest[i - i % 3] >= -.35 || v === p.rest[i]); }), true);
    await page.locator('[name=color][value=mint]').check();
    await page.waitForFunction(() => window.styleProbe.positions.every((v, i) => Math.abs(v - window.styleProbe.rest[i]) < 1e-6));
    assert.equal(await canvas.evaluate(el => el === document.querySelector('.toy-mount canvas')), true);
    for (let i = 0; i < 4; i++) await page.locator('.step-next').click();
    await page.waitForSelector('.step-panel[data-step=play]'); await ready(page);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'marshmallow');
    assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), id);
    await page.reload(); await ready(page);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'marshmallow');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('.toy-mount canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.styleProbe.contexts.every(gl => gl.isContextLost())), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
