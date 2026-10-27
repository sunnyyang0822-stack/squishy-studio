// Hall packaging studio: builds one packaged squishy from the shared spec and
// path-traces it into a truly transparent image. Runs in a browser page that the
// build script drives (scripts/build-hall-packaging.cjs). Editable source of the
// hall packaging assets; nothing here ships in the site bundle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { rng, sealNormal, filmRoughness, sealPrint, sealAlpha, sticker, tagPrint } from './textures.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- colour ----------
function srgbToLinear(c) { return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }
function linearToSrgb(c) { return c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055; }
function hexToLinear(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255].map(v => srgbToLinear(v / 255)); }
function linearToHex(rgb) { return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, '0')).join(''); }
function toOklab([r, g, b]) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}
// Every bag derives its print ink at the same lightness and capped chroma, so
// patterns differ in hue only and none reads louder than the others.
export function inkFor(hex, lightness = .7, chromaCap = .075) {
  const [L, a, b] = toOklab(hexToLinear(hex)); const chroma = Math.hypot(a, b), hue = Math.atan2(b, a);
  const c = Math.min(chromaCap, Math.max(.03, chroma * 1.25));
  return linearToHex(fromOklab([lightness, Math.cos(hue) * c, Math.sin(hue) * c]));
}

// Khronos PBR Neutral tone mapping (matches the site's daylight renderer).
function neutral(color, exposure) {
  let [r, g, b] = color.map(v => v * exposure);
  const startCompression = .8 - .04, desaturation = .15;
  const x = Math.min(r, g, b), offset = x < .08 ? x - 6.25 * x * x : .04;
  r -= offset; g -= offset; b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < startCompression) return [r, g, b];
  const d = 1 - startCompression, newPeak = 1 - d * d / (peak + d - startCompression);
  r *= newPeak / peak; g *= newPeak / peak; b *= newPeak / peak;
  const gmix = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [r * (1 - gmix) + newPeak * gmix, g * (1 - gmix) + newPeak * gmix, b * (1 - gmix) + newPeak * gmix];
}

