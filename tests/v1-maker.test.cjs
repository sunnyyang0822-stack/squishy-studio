const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync, renameSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4271';
const out = process.env.V1_CAPTURE_DIR;
let browser, server;
before(async () => {
  mkdirSync('.tmp/v1-making/runtime', { recursive: true });
  process.env.TEMP = resolve('.tmp/v1-making/runtime'); process.env.TMP = process.env.TEMP;
  if (out) mkdirSync(out, { recursive: true });
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4271' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const waitCore = page => page.waitForSelector('.toy-mount[data-render-count] canvas');
const waitSamples = page => page.waitForSelector('.samples-mount[data-render-count] canvas');
const waitPlay = page => page.waitForSelector('.finished-mount[data-render-count] canvas');
const selected = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`);
async function shot(page, name) { if (out) await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true }); }
function maxDepth(d) { return d.corePositions.reduce((max, value, i) => Math.max(max, Math.abs(value - d.coreRestPositions[i])), 0); }

test('合集到成品：裸芯试捏、独立双壳片、各自配置、合成、真实蜡壳与恢复', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: .75,
    ...(out ? { recordVideo: { dir: out, size: { width: 390, height: 844 } } } : {}) });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/collections/'); await page.locator('#style-orb .style-entry').tap(); await waitCore(page);
    assert.equal(new URL(page.url()).pathname, '/make/');
    assert.deepEqual(await page.locator('.progress-label').allTextContents(), ['造型', '内芯', '壳片', '合成', '成品']);
    assert.equal(await page.getByRole('group', { name: /填充物|装饰|绘画/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /保存|签到|支付|登录|画笔/ }).count(), 0);
    assert.equal(await page.locator('input[value=sugar]').count(), 0);
    const coreCanvas = await page.locator('.toy-mount canvas').elementHandle();
    for (const [id, feel] of [['marshmallow', 'marshmallow'], ['butter', 'slow-rebound'], ['clay', 'clay']]) {
      await selected(page, 'coreMaterial', id).check();
      await page.waitForSelector(`.toy-mount[data-feel-id="${feel}"]`);
    }
    await selected(page, 'coreColor', 'mint').check();
    await page.locator('.toy-mount .orb-input').focus(); await page.keyboard.down('Space');
    await page.waitForTimeout(650); await page.keyboard.up('Space');
    await shot(page, 'mobile-day-core');
    await page.getByRole('button', { name: '选壳片', exact: true }).tap(); await waitSamples(page);
    assert.equal(await page.locator('.toy-mount .orb-input').count(), 0, 'Core input and document rotation listeners are released for the separate sample scene');
    assert.equal(await page.locator('.toy-stage').isHidden(), true);
    assert.equal(await page.locator('.finished-mount canvas').count(), 0);
    assert.equal(await page.getByRole('button', { name: '蜡皮', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '指甲油', exact: true }).count(), 1);
    await selected(page, 'shellColor', 'sky').check(); await selected(page, 'waxThickness', 'thin').check();
    await page.getByRole('button', { name: '指甲油', exact: true }).tap();
    assert.equal(await page.getByRole('group', { name: '蜡皮厚度' }).count(), 0);
    await selected(page, 'shellColor', 'coral').check();
    await page.getByRole('button', { name: '蜡皮', exact: true }).tap();
    assert.equal(await selected(page, 'shellColor', 'sky').isChecked(), true);
    assert.equal(await selected(page, 'waxThickness', 'thin').isChecked(), true);
    await page.getByRole('button', { name: '指甲油', exact: true }).tap();
    assert.equal(await selected(page, 'shellColor', 'coral').isChecked(), true);
    await page.getByRole('button', { name: '蜡皮', exact: true }).tap();
    await page.getByRole('button', { name: '壳片右转' }).tap();
    const yaw = await page.locator('.samples-mount').getAttribute('data-yaw');
    await page.getByRole('button', { name: '壳片左转' }).tap();
    await page.waitForFunction(value => document.querySelector('.samples-mount').dataset.yaw !== value, yaw);
    await shot(page, 'mobile-day-shell');
    await page.getByRole('button', { name: '合成捏捏', exact: true }).tap(); await waitPlay(page);
    assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'play');
    assert.equal(new URL(page.url()).searchParams.get('step'), 'play');
    assert.equal(await page.locator('.samples-mount').isHidden(), true);
    const diag = () => page.locator('.finished-mount').evaluate(el => el.thinWaxDiagnostics({ measure: false }));
    const initial = await diag(); assert.equal(initial.enabled, true); assert.equal(initial.coreColor, 'mint'); assert.equal(initial.shellColor, 'sky'); assert.equal(initial.presetId, 'thin-wax');
    const box = await page.locator('.finished-mount .orb-input').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * .4); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
    assert.ok(maxDepth(await diag()) > .02, 'Real finished core deforms');
    await shot(page, 'mobile-day-product-pressed');
    const recipeUrl = page.url();
    await page.getByRole('button', { name: '恢复成品', exact: true }).tap();
    await page.waitForFunction(() => {
      const d = document.querySelector('.finished-mount').thinWaxDiagnostics({ measure: false });
      return d.corePositions.every((value, i) => value === d.coreRestPositions[i]) && d.thinWax.detached === 0 && d.thinWax.cracked === 0;
    });
    assert.equal(page.url(), recipeUrl); await shot(page, 'mobile-day-product-restored');
    await page.getByRole('button', { name: '返回修改', exact: true }).tap(); await waitSamples(page);
    assert.equal(await selected(page, 'shellColor', 'sky').isChecked(), true);
    await page.getByRole('button', { name: '上一步', exact: true }).tap(); await waitCore(page);
    assert.equal(await selected(page, 'coreColor', 'mint').isChecked(), true);
    // The last clay instance, not the initial disposed clay scene, is retained.
    assert.equal(await coreCanvas.evaluate(el => el.isConnected), false);
    await page.goBack(); await waitSamples(page);
    await page.reload(); await waitSamples(page);
    assert.equal(await selected(page, 'waxThickness', 'thin').isChecked(), true);
    await page.getByRole('link', { name: '返回合集', exact: true }).click();
    await page.locator('#style-donut .style-entry').click(); await waitCore(page);
    assert.equal(await selected(page, 'coreColor', 'mint').isChecked(), true);
    await page.getByRole('button', { name: '选壳片', exact: true }).click(); await waitSamples(page);
    assert.equal(await selected(page, 'shellColor', 'sky').isChecked(), true);
    assert.equal(await selected(page, 'waxThickness', 'thin').isChecked(), true);
    assert.deepEqual(errors, []);
  } finally {
    const video = page.video(); await context.close();
    if (out && video) renameSync(await video.path(), resolve(out, 'full-flow.webm'));
  }
});

test('各造型首版入口与裸芯，未知参数／暂停猫爪不会开启脆皮', async () => {
  const page = await browser.newPage({ deviceScaleFactor: .5 });
  try {
    for (const style of ['orb', 'cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star']) {
      await page.goto(base + '/make/?style=' + style); await waitCore(page);
      assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), style);
      assert.equal(await page.locator('.toy-mount').evaluate(el => el.thinWaxDiagnostics({ measure: false }).enabled), false);
      assert.equal(await page.locator('.toy-mount').evaluate(el => el.polishDiagnostics().enabled), false);
    }
    await page.goto(base + '/make/?style=paw&step=unknown&shellMaterial=sugar&coreColor=broken'); await waitCore(page);
    assert.equal(await page.locator('.toy-mount').getAttribute('data-style'), 'orb');
    assert.equal(await selected(page, 'coreColor', 'rose').isChecked(), true);
    assert.equal(new URL(page.url()).searchParams.get('step'), 'core');
    await page.goto(base + '/make/?style=donut&step=play'); await waitSamples(page);
    assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'shell');
    assert.equal(await page.locator('.finished-mount canvas').count(), 0);
    assert.equal(await page.getByRole('button', { name: '合成捏捏' }).isDisabled(), true);
    assert.match(await page.locator('.support-message').textContent(), /尚未接入/);
    await page.getByRole('button', { name: '指甲油', exact: true }).click();
    await page.getByRole('button', { name: '合成捏捏', exact: true }).click(); await waitPlay(page);
    assert.equal(await page.locator('.finished-mount').evaluate(el => el.polishDiagnostics().enabled), true);
  } finally { await page.close(); }
});

test('独立壳片自动慢转、手动拖动、连续换色厚度、减少动态及隐藏后停帧', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: .5 });
  try {
    await page.goto(base + '/make/?step=shell'); await waitSamples(page);
    assert.equal(await page.locator('.toy-mount canvas,.finished-mount canvas').count(), 0);
    const canvas = await page.locator('.shell-canvas').elementHandle();
    await canvas.evaluate(canvas => {
      const get = canvas.getContext('webgl2'); window.v1SampleContext = get;
    });
    const yaw = await page.locator('.samples-mount').getAttribute('data-yaw'); await page.waitForTimeout(250);
    assert.notEqual(await page.locator('.samples-mount').getAttribute('data-yaw'), yaw);
    await page.getByRole('button', { name: '自动转动', exact: true }).click(); await page.waitForTimeout(100);
    const paused = await page.locator('.samples-mount').getAttribute('data-render-count'); await page.waitForTimeout(180);
    assert.equal(await page.locator('.samples-mount').getAttribute('data-render-count'), paused);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .5); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5, { steps: 6 }); await page.mouse.up();
    assert.equal(await page.getByRole('button', { name: '蜡皮', exact: true }).getAttribute('aria-pressed'), 'true');
    const y = await page.locator('.samples-mount').getAttribute('data-yaw');
    await page.getByRole('button', { name: '壳片右转' }).click();
    await page.waitForFunction(y => document.querySelector('.samples-mount').dataset.yaw !== y, y);
    await selected(page, 'waxThickness', 'thick').check(); await selected(page, 'shellColor', 'lavender').check();
    assert.equal(await canvas.evaluate(el => el === document.querySelector('.shell-canvas')), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '转动已停', exact: true }).click(); await page.waitForTimeout(80);
    const stopped = await page.locator('.samples-mount').getAttribute('data-render-count'); await page.waitForTimeout(180);
    assert.equal(await page.locator('.samples-mount').getAttribute('data-render-count'), stopped);
    await page.getByRole('button', { name: '上一步', exact: true }).click(); await waitCore(page);
    const hidden = await page.locator('.samples-mount').getAttribute('data-render-count'); await page.waitForTimeout(180);
    assert.equal(await page.locator('.samples-mount').getAttribute('data-render-count'), hidden);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForFunction(() => window.v1SampleContext.isContextLost());
    assert.equal(await page.locator('.shell-canvas,.toy-mount canvas').count(), 0);
  } finally { await page.close(); }
});

test('模型与壳片加载失败可返回重试；合成失败不进入假成品，取消不被晚到模型覆盖', async () => {
  const page = await browser.newPage({ deviceScaleFactor: .5, reducedMotion: 'reduce' });
  try {
    await page.route('**/assets/models/squishy-orb.glb', route => route.abort());
    await page.goto(base + '/make/?style=orb'); await page.locator('.maker-retry:visible').waitFor();
    await selected(page, 'coreColor', 'mint').check();
    await page.locator('.maker-retry:visible').waitFor();
    await page.unroute('**/assets/models/squishy-orb.glb'); await page.getByRole('button', { name: '重试', exact: true }).click(); await waitCore(page);
    await page.route('**/assets/shell-samples.js*', route => route.abort());
    await page.getByRole('button', { name: '选壳片', exact: true }).click(); await page.locator('.maker-retry:visible').waitFor();
    await page.unroute('**/assets/shell-samples.js*'); await page.getByRole('button', { name: '重试', exact: true }).click(); await waitSamples(page);
    await page.route('**/assets/models/squishy-orb.glb', route => route.fulfill({ contentType: 'text/html', body: 'broken glb' }));
    await page.getByRole('button', { name: '合成捏捏' }).click(); await page.locator('.maker-retry:visible').waitFor();
    assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'making');
    assert.equal(await page.locator('.finished-mount canvas').count(), 0);
    await page.getByRole('button', { name: '返回修改', exact: true }).click(); await waitSamples(page);
    await page.unroute('**/assets/models/squishy-orb.glb');
    await page.route('**/assets/models/squishy-orb.glb', async route => { await new Promise(resolve => setTimeout(resolve, 400)); try { await route.continue(); } catch {} });
    await page.getByRole('button', { name: '合成捏捏' }).click(); await page.getByRole('button', { name: '返回修改', exact: true }).click();
    await page.waitForTimeout(650); assert.equal(await page.locator('.step-panel').getAttribute('data-step'), 'shell');
    assert.equal(await selected(page, 'coreColor', 'mint').isChecked(), true);
  } finally { await page.close(); }
});

test('快速内芯切换最后一项生效，失焦和离页释放真实输入与全部上下文', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: .5 });
  try {
    await page.addInitScript(() => {
      window.v1Contexts = [];
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const context = get.call(this, type, ...args);
        if (type === 'webgl2' && context && !window.v1Contexts.includes(context)) window.v1Contexts.push(context);
        return context;
      };
    });
    await page.goto(base + '/make/'); await waitCore(page);
    await page.evaluate(() => {
      for (const value of ['marshmallow', 'butter', 'clay']) document.querySelector(`input[name=coreMaterial][value="${value}"]`).click();
      for (const value of ['sky', 'mint', 'coral']) document.querySelector(`input[name=coreColor][value="${value}"]`).click();
    });
    await page.waitForSelector('.toy-mount[data-feel-id=clay][data-color=coral][data-render-count]');
    await page.locator('.toy-mount .orb-input').focus(); await page.keyboard.down('Space');
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false'); await page.keyboard.up('Space');
    await page.getByRole('button', { name: '选壳片', exact: true }).click(); await waitSamples(page);
    assert.equal(await page.evaluate(() => window.v1Contexts.filter(gl => !gl.isContextLost()).length), 1, 'Only the independent samples context remains');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForFunction(() => window.v1Contexts.every(gl => gl.isContextLost()));
    assert.equal(await page.locator('canvas').count(), 0);
  } finally { await page.close(); }
});

test('手机原生触摸可旋转壳片，纵向滚动不被画布劫持', async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true, deviceScaleFactor: .75, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(base + '/make/?step=shell'); await waitSamples(page);
    const cdp = await context.newCDPSession(page);
    const box = await page.locator('.shell-canvas').boundingBox();
    const y = box.y + box.height * .5, x = box.x + box.width * .22;
    const yaw = await page.locator('.samples-mount').getAttribute('data-yaw');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(value => document.querySelector('.samples-mount').dataset.yaw !== value, yaw);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 45 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => scrollY > 0);
    assert.equal(await page.getByRole('button', { name: '合成捏捏', exact: true }).isVisible(), true);
  } finally { await context.close(); }
});

test('桌面和手机昼夜、短屏横屏均可选配；键盘导航、触摸与滚动不遮挡选项', async () => {
  const reports = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: .75, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      for (const theme of ['day', 'night']) {
        await page.addInitScript(theme => localStorage.setItem('squishy-studio-theme', theme), theme);
        await page.goto(base + '/make/?step=shell'); await waitSamples(page);
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        await page.getByRole('button', { name: '指甲油', exact: true }).tap(); await selected(page, 'shellColor', 'coral').check();
        await page.getByRole('button', { name: '蜡皮', exact: true }).focus(); await page.keyboard.press('Enter');
        await selected(page, 'waxThickness', 'thick').check();
        assert.equal(await selected(page, 'waxThickness', 'thick').isChecked(), true);
        await page.locator('.maker-next').scrollIntoViewIfNeeded();
        const boxes = await page.locator('.sample-stage,.step-panel').evaluateAll(es => es.map(el => el.getBoundingClientRect().toJSON()));
        assert.ok(boxes[0].right <= boxes[1].left || boxes[0].bottom <= boxes[1].top);
        const button = await page.locator('.maker-next').boundingBox(); assert.ok(button.width >= 44 && button.height >= 44);
        const dimensions = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], physicalPhone: false }));
        reports.push({ theme, ...dimensions });
        if (viewport.width === 1440 || viewport.width === 390) await shot(page, `${viewport.width === 1440 ? 'desktop' : 'mobile'}-${theme}-shell`);
        await page.getByRole('button', { name: '合成捏捏', exact: true }).tap(); await waitPlay(page);
        await page.getByRole('button', { name: '恢复成品', exact: true }).tap();
      }
    } finally { await context.close(); }
  }
  if (out) writeFileSync(resolve(out, 'viewports.json'), JSON.stringify(reports, null, 2));
});
