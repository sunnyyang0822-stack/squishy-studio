const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Run separately from tests, recording and CPU profiling. The preview server
// must already listen on 4380. Each case launches its own fresh browser.
(async () => {
  const { squishyStyles } = await import('../src/squishy-styles.mjs');
  const cores = process.env.WAX_BENCHMARK_CORES?.split(',') || ['clay', 'marshmallow'];
  if (cores.some(core => !['clay', 'marshmallow', 'butter'].includes(core))) throw Error('Unknown benchmark core');
  const base = process.env.WAX_BENCHMARK_BASE || 'http://127.0.0.1:4380', prefix = process.env.WAX_BENCHMARK_PREFIX || 'final-performance';
  const cases = cores.flatMap(core => Object.keys(squishyStyles).map(style => ({ style, core })));
  const summary = [];
  for (const { style, core } of cases) {
    const output = `artifacts/issue-38/${prefix}-${style}-${core}.json`;
    const url = `${base}/squishy/cloud/?style=${style}&coreMaterial=${core}&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`;
    const env = { ...process.env, THIN_WAX_BENCHMARK_URL: url, THIN_WAX_BENCHMARK_X: style === 'donut' ? '.75' : '.5', THIN_WAX_BENCHMARK_Y: '.5' };
    console.log(`COMMAND: node scripts/benchmark-thin-wax.cjs ${output}; THIN_WAX_BENCHMARK_URL=${url}; X=${env.THIN_WAX_BENCHMARK_X}; Y=.5`);
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/benchmark-thin-wax.cjs', output], { env, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', resolve);
    });
    console.log(`EXIT_CODE=${exitCode}`);
    if (exitCode !== 0) throw Error(`${style}/${core}: benchmark failed`);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    summary.push({ style, core, ...report.summary, bundleSha256: report.bundleSha256, source: output });
  }
  fs.writeFileSync(`artifacts/issue-38/${prefix}-summary.json`, JSON.stringify(summary, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
