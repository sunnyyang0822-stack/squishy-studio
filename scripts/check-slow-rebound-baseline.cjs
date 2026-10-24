const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { modelAttribute } = require('../tests/helpers/orb-probe.cjs');
const baseline = 'aaaed2f19a5a2f3a34f4b9200d3189e2a9bed116';
(async () => {
  const source = execFileSync('git', ['show', `${baseline}:src/orb-slow-rebound.mjs`], { encoding: 'utf8' });
  const original = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const current = await import('../src/orb-slow-rebound.mjs');
  assert.deepEqual(current.slowReboundParameters, original.slowReboundParameters, 'Confirmed material parameters remain exact');
  assert.equal(Object.isFrozen(current.slowReboundParameters), true);
  let operations = 0;
  for (const reducedMotion of [false, true]) {
    const rest = modelAttribute('POSITION'), normals = modelAttribute('NORMAL'), a = rest.slice(), b = rest.slice();
    const old = original.createSlowReboundDeformation(a, normals, { reducedMotion });
    const next = current.createSlowReboundDeformation(b, normals, { reducedMotion });
    function run(method, ...args) {
      assert.deepEqual(next[method](...args), old[method](...args), method + ' return');
      assert.deepEqual(b, a, method + ' positions'); assert.deepEqual(next.getState(), old.getState(), method + ' state'); operations++;
    }
    function frames(count, dt = 1 / 60) { for (let i = 0; i < count; i++) run('step', dt); }
    const point = angle => [Math.sin(angle), .0175, Math.cos(angle)];
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      run('begin', point(-.7)); run('step', 0); frames(100, dt);
      for (let i = 1; i <= 9; i++) { run('move', point(-.7 + i * .15), .5); frames(2, dt); }
      frames(80, dt); run('release'); frames(50, dt); run('step', 15);
      run('begin', point(.3)); frames(25, dt); run('cancel'); frames(20, dt);
      run('beginRestore'); run('applyRestore', .3); frames(1, dt);
      run('interruptRestore'); run('applyRestore', 1); frames(3, dt);
      run('begin', point(-.3)); frames(20, dt); run('release');
      run('beginRestore'); for (let i = 0; i <= 20; i++) { run('applyRestore', i / 20); frames(1, dt); }
      run('setReducedMotion', !reducedMotion); run('begin', point(.5)); frames(20, dt);
      run('release'); frames(30, dt); run('setReducedMotion', reducedMotion); run('reset'); frames(1, dt);
    }
  }
  console.log(`PASS: origin/main baseline ${baseline}; ${operations} operations, normal/reduced motion at 30/60/120 Hz; parameters and every return, vertex and state strictly equal.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
