const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');

const base = 'http://127.0.0.1:4180';
const path = '/squishy/cloud/';
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4180' } });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
});
after(async () => { await browser?.close(); server?.kill(); });
const ready = page => page.waitForSelector('.toy-stage[data-state="ready"]');
const group = (page, name) => page.getByRole('group', { name });
const choice = (page, groupName, name) => group(page, groupName).getByRole('radio', { name, exact: true });
const next = page => page.getByRole('button', { name: '下一步' }).click();
async function progress(page, index) {
  const values = await page.locator('.workflow-progress li').evaluateAll(items => items.map(item => ({ status: item.dataset.status, current: item.getAttribute('aria-current') })));
  assert.deepEqual(values.map(item => item.status), values.map((_,i) => i < index ? 'complete' : i === index ? 'current' : 'upcoming'));
  assert.equal(values.filter(item => item.current === 'step').length,1);
  assert.equal(values[index].current,'step');
}

test('可用样式入口、旧详情路径、完整五步与返回修改保留选择', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/collections/');
  assert.equal(await page.locator('.collection-ready a[href*="style=orb"]').count(),1);
  assert.equal(await page.locator('.collection-pending a').count(),0,'无模型样例没有制作入口');
  await page.getByRole('link', { name: /圆球/ }).click();
  await ready(page);
  assert.match(page.url(), /\/squishy\/cloud\//);
  assert.equal(await page.getByRole('heading', { name: '内芯设置' }).isVisible(), true);
  await progress(page,0);
  await choice(page, '内芯材质', '棉花糖').check();
  await choice(page, '填充物', '仿真米粒').check();
  await choice(page, '内芯颜色', '薄荷绿').check();
  await page.locator('.orb-input').focus();
  await page.keyboard.down('Space');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('Space');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
  await next(page);
  assert.equal(await page.getByRole('heading', { name: '外壳设置' }).isVisible(), true);
  await progress(page,1);
  await choice(page, '外壳颜色', '雾蓝').check();
  await choice(page, '外壳材质', '糖').check();
  await next(page);
  assert.equal(await page.getByRole('heading', { name: '装饰选择' }).isVisible(), true);
  await progress(page,2);
  await choice(page, '装饰', '3').check();
  await page.locator('.orb-input').focus();
  await page.keyboard.down('Space');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
  await next(page);
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
  await page.keyboard.up('Space');
  assert.equal(await page.getByRole('heading', { name: /制作/ }).isVisible(), true);
  assert.equal(await page.locator('.making-blank').isVisible(), true);
  await progress(page,3);
  assert.equal(await page.getByRole('button', { name: '开始捏捏' }).isVisible(), true);
  assert.doesNotMatch(await page.locator('.step-panel').innerText(), /\d+%|请等待|倒计时/);
  await page.getByRole('button', { name: '开始捏捏' }).click();
  await ready(page);
  assert.equal(await page.getByRole('heading', { name: '开始捏捏' }).isVisible(), true);
  await progress(page,4);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-color'), 'sky');
  await page.locator('.orb-input').focus();
  await page.keyboard.down('Space');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('Space');
  assert.equal(await page.locator('.orb-input').getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '返回修改' }).click();
  await progress(page,2);
  assert.equal(await choice(page, '装饰', '3').isChecked(), true);
  await page.getByRole('button', { name: '上一步' }).click();
  assert.equal(await choice(page, '外壳颜色', '雾蓝').isChecked(), true);
  assert.equal(await choice(page, '外壳材质', '糖').isChecked(), true);
  await page.getByRole('button', { name: '上一步' }).click();
  assert.equal(await choice(page, '内芯材质', '棉花糖').isChecked(), true);
  assert.equal(await choice(page, '填充物', '仿真米粒').isChecked(), true);
  assert.equal(await choice(page, '内芯颜色', '薄荷绿').isChecked(), true);
  assert.equal(await page.locator('.toy-mount').getAttribute('data-color'), 'mint');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();

  const direct = await browser.newPage();
  await direct.goto(base + '/squishy/cloud');
  await ready(direct);
  assert.equal(direct.url(), base + path + '?style=orb');
  assert.equal(await direct.getByRole('heading', { name: '内芯设置' }).isVisible(), true);
  await direct.reload(); await ready(direct);
  assert.equal(await direct.getByRole('heading', { name: '内芯设置' }).isVisible(), true);
  await direct.close();
});

