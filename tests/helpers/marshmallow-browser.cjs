const { chromium } = require('playwright');
const { existsSync, mkdirSync, mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { installOrbProbe, meshStats, settled } = require('./orb-probe.cjs');
module.exports = async function run({ capture = false } = {}) {
  const folder = 'artifacts/issue-26', base = 'http://127.0.0.1:4216';
  if (capture) mkdirSync(folder, { recursive: true });
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4216' }, stdio: 'ignore' });
  let browser;
  const report = { phone: 'CDP native touch emulation; no physical phone tested', observations: [], errors: [] };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
    report.browser = browser.version();
    for (const touch of [false, true]) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const name = touch ? 'mobile-touch' : 'desktop';
      const temp = capture ? mkdtempSync(join(tmpdir(), 'marshmallow-')) : null;
      const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, ...(capture ? { recordVideo: { dir: temp, size: viewport } } : {}) });
      const page = await context.newPage(), video = page.video();
      page.on('pageerror', e => report.errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /THREE|shader/i.test(m.text())) report.errors.push(m.text()); });
      await installOrbProbe(page);
      await page.goto(base + '/squishy/cloud/');
      await page.waitForFunction(() => window.orbMeshProbe?.positions);
      await page.evaluate(() => document.fonts.ready);
      // Same color, camera, lighting, pose and undented geometry for optical comparison.
      for (const feel of ['clay', 'marshmallow']) {
        if (feel === 'marshmallow') {
          await page.locator('[name=coreMaterial][value=marshmallow]').check();
          await page.waitForFunction(() => document.querySelector('.orb-input')?.getAttribute('aria-label').includes('棉花糖'));
          assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts[0].isContextLost()), true);
        }
        for (const theme of ['day', 'night']) {
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForTimeout(180);
          if (capture) await page.screenshot({ path: `${folder}/${name}-${feel}-${theme}.png` });
        }
      }
      await page.evaluate(() => document.documentElement.dataset.theme = 'day');
      const input = page.locator('.orb-input');
      const box = await input.boundingBox();
      const at = (x, y = .48) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
      const session = touch ? await context.newCDPSession(page) : null;
      const send = async (type, point) => {
        if (touch) await session.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[type], touchPoints: ['up', 'cancel'].includes(type) ? [] : [{ ...point, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(point.x, point.y);
        else if (type === 'cancel') {
          // pointerdown intentionally prevents default focus: explicitly focus the
          // interaction surface so Escape really exercises its cancel handler.
          await page.locator('.orb-input').focus(); await page.keyboard.press('Escape');
          assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
          await page.mouse.up();
        }
        else await page.mouse.up();
      };
      const snapshot = () => page.evaluate(() => Array.from(window.orbMeshProbe.positions));
      async function freeze(label, wait = 800) {
        await settled(page); const frozen = await snapshot();
        await page.waitForTimeout(wait);
        assert.deepEqual(await snapshot(), frozen, label + ': no post-release motion');
        // Color may still finish its independent .65s coating after shape takeover.
        const count = await page.locator('.toy-mount').getAttribute('data-render-count');
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count, 'Static dents sleep');
        report.observations.push({ name, label, ...await meshStats(page) });
      }
      const shortStart = Date.now();
      await send('down', at(.5)); await page.waitForTimeout(45);
      // A concurrent browser suite can delay rAF beyond the nominal 45ms.
      // Observe the first actual loaded frame; fixed-time response is measured
      // separately by the real-GLB kernel tests, independent of host scheduling.
      await page.waitForFunction(() => {
        const p = window.orbMeshProbe;
        return p.positions?.some((v, i) => Math.abs(v - p.rest[i]) > .1);
      });
      await send('up'); report.observations.push({ name, label: 'short press actual input duration', milliseconds: Date.now() - shortStart });
      await freeze('short press');
      assert.ok((await meshStats(page)).maximum > .1);
      await send('down', at(.32)); await page.waitForTimeout(1200); await send('up'); await freeze('long press', 2200);
      await send('down', at(.24)); await page.waitForTimeout(350);
      for (let i = 1; i <= 18; i++) { await send('move', at(.24 + .52 * i / 18)); await page.waitForTimeout(16); }
      await page.waitForTimeout(350); await send('up'); await freeze('dwell endpoints and slide', 1400);
      for (const [label, duration, reverse] of [['fast swipe', 100, false], ['long swipe', 700, false], ['retrace kneading', 180, true]]) {
        await send('down', at(.2, .6));
        for (let round = 0; round < (reverse ? 4 : 1); round++) for (let i = 1; i <= 12; i++) {
          await send('move', at(round % 2 ? .8 - .6 * i / 12 : .2 + .6 * i / 12, .6)); await page.waitForTimeout(duration / 12);
        }
        await send('up'); await freeze(label);
      }
      for (const cancellation of ['cancel', 'blur', 'hidden']) {
        await send('down', at(.5, .3)); await page.waitForTimeout(80);
        if (cancellation === 'cancel') await send('cancel');
        if (cancellation === 'blur') { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await send('up'); }
        if (cancellation === 'hidden') {
          await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
          const positions = await snapshot(); await page.waitForTimeout(200); assert.deepEqual(await snapshot(), positions);
          await send('up');
          await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        }
        await freeze(cancellation);
      }
      if (capture) for (const theme of ['day', 'night']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForTimeout(150);
        await page.screenshot({ path: `${folder}/${name}-dents-${theme}.png` });
      }
      const contextsBefore = await page.evaluate(() => window.orbMeshProbe.contexts.length);
      if (touch) await page.locator('[data-category=coreColor]').click();
      await page.locator('[name=color][value=mint]').check(); await page.waitForTimeout(90);
      assert.ok((await meshStats(page)).maximum > 0, 'Restoration is continuous');
      await send('down', at(.5)); await page.waitForTimeout(100); await send('up');
      await freeze('interrupt explicit color restoration'); assert.ok((await meshStats(page)).maximum > .1);
      await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(850);
      assert.equal((await meshStats(page)).maximum, 0, 'Explicit color restore completes');
      assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts.length), contextsBefore);
      // Carry the selected feel through settings and final play.
      for (let i = 0; i < 4; i++) { await page.locator('.step-next').click(); await page.waitForTimeout(120); }
      await page.waitForSelector('.orb-input'); assert.match(await input.getAttribute('aria-label'), /棉花糖/);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.waitForFunction(() => window.orbMeshProbe.contexts.every(gl => gl.isContextLost()));
      await session?.detach(); await context.close();
      if (capture) { await video.saveAs(`${folder}/${name}.webm`); unlinkSync(await video.path()); rmdirSync(temp); }
    }
    assert.deepEqual(report.errors, []); return report;
  } finally { await browser?.close(); server.kill(); }
};