// ---------- studio lighting (environment only, never visible as background) ----------
function studioEnvironment() {
  const width = 1024, height = 512, data = new Float32Array(width * height * 4);
  const boxes = [
    // azimuth/elevation in degrees; +90° azimuth faces the camera.
    { az: [112, 121], el: [-4, 58], power: 11, feather: 2.5 },   // long key strip, front-left
    { az: [56, 60], el: [6, 42], power: 6, feather: 1.5 },       // narrow kicker, front-right
    { az: [62, 118], el: [58, 86], power: 2.6, feather: 6 },     // overhead soft panel
    { az: [-120, -60], el: [18, 48], power: 1.6, feather: 8 },   // rim from behind
  ];
  for (let y = 0; y < height; y++) {
    const el = ((y + .5) / height - .5) * 180;
    const sky = el > 0 ? .5 + .12 * Math.sin(el * Math.PI / 180) : .3 + .2 * (1 + el / 90);
    for (let x = 0; x < width; x++) {
      const az = ((x + .5) / width - .5) * 360;
      let value = sky;
      for (const box of boxes) {
        const inAz = smoothstep(box.az[0] - box.feather, box.az[0] + box.feather, az) * (1 - smoothstep(box.az[1] - box.feather, box.az[1] + box.feather, az));
        const inEl = smoothstep(box.el[0] - box.feather, box.el[0] + box.feather, el) * (1 - smoothstep(box.el[1] - box.feather, box.el[1] + box.feather, el));
        value += box.power * inAz * inEl;
      }
      const i = (y * width + x) * 4;
      data[i] = value * 1.0; data[i + 1] = value * .985; data[i + 2] = value * .965; data[i + 3] = 1;
    }
  }
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

// ---------- geometry helpers ----------
const loader = new GLTFLoader();
const modelCache = new Map();
async function loadToyGeometry(id) {
  if (!modelCache.has(id)) {
    modelCache.set(id, loader.loadAsync(`/assets/models/squishy-${id}.glb`).then(gltf => {
      let found; gltf.scene.traverse(node => { if (node.isMesh && !found) found = node; });
      found.updateWorldMatrix(true, false);
      const geometry = found.geometry.clone(); geometry.applyMatrix4(found.matrixWorld);
      return geometry;
    }));
  }
  return (await modelCache.get(id)).clone();
}

function gridSampler(grid) {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  return (x, y) => {
    const fx = (x - x0) / dx, fy = (y - y0) / dy;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), u = fx - i, v = fy - j;
    const at = (a, b) => z[b * nx + a];
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

function gridGeometry(grid, zOf) {
  const { nx, ny, x0, y0, dx, dy } = grid;
  const positions = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2), index = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    positions.set([x0 + i * dx, y0 + j * dy, zOf(k)], k * 3);
    uvs.set([i / (nx - 1), j / (ny - 1)], k * 2);
    if (i < nx - 1 && j < ny - 1) { const a = k, b = k + 1, c = k + nx, d = k + nx + 1; index.push(a, b, d, a, d, c); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

// ---------- the package ----------
export async function buildPackage(spec, id) {
  const style = spec.styles[id], bag = spec.bag, random = rng(style.seed);
  const toyHex = spec.palette[style.color], ink = inkFor(toyHex);
  const group = new THREE.Group();
  const W = bag.width, halfW = W / 2, bodyTop = bag.bodyTop, bodyBottom = bag.bodyBottom;
  const sealTop = bodyTop + bag.topSeal, sealBottom = bodyBottom - bag.bottomSeal;
  const edgeZ = .006;

  // Toy: confirmed GLB, shared scale rule (longest silhouette side = toyFill × bag width).
  const geometry = await loadToyGeometry(id);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...style.rotation)));
  geometry.computeBoundingBox();
  let box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
  const scale = bag.toyFill * W / Math.max(size.x, size.y);
  geometry.scale(scale, scale, scale); geometry.computeBoundingBox(); box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, bag.toyCenterY - center.y, .004 - box.min.z);
  geometry.computeBoundingBox(); geometry.computeVertexNormals();
  const toyMaterial = new THREE.MeshPhysicalMaterial({ color: toyHex, roughness: 1, metalness: 0, specularIntensity: .25, sheen: .35, sheenRoughness: 1, sheenColor: 0xffffff });
  const toy = new THREE.Mesh(geometry, toyMaterial); toy.name = 'toy';
  group.add(toy);
  const bvh = new MeshBVH(geometry);

  // Height field of the toy seen from the front.
  const [nx, ny] = bag.grid;
  const grid = { nx, ny, x0: -halfW, y0: bodyBottom, dx: W / (nx - 1), dy: (bodyTop - bodyBottom) / (ny - 1) };
  const count = nx * ny, toyTop = new Float32Array(count).fill(-1);
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  let toyCells = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    ray.origin.set(grid.x0 + i * grid.dx, grid.y0 + j * grid.dy, 10);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (hit) { toyTop[j * nx + i] = hit.point.z; toyCells++; }
  }

  // Limited adhesion: at most two small contact patches on the crown.
  const patches = [];
  const order = [...toyTop.keys()].filter(k => toyTop[k] > 0).sort((a, b) => toyTop[b] - toyTop[a]);
  const patchRadius = Math.sqrt(bag.maxContactShare * toyCells * grid.dx * grid.dy / (2 * Math.PI)) * .85;
  for (const k of order) {
    const p = [grid.x0 + (k % nx) * grid.dx, grid.y0 + Math.floor(k / nx) * grid.dy];
    if (patches.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) > patchRadius * 3)) patches.push(p);
    if (patches.length === 2) break;
  }

  // Front film: projected SOR on a membrane under slight gravity, resting on
  // the toy (with an air gap) and the back film, pinned at the bag edges.
  const lower = new Float32Array(count), upper = new Float32Array(count).fill(Infinity), film = new Float32Array(count);
  let contactCells = 0;
  for (let k = 0; k < count; k++) {
    const x = grid.x0 + (k % nx) * grid.dx, y = grid.y0 + Math.floor(k / nx) * grid.dy;
    lower[k] = edgeZ;
    if (toyTop[k] > 0) {
      const near = Math.min(...patches.map(q => Math.hypot(x - q[0], y - q[1]) / patchRadius));
      const gap = near < 1 ? bag.contactGap : bag.airGap;
      lower[k] = Math.max(lower[k], toyTop[k] + gap);
      if (near < 1) { upper[k] = toyTop[k] + bag.contactGap * 2; contactCells++; }
    }
    film[k] = lower[k];
  }
  const boundary = k => { const i = k % nx, j = Math.floor(k / nx); return i === 0 || j === 0 || i === nx - 1 || j === ny - 1; };
  for (let iteration = 0; iteration < 1100; iteration++) {
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const target = (film[k - 1] + film[k + 1] + film[k - nx] + film[k + nx]) / 4 - bag.sag;
      film[k] = Math.min(upper[k], Math.max(lower[k], film[k] + 1.85 * (target - film[k])));
    }
  }
  for (let k = 0; k < count; k++) if (boundary(k)) film[k] = edgeZ;

  // Wrinkles: compression folds radiating from the toy toward corners and
  // seals, only in slack film, faded at the pinned edges and contact patches.
  const toyBox = geometry.boundingBox;
  const centroid = [0, bag.toyCenterY];
  const wrinkleDisplacement = new Float32Array(count);
  const corners = [[-halfW, bodyTop], [halfW, bodyTop], [-halfW, bodyBottom], [halfW, bodyBottom]];
  for (let w = 0; w < bag.wrinkles; w++) {
    const target = w < 4 ? corners[w] : [(random() - .5) * W, random() < .5 ? bodyTop : bodyBottom];
    let angle = Math.atan2(target[1] - centroid[1], target[0] - centroid[0]) + (random() - .5) * .35;
    const reach = Math.max(toyBox.max.x - centroid[0], toyBox.max.y - centroid[1]) * (.75 + random() * .25);
    const start = [centroid[0] + Math.cos(angle) * reach, centroid[1] + Math.sin(angle) * reach];
    const length = .35 + random() * .55;
    const end = [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length];
    const amplitude = .03 + random() * .035, width = .07 + random() * .09;
    const sx = end[0] - start[0], sy = end[1] - start[1], ll = sx * sx + sy * sy;
    for (let k = 0; k < count; k++) {
      const x = grid.x0 + (k % nx) * grid.dx, y = grid.y0 + Math.floor(k / nx) * grid.dy;
      const t = Math.min(1, Math.max(0, ((x - start[0]) * sx + (y - start[1]) * sy) / ll));
      const d = Math.hypot(x - (start[0] + sx * t), y - (start[1] + sy * t));
      if (d > width * 3) continue;
      const along = Math.sin(Math.PI * t) ** .8;
      wrinkleDisplacement[k] += amplitude * along * (Math.exp(-((d / width) ** 2)) - .4 * Math.exp(-(((d - 1.7 * width) / (.7 * width)) ** 2)));
    }
  }
  // Short pinch creases where the puffed film is gathered into the side seams.
  for (let c = 0; c < 10; c++) {
    const side = c % 2 ? 1 : -1, y = bodyBottom + .25 + random() * (bodyTop - bodyBottom - .5);
    const length = .16 + random() * .28, angle = (side > 0 ? Math.PI : 0) + (random() - .5) * .7;
    const start = [side * halfW, y], end = [start[0] + Math.cos(angle) * length, y + Math.sin(angle) * length];
    const amplitude = .012 + random() * .016, width = .022 + random() * .025;
    const sx = end[0] - start[0], sy = end[1] - start[1], ll = sx * sx + sy * sy;
    for (let k = 0; k < count; k++) {
      const x = grid.x0 + (k % nx) * grid.dx, yy = grid.y0 + Math.floor(k / nx) * grid.dy;
      const t = Math.min(1, Math.max(0, ((x - start[0]) * sx + (yy - start[1]) * sy) / ll));
      const d = Math.hypot(x - (start[0] + sx * t), yy - (start[1] + sy * t));
      if (d < width * 3) wrinkleDisplacement[k] += amplitude * (1 - t) ** 1.5 * Math.exp(-((d / width) ** 2));
    }
  }
  const ripple = Array.from({ length: 3 }, () => ({ a: random() * Math.PI, f: 5 + random() * 5, p: random() * 6.28 }));
  for (let k = 0; k < count; k++) {
    if (boundary(k)) continue;
    const x = grid.x0 + (k % nx) * grid.dx, y = grid.y0 + Math.floor(k / nx) * grid.dy;
    const edge = Math.min(x + halfW, halfW - x, y - bodyBottom, bodyTop - y);
    const slack = toyTop[k] > 0 ? (upper[k] < Infinity ? 0 : .25) : 1;
    let wave = 0; for (const r of ripple) wave += Math.sin((x * Math.cos(r.a) + y * Math.sin(r.a)) * r.f + r.p) * .0022;
    film[k] = Math.max(lower[k] - (toyTop[k] > 0 ? bag.airGap * .5 : 0), film[k] + (wrinkleDisplacement[k] + wave) * slack * smoothstep(0, .14, edge));
    film[k] = Math.max(film[k], toyTop[k] > 0 ? toyTop[k] + bag.contactGap : edgeZ * .5);
  }
  const filmAt = gridSampler({ ...grid, z: film });

  // Back film: flat with faint undulation, toy rests on it.
  const back = new Float32Array(count);
  for (let k = 0; k < count; k++) { const x = grid.x0 + (k % nx) * grid.dx, y = grid.y0 + Math.floor(k / nx) * grid.dy; back[k] = boundary(k) ? 0 : -.004 * Math.sin(x * 3.1 + 1.3) * Math.sin(y * 2.3); }

  const filmMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 1, roughnessMap: filmRoughness(style.seed), transmission: 1, ior: 1.54, thickness: 0, specularIntensity: 1, side: THREE.DoubleSide });
  const front = new THREE.Mesh(gridGeometry(grid, k => film[k]), filmMaterial); front.name = 'film-front';
  const rear = new THREE.Mesh(gridGeometry(grid, k => back[k]), filmMaterial); rear.name = 'film-back';
  group.add(front, rear);

  // Zipper track below the top seal: two clear ridges across the width.
  const zipperMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .12, transmission: 1, ior: 1.5, thickness: .02 });
  for (const offset of [0, .034]) {
    const y = bodyTop - bag.zipperDrop - offset;
    const zipper = new THREE.Mesh(new THREE.CapsuleGeometry(.011, W - .03, 4, 10), zipperMaterial);
    zipper.rotation.z = Math.PI / 2; zipper.position.set(0, y, (filmAt(0, y) ?? edgeZ) + .002); zipper.name = 'zipper';
    // follow the film height across the width
    const p = zipper.geometry.attributes.position;
    for (let v = 0; v < p.count; v++) { const along = p.getY(v); const z = filmAt(-along, y) ?? edgeZ; p.setZ(v, p.getZ(v) + z - zipper.position.z + .002); }
    p.needsUpdate = true; zipper.geometry.computeVertexNormals();
    group.add(zipper);
  }

  // Heat seals: fused clear film with pressed ridges, quiet print, hang hole.
  const holeY = bodyTop + bag.topSeal * .55;
  const holeUV = { u: (bag.hole.x + halfW) / W, v: (sealTop - holeY) / bag.topSeal, r: bag.hole.radius / W };
  for (const [name, y0, y1, pattern, hole] of [['seal-top', bodyTop, sealTop, style.seal.top, holeUV], ['seal-bottom', sealBottom, bodyBottom, style.seal.bottom, null]]) {
    const height = y1 - y0, aspect = W / height;
    const normalMap = sealNormal(aspect);
    const sealMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .2, transmission: 1, ior: 1.54, thickness: 0, normalMap, normalScale: new THREE.Vector2(.55, .55), side: THREE.DoubleSide, alphaMap: hole ? sealAlpha(aspect, hole) : null, alphaTest: hole ? .5 : 0, transparent: !!hole });
    const plane = new THREE.PlaneGeometry(W, height);
    for (const [z, layer] of [[edgeZ + .001, 'front'], [-.001, 'back']]) {
      const seal = new THREE.Mesh(plane, sealMaterial); seal.position.set(0, (y0 + y1) / 2, z); seal.name = `${name}-${layer}`; group.add(seal);
    }
    const print = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: sealPrint(pattern, ink, aspect, { hole }), transparent: true, alphaTest: .02, roughness: .5, side: THREE.DoubleSide }));
    print.position.set(0, (y0 + y1) / 2, edgeZ + .0022); print.name = `${name}-print`; group.add(print);
  }

  // PVC name tag lying on the upper-right corner of the bag.
  const tagSpec = spec.tag, tagW = tagSpec.width, tagH = tagSpec.height;
  const shape = new THREE.Shape(); const r = tagSpec.radius;
  shape.moveTo(-tagW / 2 + r, -tagH / 2); shape.lineTo(tagW / 2 - r, -tagH / 2); shape.quadraticCurveTo(tagW / 2, -tagH / 2, tagW / 2, -tagH / 2 + r);
  shape.lineTo(tagW / 2, tagH / 2 - r); shape.quadraticCurveTo(tagW / 2, tagH / 2, tagW / 2 - r, tagH / 2); shape.lineTo(-tagW / 2 + r, tagH / 2);
  shape.quadraticCurveTo(-tagW / 2, tagH / 2, -tagW / 2, tagH / 2 - r); shape.lineTo(-tagW / 2, -tagH / 2 + r); shape.quadraticCurveTo(-tagW / 2, -tagH / 2, -tagW / 2 + r, -tagH / 2);
  const tagHoleLocal = [-tagW / 2 + .13, tagH / 2 - .13];
  const tagHole = new THREE.Path(); tagHole.absarc(tagHoleLocal[0], tagHoleLocal[1], .045, 0, Math.PI * 2, true); shape.holes.push(tagHole);
  const tagGeometry = new THREE.ExtrudeGeometry(shape, { depth: tagSpec.thickness, bevelEnabled: true, bevelThickness: .006, bevelSize: .006, bevelSegments: 3, curveSegments: 18 });
  const tag = new THREE.Group(); tag.name = 'tag';
  const tagBody = new THREE.Mesh(tagGeometry, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .06, transmission: 1, ior: 1.54, thickness: tagSpec.thickness }));
  tagBody.position.z = -tagSpec.thickness / 2; tag.add(tagBody);
  const inset = tagSpec.printInset, printW = tagW - inset * 2 - .16, printH = tagH - inset * 2;
  const printPlane = new THREE.Mesh(new THREE.PlaneGeometry(printW, printH), new THREE.MeshStandardMaterial({ map: tagPrint(ink, printW / printH), transparent: true, alphaTest: .5, roughness: .55 }));
  printPlane.position.set(.08, 0, 0); tag.add(printPlane);
  const tagCenter = tagSpec.center;
  const tagRest = Math.max(filmAt(tagCenter[0] - tagW / 4, tagCenter[1]) ?? edgeZ, filmAt(Math.min(halfW - .01, tagCenter[0]), tagCenter[1]) ?? edgeZ);
  tag.position.set(tagCenter[0], tagCenter[1], tagRest + tagSpec.thickness / 2 + .012);
  tag.rotation.set(THREE.MathUtils.degToRad(1.5), THREE.MathUtils.degToRad(-2), THREE.MathUtils.degToRad(tagSpec.tilt));
  group.add(tag);
  tag.updateMatrixWorld(true);
  const tagHoleWorld = new THREE.Vector3(tagHoleLocal[0], tagHoleLocal[1], 0).applyMatrix4(tag.matrixWorld);
  const printCorners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => new THREE.Vector3(.08 + sx * printW / 2, sy * printH / 2, .001).applyMatrix4(tag.matrixWorld));

  // Ball chain: a loose closed loop lying on the bag, through both holes.
  const holeWorld = new THREE.Vector3(bag.hole.x, holeY, edgeZ / 2);
  const mid = holeWorld.clone().lerp(tagHoleWorld, .5);
  const across = new THREE.Vector3(-(tagHoleWorld.y - holeWorld.y), tagHoleWorld.x - holeWorld.x, 0).normalize();
  const loop = new THREE.CatmullRomCurve3([
    holeWorld, mid.clone().addScaledVector(across, .1).add(new THREE.Vector3(.02, .03, 0)), tagHoleWorld,
    mid.clone().addScaledVector(across, -.075).add(new THREE.Vector3(.04, -.02, 0)),
  ], true, 'centripetal');
  const chainSpec = spec.chain, chainLength = loop.getLength(), beads = Math.floor(chainLength / chainSpec.pitch);
  const surfaceZ = point => {
    if (point.distanceTo(holeWorld) < .05) return edgeZ / 2;
    if (point.distanceTo(tagHoleWorld) < .05) return tagHoleWorld.z;
    const local = tag.worldToLocal(point.clone());
    let z = Math.abs(point.x) <= halfW && point.y <= sealTop && point.y >= sealBottom ? (filmAt(point.x, point.y) ?? edgeZ + .003) : 0;
    if (Math.abs(local.x) < tagW / 2 && Math.abs(local.y) < tagH / 2) z = Math.max(z, tag.position.z + tagSpec.thickness / 2);
    return z + chainSpec.beadRadius;
  };
  const metal = new THREE.MeshStandardMaterial({ color: 0xcdc9c2, metalness: 1, roughness: .24 });
  const beadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(chainSpec.beadRadius, 20, 14), metal, beads); beadMesh.name = 'chain-beads';
  const linkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(chainSpec.linkRadius, chainSpec.linkRadius, chainSpec.pitch, 8), metal, beads); linkMesh.name = 'chain-links';
  const points = Array.from({ length: beads }, (_, b) => { const p = loop.getPointAt(b / beads); p.z = surfaceZ(p); return p; });
  const matrix = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), quaternion = new THREE.Quaternion();
  points.forEach((p, b) => {
    beadMesh.setMatrixAt(b, matrix.makeTranslation(p.x, p.y, p.z));
    const q = points[(b + 1) % beads], direction = q.clone().sub(p);
    quaternion.setFromUnitVectors(up, direction.clone().normalize());
    linkMesh.setMatrixAt(b, matrix.compose(p.clone().lerp(q, .5), quaternion, new THREE.Vector3(1, direction.length() / chainSpec.pitch, 1)));
  });
  group.add(beadMesh, linkMesh);

  // Stickers: two or three, small, on slack film away from toy, seals and tag.
  const stickerMeshes = [];
  const placed = [];
  const avoidTag = (x, y) => { const local = tag.worldToLocal(new THREE.Vector3(x, y, tag.position.z)); return Math.abs(local.x) < tagW / 2 + .2 && Math.abs(local.y) < tagH / 2 + .2; };
  const toyNear = (x, y) => { for (const [ox, oy] of [[0, 0], [.14, 0], [-.14, 0], [0, .14], [0, -.14]]) { const k = Math.round((y + oy - grid.y0) / grid.dy) * nx + Math.round((x + ox - grid.x0) / grid.dx); if (toyTop[k] > 0) return true; } return false; };
  for (const [s, kind] of style.stickers.slice(0, spec.stickers.max).entries()) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = (random() - .5) * (W - .5), y = bodyBottom + .28 + random() * (bodyTop - bodyBottom - .7);
      if (toyNear(x, y) || avoidTag(x, y) || placed.some(p => Math.hypot(p[0] - x, p[1] - y) < .75)) continue;
      const sizeRange = spec.stickers.size, edge = sizeRange[0] + random() * (sizeRange[1] - sizeRange[0]);
      const plane = new THREE.PlaneGeometry(edge, edge, 6, 6), angle = (random() - .5) * .9;
      plane.rotateZ(angle); plane.translate(x, y, 0);
      const p = plane.attributes.position;
      for (let v = 0; v < p.count; v++) p.setZ(v, (filmAt(p.getX(v), p.getY(v)) ?? edgeZ) + .0014);
      plane.computeVertexNormals();
      const mesh = new THREE.Mesh(plane, new THREE.MeshPhysicalMaterial({ map: sticker(kind, s % 2 ? inkFor(toyHex, .78, .05) : ink, '#fbfaf7'), transparent: true, alphaTest: .5, roughness: .3, clearcoat: .4, clearcoatRoughness: .2 }));
      mesh.name = `sticker-${kind}`; group.add(mesh); stickerMeshes.push(mesh); placed.push([x, y, edge]);
      break;
    }
  }

  const contactShare = contactCells / Math.max(1, toyCells);
  return {
    group, ink, toyHex,
    anchors: { printCorners, bagCorners: [[-halfW, sealTop], [halfW, sealTop], [halfW, sealBottom], [-halfW, sealBottom]].map(([x, y]) => new THREE.Vector3(x, y, 0)), toyBox: geometry.boundingBox.clone() },
    stats: { contactShare, stickers: placed.length, chainBeads: beads, toyScale: scale, triangles: 0 },
  };
}

