// Optional, per-scene telemetry. No timers, audio, or pressure estimates.
// Core motion is measured from committed vertex positions, including explicit
// restore. Shell transitions are sampled only after its geometry has synced.
export function createSceneEvents(rest, callback) {
  let previous = rest.slice(), shellBefore, context, sequence = 0, disposed = false, moving = false;
  const enabled = typeof callback === 'function';
  const send = (type, detail = {}) => {
    if (!enabled || disposed || !context) return;
    // Consumer failures must not terminate the renderer's animation loop.
    try { callback(Object.freeze({ version: 1, sequence: ++sequence, ...context, type, ...detail })); } catch { /* consumer owns error reporting */ }
  };
  return {
    configure(value, positions, shell) { context = { ...value }; previous.set(positions); shellBefore = shell; },
    sample(positions, shell, { elapsed, active, restoring, time, coreNeedsFrame = true }) {
      if (!enabled || disposed) return;
      let compression = 0, recovery = 0, movement = 0;
      for (let i = 0; i < rest.length; i += 3) {
        const before = Math.hypot(previous[i] - rest[i], previous[i + 1] - rest[i + 1], previous[i + 2] - rest[i + 2]);
        const after = Math.hypot(positions[i] - rest[i], positions[i + 1] - rest[i + 1], positions[i + 2] - rest[i + 2]);
        compression = Math.max(compression, after - before); recovery = Math.max(recovery, before - after);
        movement = Math.max(movement, Math.hypot(positions[i] - previous[i], positions[i + 1] - previous[i + 1], positions[i + 2] - previous[i + 2]));
      }
      previous.set(positions);
      const exposure = shell?.panels ? shell.detached / shell.panels : null;
      const detail = { time, elapsed, exposure, exposureScope: 'global-detached-panel-fraction', active, restoring };
      if (shellBefore && shell) {
        const cracks = shell.cracked !== undefined ? shell.cracked - shellBefore.cracked : shell.damagedVertices - shellBefore.damagedVertices;
        if (cracks > 0) send('shell-crack', { ...detail, count: cracks, measure: shell.cracked !== undefined ? 'cracked-panels' : 'damaged-vertices' });
        const detached = shell.detached - shellBefore.detached;
        if (detached > 0) send('shell-fracture', { ...detail, count: detached });
      }
      // Keep shell transients ahead of concurrent core motion for C's mix.
      if (movement > 1e-7) {
        moving = true;
        if (compression > 1e-7) send('core-deform', { ...detail, displacement: compression, speed: compression / Math.max(elapsed, 1e-6) });
        if (recovery > 1e-7) send('core-recover', { ...detail, displacement: recovery, speed: recovery / Math.max(elapsed, 1e-6) });
      }
      if (moving && (movement <= 1e-7 || !coreNeedsFrame)) { moving = false; send('core-motion-end', detail); }
      shellBefore = shell;
    },
    emit: send,
    reset(positions, shell) { previous.set(positions); shellBefore = shell; send('shell-restore'); },
    dispose() { disposed = true; },
  };
}
