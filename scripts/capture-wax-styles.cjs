const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { chromium } = require('playwright');
const { installStyleProbe, ready, rotate } = require('../tests/helpers/squishy-browser.cjs');
const { regions, projectedMeshContact, geometryOK } = require('../tests/helpers/wax-style-probe.cjs');
const folder = path.resolve('artifacts/issue-38'), temporary = path.resolve('.tmp/wax-style-video');
const port = process.env.WAX_STYLE_CAPTURE_PORT || '4241', base = `http://127.0.0.1:${port}`;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const coreMaterial = process.env.WAX_STYLE_CAPTURE_CORE || 'clay';
assert.ok(['clay', 'marshmallow'].includes(coreMaterial));
const selectedStyles = process.env.WAX_STYLE_CAPTURE_STYLES?.split(',');
if (selectedStyles) for (const style of selectedStyles) assert.ok(Object.hasOwn(regions, style));
(async () => {
  fs.mkdirSync(temporary, { recursive: true });
  const report = { recordedAt: new Date().toISOString(), bundleSha256: digest('assets/orb-preview.js'), normalWallTime: true, physicalPhone: false, visualAcceptance: 'pending user review', performanceMeasured: false, cases: [], errors: [], exitCode: 1 };
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port } }); let browser;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (fs.existsSync(edge) ? edge : undefined) }); report.browser = browser.version();
    const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
    const cases = [...Object.keys(regions).map(style => ({ style, touch: false })), ...['donut', 'paw', 'orb'].map(style => ({ style, touch: true }))].filter(item => !selectedStyles || selectedStyles.includes(item.style));
    for (const { style, touch } of cases) {
      const name = `${style}-${coreMaterial}-batch-${touch ? 'mobile' : 'desktop'}`, viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
      const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, recordVideo: { dir: temporary, size: viewport } });
      const page = await context.newPage(), video = page.video(), result = { name, style, viewport, input: touch ? 'CDP touch pressure; labeled mouse-assisted side rotation' : 'native mouse', actualGeometry: [] }; report.cases.push(result);
      page.on('pageerror', e => report.errors.push({ name, error: e.message }));
      try {
        const mesh = await installStyleProbe(page, getSquishyStyle(style));
        await page.goto(`${base}/squishy/cloud/?style=${style}&coreMaterial=${coreMaterial}&coreColor=mint&shellColor=rose&waxThickness=thin&step=core`); await ready(page);
        await page.evaluate(() => { const label = document.createElement('div'); label.id = 'wax-style-label'; label.style.cssText = 'position:fixed;top:90px;left:12px;z-index:1000;background:#fffe;color:#412f46;padding:8px;font:13px sans-serif;pointer-events:none'; document.body.append(label); });
        const label = text => page.locator('#wax-style-label').evaluate((el, text) => { el.textContent = text; }, `${style} / ${coreMaterial} · ${text} · 正常速度${touch ? ' · 模拟手机触摸，侧面用鼠标转球' : ''}`);
        const client = touch ? await context.newCDPSession(page) : null;
        async function send(type, contact) {
          if (touch) await client.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x: contact.x, y: contact.y, id: 0 }] });
          else if (type === 'down') { await page.mouse.move(contact.x, contact.y); await page.mouse.down(); } else if (type === 'move') await page.mouse.move(contact.x, contact.y); else await page.mouse.up();
        }
        const diagnostic = options => page.locator('.toy-mount').evaluate((el, options) => el.thinWaxDiagnostics(options), options || { measure: false });
        await label(coreMaterial === 'marshmallow' ? '裸芯原有棉花糖手感' : '裸芯原有黏土手感');
        await send('down', await projectedMeshContact(page, mesh, style)); await page.waitForTimeout(180); await send('up'); await page.waitForTimeout(400);
        result.bareBounds = await page.locator('.orb-input').boundingBox();
        await page.locator('.step-next').click(); await page.waitForFunction(() => document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).enabled); await page.waitForTimeout(400);
        result.shellBounds = await page.locator('.orb-input').boundingBox();
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(result.bareBounds[key] - result.shellBounds[key]) < 1, `${name} core/shell ${key}`);
        await label('薄蜡与裸芯同大小同位置；无托盘'); await page.screenshot({ path: `${folder}/${name}-intact.png` });
        await page.evaluate(() => {
          window.waxStyleShortCapture = null;
          window.addEventListener('pointerdown', e => { const start = performance.now(); setTimeout(() => {
            const state = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax;
            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: e.pointerId })); window.waxStyleShortCapture = { elapsed: performance.now() - start, state };
          }, 60); }, { capture: true, once: true });
        });
        await label('短触局部开裂，内芯同步形变'); await send('down', await projectedMeshContact(page, mesh, style));
        await page.waitForFunction(() => window.waxStyleShortCapture !== null); await send('up');
        result.short = await page.evaluate(() => window.waxStyleShortCapture); assert.ok(result.short.elapsed < 500); assert.equal(result.short.state.detached, 0); assert.ok(result.short.state.cracked > 0);
        await page.screenshot({ path: `${folder}/${name}-crack.png` }); await page.waitForTimeout(250);
        await label('按住超过0.5秒开始掉片，继续深按并拖动');
        const contact = await projectedMeshContact(page, mesh, style); result.contact = contact;
        await send('down', contact); await page.waitForTimeout(1300);
        const destination = await projectedMeshContact(page, mesh, style, [.1, .02]);
        for (let i = 1; i <= 6; i++) { await send('move', { x: contact.x + (destination.x - contact.x) * i / 6, y: contact.y + (destination.y - contact.y) * i / 6 }); await page.waitForTimeout(35); }
        await page.waitForTimeout(500); result.held = await diagnostic(); assert.ok(result.held.thinWax.detached > 0);
        await page.screenshot({ path: `${folder}/${name}-held.png` }); await send('up');
        await label(coreMaterial === 'marshmallow' ? '松开：棉花糖完全留痕，碎片继续下落，破口保留' : '松开：黏土恢复，碎片继续落出画面，破口保留');
        await page.waitForFunction(() => { const s = document.querySelector('.toy-mount').thinWaxDiagnostics({ measure: false }).thinWax; return s.living === 0 && s.detached > 0 && s.expired === s.detached; }, null, { timeout: 15000 });
        const cleared = await diagnostic({ measure: true, exhaustive: true }); geometryOK(cleared); result.actualGeometry.push(cleared.geometry);
        assert.equal(cleared.debrisStage.visible, false); assert.equal(cleared.thinWax.settled, 0); assert.equal(cleared.thinWax.debris.gridCells, 0);
        result.cleared = cleared.thinWax;
        await page.screenshot({ path: `${folder}/${name}-cleared.png` });
        if (style === 'donut' || style === 'paw') {
          await label('近侧面检查内圈/连接部、蜡厚度及芯壳间隙'); await rotate(page, 45, 8); await page.waitForTimeout(350);
          const side = await diagnostic({ measure: true, exhaustive: true }); geometryOK(side); result.actualGeometry.push(side.geometry);
          await page.screenshot({ path: `${folder}/${name}-side.png` }); await page.waitForTimeout(600);
        }
        await label('重新开始可重复试捏'); await page.getByRole('button', { name: '重新开始', exact: true }).click(); await page.waitForTimeout(700);
        assert.equal((await diagnostic()).thinWax.detached, 0); result.complete = true;
      } finally { await context.close(); await video.saveAs(`${folder}/${name}.webm`); }
      console.log(`${name}: recorded`);
    }
    assert.deepEqual(report.errors, []); assert.equal(report.bundleSha256, digest('assets/orb-preview.js')); report.exitCode = 0;
  } catch (error) { report.failure = error.stack; throw error; }
  finally { fs.writeFileSync(`${folder}/${coreMaterial}-style-videos${selectedStyles ? `-${selectedStyles.join('-')}` : ''}.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