// ---------- rendering ----------
let renderer, pathTracer, environment;
function ensureRenderer(width, height, tiles = 3) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    pathTracer = new WebGLPathTracer(renderer);
    pathTracer.renderToCanvas = false; pathTracer.renderDelay = 0; pathTracer.minSamples = 0; pathTracer.fadeDuration = 0;
    pathTracer.multipleImportanceSampling = true; pathTracer.stableNoise = true; pathTracer.filterGlossyFactor = .2;
    environment = studioEnvironment();
  }
  renderer.setSize(width, height, false);
  pathTracer.tiles.set(tiles, tiles);
}

function makeCamera(spec, view = {}) {
  const r = spec.render, frame = view.frame || spec.frame;
  const aspect = (view.width || r.width) / (view.height || r.height);
  const camera = new THREE.PerspectiveCamera(view.fov || r.fov, aspect, .1, 200);
  const center = new THREE.Vector3((frame.left + frame.right) / 2, (frame.bottom + frame.top) / 2, .2);
  const halfH = (frame.top - frame.bottom) / 2, halfW = (frame.right - frame.left) / 2;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const distance = Math.max(halfH / tan, halfW / (tan * aspect)) + .6;
  const tilt = THREE.MathUtils.degToRad(view.tilt ?? r.tiltDegrees), yaw = THREE.MathUtils.degToRad(view.yaw || 0);
  camera.position.set(center.x + Math.sin(yaw) * Math.cos(tilt) * distance, center.y + Math.sin(tilt) * distance, center.z + Math.cos(yaw) * Math.cos(tilt) * distance);
  camera.lookAt(center); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  return camera;
}

