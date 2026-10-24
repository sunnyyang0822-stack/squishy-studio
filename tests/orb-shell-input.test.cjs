const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('同一捕获与命中同时驱动芯壳；命中丢失终止驻留，不在旧位置继续施力', async () => {
  const { bindOrbInput } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync('src/orb-input.js')).toString('base64'));
  const oldWindow = global.window, oldDocument = global.document;
  global.window = new EventTarget(); global.document = new EventTarget();
  const surface = new EventTarget(), calls = [], captured = new Set();
  let hit = [0, 0, 1];
  Object.assign(surface, {
    clientWidth: 200, setAttribute() {},
    setPointerCapture(id) { calls.push('capture'); captured.add(id); },
    hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id),
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  });
  const event = (target, name, extra = {}) => {
    const e = new Event(name, { cancelable: true });
    Object.assign(e, { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100 }, extra);
    target.dispatchEvent(e);
  };
  const input = bindOrbInput({ surface, hitTest: () => hit, invalidate() {},
    deformation: { begin: p => calls.push(['core.begin', p]), move: p => calls.push(['core.move', p]), release: () => calls.push('core.release'), cancel: () => calls.push('core.cancel') },
    onContact: (p, phase) => calls.push(['wax.' + phase, p]), onEnd: () => calls.push('wax.end'), endOnMiss: () => true,
  });
  try {
    event(surface, 'pointerdown');
    event(window, 'pointermove', { pointerId: 2 });
    assert.equal(calls.filter(x => Array.isArray(x)).length, 2, 'A second pointer has no contact');
    event(window, 'pointermove');
    assert.deepEqual(calls.filter(x => Array.isArray(x)), [['core.begin', hit], ['wax.begin', hit], ['core.move', hit], ['wax.move', hit]]);
    assert.equal(calls.filter(x => x === 'capture').length, 1);
    hit = null; event(window, 'pointermove');
    assert.equal(input.isActive(), false); assert.equal(captured.size, 0);
    assert.deepEqual(calls.slice(-2), ['core.cancel', 'wax.end']);
    const count = calls.length; hit = [1, 0, 0]; event(window, 'pointermove');
    assert.equal(calls.length, count, 'Returning from a miss needs a fresh press and dwell');
    event(surface, 'keydown', { key: ' ', repeat: false });
    assert.equal(input.isActive(), true);
    event(surface, 'keyup', { key: 'Enter' }); assert.equal(input.isActive(), true);
    event(window, 'blur');
    assert.equal(input.isActive(), false); assert.deepEqual(calls.slice(-2), ['core.cancel', 'wax.end']);
    event(surface, 'pointerdown');
    input.cancel({ preserveShape: true });
    assert.equal(calls.at(-1), 'wax.end', 'Preserving core shape still stops shell time');
  } finally { input.dispose(); global.window = oldWindow; global.document = oldDocument; }
});
