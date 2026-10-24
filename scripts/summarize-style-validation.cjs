const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = 'artifacts/issue-30-combinations';
const ids = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const feels = ['clay', 'marshmallow', 'slow-rebound'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bundleSHA256 = hash('assets/orb-preview.js');
const rows = [], combinations = [];
for (const feel of feels) {
  const report = JSON.parse(fs.readFileSync(`${root}/${feel}/validation.json`));
  assert.equal(report.feelId, feel); assert.equal(report.environment.bundleSHA256, bundleSHA256);
  assert.deepEqual(report.combinations.map(x => x.id).sort(), [...ids].sort());
  for (const id of ids) {
    const x = report.combinations.find(x => x.id === id);
    assert.equal(x.feelId, feel); assert.deepEqual(x.errors, []);
    assert.equal(x.asset.sha256, hash(`assets/models/squishy-${id}.glb`));
    assert.ok(fs.existsSync(`${root}/${feel}/${id}-${feel}-interaction.webm`));
    assert.deepEqual(x.views.map(v => `${v.device}/${v.theme}`).sort(), ['desktop/day', 'desktop/night', 'mobile/day', 'mobile/night']);
    for (const v of x.views) {
      assert.equal(v.feelId, feel); assert.ok(v.held.maximum > .03); assert.equal(v.restored.maximum, 0);
      if (feel === 'slow-rebound') { assert.ok(v.retainedRatio > 0 && v.retainedRatio < 1); assert.equal(v.finalPlay?.maximum ?? 0, 0); }
      else assert.ok(Math.abs(v.retainedRatio - (feel === 'clay' ? .85 : 1)) < .02);
    }
    const light = x.views.flatMap(v => v.rotationViews || []).map(v => v.light);
    assert.equal(light.length, 8); assert.ok(light.every(v => v.p05 > 30 && v.blackFraction < .005));
    const result = { id, feelId: feel, glbSHA256: x.asset.sha256, minHeldDepth: Math.min(...x.views.map(v => v.held.maximum)), maxHeldDepth: Math.max(...x.views.map(v => v.held.maximum)), minimumP05: Math.min(...light.map(v => v.p05)), maximumBlackFraction: Math.max(...light.map(v => v.blackFraction)), views: 4, rotatedViews: 8, video: `${feel}/${id}-${feel}-interaction.webm` };
    combinations.push(result);
    rows.push(`| ${id} | ${feel} | 通过 | ${result.minHeldDepth.toFixed(4)}–${result.maxHeldDepth.toFixed(4)} | ${result.minimumP05.toFixed(2)} | [录屏](${result.video}) |`);
  }
}
assert.equal(combinations.length, 21);
const totalGlbBytes = ids.reduce((sum, id) => sum + fs.statSync(`assets/models/squishy-${id}.glb`).size, 0);
const summary = { generatedAt: new Date().toISOString(), bundleSHA256, totalGlbBytes, combinations, environment: 'Desktop Edge; 1440x900 mouse and 390x844 native CDP touch emulation; no physical phone. Draw intervals are not FPS.' };
fs.writeFileSync(`${root}/summary.json`, JSON.stringify(summary, null, 2));
fs.writeFileSync(`${root}/validation.md`, `# 七模型 × 三确认预设：21组合\n\n运行包 SHA256：\`${bundleSHA256}\`。每行均有桌面/原生触屏模拟昼夜4组实际按压、滑动、释放、换色恢复、最终试捏，以及8组旋转光照检查。交互由实际 GPU 位置上传确认，静态截图不充当交互证明。慢回弹自然恢复在换色前等待并检查精确归位。输入取消、离页释放和原球三预设另由自动化回归覆盖。手机范围是模拟器，不是真机性能验收。\n\n| 模型 | 预设 | 交互结果 | 1700ms实际最大压深范围 | 旋转表面亮度P05最低/255 | 操作证据 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n七款 GLB 合计 ${totalGlbBytes.toLocaleString('en-US')} B。逐视角数据及资产 SHA 位于各预设目录的 validation.json。\n`);
console.log(JSON.stringify({ combinations: combinations.length, bundleSHA256, totalGlbBytes, minimumP05: Math.min(...combinations.map(x => x.minimumP05)), maximumBlackFraction: Math.max(...combinations.map(x => x.maximumBlackFraction)) }, null, 2));
