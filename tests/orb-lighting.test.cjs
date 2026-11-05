const { test } = require('node:test');
const assert = require('node:assert/strict');
test('cavity shade remains smooth and legible from light contact to deep pressure', async () => {
  const { cavityVisibility } = await import('../src/orb-lighting.mjs');
  assert.equal(cavityVisibility(0), 1);
  assert.equal(cavityVisibility(-1), 1);
  assert.equal(cavityVisibility(NaN), 1);
  let previous = 1;
  for (let depth = .001; depth < 1; depth += .001) {
    const current = cavityVisibility(depth);
    assert.ok(current < previous && current > .52);
    assert.ok(previous - current < .0023, 'No depth threshold creates a shading step');
    previous = current;
  }
  assert.ok(cavityVisibility(.24) - cavityVisibility(.46) > .07, 'Deep pressure must not collapse onto the old .24 flat shading cap');
});
test('day and night retain broad fill while the grazing key models the dent', async () => {
  const { getOrbLighting } = await import('../src/orb-lighting.mjs');
  for (const theme of [true, false]) {
    const p = getOrbLighting(theme);
    assert.ok(p.fill >= .6 && p.front >= .3 && p.environment >= .2);
    assert.ok(p.key > 4 * p.fill && p.rim >= .6);
  }
});
