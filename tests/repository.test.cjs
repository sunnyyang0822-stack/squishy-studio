const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('PR 检查安装依赖和浏览器并执行完整测试', async () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.ok(workflow.includes('group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}'));
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /files=\(tests\/\*\.test\.cjs\)/);
  const separatedFiles = ['tests/squishy-styles-browser.test.cjs', 'tests/squishy-marshmallow-browser.test.cjs', 'tests/squishy-slow-rebound-browser.test.cjs'];
  assert.deepEqual([...workflow.matchAll(/"\$file" != (tests\/[\w-]+\.test\.cjs)/g)].map(m => m[1]), separatedFiles, 'Only the three fully separated browser suites may be excluded from generic shards');
  assert.match(workflow, /\]\]; then\s+general\+=\("\$file"\)/);
  assert.match(workflow, /node --test --test-concurrency=1 --test-shard=\$\{\{ matrix\.shard \}\}\/4 "\$\{general\[@\]\}"/);
  assert.match(workflow, /export PLAYWRIGHT_BROWSER_PATH=/);
  assert.match(workflow, /browser-tests:\s+name: browser-tests\s+needs: \[browser-shards, style-cases\]\s+if: \$\{\{ always\(\) \}\}/);
  for (const dependency of ['browser-shards', 'style-cases']) {
    assert.ok(workflow.includes(`test "\${{ needs.${dependency}.result }}" = success`));
  }
  assert.match(workflow, /node scripts\/run-style-ci-case\.cjs "\$\{\{ matrix\.case \}\}"/);
  const matrixCases = workflow.match(/case: \[([^\]]+)\]/)[1].split(',').map(id => id.trim());
  const { squishyStyles } = await import('../src/squishy-styles.mjs');
  const styleIds = Object.keys(squishyStyles).filter(id => id !== 'orb');
  const expectedCases = [...styleIds, 'loading-race', ...styleIds.map(id => `${id}-marshmallow`), ...styleIds.map(id => `${id}-slow-rebound`), 'slow-rebound-touch'];
  assert.deepEqual(matrixCases, expectedCases, 'All 21 model/feel combinations, the loading race and native touch must run');
  const { caseNames, argumentsForCase, validateTapResult } = require('../scripts/run-style-ci-case.cjs');
  assert.deepEqual(Object.keys(caseNames), expectedCases);
  for (const id of expectedCases) {
    const args = argumentsForCase(id);
    assert.equal(args.at(-1), id.includes('slow-rebound') ? separatedFiles[2] : id.endsWith('-marshmallow') ? separatedFiles[1] : separatedFiles[0]);
    assert.ok(args.includes('--test-reporter=tap'));
    const expression = args.find(arg => arg.startsWith('--test-name-pattern=')).slice('--test-name-pattern='.length);
    assert.ok(expression.startsWith('^') && expression.endsWith('$'));
    assert.deepEqual(expectedCases.filter(other => new RegExp(expression).test(caseNames[other])), [id]);
  }
  assert.equal(expectedCases.length, 23);
  for (const file of separatedFiles) assert.ok(expectedCases.some(id => argumentsForCase(id).at(-1) === file));
  validateTapResult('# pass 1\n# fail 0\n', 0, null);
  for (const [output, code, signal] of [
    ['# pass 0\n# fail 0\n', 0, null], ['# pass 2\n# fail 0\n', 0, null],
    ['# pass 1\n# fail 1\n', 0, null], ['# pass 1\n# fail 0\n', 1, null],
    ['# pass 1\n# fail 0\n', 0, 'SIGTERM'], ['', 0, null],
    ['# pass 1\n# fail 0\n# pass 1\n', 0, null],
  ]) assert.throws(() => validateTapResult(output, code, signal));
  assert.throws(() => argumentsForCase('unknown'), /Unknown style CI case/);
  const invalid = require('node:child_process').spawnSync(process.execPath,
    ['scripts/run-style-ci-case.cjs', 'unknown'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown style CI case/);
  assert.equal(invalid.stdout, '', 'Invalid case must not launch the browser test');
  assert.doesNotMatch(workflow, /pull_request_target:/);
});

test('PR 模板要求范围、验证和回滚信息', () => {
  const template = readFileSync('.github/pull_request_template.md', 'utf8');
  for (const heading of ['关联 Issue', '改动与边界', '验证证据', '风险与回滚', '合并前检查']) {
    assert.ok(template.includes(heading), `缺少 ${heading}`);
  }
});
