const { readFileSync } = require('node:fs');
function modelAttribute(name) {
  const bytes = readFileSync('assets/models/squishy-orb.glb');
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const primitive = gltf.meshes[0].primitives[0];
  const accessor = gltf.accessors[primitive.attributes[name]];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = 28 + jsonLength + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return Float32Array.from({ length: accessor.count * 3 }, (_, i) => bytes.readFloatLE(start + i * 4));
}

// Observe real vertex uploads instead of adding a test-only deformation API to
// the product. The position buffer is identified by the actual GLB rest data.
async function installOrbProbe(page) {
  await page.addInitScript(rest => {
    window.orbMeshProbe = { rest, positions: null, uploads: 0, contexts: [], modelViewMatrix: null, orbDraws: 0 };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = original.call(this, type, ...args);
      if (type !== 'webgl2' || !gl || window.orbMeshProbe.contexts.includes(gl)) return gl;
      window.orbMeshProbe.contexts.push(gl);
      const probe = window.orbMeshProbe;
      const names = new Map(), matrices = new Map();
      const getUniformLocation = gl.getUniformLocation.bind(gl);
      gl.getUniformLocation = function(program, name) {
        const location = getUniformLocation(program, name);
        if (location) names.set(location, name);
        return location;
      };
      const uniformMatrix4fv = gl.uniformMatrix4fv.bind(gl);
      gl.uniformMatrix4fv = function(location, transpose, value, ...args) {
        if (names.get(location) === 'modelViewMatrix') matrices.set(gl.getParameter(gl.CURRENT_PROGRAM), Array.from(value));
        return uniformMatrix4fv(location, transpose, value, ...args);
      };
      const drawElements = gl.drawElements.bind(gl);
      gl.drawElements = function(mode, count, ...args) {
        if (count === 15360) { probe.modelViewMatrix = matrices.get(gl.getParameter(gl.CURRENT_PROGRAM))?.slice() || null; probe.orbDraws++; }
        return drawElements(mode, count, ...args);
      };
      let positionBuffer;
      const bufferData = gl.bufferData.bind(gl);
      gl.bufferData = function(target, data, ...other) {
        const result = bufferData(target, data, ...other);
        if (target === gl.ARRAY_BUFFER && data?.length === rest.length && rest.every((v, i) => data[i] === v)) {
          positionBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
          probe.positions = new Float32Array(data); probe.uploads++;
        }
        return result;
      };
      const bufferSubData = gl.bufferSubData.bind(gl);
      gl.bufferSubData = function(target, offset, data, ...other) {
        const result = bufferSubData(target, offset, data, ...other);
        if (positionBuffer && target === gl.ARRAY_BUFFER && gl.getParameter(gl.ARRAY_BUFFER_BINDING) === positionBuffer) {
          const sourceOffset = other[0] || 0;
          const length = other[1] || data.length - sourceOffset;
          probe.positions.set(data.subarray(sourceOffset, sourceOffset + length), offset / 4);
          probe.uploads++;
        }
        return result;
      };
      return gl;
    };
  }, Array.from(modelAttribute('POSITION')));
}

async function meshStats(page, baseline) {
  return page.evaluate(baseline => {
    const p = window.orbMeshProbe;
    const origin = baseline || p.rest;
    let maximum = 0, changed = 0, total = 0;
    const center = [0, 0, 0];
    for (let i = 0; i < p.rest.length; i += 3) {
      const d = Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - origin[i + k]));
      maximum = Math.max(maximum, d);
      if (d > .00001) { changed++; total += d; for (let k = 0; k < 3; k++) center[k] += p.rest[i + k] * d; }
    }
    return { maximum, changed, center: center.map(v => v / (total || 1)), uploads: p.uploads, contexts: p.contexts.length };
  }, baseline ? Array.from(baseline) : undefined);
}
async function settled(page) {
  // Every call starts a fresh observation window; prior settled samples cannot
  // satisfy a subsequent release before its GPU updates have arrived.
  await page.evaluate(() => { window.orbSettleSample = { uploads: -1, stableAt: performance.now() }; });
  await page.waitForFunction(() => {
    const p = window.orbMeshProbe, sample = window.orbSettleSample;
    if (!p?.positions || document.querySelector('.orb-input')?.getAttribute('aria-pressed') !== 'false') { sample.stableAt = performance.now(); return false; }
    if (sample.uploads !== p.uploads) { sample.uploads = p.uploads; sample.stableAt = performance.now(); }
    return performance.now() - sample.stableAt >= 180;
  });
}
module.exports = { modelAttribute, installOrbProbe, meshStats, settled };