async function trace(scene, camera, samples, fresh) {
  // Only the first pass uploads geometry; the matte pass swaps the background.
  if (fresh) pathTracer.setScene(scene, camera); else { pathTracer.updateEnvironment(); pathTracer.reset(); }
  while (pathTracer.isCompiling) await new Promise(r => setTimeout(r, 50));
  const gl = renderer.getContext(); let last = -1, stalled = 0;
  while (pathTracer.samples < samples) {
    pathTracer.renderSample();
    if (gl.isContextLost()) throw new Error('WebGL context lost while tracing');
    const done = Math.floor(pathTracer.samples);
    if (done !== last) { stalled = 0; if (done % 8 === 0) console.log(`samples ${done}/${samples} ${(performance.now() / 1000).toFixed(0)}s`); last = done; }
    else if (!stalled) stalled = performance.now();
    else if (performance.now() - stalled > 240000) throw new Error(`path tracer stalled at ${done} samples (compiling: ${pathTracer.isCompiling})`);
    await new Promise(r => requestAnimationFrame(r));
  }
  // Read the accumulated linear radiance directly; RGBA/FLOAT is a valid read
  // for both float and half-float colour buffers in WebGL2.
  const target = pathTracer.target, { width, height } = target;
  const data = new Float32Array(width * height * 4);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, data);
  renderer.setRenderTarget(previous);
  const error = gl.getError();
  if (error) throw new Error(`readPixels failed: ${error} (${target.texture.type})`);
  return data;
}

