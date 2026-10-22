const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { installOrbProbe, meshStats, modelAttribute } = require('./tests/helpers/orb-probe.cjs');
const folder = 'artifacts/issue-25', base = 'http://127.0.0.1:4206';

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const report = { baseline: '4f4ebfe2f4afbfa29af38fd82662637ebc3de915', host: `${os.platform()} ${os.release()} ${os.arch()}`, browser: null, phone: 'CDP native touch emulation, 390x844; no physical device tested', modelBytes: fs.statSync('assets/models/squishy-orb.glb').size, bundleBytes: fs.statSync('assets/orb-preview.js').size, parameters: (await import('./src/orb-slow-rebound.mjs')).slowReboundParameters, geometry: [], recordings: [], errors: [] };
  report.integrationBaseline = '959a719';
  report.appearance = (await import('./src/orb-appearance.mjs')).getOrbAppearance('full-matte');
  const { getOrbFeel } = await import('./src/orb-feels.mjs');
  for (const id of ['clay', 'slow-rebound']) {
    const rest = modelAttribute('POSITION'), positions = rest.slice(), d = getOrbFeel(id).createDeformation(positions, modelAttribute('NORMAL'));
    const sample = { id }; d.begin([0, .0175, 1]);
    for (let i = 1; i <= 360; i++) {
      d.step(1 / 120);
      if ([2, 12, 120, 360].includes(i)) sample[`held${i / 120}s`] = d.getState().depth;
    }
    d.release();
    for (let i = 1; i <= 1680; i++) { d.step(1 / 120); if ([60, 240, 600, 1680].includes(i)) sample[`released${i / 120}s`] = d.getState().depth; }
    sample.exactRest = positions.every((v, i) => v === rest[i]); report.geometry.push(sample);
  }
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4206' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
    report.browser = browser.version();
    async function record(name, scenario, { touch = false, clay = false } = {}) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slow-rebound-video-'));
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temp, size: viewport } });
      const page = await context.newPage(), video = page.video(), observations = [];
      await installOrbProbe(page); page.on('pageerror', e => report.errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem('squishy-studio-theme', 'day'));
      await page.goto(base + '/squishy/cloud/');
      await page.waitForSelector('.toy-stage[data-state=ready] canvas');
      if (!clay) {
        await page.locator('[name=coreMaterial][value=butter]').check();
        await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
      }
      await page.waitForFunction(() => window.orbMeshProbe?.positions); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        const marker = document.createElement('div');
        marker.style.cssText = 'position:fixed;width:22px;height:22px;border:2px solid #745083;border-radius:50%;pointer-events:none;z-index:999;transform:translate(-50%,-50%);display:none;background:#ffffff44';
        document.body.append(marker);
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(type, e => {
          if (type === 'pointermove' && !e.buttons) return;
          marker.style.left = `${e.clientX}px`; marker.style.top = `${e.clientY}px`;
          marker.style.display = ['pointerup', 'pointercancel'].includes(type) ? 'none' : 'block';
        }, true);
        const label = document.createElement('div'); label.id = 'capture-label';
        label.style.cssText = 'position:fixed;left:16px;bottom:12px;z-index:1000;font:12px sans-serif;color:#6b5575;background:#fff9;padding:6px 10px;border-radius:8px;pointer-events:none';
        document.body.append(label);
      });
      const client = touch ? await context.newCDPSession(page) : null;
      const box = await page.locator('.orb-input').boundingBox();
      const point = (x, y = .48) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
      const send = async (type, p) => {
        if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ ...p, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(p.x, p.y);
        else await page.mouse.up();
      };
      const label = async text => {
        console.log(`${name}: ${text}`);
        await page.locator('#capture-label').evaluate((el, text) => el.textContent = text + ' · 正常速度', `${clay ? '黏土' : '慢回弹'} · ${text}`);
      };
      const measure = async stage => observations.push({ stage, time: await page.evaluate(() => performance.now()), ...await meshStats(page), modelViewMatrix: await page.evaluate(() => window.orbMeshProbe.modelViewMatrix) });
      const recover = async () => {
        await label('松开 → 等待完整恢复'); const started = Date.now();
        await measure('release');
        if (clay) await page.waitForTimeout(14000);
        else await page.waitForFunction(() => {
          const p = window.orbMeshProbe; return p.positions.every((v, i) => v === p.rest[i]);
        }, null, { timeout: 18000, polling: 100 });
        await measure('recovered');
        if (!clay) assert.equal((await meshStats(page)).maximum, 0);
        const count = await page.locator('.toy-mount').getAttribute('data-render-count');
        await page.waitForTimeout(350);
        assert.equal(await page.locator('.toy-mount').getAttribute('data-render-count'), count, 'No idle render loop');
        observations.push({ stage: 'recovery-duration', milliseconds: Date.now() - started });
      };
      const swipe = async (from, to, ms, steps = 24) => {
        for (let i = 1; i <= steps; i++) {
          await send('move', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
          await page.waitForTimeout(ms / steps);
        }
      };
      const screenshots = async prefix => {
        await page.locator('#capture-label').evaluate(el => el.hidden = true);
        await page.screenshot({ path: `${folder}/${prefix}-day.png`, fullPage: true });
        await page.evaluate(() => document.documentElement.dataset.theme = 'night'); await page.waitForTimeout(150);
        await page.screenshot({ path: `${folder}/${prefix}-night.png`, fullPage: true });
        await page.evaluate(() => document.documentElement.dataset.theme = 'day'); await page.waitForTimeout(150);
        await page.locator('#capture-label').evaluate(el => el.hidden = false);
      };
      await scenario({ page, send, point, label, measure, recover, swipe, screenshots });
      assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
      await client?.detach(); await context.close(); await video.saveAs(`${folder}/${name}.webm`);
      fs.unlinkSync(await video.path()); fs.rmdirSync(temp);
      report.recordings.push({ name, viewport, input: touch ? 'CDP native touch' : 'Mouse', observations });
      fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n');
    }
    const shortLong = async ({ page, send, point, label, measure, recover }) => {
      for (const [name, ms] of [['短按200ms', 200], ['长按3s', 3000]]) {
        await label(name); await send('down', point(.5)); await page.waitForTimeout(ms); await measure(name);
        await send('up'); await recover();
      }
    };
    await record('desktop-short-long', shortLong);
    await record('clay-short-long', shortLong, { clay: true });
    await record('desktop-dwell-slide', async ({ page, send, point, label, measure, recover, swipe, screenshots }) => {
      await label('起点驻留2.5s → 滑动 → 终点驻留1.5s');
      await send('down', point(.25)); await page.waitForTimeout(2500);
      await swipe(point(.25), point(.75), 700); await page.waitForTimeout(1500); await measure('endpoint-held');
      await screenshots('desktop'); await send('up'); await recover();
    });
    await record('desktop-long-retrace-cross', async ({ page, send, point, label, measure, recover, swipe }) => {
      await label('长划 → 折返 → 交叉与重复揉压'); await send('down', point(.2));
      await swipe(point(.2), point(.8), 2200);
      for (let i = 0; i < 3; i++) {
        await swipe(point(.8), point(.2), 300); await swipe(point(.2), point(.8), 300);
      }
      await swipe(point(.8), point(.4, .23), 350); await swipe(point(.4, .23), point(.6, .73), 350);
      await measure('kneaded'); await send('up'); await recover();
    });
    await record('desktop-repress', async ({ page, send, point, label, measure, recover }) => {
      await label('按压2s → 松开1s → 恢复中异处再按'); await send('down', point(.32)); await page.waitForTimeout(2000);
      await send('up'); await page.waitForTimeout(1000); await measure('old-dent');
      await send('down', point(.68)); await page.waitForTimeout(2000); await measure('old-and-new-dents');
      await send('up'); await recover();
    });
    await record('desktop-color-interrupt', async ({ page, send, point, label, measure, recover }) => {
      await label('换色恢复 → 新输入连续接管'); await send('down', point(.4)); await page.waitForTimeout(1800); await send('up');
      await page.locator('[name=color]').nth(5).check(); await page.waitForTimeout(100);
      await send('down', point(.6)); await page.waitForTimeout(1300); await send('up'); await recover();
      await label('换色完成同时恢复形态与姿态'); await send('down', point(.4)); await page.waitForTimeout(1200); await send('up');
      await page.locator('[name=color]').nth(7).check(); await page.waitForTimeout(1000); await measure('color-restored');
      assert.equal((await meshStats(page)).maximum, 0);
    });
    await record('mobile-touch-dwell-slide', async ({ page, send, point, label, measure, recover, swipe, screenshots }) => {
      await label('触屏：起点驻留 → 滑动 → 终点驻留'); await send('down', point(.28)); await page.waitForTimeout(2000);
      await swipe(point(.28), point(.72), 700); await page.waitForTimeout(1500); await measure('touch-held');
      await screenshots('mobile'); await send('up'); await recover();
      assert.equal(await page.evaluate(() => scrollY), 0);
    }, { touch: true });
    await record('desktop-feel-switch-final-play', async ({ page, send, point, label, measure, recover }) => {
      await label('质感切换：慢回弹 → 黏土 → 棉花糖 → 慢回弹');
      await send('down', point(.5)); await page.waitForTimeout(1500); await send('up');
      await page.locator('[name=coreMaterial][value=clay]').check();
      await page.waitForSelector('.toy-mount[data-feel-id=clay][data-render-count] canvas');
      await send('down', point(.5)); await page.waitForTimeout(1000); await send('up'); await page.waitForTimeout(1000);
      await page.locator('[name=coreMaterial][value=marshmallow]').check();
      assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'clay');
      await page.locator('[name=coreMaterial][value=butter]').check();
      await page.waitForSelector('.toy-mount[data-feel-id="slow-rebound"][data-render-count] canvas');
      assert.equal((await meshStats(page)).maximum, 0);
      assert.equal(await page.evaluate(() => window.orbMeshProbe.contexts.filter(gl => !gl.isContextLost()).length), 1);
      await label('所选慢回弹贯穿制作步骤与最终体验');
      for (let i = 0; i < 4; i++) { await page.locator('.step-next').click(); await page.waitForTimeout(200); }
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'play');
      assert.equal(await page.locator('.toy-mount').getAttribute('data-feel-id'), 'slow-rebound');
      await send('down', point(.5)); await page.waitForTimeout(1800); await measure('final-play-held');
      await send('up'); await recover();
    });
    assert.deepEqual(report.errors, []);
    // Both input recordings retain real wall time. Composition changes only
    // layout; no speed-up, interpolation, or time remapping is applied.
    const ffmpeg = process.env.FFMPEG_PATH;
    if (ffmpeg && fs.existsSync(ffmpeg)) {
      execFileSync(ffmpeg, ['-y', '-i', `${folder}/clay-short-long.webm`, '-i', `${folder}/desktop-short-long.webm`, '-filter_complex', '[0:v]scale=720:450[a];[1:v]scale=720:450[b];[a][b]hstack=inputs=2:shortest=1[v]', '-map', '[v]', '-c:v', 'libvpx', '-b:v', '900k', `${folder}/clay-vs-slow-rebound.webm`], { stdio: 'pipe' });
      report.comparison = 'clay-vs-slow-rebound.webm: left clay, right slow rebound; same short/long press sequence at original wall time; natural recovery waits differ, so later actions are not synchronized. Geometry replay is the equal-time comparison.';
    }
    fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ recordings: report.recordings.length, errors: report.errors, browser: report.browser }));
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
