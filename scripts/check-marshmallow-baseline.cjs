const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { modelAttribute } = require('../tests/helpers/orb-probe.cjs');
const baseline = 'f9c223d87d52d603a721d726b54a0d5568c72956';
(async () => {
  const source = execFileSync('git', ['show', `${baseline}:src/orb-marshmallow.mjs`], { encoding: 'utf8' });
  const original = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).createMarshmallowDeformation;
  const current = (await import('../src/orb-marshmallow.mjs')).createMarshmallowDeformation;
  let operations = 0;
  for (const reducedMotion of [false, true]) {
    const rest = modelAttribute('POSITION'), normals = modelAttribute('NORMAL'), a = rest.slice(), b = rest.slice();
    const old = original(a, normals, { reducedMotion }), next = current(b, normals, { reducedMotion });
    function run(method, ...args) {
      assert.deepEqual(next[method](...args), old[method](...args), method + ' return');
      assert.deepEqual(b, a, method + ' positions'); assert.deepEqual(next.getState(), old.getState(), method + ' state'); operations++;
    }
    function frames(count, dt = 1 / 60) { for (let i = 0; i < count; i++) run('step', dt); }
    const point = a => [Math.sin(a), .0175, Math.cos(a)];
    for (let cycle = 0; cycle < 4; cycle++) {
      run('begin', point(-.8)); run('step', 0); frames(10); frames(60);
      for (let i = 1; i <= 8; i++) { run('move', point(-.8 + i * .2), .4); frames(1); }
      frames(90); run('release'); frames(10, 1);
      run('begin', point(.3)); frames(20); run('cancel'); frames(5, 2);
      run('beginRestore'); run('applyRestore', .3); frames(1);
      run('interruptRestore'); run('applyRestore', 1); frames(2);
      run('begin', point(-.3)); frames(8); run('release');
      run('beginRestore'); for (let i = 0; i <= 20; i++) { run('applyRestore', i / 20); frames(1); }
      run('reset'); frames(1);
    }
  }
  console.log(`PASS: PR #32 ${baseline}; ${operations} operations; normal/reduced motion; every return, vertex and state strictly equal.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