function project(points, camera, width, height) {
  return points.map(p => { const v = p.clone().project(camera); return [(v.x * .5 + .5) * width, (1 - (v.y * .5 + .5)) * height]; });
}

// Difference matting: identical path samples over black and white backgrounds.
// alpha = 1 − (white − black); colour (premultiplied, linear) = black pass.
async function renderMatted(group, camera, width, height, samples, exposure) {
  const scene = new THREE.Scene(); scene.add(group); scene.environment = environment; scene.environmentIntensity = 1;
  scene.background = new THREE.Color(0, 0, 0);
  pathTracer.reset(); const black = await trace(scene, camera, samples, true);
  scene.background = new THREE.Color(1, 1, 1);
  const white = await trace(scene, camera, samples, false);
  scene.remove(group);
  const image = new ImageData(width, height);
  let hazePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = ((height - 1 - y) * width + x) * 4, target = (y * width + x) * 4;
    const transmission = ((white[source] - black[source]) + (white[source + 1] - black[source + 1]) + (white[source + 2] - black[source + 2])) / 3;
    let alpha = Math.min(1, Math.max(0, 1 - transmission));
    if (alpha < 1 / 255) { image.data[target + 3] = 0; continue; }
    const straight = [black[source] / alpha, black[source + 1] / alpha, black[source + 2] / alpha];
    const mapped = neutral(straight, exposure);
    for (let c = 0; c < 3; c++) image.data[target + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(mapped[c]))) * 255);
    image.data[target + 3] = Math.round(alpha * 255);
    if (alpha > .02 && alpha < .5) hazePixels++;
  }
  return { image, hazePixels };
}

