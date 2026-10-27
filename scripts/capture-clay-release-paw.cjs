const fs = require('node:fs'), crypto = require('node:crypto'), { spawn } = require('node:child_process'), { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('../tests/helpers/squishy-browser.cjs');
const { installWaxStyleProbe, projectedMeshContact, geometryOK } = require('../tests/helpers/wax-style-probe.cjs');
const { armWaxUploadEnd, readWaxUploadEnd } = require('../tests/helpers/wax-upload-observer.cjs');
(async () => {
  const port = '4256', base = `http://127.0.0.1:${port}`, output = 'artifacts/issue-38';
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port }, windowsHide: true }); let browser;
  const report = { bundleSha256: crypto.createHash('sha256').update(fs.readFileSync('assets/orb-preview.js')).digest('hex'), normalWallTime: true, noAcceleratedClocks: true, physicalPhone: false, cases: [], errors: [], exitCode: 1 };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    for (const touch of [false, true]) {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 }, name = `clay-release-paw-${touch ? 'mobile' : 'desktop'}`;
      const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, recordVideo: { dir: '.tmp/runtime/clay-video', size: viewport } }), page = await context.newPage(), video = page.video();
      const item = { name, viewport, input: touch ? 'Native CDP touch squeezing; explicitly mouse-assisted side rotation' : 'Native mouse', completed: false }; report.cases.push(item);
      page.on('pageerror', error => report.errors.push(error.message));
      try {
        const mesh = await installStyleProbe(page, getSquishyStyle('paw')); await installWaxStyleProbe(page);
        await page.goto(`${base}/squishy/cloud/?style=paw&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`); await ready(page);
        await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics?.({ measure: false }).enabled);
        await page.evaluate(() => { const l = document.createElement('div'); l.id = 'release-label'; l.style.cssText = 'position:fixed;top:85px;left:12px;z-index:1000;background:#fffe;padding:8px;color:#412f46;font:13px sans-serif;pointer-events:none'; document.body.append(l); });
        const label = text => page.locator('#release-label').evaluate((el, text) => el.textContent = text, `${touch ? '模拟触屏' : '桌面'} · 黏土猫爪 · ${text} · 正常速度`);
        const client = touch ? await context.newCDPSession(page) : null;
        async function send(type, p) { if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: p.x, y: p.y, id: 0 }] }); else if (type === 'down') { await page.mouse.move(p.x, p.y); await page.mouse.down(); } else if (type === 'move') await page.mouse.move(p.x, p.y); else await page.mouse.up(); }
        await label('完整薄蜡与独立薄断面'); await page.waitForTimeout(500);
        await armWaxUploadEnd(page, { resultKey: 'releaseShort' }); await label('短按局部裂缝');
        const contact = await projectedMeshContact(page, mesh, 'paw'); await send('down', contact);
        const short = await readWaxUploadEnd(page, 'releaseShort');
        item.short = Object.fromEntries(['elapsed', 'sampledElapsed', 'captured', 'trustedDown', 'gpuDepth', 'changedSinceDown', 'gpuCoreError', 'drawsAtRelease', 'drawsAfter', 'actualGPU'].map(key => [key, short[key]])); item.short.state = short.state;
        await send('up');
        await page.waitForTimeout(400); await label('超过0.5秒后少量碎裂，持续深按'); await send('down', contact); await page.waitForTimeout(2300);
        const destination = await projectedMeshContact(page, mesh, 'paw', [.12, -.02]);
        await label('深按后连续滑动，局部损伤');
        for (let i = 1; i <= 8; i++) { await send('move', { x: contact.x + (destination.x - contact.x) * i / 8, y: contact.y + (destination.y - contact.y) * i / 8 }); await page.waitForTimeout(45); }
        await page.waitForTimeout(700); await send('up');
        await label('松开保留破口，碎片继续向下'); await page.waitForTimeout(1000);
        const measured = await page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics({ measure: true, exhaustive: true })); geometryOK(measured); item.geometry = measured.geometry; item.damage = measured.thinWax;
        await label(touch ? '侧面由鼠标辅助旋转，捏压使用触摸' : '侧面检查蜡厚度与壳芯间隙'); await rotate(page, 40, 8); await page.waitForTimeout(650); await page.screenshot({ path: `${output}/${name}-side.png` });
        await label('重新开始可重复测试'); await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(800); item.completed = true;
      } finally { await context.close(); await video.saveAs(`${output}/${name}.webm`); }
      console.log(`${name}: recorded`);
    }
    if (report.errors.length) throw Error(JSON.stringify(report.errors)); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${output}/clay-release-paw-videos.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
