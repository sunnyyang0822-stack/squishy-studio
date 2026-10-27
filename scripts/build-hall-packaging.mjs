// Bakes hall packaging geometry (CPU only, no GPU needed).
//   node scripts/build-hall-packaging.mjs [ids…]
// Reads the confirmed GLB models (never modified), drapes the PVC film, places
// chain/tag/stickers and writes one meshopt-compressed GLB per style to
// assets/hall-packaging/<id>.glb plus manifest.json. The hall runtime only loads
// these files and renders them once.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { MeshBVH } from 'three-mesh-bvh';
import { buildPackageGeometry, placeToy } from '../src/hall-packaging/geometry.mjs';
import { gridFor } from '../src/hall-packaging/shared.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'assets-source/hall-packaging/spec.json'), 'utf8'));
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
const targets = ids.length ? ids : Object.keys(spec.styles);
const outDir = join(root, 'assets/hall-packaging');
for (const id of targets) if (!spec.styles[id]) throw new Error(`Unknown style ${id}`);

async function loadToy(id) {
  const bytes = readFileSync(join(root, `assets/models/squishy-${id}.glb`));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let mesh; gltf.scene.traverse(node => { if (node.isMesh && !mesh) mesh = node; });
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.clone(); geometry.applyMatrix4(mesh.matrixWorld);
  for (const name of Object.keys(geometry.attributes)) if (name !== 'position') geometry.deleteAttribute(name);
  return geometry;
}

// Display-only reduction of the toy for the hall (silhouette-preserving).
function simplify(geometry, ratio) {
  const positions = geometry.attributes.position.array, index = Uint32Array.from(geometry.index.array);
  const target = Math.floor(index.length * ratio / 3) * 3;
  const [reduced] = MeshoptSimplifier.simplify(index, positions, 3, target, .0015, ['LockBorder']);
  const remap = new Map(), packed = [];
  const indices = Uint32Array.from(reduced, v => { if (!remap.has(v)) { remap.set(v, remap.size); packed.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); } return remap.get(v); });
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(packed, 3));
  result.setIndex(new THREE.BufferAttribute(indices, 1)); result.computeVertexNormals(); result.computeBoundingBox();
  return result;
}

// Baked ambient occlusion of the toy on itself (cosine-weighted hemisphere
// rays against the full-resolution model): crevices between lobes, arms and
// pads darken softly, as in a studio product shot. Stored as vertex colour.
function bakeOcclusion(display, source, rays = 48) {
  const bvh = new MeshBVH(source), p = display.attributes.position, n = display.attributes.normal, colors = new Float32Array(p.count * 3);
  const ray = new THREE.Ray(), normal = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), reach = 1.1;
  for (let v = 0; v < p.count; v++) {
    normal.fromBufferAttribute(n, v).normalize();
    t1.set(Math.abs(normal.x) < .9 ? 1 : 0, Math.abs(normal.x) < .9 ? 0 : 1, 0).cross(normal).normalize(); t2.crossVectors(normal, t1);
    let open = 0;
    for (let i = 0; i < rays; i++) {
      const a = (i + .5) / rays, phi = i * 2.399963, rr = Math.sqrt(a), z = Math.sqrt(1 - a);
      ray.direction.copy(t1).multiplyScalar(Math.cos(phi) * rr).addScaledVector(t2, Math.sin(phi) * rr).addScaledVector(normal, z).normalize();
      ray.origin.fromBufferAttribute(p, v).addScaledVector(normal, .004);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      open += hit && hit.distance < reach ? Math.min(1, hit.distance / reach) ** 2 : 1;
    }
    const ao = .5 + .5 * open / rays;
    colors.set([ao, ao, ao], v * 3);
  }
  display.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function addMesh(document, buffer, scene, name, geometry) {
  const primitive = document.createPrimitive();
  // Normals and UVs are cheap to rebuild at runtime; shipping positions only halves the file.
  for (const [attribute, key] of [['position', 'POSITION'], ['color', 'COLOR_0']]) {
    const source = geometry.attributes[attribute]; if (!source) continue;
    primitive.setAttribute(key, document.createAccessor().setType(source.itemSize === 3 ? 'VEC3' : 'VEC2').setArray(new Float32Array(source.array)).setBuffer(buffer));
  }
  primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(geometry.index.array)).setBuffer(buffer));
  const node = document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive));
  scene.addChild(node);
}

// Films are regular grids: ship the vertices as points and rebuild the
// triangle index at runtime, which removes most of the file size.
function addFilm(document, buffer, scene, name, { grid, heights }) {
  const g = gridFor(spec, grid), positions = new Float32Array(heights.length * 3);
  for (let k = 0; k < heights.length; k++) positions.set([g.x0 + (k % g.nx) * g.dx, g.y0 + Math.floor(k / g.nx) * g.dy, heights[k]], k * 3);
  const primitive = document.createPrimitive().setMode(0)
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer));
  scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)).setExtras({ grid }));
}

await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'manifest.json');
let manifest; try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = { version: 1, styles: {} }; }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const id of targets) {
  const started = performance.now();
  const source = await loadToy(id);
  const { geometry: placed, scale } = placeToy(spec, id, source);
  const baked = buildPackageGeometry(spec, id, placed);
  const toy = simplify(placed, spec.render.toyLods);
  bakeOcclusion(toy, placed);

  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene('package');
  addMesh(document, buffer, scene, 'toy', toy);
  addFilm(document, buffer, scene, 'film-front', baked.film);
  addFilm(document, buffer, scene, 'film-back', baked.back);
  baked.stickers.forEach((sticker, i) => addMesh(document, buffer, scene, `sticker-${i}`, sticker.geometry));
  scene.setExtras({
    style: id, chain: Array.from(baked.chainPoints, v => +v.toFixed(4)), clasp: baked.clasp, warp: baked.warp, folds: baked.folds, tag: baked.tagPose,
    zipper: baked.zipper.map(z => ({ y: z.y, heights: z.heights.map(h => +h.toFixed(4)) })),
    stickers: baked.stickers.map(s => ({ kind: s.kind, variant: s.variant, center: s.center.map(v => +v.toFixed(4)), angle: +s.angle.toFixed(4), size: +s.size.toFixed(4) })),
    shade: { size: baked.shade.size, data: Buffer.from(baked.shade.data).toString('base64') },
  });
  await document.transform(quantize({ quantizePosition: 14, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const file = join(outDir, `${id}.glb`);
  writeFileSync(file, await io.writeBinary(document));
  const bytes = statSync(file).size;
  manifest.styles[id] = {
    model: `/assets/hall-packaging/${id}.glb`, bytes,
    triangles: { toy: toy.index.count / 3, filmFront: (baked.film.grid[0] - 1) * (baked.film.grid[1] - 1) * 2, filmBack: (baked.back.grid[0] - 1) * (baked.back.grid[1] - 1) * 2 },
    sourceTriangles: placed.index.count / 3, toyScale: +scale.toFixed(4), ...baked.stats, clearance: baked.audit,
  };
  console.log(`${id}: ${(bytes / 1024).toFixed(1)} KB, toy ${placed.index.count / 3}→${toy.index.count / 3} tris, contact ${baked.stats.contactShare}, clearance ${JSON.stringify(baked.audit)}, ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
