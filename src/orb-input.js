// Pointer ownership is independent of rendering and the deformation kernel.
export function bindOrbInput({ surface, hitTest, deformation, invalidate, onBegin = () => {}, keyboardPoint }) {
  const events = new AbortController();
  let owner = null, keyboardKey = null, start, last;
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: events.signal });
  const setPressed = value => surface.setAttribute('aria-pressed', String(value));
  function finish({ immediate = false, preserveShape = false } = {}) {
    const previous = owner;
    owner = null;
    keyboardKey = null;
    if (typeof previous === 'number' && surface.hasPointerCapture(previous)) surface.releasePointerCapture(previous);
    setPressed(false);
    if (!preserveShape) { if (immediate) deformation.cancel(); else deformation.release(); }
    invalidate();
  }
  function update(clientX, clientY) {
    last = [clientX, clientY];
    const point = hitTest(clientX, clientY, false);
    if (point) {
      deformation.move(point, Math.hypot(clientX - start[0], clientY - start[1]) / Math.max(1, surface.clientWidth));
      invalidate();
    }
  }
  on(surface, 'pointerdown', event => {
    if (owner !== null || !event.isPrimary || event.button !== 0) return;
    const point = hitTest(event.clientX, event.clientY, true);
    if (!point) return;
    event.preventDefault();
    owner = event.pointerId; start = last = [event.clientX, event.clientY];
    surface.setPointerCapture(event.pointerId);
    onBegin(); setPressed(true); deformation.begin(point); invalidate();
  });
  on(window, 'pointermove', event => { if (event.pointerId === owner) update(event.clientX, event.clientY); });
  on(window, 'pointerup', event => { if (event.pointerId === owner) finish(); });
  on(window, 'pointercancel', event => { if (event.pointerId === owner) finish({ immediate: true }); });
  on(surface, 'lostpointercapture', event => { if (event.pointerId === owner) finish({ immediate: true }); });
  on(surface, 'keydown', event => {
    if (![' ', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') { finish({ immediate: true }); return; }
    if (owner !== null || event.repeat) return;
    const box = surface.getBoundingClientRect();
    const point = keyboardPoint ? keyboardPoint(box) : hitTest(box.x + box.width / 2, box.y + box.height / 2, true);
    if (!point) return;
    onBegin(); owner = 'keyboard'; keyboardKey = event.key; setPressed(true); deformation.begin(point); invalidate();
  });
  on(surface, 'keyup', event => { if (owner === 'keyboard' && event.key === keyboardKey) { event.preventDefault(); finish(); } });
  on(surface, 'blur', () => { if (owner === 'keyboard') finish({ immediate: true }); });
  on(window, 'blur', () => finish({ immediate: true }));
  on(document, 'visibilitychange', () => { if (document.hidden) finish({ immediate: true }); });
  return {
    isActive() { return owner !== null; },
    cancel({ preserveShape = false } = {}) { finish({ immediate: true, preserveShape }); },
    resize() { if (typeof owner === 'number' && last) update(...last); },
    dispose() { finish({ immediate: true }); events.abort(); },
  };
}
