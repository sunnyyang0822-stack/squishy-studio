const assert = require('node:assert/strict');

// Test-only observation of real native WebGL position uploads. No animation
// clocks, frame deltas, geometry, material state, or native draw calls change.
async function installWaxGPUObserver(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = original.call(this, type, ...args);
      if (type !== 'webgl2' || !gl || gl.waxGPUObserver) return gl;
      const probe = gl.waxGPUObserver = window.waxGPUObserver = { buffers: new Map(), uploads: 0, draws: 0, uploadObservers: new Set() };
      window.waxUploadProbe = gl.waxUploadProbe = probe;
      window.waxStyleBuffers = gl.waxStyleBuffers = probe.buffers;
      let bound;
      const bind = gl.bindBuffer.bind(gl), data = gl.bufferData.bind(gl), sub = gl.bufferSubData.bind(gl), dispose = gl.deleteBuffer.bind(gl);
      gl.bindBuffer = (...a) => { if (a[0] === gl.ARRAY_BUFFER) bound = a[1]; return bind(...a); };
      gl.bufferData = (...a) => {
        const result = data(...a);
        if (a[0] === gl.ARRAY_BUFFER) {
          if (a[1] instanceof Float32Array) { probe.buffers.set(bound, a[1].slice()); probe.uploads++; }
          else probe.buffers.delete(bound);
        }
        return result;
      };
      gl.bufferSubData = (...a) => {
        // Notify only AFTER the original native upload returned, before the
        // renderer's subsequent draw. Observers identify an exact buffer handle.
        const result = sub(...a), target = probe.buffers.get(bound);
        if (a[0] === gl.ARRAY_BUFFER && target && a[2] instanceof Float32Array) {
          const offset = a[3] ?? 0, length = a[4] ?? (a[2].length - offset);
          target.set(a[2].subarray(offset, offset + length), a[1] / 4); probe.uploads++;
          for (const observer of [...probe.uploadObservers]) observer(bound, target);
        }
        return result;
      };
      gl.deleteBuffer = buffer => { probe.buffers.delete(buffer); return dispose(buffer); };
      for (const method of ['drawElements', 'drawArrays']) {
        const draw = gl[method].bind(gl);
        gl[method] = (...a) => { const result = draw(...a); probe.draws++; return result; };
      }
      return gl;
    };
  });
}

async function armWaxUploadEnd(page, { resultKey = 'waxShortContact', action = 'pointerup', minimumChange = .0001, minimumDepth = .001 } = {}) {
  await page.locator('.toy-mount').evaluate((mount, { resultKey, action, minimumChange, minimumDepth }) => {
    const probe = window.waxGPUObserver, baseline = mount.thinWaxDiagnostics({ measure: false });
    let coreBuffer;
    for (const [buffer, values] of probe.buffers) {
      if (values.length !== baseline.corePositions.length) continue;
      if (values.every((v, i) => Math.abs(v - baseline.corePositions[i]) <= 1e-6)) { coreBuffer = buffer; break; }
    }
    if (!coreBuffer) throw Error('No actual position buffer matches the current core; normals/colors cannot arm the observer');
    window[resultKey] = null;
    window.addEventListener('pointerdown', event => {
      const start = performance.now(), surface = document.querySelector('.orb-input');
      const observe = (buffer, uploaded) => {
        if (buffer !== coreBuffer) return;
        let depthSquared = 0, changedSinceDown = 0;
        for (let i = 0; i < uploaded.length; i += 3) {
          let squared = 0;
          for (let k = 0; k < 3; k++) {
            squared += (uploaded[i + k] - baseline.coreRestPositions[i + k]) ** 2;
            changedSinceDown = Math.max(changedSinceDown, Math.abs(uploaded[i + k] - baseline.corePositions[i + k]));
          }
          depthSquared = Math.max(depthSquared, squared);
        }
        const gpuDepth = Math.sqrt(depthSquared);
        if (gpuDepth <= minimumDepth || changedSinceDown <= minimumChange) return;
        const before = mount.thinWaxDiagnostics({ measure: false }); let gpuCoreError = 0;
        for (let i = 0; i < uploaded.length; i++) gpuCoreError = Math.max(gpuCoreError, Math.abs(uploaded[i] - before.corePositions[i]));
        const sampledElapsed = performance.now() - start, captured = surface.hasPointerCapture(event.pointerId), drawsAtRelease = probe.draws;
        probe.uploadObservers.delete(observe);
        if (action === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        else if (action === 'miss') window.dispatchEvent(new PointerEvent('pointermove', { pointerId: event.pointerId, clientX: 5, clientY: 5 }));
        else window.dispatchEvent(action === 'blur' ? new Event('blur') : new PointerEvent(action, { pointerId: event.pointerId }));
        window[resultKey] = { before, state: before.thinWax, core: before.corePositions, elapsed: performance.now() - start, sampledElapsed,
          captured, trustedDown: event.isTrusted, trusted: event.isTrusted, gpuDepth, changedSinceDown, minimumDepth, minimumChange, gpuCoreError, drawsAtRelease, actualGPU: true };
      };
      probe.uploadObservers.add(observe);
    }, { capture: true, once: true });
  }, { resultKey, action, minimumChange, minimumDepth });
}

async function readWaxUploadEnd(page, resultKey = 'waxShortContact') {
  await page.waitForFunction(key => window[key] != null && window.waxGPUObserver.draws > window[key].drawsAtRelease, resultKey);
  const result = await page.evaluate(key => ({ ...window[key], drawsAfter: window.waxGPUObserver.draws }), resultKey);
  assert.ok(result.elapsed < 500, `Actual force ended before the fracture threshold: ${JSON.stringify({ elapsed: result.elapsed, sampledElapsed: result.sampledElapsed, gpuDepth: result.gpuDepth })}`);
  assert.equal(result.trustedDown, true); assert.equal(result.captured, true); assert.equal(result.actualGPU, true);
  assert.equal(result.before.coreState.active, true, 'The original core input is active when its changed position buffer uploads');
  assert.ok(result.gpuDepth > (result.minimumDepth ?? .001) && result.changedSinceDown > (result.minimumChange ?? .0001), 'A changed, genuinely uploaded core deformation precedes force termination');
  assert.ok(result.gpuCoreError <= 1e-6, `The actual uploaded position buffer matches the sampled core: ${result.gpuCoreError}`);
  assert.ok(result.drawsAfter > result.drawsAtRelease, 'The native renderer still completes real draws after the observed upload');
  return result;
}
module.exports = { installWaxGPUObserver, armWaxUploadEnd, readWaxUploadEnd };
