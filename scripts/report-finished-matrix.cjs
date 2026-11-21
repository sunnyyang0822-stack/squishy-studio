const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const output = path.resolve('artifacts/wax-product');
const bundleSha256 = crypto.createHash('sha256').update(fs.readFileSync('assets/orb-preview.js')).digest('hex');
const styles = { orb: '圆球', cloud: '云朵', cylinder: '圆柱', donut: '甜甜圈', pyramid: '三角锥', flower: '五瓣花', star: '五角星' };
const cores = { clay: '黏土', marshmallow: '棉花糖', butter: '慢回弹' };
const thicknesses = { thin: '薄', medium: '中', thick: '厚' };
const rows = [];
for (const [style, styleName] of Object.entries(styles)) for (const [core, coreName] of Object.entries(cores)) for (const [thickness, thicknessName] of Object.entries(thicknesses)) {
  const devices = ['desktop', 'mobile'].map(device => {
    const file = `${style}-${core}-${thickness}-${device}.json`;
    const report = fs.existsSync(`${output}/${file}`) ? JSON.parse(fs.readFileSync(`${output}/${file}`, 'utf8')) : null;
    return { device, evidence: file, complete: report?.complete === true && report.bundleSha256 === bundleSha256, error: report?.error, performance: report?.performance, bundleMatches: report?.bundleSha256 === bundleSha256 };
  });
  const complete = devices.every(d => d.complete);
  // Diagnostic flag, not an invented product acceptance threshold. Recurrent
  // >100ms intervals or a P95 above 100ms must remain visible to the integrator.
  const longFrames = devices.some(d => d.performance?.p95 > 100 || d.performance?.over100ms >= 3);
  rows.push({ style, core, thickness, name: `${styleName}/${coreName}/${thicknessName}`, preview: 'merged-baseline', finishedFunctional: complete ? 'verified' : 'pending-or-failed', restore: complete ? 'verified' : 'pending-or-failed', performance: longFrames ? 'BLOCKED-observed-long-frames' : 'hardware-acceptance-pending', devices });
}
const summary = { generatedAt: new Date().toISOString(), bundleSha256,
  actualPhone: false, totalCombinations: rows.length, verifiedFunctional: rows.filter(r => r.finishedFunctional === 'verified').length,
  observedPerformanceBlockers: rows.filter(r => r.performance.startsWith('BLOCKED')).map(r => r.name),
  integration: 'A must connect createFinishedScene; historical detail/play unchanged', rows };
fs.writeFileSync(`${output}/matrix.json`, JSON.stringify(summary, null, 2));
const lines = ['# 成品组合实测矩阵', '', '每行是一个独立配方组合；预览栏来自合并基线，不冒充本轮独立壳片 UI 验收。成品/恢复栏验证 B 的真实成品 API；A 页面接入另行集成。', '',
  '真机、Safari 和声音尚未验收。性能列的长帧为实测阻塞；其余也不能宣称手机真机通过。', '',
  '| 造型/内芯/蜡厚度 | 制作预览基线 | 成品功能 | 完整恢复 | 桌面 P95/max ms | 模拟触屏 P95/max ms | 限制/证据 |',
  '| --- | --- | --- | --- | --- | --- | --- |'];
for (const row of rows) {
  const timing = d => d.performance ? `${d.performance.p95?.toFixed(1)}/${d.performance.max?.toFixed(1)}` : '未测';
  const evidence = row.devices.map(d => `[${d.device}](${d.evidence})`).join(' ');
  lines.push(`| ${row.name} | 已合并 | ${row.finishedFunctional === 'verified' ? '通过' : '待验/失败'} | ${row.restore === 'verified' ? '通过' : '待验/失败'} | ${timing(row.devices[0])} | ${timing(row.devices[1])} | ${row.performance.startsWith('BLOCKED') ? '**性能阻塞**；' : '真机待验；'}${evidence} |`);
}
lines.push('', '猫爪 × 三内芯 × 三蜡厚度：全部暂停，不初始化套壳（#53）。指甲油单独运行既有预设回归，不以蜡皮通过推断其视觉验收。', '', `完整功能验证 ${summary.verifiedFunctional}/${summary.totalCombinations}；真实手机 0 台。`, '');
fs.writeFileSync(`${output}/matrix.md`, lines.join('\n'));
console.log(JSON.stringify({ verifiedFunctional: summary.verifiedFunctional, expected: rows.length, performanceBlockers: summary.observedPerformanceBlockers }, null, 2));