function rasterPreview(group, camera, width, height) {
  const scene = new THREE.Scene(); scene.add(group); scene.environment = new THREE.PMREMGenerator(renderer).fromEquirectangular(environment).texture;
  renderer.setClearColor(0, 0); renderer.render(scene, camera); scene.remove(group);
  const context = document.createElement('canvas').getContext('2d'); context.canvas.width = width; context.canvas.height = height;
  context.drawImage(renderer.domElement, 0, 0); return { image: context.getImageData(0, 0, width, height), hazePixels: 0 };
}

async function encode(image, type, quality) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d').putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type, quality });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

export async function render(spec, id, view = {}) {
  const width = view.width || spec.render.width, height = view.height || spec.render.height;
  ensureRenderer(width, height, view.tiles || spec.render.tiles);
  pathTracer.bounces = spec.render.bounces; pathTracer.transmissiveBounces = spec.render.transmissiveBounces;
  const built = await buildPackage(spec, id);
  const camera = makeCamera(spec, view);
  built.group.updateMatrixWorld(true);
  let triangles = 0; built.group.traverse(node => { if (node.isMesh) { const g = node.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1); } });
  const started = performance.now();
  const { image, hazePixels } = view.preview ? rasterPreview(built.group, camera, width, height) : await renderMatted(built.group, camera, width, height, view.samples || spec.render.samples, spec.render.exposure);
  const seconds = (performance.now() - started) / 1000;
  const meta = {
    id, width, height, ink: built.ink, toyColor: built.toyHex,
    printQuad: project(built.anchors.printCorners, camera, width, height),
    bagQuad: project(built.anchors.bagCorners, camera, width, height),
    stats: { ...built.stats, triangles: Math.round(triangles), seconds: +seconds.toFixed(1), hazePixels, samples: view.preview ? 0 : (view.samples || spec.render.samples) },
  };
  const formats = view.formats || ['png'];
  const files = {};
  for (const scale of view.scales || [1]) {
    let output = image;
    if (scale !== 1) {
      // Resample in premultiplied space so transparent edges do not darken or brighten.
      const bitmap = await createImageBitmap(image, { premultiplyAlpha: 'premultiply' });
      const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale)), context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      output = context.getImageData(0, 0, canvas.width, canvas.height);
    }
    for (const format of formats) files[`${format}@${scale}`] = await encode(output, `image/${format}`, format === 'webp' ? (view.quality ?? .9) : undefined);
  }
  return { meta, files };
}

window.studio = { render, inkFor, gpu: () => { ensureRenderer(8, 8); const gl = renderer.getContext(); const info = gl.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } };
