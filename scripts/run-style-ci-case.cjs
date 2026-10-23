const { spawn } = require('node:child_process');
const styleIds = ['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star'];
const caseNames = Object.freeze(Object.fromEntries([
  ...styleIds.map(id => [id, `${id}×clay：真实 GPU 按压、滑动、留痕、换色恢复、旋转、取消及离页释放`]),
  ['loading-race', '新增模型加载失败可重试，快速样式切换只提交最后选择'],
]));
function argumentsForCase(id) {
  if (!Object.hasOwn(caseNames, id)) throw new RangeError(`Unknown style CI case: ${id}`);
  const escaped = caseNames[id].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ['--test', '--test-concurrency=1', '--test-reporter=tap',
    `--test-name-pattern=^${escaped}$`, 'tests/squishy-styles-browser.test.cjs'];
}
function validateTapResult(output, code, signal) {
  const counts = name => [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))].map(m => Number(m[1]));
  const pass = counts('pass'), fail = counts('fail');
  if (code !== 0 || signal || pass.length !== 1 || pass[0] !== 1 || fail.length !== 1 || fail[0] !== 0) {
    throw new Error(`Style CI case must execute exactly one passing test: exit=${code}, signal=${signal}, pass=${pass}, fail=${fail}`);
  }
}
function runCase(id) {
  const args = argumentsForCase(id); // Reject unknown IDs before starting a browser or server.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      try { validateTapResult(output, code, signal); resolve(); } catch (error) { reject(error); }
    });
  });
}
if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/run-style-ci-case.cjs <case-id>');
    return runCase(process.argv[2]);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { caseNames, argumentsForCase, validateTapResult };