test('十色、蜡厚度条件焦点和切回恢复；键盘及浏览器历史有效', async () => {
  const { orbColors } = await import('../detail/orb-colors.mjs');
  const page = await browser.newPage();
  await page.goto(base + path); await ready(page);
  assert.equal(await group(page, '内芯颜色').getByRole('radio').count(), 10);
  for (const { id, name } of orbColors) {
    await choice(page, '内芯颜色', name).check();
    await page.waitForFunction(id => document.querySelector('.toy-mount').dataset.color === id, id);
  }
  await choice(page, '内芯颜色', '薄荷绿').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await group(page, '内芯颜色').getByRole('radio', { checked: true }).count(), 1);
  await next(page);
  assert.equal(await group(page, '外壳颜色').getByRole('radio').count(), 10);
  await choice(page, '外壳颜色', '奶油粉').check();
  await choice(page, '蜡的厚度', '厚').focus();
  await choice(page, '蜡的厚度', '厚').check();
  await choice(page, '外壳材质', '指甲油').check();
  assert.equal(await group(page, '蜡的厚度').isVisible(), false);
  assert.equal(await page.evaluate(() => document.querySelector('[data-group="waxThickness"]').contains(document.activeElement)), false);
  await choice(page, '外壳材质', '蜡').check();
  assert.equal(await choice(page, '蜡的厚度', '厚').isChecked(), true);
  await page.goBack();
  assert.equal(await page.getByRole('heading', { name: '内芯设置' }).isVisible(), true);
  await page.goForward();
  assert.equal(await page.getByRole('heading', { name: '外壳设置' }).isVisible(), true);
  assert.equal(await choice(page, '蜡的厚度', '厚').isChecked(), true);
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  await page.reload(); await ready(page);
  await progress(page,0);
  assert.equal(await choice(page,'内芯颜色','奶油粉').isChecked(),true,'刷新开始新的默认配方');
  assert.equal(await page.getByRole('heading',{name:'内芯设置'}).isVisible(),true);
  await page.goto(base + path + '?style=missing&step=invalid'); await ready(page);
  assert.equal(page.url(),base + path + '?style=orb');
  await progress(page,0);
  await page.close();
});

test('加载失败可继续选择、前进及重试，快速换色保持最后颜色', async () => {
  const page = await browser.newPage();
  await page.route('**/squishy-orb.glb', route => route.abort());
  await page.goto(base + path); await page.waitForSelector('.toy-stage[data-state="error"]');
  await choice(page, '内芯颜色', '薄荷绿').check();
  await next(page);
  assert.equal(await page.getByRole('heading', { name: '外壳设置' }).isVisible(), true);
  await page.getByRole('button', { name: '上一步' }).click();
  assert.equal(await choice(page, '内芯颜色', '薄荷绿').isChecked(), true);
  await page.unroute('**/squishy-orb.glb');
  await page.getByRole('button', { name: '重新加载' }).click();
  await ready(page);
  await page.evaluate(() => {
    for (const id of ['rose', 'mint', 'sky']) {
      const input = document.querySelector(`[data-group="coreColor"] input[data-choice="${id}"]`);
      input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(() => document.querySelector('.toy-mount').dataset.color === 'sky');
  assert.equal(await page.locator('.toy-mount canvas').count(), 1);
  await page.close();
});

test('桌面与手机昼夜、短屏横屏无横向溢出；触控目标与主体可滚动触达', async () => {
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 667 },
    { width: 320, height: 568 }, { width: 844, height: 390 },
  ]) for (const theme of ['day', 'night']) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width < 600 });
    const page = await context.newPage();
    await page.addInitScript(value => localStorage.setItem('squishy-studio-theme', value), theme);
    await page.goto(base + path); await ready(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(await choice(page, '内芯材质', '慢回弹').count(), 1);
    const coreButtons = await group(page, '内芯材质').getByRole('radio').evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().toJSON()));
    assert.equal(new Set(coreButtons.map(box => box.y)).size, 1, '三种内芯材质同排');
    assert.ok(coreButtons.every(box => box.width >= 44 && box.height >= 44), '内芯按钮至少44px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify({ viewport, theme }));
    const toy = await page.locator('.toy-stage').boundingBox();
    const panel = await page.locator('.step-panel').boundingBox();
    assert.ok(toy.width >= 160 && toy.height >= 140, JSON.stringify({ viewport, toy }));
    if (viewport.width > 760) assert.ok(panel.x >= toy.x + toy.width - 1);
    else assert.ok(panel.y >= toy.y + toy.height - 1);
    for (const locator of [page.getByRole('button', { name: '下一步' }), page.getByRole('link', { name: '返回合集' })]) {
      const box = await locator.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify({ viewport, box }));
      await locator.scrollIntoViewIfNeeded();
      const visible = await locator.boundingBox();
      assert.ok(visible.y >= -1 && visible.y + visible.height <= viewport.height + 1);
    }
    await next(page);
    assert.equal(await group(page, '外壳颜色').getByRole('radio').count(), 10);
    await context.close();
  }
});

test('动态高度、横竖屏与安全留白变化复用同一画布，配方保留且全部导航可触达', async () => {
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.goto(base+path); await ready(page);
  const canvas = await page.locator('.toy-mount canvas').elementHandle();
  await choice(page,'内芯颜色','柠檬黄').check();
  for (const viewport of [{width:390,height:600},{width:390,height:744},{width:844,height:390},{width:390,height:844},{width:320,height:568}]) {
    await page.setViewportSize(viewport);
    await page.locator('.toy-stage').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const stage = document.querySelector('.toy-stage').getBoundingClientRect();
      const current = document.querySelector('.toy-mount canvas');
      return Math.abs(current.width/current.height-stage.width/stage.height)<.02;
    });
    assert.equal(await canvas.evaluate(el=>el===document.querySelector('.toy-mount canvas')),true);
    assert.equal(await choice(page,'内芯颜色','柠檬黄').isChecked(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.step-next').scrollIntoViewIfNeeded();
    const button = await page.locator('.step-next').boundingBox();
    assert.ok(button.y>=0 && button.y+button.height<=viewport.height+1);
  }
  await page.addStyleTag({content:'.detail-topbar{padding-top:32px}.detail-main{padding-bottom:34px}'});
  await page.locator('.step-next').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await canvas.evaluate(el=>el===document.querySelector('.toy-mount canvas')),true);
  await page.close();
});
