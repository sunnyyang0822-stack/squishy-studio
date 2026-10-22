const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readMesh, topology } = require('./tests/helpers/squishy-mesh.cjs');
const { installStyleProbe, ready, point, stats, settle, surfaceLight, rotate } = require('./tests/helpers/squishy-browser.cjs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4183';
const folder = 'artifacts/issue-30/browser';

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const { getSquishyStyle } = await import('./src/squishy-styles.mjs');
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
  const report = { date: new Date().toISOString(), environment: { browser: await browser.version(), mobile: 'Playwright 390×844 viewport, touch emulation; no physical device', performance: 'Observed render intervals during active input; not device FPS' }, combinations: [] };
  try {
    for (const id of ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) {
      const style = getSquishyStyle(id), mesh = readMesh(`.${style.modelUrl}`);
      const result = { id, feelId: 'clay', asset: { bytes: mesh.bytes.length, vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, bounds: [mesh.low, mesh.high], topology: topology(mesh) }, views: [], errors: [] };
      for (const [device, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height }, isMobile: device === 'mobile', hasTouch: device === 'mobile', ...(device === 'desktop' ? { recordVideo: { dir: folder, size: { width, height } } } : {}) });
        const page = await context.newPage(); page.on('pageerror', e => result.errors.push(e.message));
        const touch = device === 'mobile' ? await context.newCDPSession(page) : null;
        await installStyleProbe(page, style); await page.goto(`${base}/squishy/cloud/?style=${id}`); await ready(page); await page.evaluate(() => document.fonts.ready);
        for (const theme of ['day', 'night']) {
          await page.evaluate(t => document.documentElement.dataset.theme = t, theme); await page.waitForTimeout(700);
          const prefix = `${folder}/${id}-${device}-${theme}`;
          await page.screenshot({ path: `${prefix}-rest.png`, fullPage: true });
          const p = await point(page, id === 'donut' ? .76 : .5, .42);
          const scrollBefore = await page.evaluate(() => scrollY);
          if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0 }] });
          else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
          await page.waitForTimeout(1700);
          const held = await stats(page); assert.ok(held.maximum > .03, `${id} ${device} ${theme} must actually deform`);
          await page.screenshot({ path: `${prefix}-pressed.png`, fullPage: true });
          if (touch) {
            for (let i = 1; i <= 10; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + i * 1.5, y: p.y + i * .8, id: 0 }] });
          } else await page.mouse.move(p.x + 15, p.y + 8, { steps: 10 });
          await page.waitForTimeout(300);
          if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
          await settle(page); assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'Manipulation does not scroll page');
          const released = await stats(page); assert.ok(released.maximum > .02);
          await page.screenshot({ path: `${prefix}-retained.png`, fullPage: true });
          if (await page.locator('[data-category=coreColor]').isVisible()) await page.locator('[data-category=coreColor]').click();
          await page.locator('[name=color][value=mint]').check();
          await page.waitForFunction(() => window.styleProbe.positions.every((v, i) => Math.abs(v - window.styleProbe.rest[i]) < 1e-6));
          // Repeat selects a different hue on the next theme so it exercises restoration.
          await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(650);
          result.views.push({ device, theme, input: touch ? 'CDP native touch emulation' : 'mouse', held, released, restored: await stats(page) });
          if (device === 'desktop') {
            const views = [];
            for (const [face, dx, dy] of [['front', 0, 0], ['side', width / 4, 0], ['back', width / 4, 0], ['bottom', 0, -height / 4]]) {
              if (dx || dy) await rotate(page, dx, dy);
              const light = await surfaceLight(page, theme);
              assert.ok(light.count > 1000 && light.p05 > 30 && light.blackFraction < .005, `${id} ${theme} ${face}: ${JSON.stringify(light)}`);
              await page.screenshot({ path: `${folder}/${id}-browser-${theme}-${face}.png`, fullPage: true });
              views.push({ face, light });
            }
            result.views.at(-1).rotationViews = views;
            await page.locator('[name=color][value=mint]').check(); await page.waitForTimeout(700);
            await page.locator('[name=color][value=rose]').check(); await page.waitForTimeout(700);
          }
        }
        if (device === 'desktop') {
          const b = await page.locator('.toy-stage').boundingBox();
          await page.mouse.move(b.x + 12, b.y + 45); await page.mouse.down(); await page.mouse.move(b.x + 180, b.y + 100, { steps: 25 }); await page.mouse.up(); await page.waitForTimeout(500);
          await page.screenshot({ path: `${folder}/${id}-browser-rotated.png`, fullPage: true });
        }
        const intervals = await page.evaluate(() => window.styleProbe.intervals.slice().sort((a, b) => a - b));
        result[`${device}RenderIntervalsMs`] = { samples: intervals.length, median: intervals[Math.floor(intervals.length / 2)] || null, p95: intervals[Math.floor(intervals.length * .95)] || null };
        const video = page.video(); await context.close();
        if (video) { await video.saveAs(`${folder}/${id}-clay-interaction.webm`); const generated = await video.path(); if (generated !== `${folder}/${id}-clay-interaction.webm`) fs.unlinkSync(generated); }
      }
      assert.deepEqual(result.errors, []); report.combinations.push(result);
      fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2)); console.log(`${id}×clay: captured, actual GPU deformation verified`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
