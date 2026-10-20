// A single interruptible animation owns the panel. Closing makes it inert at
// once; it remains in flow until the fade finishes, avoiding a clickable ghost.
export function createPanelMotion(panel, { signal } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let animation;
  let open = !panel.hidden;
  let disposed = false;
  const finish = () => { panel.hidden = !open; animation?.cancel(); animation = undefined; };
  const setOpen = (next, { instant = false } = {}) => {
    if (disposed) return;
    const wasHidden = panel.hidden;
    const style = getComputedStyle(panel);
    const from = wasHidden ? { opacity: 0, transform: 'translateY(-4px) scale(.98)' } : { opacity: style.opacity, transform: style.transform };
    animation?.cancel();
    open = next;
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
    if (instant || reduce.matches || !panel.animate || (wasHidden && !open)) { finish(); return; }
    panel.hidden = false;
    animation = panel.animate([from, open ? { opacity: 1, transform: 'none' } : { opacity: 0, transform: 'translateY(-3px) scale(.985)' }], { duration: open ? 180 : 120, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'both' });
    const current = animation;
    current.finished.then(() => { if (animation === current) finish(); }, () => {});
  };
  const onReduce = () => { if (reduce.matches) finish(); };
  reduce.addEventListener('change', onReduce);
  const dispose = () => { disposed = true; animation?.cancel(); reduce.removeEventListener('change', onReduce); };
  signal?.addEventListener('abort', dispose, { once: true });
  return { setOpen, dispose };
}
