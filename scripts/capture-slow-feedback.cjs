const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { installOrbProbe, meshStats } = require('../tests/helpers/orb-probe.cjs');
const folder = 'artifacts/issue-25-responsive', base = 'http://127.0.0.1:4208';

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4208' }, stdio: 'ignore' });
  let browser;
  const report = { baseline: '2bf30c3', speed: 'normal wall time', physicalPhone: false, recordings: [], errors: [] };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: fs.existsSync(edge) ? edge : undefined });
    report.browser = browser.version();
    for (const touch of [false, true]) {
      const name = touch ? 'mobile-touch' : 'desktop-mouse';
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slow-feedback-'));
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video(), measurements = [];
      page.on('pageerror', error => report.errors.push(error.message));
      await installOrbProbe(page);
      await page.goto(base + '/squishy/cloud/');
      await page.waitForSelector('.toy-stage[data-state=ready] canvas');
      await page.locator('[name=coreMaterial][value=butter]').check();
      await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
      await page.evaluate(() => {
        const label = document.createElement('div'); label.id = 'feedback-capture';
        label.style.cssText = 'position:fixed;top:106px;left:16px;z-index:1000;background:#fffC;color:#593c61;padding:8px;font:14px sans-serif;pointer-events:none';
        document.body.append(label);
      });
      const label = text => page.locator('#feedback-capture').evaluate((el, text) => el.textContent = text + ' · 正常速度', text);
      const client = touch ? await context.newCDPSession(page) : null;
      const box = await page.locator('.orb-input').boundingBox();
      const point = x => ({ x: box.x + box.width * x, y: box.y + box.height * .5 });
      async function send(type, p) {
        if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ ...p, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(p.x, p.y);
        else await page.mouse.up();
      }
      async function measure(stage) { measurements.push({ stage, time: await page.evaluate(() => performance.now()), ...await meshStats(page) }); }
      async function recover() {
        await label('松开，保留原回弹速度，直到全部恢复');
        await page.waitForFunction(() => { const p = window.orbMeshProbe; return p.positions?.every((v, i) => v === p.rest[i]); }, null, { timeout: 18000 });
        await page.waitForTimeout(500); await measure('exact-rest');
        assert.equal((await meshStats(page)).maximum, 0);
      }
      await label('短按300ms，及时出现局部凹陷');
      await send('down', point(.5)); await page.waitForTimeout(300); await measure('300ms-press');
      await page.screenshot({ path: `${folder}/${name}-short-press.png` });
      await send('up'); await recover();
      await label('持续按住1秒，完整观察约0.8秒下压过程');
      await send('down', point(.5)); await page.waitForTimeout(1000); await measure('1000ms-press');
      await page.screenshot({ path: `${folder}/${name}-full-press.png` });
      await send('up'); await recover();
      await label('连续滑动800ms，无端点驻留');
      await send('down', point(.32));
      const started = Date.now();
      let progress = 0;
      while (progress < 1) {
        progress = Math.min(1, (Date.now() - started) / 800);
        await send('move', point(.32 + .36 * progress));
        if (progress < 1) await page.waitForTimeout(16);
      }
      await measure('sliding'); await page.screenshot({ path: `${folder}/${name}-sliding.png` });
      await label('终点驻留800ms，逐渐加深'); await page.waitForTimeout(800); await measure('endpoint-dwell');
      await send('up'); await recover();
      await context.close(); await video.saveAs(`${folder}/${name}.webm`);
      report.recordings.push({ name, viewport, input: touch ? 'CDP touch emulation' : 'mouse', measurements });
    }
    assert.deepEqual(report.errors, []);
    report.parameters = (await import('../src/orb-slow-rebound.mjs')).slowReboundParameters;
    fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ recordings: report.recordings.length, errors: report.errors, exitCode: 0 }));
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
