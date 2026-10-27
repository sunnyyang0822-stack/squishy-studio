const { test } = require('node:test');
const assert = require('node:assert/strict');

test('collection tray preserves bounded volume and physical floor while staying hidden until mounted', async () => {
  const { createWaxCollectionTray, waxCollectionTrayStyle: s } = await import('../src/wax-collection-tray.mjs');
  const tray = createWaxCollectionTray();
  try {
    assert.ok(Object.isFrozen(s));
    assert.equal(tray.name, 'Thin_Wax_Collection_Tray');
    assert.equal(tray.visible, false); assert.equal(tray.receiveShadow, true); assert.equal(tray.parent, null);
    tray.geometry.computeBoundingBox(); const bounds = tray.geometry.boundingBox;
    assert.ok(bounds.max.y > bounds.min.y, 'Tray has actual nonzero thickness');
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - s.height) < 1e-7);
    assert.ok(Math.abs(tray.position.y + bounds.max.y - s.floorY) < 1e-7, 'Top surface equals debris physical floorY');
    assert.equal(tray.geometry.parameters.radialSegments, s.segments);
    assert.equal(tray.geometry.parameters.radiusTop, s.radius);
    assert.ok(s.radius > s.physicalRadius, 'Visual rim extends beyond the bounded physics region');
    assert.equal(tray.material.color.getHex(), s.dayColor);
    assert.equal(s.dayColor, 0xf2e6de); assert.equal(s.nightColor, 0x514754);
    assert.equal(tray.material.roughness, .96); assert.equal(tray.material.metalness, 0);
  } finally { tray.geometry.dispose(); tray.material.dispose(); }
});

test('collection tray factory owns separate geometry/material and exposes retained night style without shared mutation', async () => {
  const { createWaxCollectionTray, waxCollectionTrayStyle: s } = await import('../src/wax-collection-tray.mjs');
  const a = createWaxCollectionTray(), b = createWaxCollectionTray();
  try {
    assert.notEqual(a.geometry, b.geometry); assert.notEqual(a.material, b.material);
    a.material.color.setHex(s.nightColor); a.visible = true;
    assert.equal(a.material.color.getHex(), s.nightColor);
    assert.equal(b.material.color.getHex(), s.dayColor); assert.equal(b.visible, false);
    a.geometry.scale(.5, 1, .5); b.geometry.computeBoundingBox();
    assert.ok(Math.abs(b.geometry.boundingBox.max.x - s.radius) < 1e-6);
  } finally { for (const tray of [a, b]) { tray.geometry.dispose(); tray.material.dispose(); } }
});
