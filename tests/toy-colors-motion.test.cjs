const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { comparePng } = require('../scripts/png-comparison.cjs');
const base = 'http://127.0.0.1:4184';
let server, browser;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4184' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });

test('详情、四只样例及大厅玩具在昼夜和过渡中均保留原色', async () => {
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    for (const [path,selector] of [['/squishy/cloud/','.toy-mount canvas'],['/#samples','.sample-art img'],['/collections/','.collection-pending img']]) {
      await page.goto(base + path);
      await page.locator(selector).first().waitFor();
      if (selector.includes('canvas')) await page.waitForSelector('.toy-mount[data-render-count]');
      else await page.locator(selector).evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.evaluate(() => document.fonts.ready);
      // Fixed backing isolates original texture/color from the intended change
      // of environment visible through the SVGs' transparent pixels.
      await page.addStyleTag({ content: `${selector}{background:#807b87!important} .sample,.sample-art{transform:none!important} .toy-stage:has([data-color-proof]),.sample:has([data-color-proof]){z-index:2147483647!important} [data-color-proof]{position:fixed!important;inset:0 auto auto 0!important;width:192px!important;height:192px!important;z-index:2147483647!important}` });
      const images = await page.locator(selector).all();
      const texturePixels = async image => {
        // A fixed integer pixel position prevents scroll-dependent SVG edge
        // rasterization from masquerading as a theme color change on Chromium.
        // Keep the real DOM ancestry and all theme/filter rules in effect.
        await image.evaluate(el => el.setAttribute('data-color-proof', ''));
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const box = await image.boundingBox();
        assert.deepEqual({ x:box.x,y:box.y,width:box.width,height:box.height }, { x:0,y:0,width:192,height:192 });
        // Fractional CSS boundaries blend one outer row/column with the changing
        // environment. Compare the full interior on its fixed opaque backing.
        try { return await page.screenshot({ clip: { x:1,y:1,width:190,height:190 } }); }
        finally { await image.evaluate(el=>el.removeAttribute('data-color-proof')); }
      };
      const reference = [];
      await page.evaluate(() => document.documentElement.dataset.theme = 'day');
      for (const image of images) reference.push(await texturePixels(image));
      for (const theme of ['night','day','night']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const [i,image] of images.entries()) {
          const filters = await image.evaluate(el => { const result = []; for (let node = el; node; node = node.parentElement) { const css = getComputedStyle(node); result.push([css.filter,css.opacity,css.mixBlendMode]); } return result; });
          assert.ok(filters.every(([filter,opacity,blend]) => filter === 'none' && opacity === '1' && blend === 'normal'), JSON.stringify(filters));
          const result = comparePng(reference[i], await texturePixels(image));
          assert.equal(result.changedPixels, 0, `${viewport.width} ${path} ${theme} image ${i}: ${JSON.stringify(result)}`);
        }
      }
    }
    await page.close();
  }
});

test('面板180/120ms、反向连续、立即不可交互及键盘无动画', async () => {
  const page = await browser.newPage(); await page.goto(base + '/squishy/cloud/');
  await page.waitForSelector('[data-state=ready]');
  // Drive real click handlers in one browser task so timings do not depend on
  // the runner's speed or on animation completion before the next tool call.
  const result = await page.evaluate(async () => {
    const trigger = document.querySelector('.sound-trigger');
    const panel = document.querySelector('.sound-panel');
    trigger.dispatchEvent(new MouseEvent('click', { bubbles:true,detail:1 }));
    const opening = panel.getAnimations()[0];
    opening.pause(); opening.currentTime = 75;
    const before = Number(getComputedStyle(panel).opacity);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles:true,detail:1 }));
    const closing = panel.getAnimations()[0];
    const after = Number(getComputedStyle(panel).opacity);
    const inert = panel.inert;
    closing.pause(); closing.currentTime = 50;
    const closingOpacity = Number(getComputedStyle(panel).opacity);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles:true,detail:1 }));
    const reopenedOpacity = Number(getComputedStyle(panel).opacity);
    await panel.getAnimations()[0].finished;
    return { before,after,inert,closingOpacity,reopenedOpacity,openingDuration:opening.effect.getTiming().duration,closingDuration:closing.effect.getTiming().duration,hidden:panel.hidden,expanded:trigger.getAttribute('aria-expanded'),active:document.activeElement.id };
  });
  assert.ok(result.before > 0 && result.before < 1);
  assert.ok(Math.abs(result.before - result.after) < .01);
  assert.ok(Math.abs(result.closingOpacity - result.reopenedOpacity) < .01);
  assert.equal(result.inert, true); assert.equal(result.openingDuration,180); assert.equal(result.closingDuration,120);
  assert.equal(result.hidden,false); assert.equal(result.expanded,'true'); assert.equal(result.active,'volume');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sound-panel').isVisible(),false);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.sound-panel').evaluate(el => el.getAnimations().length),0);
  assert.equal(await page.locator('#volume').evaluate(el => el === document.activeElement),true);
  await page.keyboard.press('Escape');
  const close = await page.evaluate(() => {
    const trigger = document.querySelector('.sound-trigger'), panel = document.querySelector('.sound-panel');
    trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
    document.querySelector('.panel-close').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
    return { inert:panel.inert,hidden:panel.hidden,expanded:trigger.getAttribute('aria-expanded'),focused:document.activeElement === trigger };
  });
  assert.deepEqual(close,{inert:true,hidden:false,expanded:'false',focused:true});
  await page.locator('.sound-panel').waitFor({state:'hidden'});
  await page.close();
});

