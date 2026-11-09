const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { installStyleProbe, ready, projectedSurfaceContact, rotate } = require('./helpers/squishy-browser.cjs');
const base = `http://127.0.0.1:${process.env.MEDIUM_WAX_TEST_PORT || 4241}`;
const output = path.resolve('.tmp/issue-41');
const capture = process.env.MEDIUM_WAX_CAPTURE === '1';
let browser, server;
const diag = (page, measure = false) => page.locator('.toy-mount').evaluate((el, measure) => {
  const d = el.thinWaxDiagnostics({ measure, exhaustive: measure });
  delete d.corePositions; delete d.coreRestPositions; return d;
}, measure);
before(async () => {
  if (capture) fs.mkdirSync(output, { recursive: true });
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: new URL(base).port } });
  let available = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) { available = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(available, 'Local server starts');
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

for (const mobile of [false, true]) for (const theme of ['day', 'night']) test(`thin/medium matched orb-clay: ${mobile ? 'mobile-emulation' : 'desktop'} ${theme}`, { timeout: 120000 }, async () => {
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const measurements = [];
  for (const thickness of ['thin', 'medium']) {
    const name = `${mobile ? 'mobile' : 'desktop'}-${theme}-${thickness}`;
    const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    const context = await browser.newContext({ viewport, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1), isMobile: mobile, hasTouch: mobile, ...(capture ? { recordVideo: { dir: output, size: viewport } } : {}) });
    const page = await context.newPage(), video = page.video(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(theme => {
        localStorage.setItem('theme', theme);
        window.waxIntervals = []; let last;
        const nativeFrame = requestAnimationFrame;
        window.requestAnimationFrame = callback => nativeFrame(time => {
          callback(time);
          if (window.waxPerfRecording) {
            if (last !== undefined && time - last > 1) window.waxIntervals.push(time - last);
            last = time;
          } else last = undefined;
        });
      }, theme);
      await installStyleProbe(page, getSquishyStyle('orb'));
      await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=${thickness}&step=shell`);
      await ready(page); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.().enabled);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.waitForTimeout(600);
      const initial = await diag(page, true);
      assert.equal(initial.presetId, `${thickness}-wax`); assert.equal(initial.geometry.thickness, thickness === 'thin' ? .014 : .028);
      assert.equal(initial.geometry.attachedViolations, 0); assert.equal(initial.debrisStage.visible, false);
      if (capture) await page.screenshot({ path: path.join(output, `${name}-intact.png`) });
      const hit = await projectedSurfaceContact(page, 0, .03), client = await context.newCDPSession(page);
      const down = async p => {
        if (mobile) await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0 }] });
        else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
      };
      const up = async () => mobile ? client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.mouse.up();
      // Dispatch release on the wall clock, independent of the press render
      // ACK, so a slow first frame cannot extend the intended 180ms tap.
      if (!mobile) await page.mouse.move(hit.x, hit.y);
      const pressed = mobile ? client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hit.x, y: hit.y, id: 0 }] }) : client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      const released = new Promise((resolve, reject) => setTimeout(() => {
        const ended = mobile ? client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
        ended.then(resolve, reject);
      }, 180));
      await Promise.all([pressed, released]);
      const short = await diag(page); assert.equal(short.thinWax.detached, 0); assert.ok(short.thinWax.cracked > 0);
      if (capture) await page.screenshot({ path: path.join(output, `${name}-crack.png`) });
      await down(hit); await page.waitForTimeout(720);
      const first = await diag(page, true); assert.ok(first.thinWax.detached > 0); assert.equal(first.geometry.detachedViolations, 0);
      if (capture) await page.screenshot({ path: path.join(output, `${name}-falling.png`) });
      // Measure sustained pressure without exhaustive geometry queries or
      // screenshots in this interval; keep every observed interval, even stalls.
      await page.evaluate(() => { window.waxIntervals = []; window.waxPerfRecording = true; });
      await page.waitForTimeout(1100);
      await page.evaluate(() => { window.waxPerfRecording = false; }); await up();
      const deep = await diag(page, true); assert.ok(deep.thinWax.detached >= first.thinWax.detached);
      assert.equal(deep.geometry.attachedViolations, 0); assert.equal(deep.geometry.detachedViolations, 0);
      if (capture) await page.screenshot({ path: path.join(output, `${name}-deep.png`) });
      // Existing product rotation is mouse-only. Mobile pressure above uses CDP touch.
      await rotate(page, 105, 22); await page.waitForTimeout(200);
      const side = await diag(page, true); assert.equal(side.geometry.attachedViolations, 0); assert.equal(side.geometry.detachedViolations, 0);
      if (capture) await page.screenshot({ path: path.join(output, `${name}-side.png`) });
      const intervals = await page.evaluate(() => window.waxIntervals.filter(x => x > 0).sort((a, b) => a - b));
      assert.ok(intervals.length > 0);
      measurements.push({ name, viewport, browser: browser.version(), physicalPhone: false, pressure: mobile ? 'CDP touch emulation' : 'mouse', rotation: 'mouse', initial, short, first, deep, side,
        frames: intervals.length, medianFrameMs: intervals[Math.floor(intervals.length * .5)], p95FrameMs: intervals[Math.floor(intervals.length * .95)], maximumFrameMs: intervals.at(-1), gapsOver250Ms: intervals.filter(x => x > 250).length });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      if (capture && video) await video.saveAs(path.join(output, `${name}.webm`));
    }
  }
  if (capture) fs.writeFileSync(path.join(output, `${mobile ? 'mobile' : 'desktop'}-${theme}-measurements.json`), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify({ comparison: measurements.map(({ name, frames, medianFrameMs, p95FrameMs, initial, deep }) => ({ name, frames, medianFrameMs, p95FrameMs, thickness: initial.geometry.thickness, panels: initial.geometry.patches, detached: deep.thinWax.detached })) }));
});

test('rapid thickness changes clear old damage/resources; last selection wins and unsupported recipes stay disabled', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.THIN_WAX_TEST_DPR || 1) });
  try {
    await page.goto(`${base}/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell`);
    await page.waitForFunction(() => document.querySelector('.toy-mount')?.thinWaxDiagnostics?.().enabled);
    const original = await diag(page);
    await page.locator('.orb-input').focus(); await page.keyboard.down('Space');
    // This lifecycle test needs a damaged shell before replacement. Wait for
    // actual damage rather than assuming the software renderer fits 850ms.
    // Dwell onset remains covered by the dedicated timing tests above.
    try {
      await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax.detached > 0, undefined, { timeout: 10000 });
    } finally { await page.keyboard.up('Space'); }
    assert.ok((await diag(page)).thinWax.detached > 0);
    const select = async (name, value) => page.locator(`input[name="${name}"][value="${value}"]`).evaluate(input => {
      input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => {
      for (const value of ['thin', 'medium', 'thin', 'medium']) {
        const input = document.querySelector(`input[name="waxThickness"][value="${value}"]`); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // Uncommitted intermediate selections ending on the existing recipe are a
    // no-op in the approved thin lifecycle; do not repair that damage.
    assert.ok((await diag(page)).thinWax.detached > 0);
    await select('waxThickness', 'thin');
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics(); return d.presetId === 'thin-wax' && d.thinWax.detached === 0; });
    await select('waxThickness', 'medium');
    await page.waitForFunction(() => { const d = document.querySelector('.toy-mount').thinWaxDiagnostics(); return d.presetId === 'medium-wax' && d.thinWax.detached === 0; });
    for (let i = 0; i < 3; i++) {
      await select('waxThickness', 'thin'); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().presetId === 'thin-wax');
      await select('waxThickness', 'medium'); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().presetId === 'medium-wax');
    }
    const final = await diag(page); assert.equal(final.thinWax.detached, 0); assert.equal(final.thinWax.living, 0);
    assert.equal(final.resources.geometries, original.resources.geometries, 'Repeated thickness replacement releases shell geometries');
    assert.equal(final.coreColor, 'mint'); assert.equal(final.shellColor, 'rose');
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await select('waxThickness', 'thick');
    await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().presetId === 'thick-wax');
    assert.notEqual((await diag(page)).presetId, 'medium-wax');
    for (const [name, value] of [['shellMaterial', 'polish'], ['shellMaterial', 'sugar']]) {
      await select(name, value); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics().enabled === false);
      assert.equal((await diag(page)).presetId, null);
    }
    for (const [style, material] of [['paw', 'clay'], ['paw', 'marshmallow'], ['paw', 'butter']]) {
      await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${material}&waxThickness=medium&step=shell`);
      await page.waitForFunction(() => document.querySelector('.toy-stage')?.dataset.state === 'ready');
      assert.equal((await diag(page)).enabled, false);
    }
  } finally { await page.close(); }
});
