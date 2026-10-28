const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, lstatSync, existsSync } = require('node:fs');
const { resolve, dirname, sep } = require('node:path');

const root = resolve(__dirname, '..');
const manifests = ['emilkowalski', 'impeccable'].map(source =>
  JSON.parse(readFileSync(resolve(root, `.agents/skill-sources/${source}/source.json`), 'utf8')));
const skillNames = manifests.flatMap(manifest => manifest.skills);
const text = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('项目级技能入口齐全，名称和描述可读取', () => {
  for (const manifest of manifests) assert.equal(manifest.scope, 'project');
  assert.equal(skillNames.length, 16);
  assert.equal(new Set(skillNames).size, skillNames.length);
  const skillRoot = resolve(root, '.agents/skills');
  const installed = readdirSync(skillRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(installed, [...skillNames].sort());
  for (const name of skillNames) {
    assert.match(name, /^[a-z0-9-]+$/);
    const entry = resolve(skillRoot, name, 'SKILL.md');
    const frontmatter = text(entry).match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
    assert.ok(frontmatter, `${name} 缺少 frontmatter`);
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(frontmatter, /^description: .+/m);
  }
});

test('技能、配套资源和许可证与固定上游版本一致', () => {
  assert.equal(manifests[0].repository, 'https://github.com/emilkowalski/skills');
  assert.equal(manifests[0].license, 'MIT');
  assert.equal(manifests[0].files.length, 25);
  assert.equal(manifests[1].repository, 'https://github.com/pbakaus/impeccable');
  assert.equal(manifests[1].license, 'Apache-2.0');
  assert.equal(manifests[1].files.length, 64);
  for (const manifest of manifests) assert.match(manifest.revision, /^[0-9a-f]{40}$/);
  const paths = new Set();
  for (const entry of manifests.flatMap(manifest => manifest.files)) {
    assert.ok(entry.path.startsWith('.agents/'), `不允许的安装路径：${entry.path}`);
    const destination = resolve(root, entry.path);
    assert.ok(destination.startsWith(root + sep), '安装文件必须位于项目内');
    assert.equal(lstatSync(destination).isSymbolicLink(), false, '安装文件不能是外部链接');
    assert.equal(paths.has(entry.path), false, '来源清单不能重复');
    paths.add(entry.path);
    const bytes = Buffer.from(text(destination), 'utf8');
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(sha, entry.gitBlobSha1, `${entry.path} 已偏离记录的上游内容`);
  }
  for (const name of skillNames) {
    assert.ok(paths.has(`.agents/skills/${name}/SKILL.md`), `${name} 未记录来源`);
  }
  const license = text(resolve(root, '.agents/skill-sources/emilkowalski/LICENSE'));
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Emil Kowalski/);
  assert.match(text(resolve(root, '.agents/skill-sources/impeccable/LICENSE')), /Apache License/);
  assert.ok(existsSync(resolve(root, '.agents/skill-sources/impeccable/NOTICE.md')));
});

test('上游技能中的本地 Markdown 引用均已安装', () => {
  const agentsRoot = resolve(root, '.agents');
  for (const entry of manifests.flatMap(manifest => manifest.files).filter(file => file.path.endsWith('.md'))) {
    const source = resolve(root, entry.path);
    for (const match of text(source).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const path = resolve(dirname(source), decodeURIComponent(target.split('#')[0]));
      assert.ok(path.startsWith(agentsRoot + sep), `${entry.path} 的引用越过安装目录`);
      assert.ok(existsSync(path), `${entry.path} 缺少配套文件 ${target}`);
    }
  }
});

test('Impeccable 命令入口、参考资料和跨平台元数据齐全', () => {
  const base = resolve(root, '.agents/skills/impeccable');
  for (const path of ['scripts/impeccable', 'scripts/impeccable.cmd', 'scripts/VERSION', 'agents/openai.yaml', 'reference/new-work.md']) {
    assert.ok(existsSync(resolve(base, path)), `缺少 ${path}`);
  }
  assert.match(text(resolve(base, 'scripts/VERSION')).trim(), /^\d+\.\d+\.\d+$/);
  assert.match(text(resolve(base, 'scripts/impeccable.cmd')), /\.sha256/);
  assert.match(text(resolve(base, 'agents/openai.yaml')), /display_name: Impeccable/);
});
