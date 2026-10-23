const { readMesh } = require('./squishy-mesh.cjs');
async function installStyleProbe(page, style) {
  const mesh = readMesh(`.${style.modelUrl}`);
  await page.addInitScript(({ rest, restNormals, drawCount }) => {
    const p = window.styleProbe = { rest, restNormals, positions: null, normals: null, contexts: [], uploads: 0, draws: 0, matrices: [], intervals: [] };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const gl = original.call(this, type, ...args);
      if (type !== 'webgl2' || !gl || p.contexts.includes(gl)) return gl;
      p.contexts.push(gl);
      let positionBuffer, normalBuffer, lastDraw;
      // Observe bindings at their source instead of synchronously querying the
      // GPU process during every draw and dynamic buffer upload.
      let currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      let arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      let drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      let readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      const names = new Map(), matrices = new Map();
      for (const method of ['useProgram', 'bindBuffer', 'bindFramebuffer', 'bufferData', 'bufferSubData', 'getUniformLocation', 'uniformMatrix4fv', 'drawElements']) {
        const native = gl[method].bind(gl);
        gl[method] = function(...a) {
          const result = native(...a);
          if (method === 'useProgram') currentProgram = a[0];
          if (method === 'bindBuffer' && a[0] === gl.ARRAY_BUFFER) arrayBuffer = a[1];
          if (method === 'bindFramebuffer') {
            if (a[0] === gl.FRAMEBUFFER || a[0] === gl.DRAW_FRAMEBUFFER) drawFramebuffer = a[1];
            if (a[0] === gl.FRAMEBUFFER || a[0] === gl.READ_FRAMEBUFFER) readFramebuffer = a[1];
          }
          if (method === 'getUniformLocation' && result) names.set(result, a[1]);
          if (method === 'uniformMatrix4fv' && names.get(a[0]) === 'modelViewMatrix') matrices.set(currentProgram, Array.from(a[2]));
          if (method === 'bufferData' && a[0] === gl.ARRAY_BUFFER && a[1]?.length === rest.length && rest.every((v, i) => Math.abs(a[1][i] - v) < 1e-6)) {
            positionBuffer = arrayBuffer; p.positions = Array.from(a[1]); p.uploads++;
          }
          if (method === 'bufferData' && a[0] === gl.ARRAY_BUFFER && a[1]?.length === restNormals.length && restNormals.every((v, i) => Math.abs(a[1][i] - v) < 1e-6)) {
            normalBuffer = arrayBuffer; p.normals = Array.from(a[1]);
          }
          if (method === 'bufferSubData' && positionBuffer && a[0] === gl.ARRAY_BUFFER && arrayBuffer === positionBuffer) {
            const data = a[2], offset = a[3] || 0, length = a[4] || data.length - offset;
            for (let i = 0; i < length; i++) p.positions[a[1] / 4 + i] = data[offset + i];
            p.uploads++;
          }
          if (method === 'bufferSubData' && normalBuffer && a[0] === gl.ARRAY_BUFFER && arrayBuffer === normalBuffer) {
            const data = a[2], offset = a[3] || 0, length = a[4] || data.length - offset;
            for (let i = 0; i < length; i++) p.normals[a[1] / 4 + i] = data[offset + i];
          }
          if (method === 'drawElements' && a[1] === drawCount) {
            p.matrix = matrices.get(currentProgram)?.slice();
            const now = performance.now(); if (lastDraw && now - lastDraw < 250) p.intervals.push(now - lastDraw); lastDraw = now;
            p.draws++; p.matrices.push(p.matrix); if (p.matrices.length > 20) p.matrices.shift();
            if (p.readPixelsNext && !drawFramebuffer && !readFramebuffer) {
              p.readPixelsNext = false;
              const rgba = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
              gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
              const luminance = [], rgb = [0, 0, 0]; let black = 0;
              // Transparent background and translucent contact shadow are excluded.
              for (let i = 0; i < rgba.length; i += 16) if (rgba[i + 3] >= 254) {
                luminance.push(.2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2]);
                for (let k = 0; k < 3; k++) rgb[k] += rgba[i + k];
                if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) < 24) black++;
              }
              luminance.sort((a, b) => a - b);
              p.surfaceLight = { count: luminance.length, p05: luminance[Math.floor(luminance.length * .05)] || 0, median: luminance[Math.floor(luminance.length * .5)] || 0, blackFraction: black / (luminance.length || 1), meanRGB: rgb.map(v => v / (luminance.length || 1)) };
            }
          }
          return result;
        };
      }
      return gl;
    };
  }, { rest: mesh.positions, restNormals: mesh.normals, drawCount: mesh.indices.length });
  return mesh;
}
async function stats(page) {
  return page.evaluate(() => {
    const p = window.styleProbe; let maximum = 0, changed = 0; const center = [0, 0, 0]; let total = 0;
    for (let i = 0; i < p.rest.length; i += 3) {
      const d = Math.hypot(...[0, 1, 2].map(k => p.positions[i + k] - p.rest[i + k]));
      maximum = Math.max(maximum, d);
      if (d > 1e-5) { changed++; total += d; for (let k = 0; k < 3; k++) center[k] += d * p.rest[i + k]; }
    }
    return { maximum, changed, center: center.map(n => n / (total || 1)), uploads: p.uploads, vertices: p.rest.length / 3, finite: p.positions.every(Number.isFinite) };
  });
}
async function ready(page) {
  await page.waitForSelector('.toy-stage[data-state=ready] .toy-mount canvas');
  await page.waitForFunction(() => window.styleProbe?.positions && window.styleProbe.draws);
}
async function point(page, x, y) {
  const b = await page.locator('.orb-input').boundingBox(); return { x: b.x + b.width * x, y: b.y + b.height * y };
}
async function settle(page) {
  await page.waitForFunction(() => document.querySelector('.orb-input')?.getAttribute('aria-pressed') === 'false');
  await page.evaluate(() => window.styleStable = { uploads: window.styleProbe.uploads, since: performance.now() });
  await page.waitForFunction(() => {
    const p = window.styleProbe, s = window.styleStable;
    if (s.uploads !== p.uploads) { s.uploads = p.uploads; s.since = performance.now(); }
    return performance.now() - s.since > 200;
  });
}
async function surfaceLight(page, theme) {
  await page.evaluate(theme => { window.styleProbe.surfaceLight = null; window.styleProbe.readPixelsNext = true; document.documentElement.dataset.theme = theme; }, theme);
  await page.waitForFunction(() => window.styleProbe.surfaceLight);
  return page.evaluate(() => window.styleProbe.surfaceLight);
}
async function rotate(page, dx, dy) {
  const b = await page.locator('.toy-stage').boundingBox();
  await page.mouse.move(b.x + 12, b.y + 45); await page.mouse.down();
  await page.mouse.move(b.x + 12 + dx, b.y + 45 + dy, { steps: 20 }); await page.mouse.up(); await page.waitForTimeout(200);
}
const contactFor = id => [id === 'donut' ? .76 : .5, id === 'paw' ? .68 : .42];
module.exports = { installStyleProbe, stats, ready, point, settle, surfaceLight, rotate, contactFor };
