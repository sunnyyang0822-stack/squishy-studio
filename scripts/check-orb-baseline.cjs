// CPU-only comparison against the fixed pre-Issue-30 delivery baseline.
// The baseline factory is loaded in memory, never copied into product sources.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { modelAttribute } = require('../tests/helpers/orb-probe.cjs');

const repository = path.resolve(__dirname, '..');
const baseline = '1976819e4258c519b289d76054d728f4b9a70370';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitShow = file => execFileSync('git', ['show', `${baseline}:${file}`], {
  cwd: repository, maxBuffer: 10 * 1024 * 1024,
});

async function main() {
  process.chdir(repository);
  const baselineSource = gitShow('src/orb-deformation.mjs');
  const currentSource = readFileSync('src/orb-deformation.mjs');
  const orbAsset = readFileSync('assets/models/squishy-orb.glb');
  assert.deepEqual(orbAsset, gitShow('assets/models/squishy-orb.glb'), 'Original orb GLB must remain byte-identical');
  const before = await import(`data:text/javascript;base64,${baselineSource.toString('base64')}`);
  const after = await import(pathToFileURL(path.join(repository, 'src/orb-deformation.mjs')).href);
  console.log(`Fixed baseline: ${baseline}`);
  console.log(`Baseline factory SHA-256: ${sha256(baselineSource)}`);
  console.log(`Current factory SHA-256: ${sha256(currentSource)}`);
  console.log(`Original orb GLB SHA-256: ${sha256(orbAsset)} (byte-identical to baseline)`);
  console.log('Assertions after every operation: exact position-buffer equality, exact getState() equality, exact method-return equality.');
  console.log('Per mode: five begin/hold/move/hold/release/settle strokes; explicit restoration at .1/.3/.6/1; begin/hold/cancel/settle/reset. Time step: 1/120 second.');
  let total = 0;
  for (const reducedMotion of [false, true]) {
    const positions = modelAttribute('POSITION'), currentPositions = positions.slice();
    const normals = modelAttribute('NORMAL');
    const original = before.createOrbDeformation(positions, normals.slice(), { reducedMotion });
    const current = after.createOrbDeformation(currentPositions, normals.slice(), { reducedMotion });
    let operations = 0;
    function call(method, ...args) {
      const originalResult = original[method](...args);
      const currentResult = current[method](...args);
      const context = `reducedMotion=${reducedMotion}, operation=${operations + 1}, method=${method}`;
      assert.deepEqual(currentPositions, positions, `${context}: positions`);
      assert.deepEqual(current.getState(), original.getState(), `${context}: state`);
      assert.deepEqual(currentResult, originalResult, `${context}: return value`);
      operations++;
    }
    function advance(frames) { for (let i = 0; i < frames; i++) call('step', 1 / 120); }
    for (let stroke = 0; stroke < 5; stroke++) {
      call('begin', [Math.sin(stroke * .2), .0175, Math.cos(stroke * .2)]); advance(80);
      call('move', [Math.sin(stroke * .2 + .3), .12, Math.cos(stroke * .2 + .3)], .3); advance(80);
      call('release'); advance(100);
    }
    call('beginRestore');
    for (const progress of [.1, .3, .6, 1]) { call('applyRestore', progress); advance(1); }
    call('begin', [0, 0, 1]); advance(100);
    call('cancel'); advance(100); call('reset');
    total += operations;
    console.log(`PASS reducedMotion=${reducedMotion}: ${operations} operations, ${positions.length / 3} actual GLB vertices.`);
  }
  assert.equal(total, 3054);
  console.log(`PASS total: ${total} operations. No GPU or browser was started.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
