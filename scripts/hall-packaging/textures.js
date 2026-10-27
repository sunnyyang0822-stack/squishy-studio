// Procedural, project-authored print and surface textures for the hall packaging.
// Nothing here is traced from the reference photo; every mark is drawn in code.
import * as THREE from 'three';

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  return [element, element.getContext('2d')];
}

function texture(element, { color = true, repeat = false } = {}) {
  const map = new THREE.CanvasTexture(element);
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = 8;
  if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;
  return map;
}

export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

// Converts a height field in [0, 1] into a tangent-space normal map.
function heightToNormal(height, width, rows, strength) {
  const [element, context] = canvas(width, rows);
  const image = context.createImageData(width, rows);
  const at = (x, y) => height[((y + rows) % rows) * width + ((x + width) % width)];
  for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const length = Math.hypot(dx, dy, 1), index = (y * width + x) * 4;
    image.data[index] = (-dx / length * .5 + .5) * 255;
    image.data[index + 1] = (dy / length * .5 + .5) * 255;
    image.data[index + 2] = (1 / length * .5 + .5) * 255;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return texture(element, { color: false });
}

// Heat-pressed seal: fine horizontal ridges across the whole band, with a
// smooth unpressed rim so it reads as fused film rather than a printed frame.
export function sealNormal(aspect) {
  const width = 1024, rows = Math.max(32, Math.round(width / aspect));
  const height = new Float32Array(width * rows);
  for (let y = 0; y < rows; y++) {
    const v = y / rows, rim = Math.min(1, Math.min(v, 1 - v) * 9);
    for (let x = 0; x < width; x++) {
      const ridge = .5 + .5 * Math.sin(y * Math.PI * 2 / 3.2);
      const dimple = .5 + .5 * Math.sin(x * Math.PI * 2 / 5.5) * Math.sin(y * Math.PI * 2 / 6.4);
      height[y * width + x] = rim * (ridge * .75 + dimple * .25);
    }
  }
  return heightToNormal(height, width, rows, 1.6);
}

// Low-contrast roughness variation (handling scuffs) for the film. Green channel
// drives roughness in three.js; values stay glossy (0.03–0.11).
export function filmRoughness(seed) {
  const size = 512, [element, context] = canvas(size, size), random = rng(seed);
  context.fillStyle = 'rgb(0,18,0)'; context.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const x = random() * size, y = random() * size, length = 20 + random() * 90, angle = random() * Math.PI;
    context.strokeStyle = `rgba(0,${28 + random() * 26},0,${.25 + random() * .35})`;
    context.lineWidth = .6 + random() * 1.4;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); context.stroke();
  }
  return texture(element, { color: false });
}

// Seal print. Patterns share one line weight and opacity so no bag looks louder.
export function sealPrint(pattern, ink, aspect, { hole = null } = {}) {
  const width = 1024, rows = Math.max(48, Math.round(width / aspect));
  const [element, context] = canvas(width, rows);
  context.clearRect(0, 0, width, rows);
  const band = [rows * .26, rows * .74];
  context.fillStyle = ink; context.strokeStyle = ink;
  context.globalAlpha = .46;
  const fine = pattern.endsWith('-fine');
  const kind = pattern.replace('-fine', '');
  if (kind === 'horizontal') {
    const count = fine ? 5 : 3, weight = fine ? 1.6 : 2.6;
    for (let i = 0; i < count; i++) {
      const y = band[0] + (band[1] - band[0]) * (i + .5) / count;
      context.fillRect(0, y - weight / 2, width, weight);
    }
  } else if (kind === 'vertical') {
    const step = fine ? 11 : 19, weight = fine ? 2 : 4;
    for (let x = step / 2; x < width; x += step) context.fillRect(x - weight / 2, band[0], weight, band[1] - band[0]);
  } else if (kind === 'check') {
    const step = fine ? 12 : 20, weight = step / 2;
    context.globalAlpha = .24;
    for (let x = 0; x < width; x += step) context.fillRect(x, band[0], weight, band[1] - band[0]);
    for (let y = band[0]; y < band[1]; y += step) context.fillRect(0, y, width, Math.min(weight, band[1] - y));
  }
  context.globalAlpha = 1;
  if (hole) {
    // Leave the printed area around the hang hole unprinted.
    context.globalCompositeOperation = 'destination-out';
    context.beginPath(); context.arc(hole.u * width, hole.v * rows, hole.r * width * 2.4, 0, Math.PI * 2); context.fill();
    context.globalCompositeOperation = 'source-over';
  }
  return texture(element);
}

