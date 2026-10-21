// Mouse-only background drag. Touch retains native page scrolling.
export function bindOrbRotation({ isSqueezing, rotate }) {
  const events = new AbortController();
  let owner = null, last;
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: events.signal });
  const excluded = '.orb-input, a, button, input, select, textarea, label, fieldset, .customization, .sound-tool, .detail-topbar, [role="dialog"]';
  function finish() {
    const previous = owner; owner = null;
    document.body.classList.remove('orb-rotating');
    if (previous !== null && document.documentElement.hasPointerCapture(previous)) document.documentElement.releasePointerCapture(previous);
  }
  on(document, 'pointerdown', event => {
    if (owner !== null || event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0 || isSqueezing() || event.target.closest(excluded)) return;
    event.preventDefault(); owner = event.pointerId; last = [event.clientX, event.clientY];
    document.documentElement.setPointerCapture(owner); document.body.classList.add('orb-rotating');
  });
  on(window, 'pointermove', event => {
    if (event.pointerId !== owner) return;
    rotate((event.clientX - last[0]) / Math.max(1, innerWidth) * Math.PI * 2, (event.clientY - last[1]) / Math.max(1, innerHeight) * Math.PI * 2);
    last = [event.clientX, event.clientY];
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(window, type, event => { if (event.pointerId === owner) finish(); });
  on(window, 'blur', finish);
  on(document, 'visibilitychange', () => { if (document.hidden) finish(); });
  return { cancel: finish, dispose() { finish(); events.abort(); } };
}