test('减少动态时无面板位移，鼠标和键盘操作均可用；偏好动态更新也能收束', async () => {
  const page = await browser.newPage({ reducedMotion:'reduce',viewport:{width:390,height:844} });
  await page.goto(base + '/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
  await page.locator('.sound-trigger').click();
  assert.equal(await page.locator('.sound-panel').evaluate(el => el.getAnimations().length),0);
  await page.getByRole('button',{name:'关闭音量面板'}).click();
  assert.equal(await page.locator('.sound-panel').isVisible(),false);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => { document.querySelector('.sound-trigger').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1})); document.querySelector('.sound-panel').getAnimations()[0].pause(); });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => document.querySelector('.sound-panel').getAnimations().length === 0);
  assert.equal(await page.locator('.sound-panel').isVisible(),true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.sound-panel').isVisible(),false);
  await page.goto(base+'/#samples');
  const link = page.locator('.collection-link'); await link.hover();
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transform),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await link.focus();
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transform),'none', '键盘聚焦不触发箭头移动');
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transitionProperty),'none');
  await page.close();
});

test('两组滑动底块独立、200ms、连续反向不跳；键盘和减少动态即时定位', async () => {
  const page = await browser.newPage(); await page.goto(base+'/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
  const result = await page.evaluate(async () => {
    const groups = [...document.querySelectorAll('.choice-group')];
    const thumb = groups[0].querySelector('.choice-highlight');
    const other = getComputedStyle(groups[1].querySelector('.choice-highlight')).transform;
    document.querySelector('[value=thin]').click();
    getComputedStyle(thumb).transform;
    const first = thumb.getAnimations()[0]; first.pause(); first.currentTime = 65;
    const interrupted = getComputedStyle(thumb).transform;
    document.querySelector('[value=thick]').click();
    const resumed = getComputedStyle(thumb).transform;
    const duration = thumb.getAnimations()[0].effect.getTiming().duration;
    await thumb.getAnimations()[0].finished;
    return {interrupted,resumed,duration,otherUnchanged:other === getComputedStyle(groups[1].querySelector('.choice-highlight')).transform};
  });
  const translation = text => Number(text.split(',')[4]);
  assert.ok(Math.abs(translation(result.interrupted)-translation(result.resumed)) < .01);
  assert.equal(result.duration,200); assert.equal(result.otherUnchanged,true);
  const aligned = async group => {
    const positions = await group.evaluate(el => ({thumb:el.querySelector('.choice-highlight').getBoundingClientRect().toJSON(),input:el.querySelector('input:checked').getBoundingClientRect().toJSON()}));
    assert.ok(Math.abs(positions.thumb.x-positions.input.x) < 1 && Math.abs(positions.thumb.width-positions.input.width) < 1,JSON.stringify(positions));
  };
  const thickness = page.getByRole('group',{name:'脆皮厚度'}).locator('.choice-group');
  const material = page.getByRole('group',{name:'脆皮材质'}).locator('.choice-group');
  await aligned(thickness); await aligned(material);
  await page.locator('[value=thick]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('[value=medium]').isChecked(),true);
  assert.equal(await thickness.locator('.choice-highlight').evaluate(el=>el.getAnimations().length),0);
  await aligned(thickness);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[value=sugar]').check();
  assert.equal(await material.locator('.choice-highlight').evaluate(el=>el.getAnimations().length),0);
  await aligned(material);
  for (const [width,height] of [[390,844],[375,667],[320,568],[844,390]]) {
    await page.setViewportSize({width,height}); await aligned(thickness); await aligned(material);
  }
  await page.close();
});
