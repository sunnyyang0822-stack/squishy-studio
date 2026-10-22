// Local worktrees run concurrently. Change only server endpoints in temporary
// test copies; CI still runs the original assertions with ordinary npm test.
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const offset = Number(process.env.TEST_PORT_OFFSET || 1000);
if (!Number.isInteger(offset) || offset < 100 || offset > 50000) throw new Error('TEST_PORT_OFFSET must be an integer from 100 to 50000');
const copies = [], testCopies = [];
const helperName = `.__isolated-${process.pid}-marshmallow-browser.cjs`;
const isolate = source => source.replace(/http:\/\/127\.0\.0\.1:(\d+)/g, (_, port) => `http://127.0.0.1:${Number(port) + offset}`)
  .replace(/(\bPORT\s*:\s*['"])(\d+)(['"])/g, (_, prefix, port, suffix) => `${prefix}${Number(port) + offset}${suffix}`);
function copy(relative, source) {
  const file = join(root, 'tests', relative);
  writeFileSync(file, source); copies.push(file); return file;
}
try {
  // This helper starts its own server and must use the same isolated range.
  const helper = isolate(readFileSync(join(root, 'tests/helpers/marshmallow-browser.cjs'), 'utf8'));
  copy(join('helpers', helperName), helper);
  for (const name of readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).sort()) {
    const source = readFileSync(join(root, 'tests', name), 'utf8');
    const isolated = isolate(source).replaceAll('./helpers/marshmallow-browser.cjs', `./helpers/${helperName}`);
    testCopies.push(copy(`.__isolated-${process.pid}-${name}.cjs`, isolated));
  }
  const detailPort = String(Number(process.env.DETAIL_TEST_PORT || 4180) + offset);
  assert(Number.isInteger(Number(detailPort)) && Number(detailPort) > 0 && Number(detailPort) <= 65535, 'Invalid isolated DETAIL_TEST_PORT');
  if (process.argv.includes('--check')) {
    assert(helper.includes(`http://127.0.0.1:${4216 + offset}`));
    assert(helper.includes(`PORT: '${4216 + offset}'`));
    const marshmallow = testCopies.find(file => file.endsWith('-orb-marshmallow-browser.test.cjs.cjs'));
    assert(readFileSync(marshmallow, 'utf8').includes(`./helpers/${helperName}`));
    for (const file of copies) {
      const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `Syntax check failed: ${file}`);
    }
    console.log(`PASS: ${testCopies.length} isolated tests and helper parse; helper endpoints remapped; DETAIL_TEST_PORT=${detailPort}; no browser started.`);
  } else {
    console.log(`Running all ${testCopies.length} original test files with port offset +${offset}; assertions unchanged; concurrency=1; DETAIL_TEST_PORT=${detailPort}.`);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testCopies], {
      cwd: root, stdio: 'inherit', env: { ...process.env, DETAIL_TEST_PORT: detailPort },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} finally {
  for (const file of copies) unlinkSync(file);
}