// Alpha map with a punched hang hole; white = solid film.
export function sealAlpha(aspect, hole) {
  const width = 1024, rows = Math.max(48, Math.round(width / aspect));
  const [element, context] = canvas(width, rows);
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, rows);
  if (hole) {
    context.fillStyle = '#000';
    context.beginPath(); context.ellipse(hole.u * width, hole.v * rows, hole.r * width, hole.r * width, 0, 0, Math.PI * 2); context.fill();
  }
  return texture(element, { color: false });
}

function starPath(context, cx, cy, outer, inner, points, round = 0) {
  context.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 ? inner : outer, angle = -Math.PI / 2 + i * Math.PI / points;
    const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
    i ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.closePath();
  if (round) { context.lineJoin = 'round'; }
}

const stickerShapes = {
  heart(context) {
    context.beginPath();
    context.moveTo(64, 100);
    context.bezierCurveTo(22, 74, 16, 44, 38, 34); context.bezierCurveTo(52, 28, 62, 38, 64, 46);
    context.bezierCurveTo(66, 38, 76, 28, 90, 34); context.bezierCurveTo(112, 44, 106, 74, 64, 100);
    context.closePath();
  },
  star(context) { starPath(context, 64, 68, 44, 20, 5, 1); },
  sparkle(context) {
    context.beginPath();
    context.moveTo(64, 14); context.quadraticCurveTo(70, 58, 114, 64); context.quadraticCurveTo(70, 70, 64, 114);
    context.quadraticCurveTo(58, 70, 14, 64); context.quadraticCurveTo(58, 58, 64, 14); context.closePath();
  },
  dot(context) { context.beginPath(); context.arc(64, 64, 38, 0, Math.PI * 2); },
  drop(context) {
    context.beginPath(); context.moveTo(64, 16);
    context.bezierCurveTo(78, 44, 98, 60, 98, 80); context.arc(64, 80, 34, 0, Math.PI); context.bezierCurveTo(30, 60, 50, 44, 64, 16);
    context.closePath();
  },
  leaf(context) {
    context.beginPath(); context.moveTo(24, 100);
    context.bezierCurveTo(24, 46, 60, 22, 106, 22); context.bezierCurveTo(106, 70, 80, 104, 24, 100); context.closePath();
  },
  sprinkle(context) {
    context.beginPath();
    for (const [x, y, angle] of [[40, 46, .6], [80, 40, -.5], [62, 84, .2]]) {
      const dx = Math.cos(angle) * 16, dy = Math.sin(angle) * 16;
      context.moveTo(x - dx, y - dy); context.lineTo(x + dx, y + dy);
    }
  },
};

// Small die-cut vinyl sticker: white cut margin plus a muted printed motif.
export function sticker(kind, ink, paper) {
  const [element, context] = canvas(128, 128);
  const shape = stickerShapes[kind] || stickerShapes.dot;
  context.lineJoin = 'round'; context.lineCap = 'round';
  shape(context);
  context.strokeStyle = '#fbfaf7'; context.lineWidth = kind === 'sprinkle' ? 30 : 16; context.stroke();
  if (kind !== 'sprinkle') { context.fillStyle = '#fbfaf7'; context.fill(); }
  shape(context);
  if (kind === 'sprinkle') { context.strokeStyle = ink; context.lineWidth = 12; context.stroke(); }
  else { context.fillStyle = ink; context.fill(); }
  if (kind === 'dot' || kind === 'heart') {
    context.fillStyle = paper; context.globalAlpha = .55;
    context.beginPath(); context.ellipse(52, 52, 9, 6, -.6, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1;
  }
  if (kind === 'leaf') { context.strokeStyle = paper; context.lineWidth = 3; context.beginPath(); context.moveTo(32, 92); context.quadraticCurveTo(66, 60, 98, 30); context.stroke(); }
  return texture(element);
}

// Printed insert of the PVC tag. The style name is supplied by real page text,
// so the print only carries a quiet accent rule and a blank writing field.
export function tagPrint(ink, aspect) {
  const width = 512, rows = Math.round(width / aspect);
  const [element, context] = canvas(width, rows);
  const radius = rows * .16;
  context.fillStyle = '#f7f3ec';
  context.beginPath(); context.roundRect(0, 0, width, rows, radius); context.fill();
  context.fillStyle = ink; context.globalAlpha = .9;
  context.beginPath(); context.roundRect(width * .05, rows * .2, width * .022, rows * .6, width * .011); context.fill();
  context.globalAlpha = .35;
  context.fillRect(width * .12, rows * .78, width * .76, 2);
  context.globalAlpha = 1;
  return texture(element);
}
