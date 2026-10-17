const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('PR 检查安装依赖和浏览器并执行完整测试', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});

test('PR 模板要求范围、验证和回滚信息', () => {
  const template = readFileSync('.github/pull_request_template.md', 'utf8');
  for (const heading of ['关联 Issue', '改动与边界', '验证证据', '风险与回滚', '合并前检查']) {
    assert.ok(template.includes(heading), `缺少 ${heading}`);
  }
});
