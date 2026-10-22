const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { installOrbProbe, meshStats, settled, modelAttribute } = require('./tests/helpers/orb-probe.cjs');
const folder = 'artifacts/issue-16-clay-damping';
const baseline = '56c90894ea0448d13416d6cc4e292b4645a3574e';
const base = 'http://127.0.0.1:4198';

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  const oldKernel = execFileSync('git', ['show', `${baseline}:src/orb-deformation.mjs`]);
  const { createOrbDeformation: oldFactory } = await import('data:text/javascript;base64,' + oldKernel.toString('base64'));
  const { getOrbFeel } = await import('./src/orb-feels.mjs');
  const oldBundle = execFileSync('git', ['show', `${baseline}:assets/orb-preview.js`]);
  const report = { baseline, browser: null, host: `${os.platform()} ${os.release()} ${os.arch()}`, phone: 'Chromium/CDP touch emulation; no physical device', modelBytes: fs.statSync('assets/models/squishy-orb.glb').size, engineBytes: fs.statSync('assets/orb-preview.js').size, comparisons: [], recordings: [], errors: [] };
  const rest = modelAttribute('POSITION'), normals = modelAttribute('NORMAL');
  const point = angle => [Math.sin(angle), .0175, Math.cos(angle)];
  const depthAt = (positions, point) => {
    let index = 0, nearest = Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      const distance = Math.hypot(...point.map((v,k) => v - rest[i+k]));
      if (distance < nearest) { index = i; nearest = distance; }
    }
    return Math.hypot(...point.map((_,k) => rest[index+k] - positions[index+k]));
  };
  for (const reducedMotion of [false, true]) for (const hz of [60, 120]) {
    const sample = factory => {
      const positions = rest.slice(), d = factory(positions, normals, { reducedMotion });
      d.begin(point(-.9));
      for (let i = 1; i <= hz / 10; i++) { d.move(point(-.9 + 1.8 * i / (hz / 10)), i / (hz / 10)); d.step(1 / hz); }
      const quickSwipe = d.getState().depth;
      d.reset(); d.begin(point(-.9)); for (let i = 0; i < hz * 3; i++) d.step(1 / hz);
      const held = d.getState().depth; d.move(point(.9), 1); d.step(1 / hz);
      const firstNewContact = depthAt(positions, point(.9));
      for (let i = 1; i < hz / 10; i++) d.step(1 / hz);
      const newContact100ms = depthAt(positions, point(.9));
      d.release(); for (let i = 0; i < hz * 3; i++) d.step(1 / hz);
      assert.equal(d.step(1 / hz).needsFrame, false);
      return { quickSwipe, held, firstNewContact, newContact100ms };
    };
    const before = sample(oldFactory), after = sample(getOrbFeel('clay').createDeformation);
    assert.ok(after.quickSwipe < before.quickSwipe * .8);
    assert.ok(after.firstNewContact < before.firstNewContact * .8);
    assert.ok(after.newContact100ms < before.newContact100ms * .85);
    assert.ok(after.held > .30 && after.held > before.held * .94);
    report.comparisons.push({ reducedMotion, hz, before, after });
  }
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4198' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) });
    report.browser = browser.version();
    for (const version of ['before', 'after']) for (const touch of [false, true]) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
      const name = `${version}-${touch ? 'mobile-touch' : 'desktop'}`;
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-damping-video-'));
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, recordVideo: { dir: temp, size: viewport } });
      const page = await context.newPage(), video = page.video();
      if (version === 'before') await page.route('**/assets/orb-preview.js', route => route.fulfill({ contentType: 'text/javascript', body: oldBundle }));
      await installOrbProbe(page); page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('squishy-studio-theme', 'day'));
      await page.goto(base + '/squishy/cloud/'); await page.waitForFunction(() => window.orbMeshProbe?.positions);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
      const session = touch ? await context.newCDPSession(page) : null;
      const send = async (type, p) => {
        if (touch) await session.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ ...p, id: 0 }] });
        else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
        else if (type === 'move') await page.mouse.move(p.x, p.y);
        else await page.mouse.up();
      };
      const observations = [];
      for (const [label, hold] of [['quick-swipe', 0], ['held-drag', 1600]]) {
        const box = await page.locator('.orb-input').boundingBox();
        const start = { x: box.x + box.width * .28, y: box.y + box.height * .45 };
        await send('down', start); if (hold) await page.waitForTimeout(hold);
        for (let step = 1; step <= 16; step++) {
          await send('move', { x: start.x + box.width * .44 * step / 16, y: start.y }); await page.waitForTimeout(16);
        }
        observations.push({ label, pressed: await meshStats(page) });
        await send('up'); await settled(page); await page.waitForTimeout(500);
        assert.ok((await meshStats(page)).maximum > 0, 'The real stroke remains visible');
        await page.screenshot({ path: `${folder}/${name}-${label}.png`, fullPage: true });
        await page.locator(`[name=color][value=${hold ? 'rose' : 'mint'}]`).check(); await page.waitForTimeout(850);
        assert.equal((await meshStats(page)).maximum, 0, 'Color still restores clay');
      }
      await session?.detach(); await context.close(); await video.saveAs(`${folder}/${name}.webm`);
      fs.unlinkSync(await video.path()); fs.rmdirSync(temp);
      report.recordings.push({ name, viewport, input: touch ? 'Native CDP touch events' : 'Mouse', observations });
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(`${folder}/validation.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
