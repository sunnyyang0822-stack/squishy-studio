const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { modelAttribute } = require('../tests/helpers/orb-probe.cjs');
const baseline = 'a9315d9a88174afa5163ed732791ce15e0219022';
(async () => {
  for (const [file, factory] of [['orb-deformation.mjs', 'createOrbDeformation'], ['orb-marshmallow.mjs', 'createMarshmallowDeformation'], ['orb-slow-rebound.mjs', 'createSlowReboundDeformation']]) {
    const source = execFileSync('git', ['show', `${baseline}:src/${file}`]);
    assert.equal(fs.readFileSync(`src/${file}`, 'utf8').replaceAll('\r\n', '\n'), source.toString().replaceAll('\r\n', '\n'), `${file}: no algorithm or parameter changes (Git line endings normalized)`);
    const old = await import('data:text/javascript;base64,' + source.toString('base64'));
    const next = await import(`../src/${file}`);
    let operations = 0;
    for (const reducedMotion of [false, true]) {
      const a = modelAttribute('POSITION'), b = a.slice(), normals = modelAttribute('NORMAL');
      const before = old[factory](a, normals, { reducedMotion }), after = next[factory](b, normals, { reducedMotion });
      function run(method, ...args) {
        assert.deepEqual(after[method](...args), before[method](...args));
        assert.deepEqual(a, b); assert.deepEqual(after.getState(), before.getState()); operations++;
      }
      for (const angle of [0, -.6, .6]) {
        run('begin', [Math.sin(angle), 0, Math.cos(angle)]);
        for (let i = 0; i < 90; i++) run('step', 1 / 60);
        run('move', [Math.sin(angle + .2), 0, Math.cos(angle + .2)], .2);
        for (let i = 0; i < 20; i++) run('step', 1 / 60);
        run('release'); for (let i = 0; i < 90; i++) run('step', 1 / 60);
      }
      run('beginRestore'); for (const p of [.1, .4, .7, 1]) { run('applyRestore', p); run('step', 0); }
      run('reset'); run('step', 0);
    }
    console.log(`PASS ${file}: ${operations} exact paired operations on the SAME new sphere, including reduced motion; baseline ${baseline}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
