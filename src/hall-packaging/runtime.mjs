// Hall packaging runtime. One shared WebGL context renders each packaged
// squishy exactly once into its own 2D canvas, then the context is released.
// No animation loop; geometry is pre-baked (scripts/build-hall-packaging.mjs).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import spec from '../../assets-source/hall-packaging/spec.json';
import { layout, gridFor, bagWarp, tagLayout } from './shared.mjs';
import { sealNormal, filmRoughness, sealPrint, sealAlpha, sticker, tagPrint, creaseNormal } from './textures.mjs';

export { spec };

// ---------- colour ----------
const srgbToLinear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const linearToSrgb = c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
function toOklab(hex) {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, n >> 8 & 255, n & 255].map(v => srgbToLinear(v / 255));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, '0')).join('');
}
// All print inks share one lightness and a chroma cap, so no bag reads louder.
export function inkFor(hex, lightness = .66, chromaCap = .085) {
  const [, a, b] = toOklab(hex), chroma = Math.hypot(a, b), hue = Math.atan2(b, a), c = Math.min(chromaCap, Math.max(.03, chroma * 1.25));
  return fromOklab([lightness, Math.cos(hue) * c, Math.sin(hue) * c]);
}

// ---------- studio light (reflections only; never a visible background) ----------
function studioEnvironment() {
  const width = 512, height = 256, data = new Uint16Array(width * height * 4);
  const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Long thin strip lights: folds and puffed slopes catch them as the sharp
  // highlight bands seen on real PVC bags. No broad panels (they read as wet blobs).
  // Soft rectangular light panels (lightformer style): wide feathered edges give
  // the film long, smooth highlight bands instead of hard-edged blocks.
  const boxes = [
    { az: [112, 156], el: [24, 84], power: 6, feather: 5 },     // big window, upper-left: facets facing it go white
    { az: [62, 84], el: [40, 70], power: 2.4, feather: 5 },     // second window pane, upper-right
    { az: [96, 112], el: [-2, 36], power: 1.2, feather: 6 },    // soft key panel, front-left
    { az: [-130, -50], el: [14, 52], power: .8, feather: 12 },  // rim from behind
  ];




  for (let y = 0; y < height; y++) {
    const el = ((y + .5) / height - .5) * 180, sky = el > 0 ? .14 + .06 * Math.sin(el * Math.PI / 180) : .1 + .08 * (1 + el / 90);
    for (let x = 0; x < width; x++) {
      const az = ((x + .5) / width - .5) * 360; let v = sky;
      for (const b of boxes) v += b.power * s(b.az[0] - b.feather, b.az[0] + b.feather, az) * (1 - s(b.az[1] - b.feather, b.az[1] + b.feather, az)) * s(b.el[0] - b.feather, b.el[0] + b.feather, el) * (1 - s(b.el[1] - b.feather, b.el[1] + b.feather, el));
      const i = (y * width + x) * 4;
      data[i] = THREE.DataUtils.toHalfFloat(v); data[i + 1] = THREE.DataUtils.toHalfFloat(v * .985); data[i + 2] = THREE.DataUtils.toHalfFloat(v * .965); data[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  map.mapping = THREE.EquirectangularReflectionMapping; map.minFilter = map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  return map;
}

// Hall-only crumbly crust on the matte toy (procedural normal perturbation in
// object space). Does not touch the model asset or any feel/appearance preset.
// Per-content light balance: every toy reads at the same perceived lightness,
// so pale styles do not wash out and deeper ones do not go dull.
function balance(hex) {
  const n = parseInt(hex.slice(1), 16), y = .2126 * srgbToLinear((n >> 16) / 255) + .7152 * srgbToLinear((n >> 8 & 255) / 255) + .0722 * srgbToLinear((n & 255) / 255);
  return Math.min(1.25, Math.max(.8, Math.sqrt(.62 / y)));
}

function crustMaterial(color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, envMapIntensity: .85, vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCrust;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrust = position * 70.0;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCrust;
float crustHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float crustNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crustHash(i), crustHash(i + vec3(1,0,0)), f.x), mix(crustHash(i + vec3(0,1,0)), crustHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(crustHash(i + vec3(0,0,1)), crustHash(i + vec3(1,0,1)), f.x), mix(crustHash(i + vec3(0,1,1)), crustHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float crust(vec3 p) { return crustNoise(p) * .6 + crustNoise(p * 2.3) * .3 + crustNoise(p * 5.1) * .1; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ float e = .3; float h = crust(vCrust);
  vec3 g = vec3(crust(vCrust + vec3(e,0,0)) - h, crust(vCrust + vec3(0,e,0)) - h, crust(vCrust + vec3(0,0,e)) - h) / e;
  normal = normalize(normal - .32 * (g - dot(g, normal) * normal));
  diffuseColor.rgb *= .93 + .07 * h; }`);
  };
  return material;
}

// ---------- package scene ----------
function shadeTexture({ size: [w, h], data }) {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)), rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([bytes[i], bytes[i], bytes[i], 255], i * 4);
  const texture = new THREE.DataTexture(rgba, w, h); texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();
const loadModel = url => { if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url)); return modelCache.get(url); };

// Baked meshes are quantized (KHR_mesh_quantization): the dequantize scale and
// offset live in the node transform, so read positions through matrixWorld.
function worldPositions(object) {
  object.updateWorldMatrix(true, false);
  const source = object.geometry.attributes.position, out = new Float32Array(source.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) { v.fromBufferAttribute(source, i).applyMatrix4(object.matrixWorld); out.set([v.x, v.y, v.z], i * 3); }
  return out;
}

function rebuildFilm(points, grid) {
  const [nx, ny] = grid, geometry = new THREE.BufferGeometry();
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6), uv = new Float32Array(nx * ny * 2); let n = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = j / (ny - 1);
    if (i < nx - 1 && j < ny - 1) { index.set([k, k + 1, k + nx + 1, k, k + nx + 1, k + nx], n); n += 6; }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions(points), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.computeVertexNormals();
  return geometry;
}

function dequantized(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(worldPositions(mesh), 3));
  geometry.setIndex(mesh.geometry.index.clone()); geometry.computeVertexNormals();
  return geometry;
}

// Thin PVC film. Physically a ~4% reflector at normal incidence rising to
// near-mirror at grazing angles. Rendered premultiplied: the film adds its
// reflections and only slightly occludes what is behind it, so face-on areas
// stay clear while folds, seams and grazing edges read as plastic.
function film(options = {}) {
  const { roughnessMap = null, roughness = .04, base = .025, edge = 0, tint = .62, normalMap = null, normalScale = .55, alphaMap = null, toyRect = null } = options;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness, roughnessMap, normalMap, alphaMap, side: THREE.DoubleSide, transparent: true, depthWrite: false, envMapIntensity: 1.35 });
  if (normalMap) material.normalScale = new THREE.Vector2(normalScale, normalScale);
  if (alphaMap) material.alphaTest = .5;
  material.defines = { USE_UV: '' };
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.onBeforeCompile = shader => {
    shader.uniforms.filmToy = { value: new THREE.Vector4(...(toyRect || [2, 2, 2, 2])) };
    shader.uniforms.filmBase = { value: base }; shader.uniforms.filmEdge = { value: edge }; shader.uniforms.filmTint = { value: tint };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float filmBase, filmEdge, filmTint;\nuniform vec4 filmToy;')
      .replace('#include <opaque_fragment>', `
        float facing = abs(dot(normalize(vViewPosition), normal));
        float fresnel = .04 + .96 * pow(1. - facing, 5.);
        reflectedLight.indirectSpecular *= mix(1., .55, smoothstep(.25, .0, facing));
        float seam = filmEdge * (1. - smoothstep(0., .006, min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y))));
        float filmAlpha = clamp(filmBase + fresnel * .5 + seam, 0., .92) * diffuseColor.a;
        vec2 toyCenter = (filmToy.xy + filmToy.zw) * .5, toyHalf = max((filmToy.zw - filmToy.xy) * .5, vec2(1e-3));
        float overToy = 1. - smoothstep(.75, 1.05, length((vUv - toyCenter) / toyHalf));
        vec3 specular = (reflectedLight.directSpecular + reflectedLight.indirectSpecular) * 1.;
        gl_FragColor = vec4(vec3(filmTint) * filmAlpha * .18 + specular, filmAlpha);`);
  };
  return material;
}

async function buildScene(id, url) {
  const style = spec.styles[id], bag = spec.bag, { halfW, sealTop, sealBottom, edgeZ, holeY, holeX } = layout(spec);
  const W = bag.width, toyHex = spec.palette[style.color], ink = inkFor(toyHex);
  const gltf = await loadModel(url), extras = gltf.scene.userData;
  const group = new THREE.Group(), disposables = [], warp = bagWarp(spec, style.seed, extras.warp);
  // xy warp for parts attached to the bag (the toy stays rigid; lift is baked).
  const warped = (geometry, lift = false) => { const p = geometry.attributes.position; for (let v = 0; v < p.count; v++) { const [x, y] = warp.xy(p.getX(v), p.getY(v)); p.setXYZ(v, x, y, p.getZ(v) + (lift ? warp.lift(p.getX(v), p.getY(v)) : 0)); } p.needsUpdate = true; geometry.computeVertexNormals(); return geometry; };
  const track = o => { disposables.push(o); return o; };
  const byName = name => gltf.scene.getObjectByName(name);
  const roughnessMap = track(filmRoughness(style.seed));
  // Toy footprint in bag uv (for the crease map: film stays smooth over the toy).
  const toyMesh = byName('toy'); toyMesh.updateWorldMatrix(true, false);
  const toyBounds = new THREE.Box3().setFromObject(toyMesh);
  const span = [bag.bodyTop - bag.bodyBottom];
  const toyUv = [(toyBounds.min.x + halfW) / W, (toyBounds.min.y - bag.bodyBottom) / span[0], (toyBounds.max.x + halfW) / W, (toyBounds.max.y - bag.bodyBottom) / span[0]];
  const toBagUv = ([x, y]) => [(x + halfW) / W, (y - bag.bodyBottom) / span[0]];
  const creases = track(creaseNormal(style.seed, toyUv, (extras.folds || []).map(f => ({ start: toBagUv(f.start), end: toBagUv(f.end) }))));
  const filmMaterial = track(film({ roughnessMap, edge: .6, normalMap: creases, normalScale: 1.2, toyRect: toyUv }));

  const toyGeometry = track(dequantized(byName('toy')));
  const aoSource = byName('toy').geometry.attributes.color; if (aoSource) { const c = new Float32Array(aoSource.count * 3); for (let i = 0; i < aoSource.count; i++) c.set([aoSource.getX(i), aoSource.getY(i), aoSource.getZ(i)], i * 3); toyGeometry.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  const toyMaterial = track(crustMaterial(toyHex)); toyMaterial.envMapIntensity *= balance(toyHex);
  const toyObject = new THREE.Mesh(toyGeometry, toyMaterial); toyObject.name = 'toy'; group.add(toyObject);
  // Back film carries the toy's soft contact shade (baked in the alpha of a grid texture).
  const shadeMaterial = track(film({ roughnessMap, edge: .35 }));
  const shade = extras.shade && track(shadeTexture(extras.shade));
  if (shade) shadeMaterial.onBeforeCompile = (original => shader => {
    original(shader);
    shader.uniforms.filmShade = { value: shade };
    shader.fragmentShader = shader.fragmentShader.replace('uniform float filmBase', 'uniform sampler2D filmShade;\nuniform float filmBase')
      .replace('gl_FragColor = vec4(vec3(filmTint) * filmAlpha * .3 + specular, filmAlpha);', 'float s = texture2D(filmShade, vUv).r; float a = clamp(filmAlpha + s * .42, 0., .95);\n        gl_FragColor = vec4(vec3(filmTint) * filmAlpha * .3 + vec3(.18, .15, .16) * s * .42 + specular, a);');
  })(shadeMaterial.onBeforeCompile);
  for (const name of ['film-front', 'film-back']) {
    const node = byName(name), points = node.isPoints ? node : node.children.find(child => child.isPoints);
    const geometry = track(warped(rebuildFilm(points, node.userData.grid)));
    const filmMesh = new THREE.Mesh(geometry, name === 'film-back' ? shadeMaterial : filmMaterial); filmMesh.name = name; group.add(filmMesh);
  }

  // Zipper ridges following the baked film profile.
  const zipperMaterial = track(film({ roughness: .1, base: .12 }));
  for (const { y, heights } of extras.zipper) {
    const curve = new THREE.CatmullRomCurve3(heights.map((h, s) => new THREE.Vector3(-halfW + .015 + s / (heights.length - 1) * (W - .03), y, h)));
    group.add(new THREE.Mesh(track(warped(new THREE.TubeGeometry(curve, 96, .011, 8))), zipperMaterial));
  }

  // Heat seals: fused clear film, pressed ridges, quiet print, punched hang hole.
  const hole = { u: (holeX + halfW) / W, v: (sealTop - holeY) / bag.topSeal, r: bag.hole.radius / W };
  for (const [y0, y1, pattern, punched] of [[bag.bodyTop, sealTop, style.seal.top, hole], [sealBottom, bag.bodyBottom, style.seal.bottom, null]]) {
    const height = y1 - y0, aspect = W / height, plane = track(warped(new THREE.PlaneGeometry(W, height, 48, 4).translate(0, (y0 + y1) / 2, 0), true));
    const sealMaterial = track(film({ roughness: .24, base: .1, normalMap: track(sealNormal(aspect)), alphaMap: punched ? track(sealAlpha(aspect, punched)) : null }));
    for (const z of [edgeZ + .001, -.001]) { const seal = new THREE.Mesh(plane, sealMaterial); seal.position.set(0, 0, z); group.add(seal); }
    const print = new THREE.Mesh(plane, track(new THREE.MeshStandardMaterial({ map: track(sealPrint(pattern, ink, aspect, { hole: punched })), transparent: true, depthWrite: false, roughness: .5, side: THREE.DoubleSide })));
    print.position.set(0, 0, edgeZ + .0022); print.renderOrder = 2; group.add(print);
  }

  // PVC name tag: clear acrylic body in the style's outline, printed insert in a
  // pale tint of the toy colour. The name itself is page text (see placeName).
  const t = spec.tag, kind = extras.tag.shape, geo = tagLayout(spec, kind);
  const shape = new THREE.Shape(geo.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const tagHole = new THREE.Path(); tagHole.absarc(geo.hole[0], geo.hole[1], geo.holeRadius, 0, Math.PI * 2, true); shape.holes.push(tagHole);
  const tag = new THREE.Group();
  const body = new THREE.Mesh(track(new THREE.ExtrudeGeometry(shape, { depth: t.thickness, bevelEnabled: true, bevelThickness: geo.bevel, bevelSize: geo.bevel, bevelSegments: 3, curveSegments: 12 })), track(film({ roughness: .08, base: .14, tint: .9 })));
  body.position.z = -t.thickness / 2; tag.add(body);
  // Printed insert: the tag outline scaled into the area right of the hang hole
  // (no hole cut through it, so the triangulation stays clean).
  const inset = t.printInset * .55, w2 = t.width / 2, scaleY = 1 - inset * 2 / t.height;
  const x0 = geo.hole[0] + geo.holeRadius + .03, x1 = w2 - inset, mapX = x => x0 + (x + w2) / t.width * (x1 - x0);
  const insertShape = new THREE.Shape(geo.outline.map(([x, y]) => new THREE.Vector2(mapX(x), y * scaleY)));
  const insertGeometry = track(new THREE.ShapeGeometry(insertShape, 16));
  { const p = insertGeometry.attributes.position, uv = new Float32Array(p.count * 2); for (let v = 0; v < p.count; v++) { uv[v * 2] = p.getX(v) / t.width + .5; uv[v * 2 + 1] = p.getY(v) / t.height + .5; } insertGeometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
  const tagGround = inkFor(toyHex, .955, .03), tagEdge = inkFor(toyHex, .74, .07);
  const insert = new THREE.Mesh(insertGeometry, track(new THREE.MeshPhysicalMaterial({ map: track(tagPrint(tagGround, tagEdge, t.width / t.height)), roughness: .5, clearcoat: .6, clearcoatRoughness: .25 })));
  insert.position.z = .0008; tag.add(insert);
  tag.position.fromArray(extras.tag.position); tag.quaternion.fromArray(extras.tag.quaternion);
  [tag.position.x, tag.position.y] = warp.xy(tag.position.x, tag.position.y);
  group.add(tag);
  const printCorners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => new THREE.Vector3(geo.print.x + sx * geo.print.width / 2, geo.print.y + sy * geo.print.height / 2, .002));
  const nameColor = inkFor(toyHex, .36, .06);

  // Ball chain.
  const points = extras.chain.slice(), beads = points.length / 3, c = spec.chain;
  for (let b = 0; b < beads; b++) [points[b * 3], points[b * 3 + 1]] = warp.xy(points[b * 3], points[b * 3 + 1]);
  const metal = track(new THREE.MeshStandardMaterial({ color: 0xcdc9c2, metalness: 1, roughness: .26 }));
  const beadMesh = new THREE.InstancedMesh(track(new THREE.SphereGeometry(c.beadRadius, 12, 8)), metal, beads);
  const linkMesh = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(c.linkRadius, c.linkRadius, 1, 6)), metal, beads);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let b = 0; b < beads; b++) {
    p.fromArray(points, b * 3); n.fromArray(points, ((b + 1) % beads) * 3);
    beadMesh.setMatrixAt(b, m.makeTranslation(p.x, p.y, p.z));
    const d = n.clone().sub(p); q.setFromUnitVectors(up, d.clone().normalize());
    linkMesh.setMatrixAt(b, m.compose(p.clone().lerp(n, .5), q, new THREE.Vector3(1, d.length(), 1)));
  }
  // Ball-chain connector replacing two beads.
  if (extras.clasp !== undefined) {
    const i = extras.clasp, j = (i + 1) % beads, a0 = new THREE.Vector3().fromArray(points, i * 3), a1 = new THREE.Vector3().fromArray(points, j * 3);
    for (const k of [i, j]) beadMesh.setMatrixAt(k, m.makeScale(0, 0, 0));
    const clasp = new THREE.Mesh(track(new THREE.CapsuleGeometry(c.claspRadius, c.claspLength - c.claspRadius * 2, 4, 12)), metal);
    clasp.position.copy(a0).lerp(a1, .5); clasp.quaternion.setFromUnitVectors(up, a1.clone().sub(a0).normalize()); group.add(clasp);
  }
  group.add(beadMesh, linkMesh);

  // Stickers.
  extras.stickers.forEach(({ kind, variant, center, angle, size }, i) => {
    const geometry = track(dequantized(byName(`sticker-${i}`))), p = geometry.attributes.position, uvs = new Float32Array(p.count * 2);
    // UVs from the baked placement (vertex order is not preserved by compression).
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    for (let v = 0; v < p.count; v++) { const dx = p.getX(v) - center[0], dy = p.getY(v) - center[1]; uvs[v * 2] = (dx * cos - dy * sin) / size + .5; uvs[v * 2 + 1] = (dx * sin + dy * cos) / size + .5; }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    warped(geometry);
    group.add(new THREE.Mesh(geometry, track(new THREE.MeshStandardMaterial({ map: track(sticker(kind, variant ? inkFor(toyHex, .74, .06) : ink, '#fbfaf7')), alphaTest: .5, roughness: .32 }))));
  });


  // Small per-style turn, as bags never lie perfectly square.
  group.rotation.z = THREE.MathUtils.degToRad(style.turn || 0);
  return { group, tag, printCorners, ink, nameColor, dispose: () => disposables.forEach(d => d.dispose?.()) };
}

// ---------- rendering ----------
export function cameraFor(view = {}, aspect) {
  const r = spec.render, frame = view.frame || spec.frame;
  const camera = new THREE.PerspectiveCamera(view.fov || r.fov, aspect, .1, 200);
  const center = new THREE.Vector3((frame.left + frame.right) / 2, (frame.bottom + frame.top) / 2, .2);
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const distance = Math.max((frame.top - frame.bottom) / 2 / tan, (frame.right - frame.left) / 2 / (tan * aspect)) + .6;
  const tilt = THREE.MathUtils.degToRad(view.tilt ?? r.tiltDegrees), yaw = THREE.MathUtils.degToRad(view.yaw || 0);
  camera.position.set(center.x + Math.sin(yaw) * Math.cos(tilt) * distance, center.y - Math.sin(tilt) * distance, center.z + Math.cos(yaw) * Math.cos(tilt) * distance);
  camera.up.set(0, 1, 0); camera.lookAt(center); camera.updateMatrixWorld(true);
  return camera;
}

export function createPackageRenderer() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = spec.render.exposure;
  renderer.setClearColor(0x000000, 0);
  const pmrem = new THREE.PMREMGenerator(renderer), source = studioEnvironment();
  const environment = pmrem.fromEquirectangular(source).texture; source.dispose(); pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff6ee, 2.3); key.position.set(-2.5, 3, 4);
  const fill = new THREE.DirectionalLight(0xf2f4ff, .7); fill.position.set(3, -1, 4);

  async function render(id, url, target, view = {}) {
    const started = performance.now();
    const cssWidth = view.width || target.clientWidth || 360, cssHeight = view.height || target.clientHeight || cssWidth * 5 / 4;
    const ratio = Math.min(view.pixelRatio || window.devicePixelRatio || 1, spec.render.maxPixelRatio);
    const width = Math.round(cssWidth * ratio), height = Math.round(cssHeight * ratio);
    const built = await buildScene(id, url);
    for (const name of view.hide || []) { const o = built.group.getObjectByName(name); if (o) o.visible = false; }
    const scene = new THREE.Scene(); scene.environment = environment; scene.add(built.group, key, fill);
    const camera = cameraFor(view, width / height);
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    renderer.render(scene, camera);
    target.width = width; target.height = height;
    const context = target.getContext('2d'); context.clearRect(0, 0, width, height); context.drawImage(canvas, 0, 0);
    built.group.updateMatrixWorld(true);
    const quad = built.printCorners.map(c => { const v = c.clone().applyMatrix4(built.tag.matrixWorld).project(camera); return [(v.x * .5 + .5) * 100, (1 - (v.y * .5 + .5)) * 100]; });
    const info = renderer.info.render; const stats = { ms: +(performance.now() - started).toFixed(1), triangles: info.triangles, calls: info.calls, width, height };
    scene.remove(built.group); built.dispose();
    return { quad, ink: built.ink, nameColor: built.nameColor, stats };
  }
  function dispose() { environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
  return { render, dispose };
}

// Places the real page text on the tag's print field and sizes it to fill the
// field (largest size that fits both ways). Returns the size; callers treat a
// result below the minimum as an error rather than letting text overflow.
export function placeName(element, quad, { color, minimum = 10, maximum = 40 } = {}) {
  const box = element.parentElement.getBoundingClientRect();
  const px = quad.map(([x, y]) => [x / 100 * box.width, y / 100 * box.height]);
  const width = Math.hypot(px[1][0] - px[0][0], px[1][1] - px[0][1]), height = Math.hypot(px[3][0] - px[0][0], px[3][1] - px[0][1]);
  const angle = Math.atan2(px[1][1] - px[0][1], px[1][0] - px[0][0]);
  const cx = px.reduce((s, p) => s + p[0], 0) / 4, cy = px.reduce((s, p) => s + p[1], 0) / 4;
  Object.assign(element.style, { left: `${cx}px`, top: `${cy}px`, width: `${width}px`, height: `${height}px`, transform: `translate(-50%, -50%) rotate(${angle}rad)`, color: color || '' });
  const chars = [...element.textContent].length, tracking = .02;
  const size = Math.floor(Math.min(maximum, height * .88, width * .9 / (chars + tracking * (chars - 1))) * 2) / 2;
  element.style.fontSize = `${size}px`; element.style.letterSpacing = `${tracking}em`;
  element.dataset.fit = size >= minimum ? 'ok' : 'too-small';
  return { size, width, height };
}
