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

test('详情白天色彩校正可逆，四只样例与大厅玩具在昼夜仍保留原色', async () => {
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport });
    for (const [path,selector] of [['/squishy/cloud/','.toy-mount canvas'],['/#samples','.sample-art img'],['/collections/','.style-art img']]) {
      await page.goto(base + path);
      await page.locator(selector).first().waitFor();
      if (selector.includes('canvas')) await page.waitForSelector('.toy-mount[data-render-count]');
      else await page.locator(selector).evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.evaluate(() => document.fonts.ready);
      // Fixed backing isolates original texture/color from the intended change
      // of environment visible through the SVGs' transparent pixels.
      // Geometry normalization is immediate: hover transitions must not animate
      // the test-only removal of rotation while pixel coordinates are sampled.
      await page.addStyleTag({ content: `${selector}{background:#807b87!important} .sample,.sample-art{transform:none!important;transition:none!important} .toy-stage:has([data-color-proof]),.sample:has([data-color-proof]){z-index:2147483647!important} [data-color-proof]{position:fixed!important;inset:0 auto auto 0!important;width:192px!important;height:192px!important;z-index:2147483647!important}` });
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
          if (selector.includes('canvas') && theme === 'night') {
            assert.ok(result.changedPixels > 100 && result.maximumChannelDelta > 3, 'Day-only pigment compensation changes the rendered orb, with no CSS filter: ' + JSON.stringify(result));
          } else assert.equal(result.changedPixels, 0, `${viewport.width} ${path} ${theme} image ${i}: ${JSON.stringify(result)}`);
        }
      }
    }
    await page.close();
  }
});

// The old sound UI was removed. Keep the reusable motion module's behavior
// covered in a standalone fixture, independent of the current detail controls.
async function panelFixture(page) {
  await page.goto(base + '/');
  await page.evaluate(async () => {
    const panel = document.createElement('section'); panel.id = 'motion-fixture'; panel.hidden = true;
    panel.style.cssText = 'position:fixed;inset:80px auto auto 20px;width:200px;height:120px;background:white;transform-origin:top right';
    document.body.append(panel);
    const { createPanelMotion } = await import('/detail/panel-motion.js');
    window.fixtureMotion = createPanelMotion(panel);
  });
}

test('独立面板fixture保留180/120ms、连续反转与关闭立即inert契约', async () => {
  const page = await browser.newPage(); await panelFixture(page);
  const result = await page.evaluate(async () => {
    const panel = document.querySelector('#motion-fixture'), motion = window.fixtureMotion;
    motion.setOpen(true);
    const opening = panel.getAnimations()[0]; opening.pause(); opening.currentTime = 75;
    const before = Number(getComputedStyle(panel).opacity);
    motion.setOpen(false);
    const closing = panel.getAnimations()[0], after = Number(getComputedStyle(panel).opacity), inert = panel.inert;
    closing.pause(); closing.currentTime = 50;
    const closingOpacity = Number(getComputedStyle(panel).opacity);
    motion.setOpen(true); const reopenedOpacity = Number(getComputedStyle(panel).opacity);
    await panel.getAnimations()[0].finished;
    return { before, after, inert, closingOpacity, reopenedOpacity, openingDuration:opening.effect.getTiming().duration, closingDuration:closing.effect.getTiming().duration, hidden:panel.hidden, aria:panel.getAttribute('aria-hidden') };
  });
  assert.ok(result.before > 0 && result.before < 1);
  assert.ok(Math.abs(result.before - result.after) < .01);
  assert.ok(Math.abs(result.closingOpacity - result.reopenedOpacity) < .01);
  assert.equal(result.inert, true); assert.equal(result.openingDuration, 180); assert.equal(result.closingDuration, 120);
  assert.equal(result.hidden, false); assert.equal(result.aria, 'false');
  await page.evaluate(() => window.fixtureMotion.setOpen(false, { instant:true }));
  assert.equal(await page.locator('#motion-fixture').isVisible(), false);
  assert.equal(await page.locator('#motion-fixture').evaluate(el => el.getAnimations().length), 0);
  await page.close();
});

test('独立面板fixture响应减少动态并收束正在执行的动画，首页键盘保持即时反馈', async () => {
  const page = await browser.newPage({ reducedMotion:'reduce', viewport:{width:390,height:844} });
  await panelFixture(page);
  await page.evaluate(() => window.fixtureMotion.setOpen(true));
  assert.equal(await page.locator('#motion-fixture').evaluate(el => el.getAnimations().length), 0);
  await page.evaluate(() => window.fixtureMotion.setOpen(false));
  assert.equal(await page.locator('#motion-fixture').isVisible(), false);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => { window.fixtureMotion.setOpen(true); document.querySelector('#motion-fixture').getAnimations()[0].pause(); });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => document.querySelector('#motion-fixture').getAnimations().length === 0);
  assert.equal(await page.locator('#motion-fixture').isVisible(), true);
  await page.evaluate(() => { window.fixtureMotion.dispose(); document.querySelector('#motion-fixture').remove(); });
  await page.goto(base+'/#samples');
  const link = page.locator('.collection-link'); await link.hover();
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transform), 'none');
  await page.emulateMedia({reducedMotion:'no-preference'}); await link.focus();
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transform), 'none');
  assert.equal(await link.locator('span').evaluate(el=>getComputedStyle(el).transitionProperty), 'none');
  await page.close();
});

test('颜色卡片选中与键盘即时反馈，减少动态下无位移动画且色块遵循共享色表', async () => {
  const { orbColors } = await import('../detail/orb-colors.mjs');
  const page = await browser.newPage(); await page.goto(base+'/squishy/cloud/'); await page.waitForSelector('[data-state=ready]');
  if (await page.locator('[data-category=coreColor]').isVisible()) await page.locator('[data-category=coreColor]').click();
  for (const theme of ['day','night']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const color of orbColors) {
      const input = page.locator(`[name=color][value=${color.id}]`);
      await input.check();
      const state = await input.evaluate(el => {
        const face = el.nextElementSibling, style = getComputedStyle(face);
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
        const context=canvas.getContext('2d'); context.fillStyle=style.borderTopColor; context.fillRect(0,0,1,1);
        return { ring:Array.from(context.getImageData(0,0,1,1).data).slice(0,3), border:style.borderTopStyle, width:style.borderTopWidth, weight:style.fontWeight, swatch:getComputedStyle(face.querySelector('.color-swatch')).backgroundColor, check:getComputedStyle(face.querySelector('.color-swatch'), '::after').content, animations:face.getAnimations().length };
      });
      const rgb = color.hex.slice(1).match(/../g).map(hex => parseInt(hex,16));
      assert.equal(state.swatch, `rgb(${rgb.join(', ')})`);
      const ratios=state.ring.map((channel,index)=>channel/rgb[index]);
      assert.ok(ratios.every(ratio=>ratio>.5 && ratio<.85),'选中圈为当前色的加深版');
      assert.ok(Math.max(...ratios)-Math.min(...ratios)<.02,'加深时保持当前颜色的色相比例');
      assert.equal(state.border, 'solid'); assert.equal(state.width, '2px');
      assert.equal(state.weight, '650'); assert.notEqual(state.check, 'none'); assert.equal(state.animations, 0);
    }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[value=cream]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('[value=lavender]').isChecked(), true, JSON.stringify(await page.locator('[name=color]').evaluateAll(inputs => inputs.map(el => [el.value, el.checked, el === document.activeElement]))));
  assert.equal(await page.locator('.color-face').evaluateAll(elements => elements.every(el => el.getAnimations().length === 0)), true);
  await page.close();
});
