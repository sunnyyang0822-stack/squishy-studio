import * as THREE from 'three';

// Model-local units, independent of wax thickness, gravity and elapsed time.
export const polishShellParameters = Object.freeze({
  gap: .0035, contactRadius: .66, pathSpacing: .035,
  onsetDepth: .006, fullDamageDepth: .24, cycleGain: .08,
  globalWidthGain: 1.5, marshmallowOnsetDepth: .00008, marshmallowFullDamageDepth: .032,
  marshmallowWidthGain: 2.25, slowReboundRecoveredWidthGain: 1.5, maxCycles: 12, roughness: .43, cellScale: 2.15,
});
const clamp = value => Math.max(0, Math.min(1, value));
const fract = value => value - Math.floor(value);
const hash = (x, y, z, offset) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + offset) * 43758.5453);

// Same fixed-budget field used by the fragment shader. This is a reference for
// geometry/render tests, not a colored crack texture or a second inner surface.
export function polishCrackField(point, scale = polishShellParameters.cellScale) {
  const p = point.map(v => v * scale);
  const cell = p.map(Math.floor);
  let first = Infinity, second = Infinity, seed = 0;
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const c = [cell[0] + x, cell[1] + y, cell[2] + z];
    const delta = c.map((v, k) => v + .18 + .64 * hash(...c, k * 19.19) - p[k]);
    const distance = Math.hypot(...delta);
    if (distance < first) { second = first; first = distance; seed = hash(...c, 61.7); }
    else second = Math.min(second, distance);
  }
  return { edge: second - first, threshold: .025 + seed * .12 };
}
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
// A stable coarse network stays in place. Later, finer networks overlap it;
// pressure and fatigue never rescale cells or erode the remaining film islands.
export function polishCrackLayers(damage, opening, residual = 0) {
  const strain = smooth(0, .25, opening);
  const memory = smooth(0, .07, residual);
  return [
    { scale: 2.15, strength: damage, width: .003 + .011 * strain + .005 * memory, shade: .48 },
    { scale: 4.3, strength: smooth(.66, .86, damage), width: .002 + .007 * strain + .0025 * memory, shade: .34 },
    { scale: 6.45, strength: smooth(.90, 1, damage), width: .0015 + .004 * strain + .0015 * memory, shade: .25 },
  ];
}
// Child fissures grow out from existing parent boundaries, with a continuous
// width blend at the junction. They never switch to an unrelated whole overlay.
export function polishCrackSample(point, damage, opening, residual = 0, widthGain = 1, recoveredWidthGain = 1, globalWidthGain = polishShellParameters.globalWidthGain) {
  const layers = polishCrackLayers(damage, opening, residual);
  const fields = layers.map(layer => polishCrackField(point, layer.scale));
  const secondary = layers[1].strength, detail = layers[2].strength;
  const reach = .015 + .60 * secondary;
  layers[1].strength *= 1 - smooth(reach, reach + .08, fields[0].edge);
  layers[1].width += layers[0].width * 1.35 * (1 - smooth(0, .065, fields[0].edge));
  const parentDistance = Math.min(fields[0].edge, fields[1].edge * .5);
  const detailReach = .01 + .35 * detail;
  layers[2].strength *= 1 - smooth(detailReach, detailReach + .06, parentDistance);
  layers[2].width += layers[1].width * .8 * (1 - smooth(0, .045, parentDistance));
  const recoveryGain = 1 + (recoveredWidthGain - 1) * (1 - smooth(0, .25, opening)) * +(residual > .000001);
  for (const layer of layers) layer.width *= widthGain * recoveryGain * globalWidthGain;
  const visible = layers.map((layer, i) => layer.strength > fields[i].threshold && fields[i].edge < layer.width * smooth(0, .22, layer.strength));
  return { visible: visible.some(Boolean), layers, fields, hits: visible };
}
export function polishCrackVisible(point, damage, opening, residual = 0, widthGain = 1, recoveredWidthGain = 1, globalWidthGain = polishShellParameters.globalWidthGain) {
  return polishCrackSample(point, damage, opening, residual, widthGain, recoveredWidthGain, globalWidthGain).visible;
}

const crackShader = `
varying vec3 vPolishRest;
varying float vPolishDamage;
varying float vPolishOpening;
varying float vPolishResidual;
float polishHash(vec3 c, float offset) {
  return fract(sin(dot(c, vec3(127.1,311.7,74.7)) + offset) * 43758.5453);
}
vec2 polishField(vec3 p, float scale) {
  p *= scale;
  vec3 cell = floor(p);
  float first = 1e4; float second = 1e4; float seed = 0.;
  for (int x=-1; x<=1; x++) for (int y=-1; y<=1; y++) for (int z=-1; z<=1; z++) {
    vec3 c = cell + vec3(float(x),float(y),float(z));
    vec3 jitter = vec3(polishHash(c,0.),polishHash(c,19.19),polishHash(c,38.38));
    float d = length(c + .18 + .64*jitter - p);
    if (d < first) { second=first; first=d; seed=polishHash(c,61.7); }
    else second=min(second,d);
  }
  return vec2(second-first,.025+seed*.12);
}
float polishLayer(vec3 p, float scale, float strength, float width, float shade) {
  if (strength <= .025) return 0.;
  vec2 crack=polishField(p,scale);
  if (strength <= crack.y) return 0.;
  float aperture=width*smoothstep(0.,.22,strength);
  if (crack.x<aperture) discard;
  return (1.-smoothstep(aperture,aperture+.024,crack.x))*shade;
}
`;

export function createPolishShell({ geometry, restPositions = geometry.attributes.position.array.slice(), restNormals = geometry.attributes.normal.array.slice(), color = '#f0cbd1', coreColor, feelId = 'clay', surfaceGeometry }) {
  if (!geometry.index || !geometry.attributes.normal) throw new TypeError('Polish requires indexed core positions and normals');
  const response = feelId === 'marshmallow' ? { onset: polishShellParameters.marshmallowOnsetDepth, fullDepth: polishShellParameters.marshmallowFullDamageDepth } : { onset: polishShellParameters.onsetDepth, fullDepth: polishShellParameters.fullDamageDepth };
  const crackWidthGain = feelId === 'marshmallow' ? polishShellParameters.marshmallowWidthGain : 1;
  const retainFilmStrain = feelId === 'slow-rebound';
  const recoveredWidthGain = retainFilmStrain ? polishShellParameters.slowReboundRecoveredWidthGain : 1;
  const rest = Float32Array.from(restPositions), count = rest.length / 3;
  const shellGeometry = geometry.clone();
  // Core pigment is owned exclusively by its existing scene.
  shellGeometry.deleteAttribute('color');
  const damage = new Float32Array(count), opening = new Float32Array(count), residual = new Float32Array(count);
  const maxDepth = new Float32Array(count), fatigue = new Float32Array(count);
  const cyclePeak = new Float32Array(count), cycleBase = new Float32Array(count);
  const contacts = new Uint8Array(count), counted = new Uint8Array(count), envelope = new Float32Array(count);
  shellGeometry.setAttribute('polishRest', new THREE.BufferAttribute(rest.slice(), 3));
  shellGeometry.setAttribute('polishDamage', new THREE.BufferAttribute(damage, 1).setUsage(THREE.DynamicDrawUsage));
  shellGeometry.setAttribute('polishResidual', new THREE.BufferAttribute(residual, 1).setUsage(THREE.DynamicDrawUsage));
  shellGeometry.setAttribute('polishOpening', new THREE.BufferAttribute(opening, 1).setUsage(THREE.DynamicDrawUsage));
  shellGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  shellGeometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.MeshStandardMaterial({ color, roughness: polishShellParameters.roughness, metalness: 0, envMapIntensity: .65 });
  const rimEnabled = coreColor !== undefined && new THREE.Color(coreColor).equals(material.color);
  material.onBeforeCompile = shader => {
    shader.uniforms.polishRimEnabled = { value: rimEnabled ? 1 : 0 };
    shader.uniforms.polishWidthGain = { value: crackWidthGain * polishShellParameters.globalWidthGain };
    shader.uniforms.polishRecoveredWidthGain = { value: recoveredWidthGain };
    shader.vertexShader = `attribute vec3 polishRest; attribute float polishDamage; attribute float polishOpening; attribute float polishResidual;
varying vec3 vPolishRest; varying float vPolishDamage; varying float vPolishOpening; varying float vPolishResidual;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vPolishRest=polishRest; vPolishDamage=polishDamage; vPolishOpening=polishOpening; vPolishResidual=polishResidual;`);
    shader.fragmentShader = 'uniform float polishRimEnabled; uniform float polishWidthGain; uniform float polishRecoveredWidthGain;\n' + crackShader + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
if(vPolishDamage>.025) {
float strain=smoothstep(0.,.25,vPolishOpening);
float memory=smoothstep(0.,.07,vPolishResidual);
float effectiveWidthGain=polishWidthGain*(1.+(polishRecoveredWidthGain-1.)*(1.-strain)*step(.000001,vPolishResidual));
float primaryWidth=.003+.011*strain+.005*memory;
vec2 primary=polishField(vPolishRest,2.15);
float rim=polishLayer(vPolishRest,2.15,vPolishDamage,primaryWidth*effectiveWidthGain,.48);
float secondary=smoothstep(.66,.86,vPolishDamage);
float reach=.015+.60*secondary;
float secondaryGrowth=secondary*(1.-smoothstep(reach,reach+.08,primary.x));
float secondaryWidth=.002+.007*strain+.0025*memory+primaryWidth*1.35*(1.-smoothstep(0.,.065,primary.x));
rim=max(rim,polishLayer(vPolishRest,4.3,secondaryGrowth,secondaryWidth*effectiveWidthGain,.34));
float detail=smoothstep(.90,1.,vPolishDamage);
if(detail>.025) {
vec2 child=polishField(vPolishRest,4.3);
float parentDistance=min(primary.x,child.x*.5);
float detailReach=.01+.35*detail;
float detailGrowth=detail*(1.-smoothstep(detailReach,detailReach+.06,parentDistance));
float detailWidth=.0015+.004*strain+.0015*memory+secondaryWidth*.8*(1.-smoothstep(0.,.045,parentDistance));
rim=max(rim,polishLayer(vPolishRest,6.45,detailGrowth,detailWidth*effectiveWidthGain,.25));
}
diffuseColor.rgb*=1.-rim*polishRimEnabled;
}`);
  };
  material.customProgramCacheKey = () => 'polish-shell-layered-v10';
  const mesh = new THREE.Mesh(shellGeometry, material);
  mesh.name = 'AttachedPolishFilm'; mesh.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'PolishShell'; group.add(mesh);
  let active = false, disposed = false, dirty = true, cycle = 0;
  let lastPoint = null;
  // Non-spherical folds may rotate one incident face past the smooth normal.
  // Project only the coating's offset into every live incident face's outside
  // half-space; never modify the core or enlarge the coating separation.
  const supportIndex = geometry.index.array;
  // The confirmed deep slow-rebound orb can now turn incident faces just as
  // far as a sculpted surface. Reuse the existing film-only support projection;
  // crack widths, gap, damage and the core geometry remain preset-owned.
  const needsFaceSupport = Boolean(surfaceGeometry) || retainFilmStrain;
  const incidentFaces = needsFaceSupport ? Array.from({ length: count }, () => []) : null;
  const faceNormals = needsFaceSupport ? new Float64Array(supportIndex.length) : null;
  if (incidentFaces) for (let f=0; f<supportIndex.length; f+=3) for(let k=0;k<3;k++) incidentFaces[supportIndex[f+k]].push(f);
  function constrainFilmOffsets(positions, target) {
    if (!incidentFaces) return false;
    for(let f=0;f<supportIndex.length;f+=3){
      const a=supportIndex[f]*3,b=supportIndex[f+1]*3,c=supportIndex[f+2]*3;
      const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
      const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
      faceNormals[f]=nx/l;faceNormals[f+1]=ny/l;faceNormals[f+2]=nz/l;
    }
    let changed=false;
    for(let i=0;i<count;i++){
      const j=i*3;let x=target[j]-positions[j],y=target[j+1]-positions[j+1],z=target[j+2]-positions[j+2];
      let needsCorrection=false;
      for(const f of incidentFaces[i]) if(x*faceNormals[f]+y*faceNormals[f+1]+z*faceNormals[f+2]<.00015){needsCorrection=true;break;}
      if(!needsCorrection)continue;
      for(let pass=0;pass<16;pass++)for(const f of incidentFaces[i]){
        const nx=faceNormals[f],ny=faceNormals[f+1],nz=faceNormals[f+2],deficit=.0002-(x*nx+y*ny+z*nz);
        if(deficit>0){x+=nx*deficit;y+=ny*deficit;z+=nz*deficit;}
        const l=Math.hypot(x,y,z);if(l>polishShellParameters.gap){const k=polishShellParameters.gap/l;x*=k;y*=k;z*=k;}
      }
      const next=[positions[j]+x,positions[j+1]+y,positions[j+2]+z];
      for(let k=0;k<3;k++){if(target[j+k]!==Math.fround(next[k]))changed=true;target[j+k]=next[k];}
    }
    return changed;
  }
  const pointArray = point => point.isVector3 ? point.toArray() : Array.from(point);
  function stamp(point) {
    if (surfaceGeometry) {
      for (const [i, distance] of surfaceGeometry.neighborhood(point, polishShellParameters.contactRadius)) {
        const q = distance ** 2 / polishShellParameters.contactRadius ** 2;
        if (q < 1) envelope[i] = Math.max(envelope[i], (1 - q) ** 2);
      }
      return;
    }
    const radius2 = polishShellParameters.contactRadius ** 2;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const q = ((rest[j] - point[0]) ** 2 + (rest[j + 1] - point[1]) ** 2 + (rest[j + 2] - point[2]) ** 2) / radius2;
      if (q < 1) envelope[i] = Math.max(envelope[i], (1 - q) ** 2);
    }
  }
  function move(point) {
    if (!active || disposed) return;
    const next = pointArray(point);
    if (surfaceGeometry) {
      for (const sample of surfaceGeometry.path(lastPoint, next, polishShellParameters.pathSpacing)) stamp(sample);
      lastPoint = next; return;
    }
    const distance = Math.hypot(...next.map((v, k) => v - lastPoint[k]));
    const steps = Math.max(1, Math.ceil(distance / polishShellParameters.pathSpacing));
    // Follow the orb's rest surface, not the chord through its center.
    const ra = Math.hypot(...lastPoint), rb = Math.hypot(...next);
    for (let sample = 1; sample <= steps; sample++) {
      const t = sample / steps, p = next.map((v, k) => lastPoint[k] + (v - lastPoint[k]) * t);
      const r = Math.hypot(...p), target = ra + (rb - ra) * t;
      stamp(r > .001 ? p.map(v => v * target / r) : p);
    }
    lastPoint = next;
  }
  function sync() {
    if (disposed) return false;
    const positions = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
    const target = shellGeometry.attributes.position.array, targetNormals = shellGeometry.attributes.normal.array;
    let changed = dirty;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const depth = Math.hypot(rest[j] - positions[j], rest[j + 1] - positions[j + 1], rest[j + 2] - positions[j + 2]);
      if (active && envelope[i] > .0001 && depth > response.onset) {
        const load = clamp((depth - response.onset) / response.fullDepth) * Math.sqrt(envelope[i]);
        maxDepth[i] = Math.max(maxDepth[i], load);
        if (retainFilmStrain) {
          // A bounded loss of film area persists when the core expands again.
          // Geometry remains supported; only the real uncovered seam remembers it.
          const nextResidual = Math.fround(Math.min(.07, Math.max(residual[i], depth * .16)));
          if (residual[i] !== nextResidual) changed = true;
          residual[i] = nextResidual;
        }
        cyclePeak[i] = Math.max(cyclePeak[i], load);
        // One bounded peak contribution per vertex/contact. Neither frame count
        // nor move frequency enters damage. A sliding new region starts at one.
        fatigue[i] = Math.min(1, cycleBase[i] + cyclePeak[i] * polishShellParameters.cycleGain);
        if (!counted[i] && load > .008) { counted[i] = 1; contacts[i] = Math.min(polishShellParameters.maxCycles, contacts[i] + 1); }
      }
      const nextDamage = clamp(maxDepth[i] * .56 + fatigue[i]);
      if (damage[i] !== Math.fround(nextDamage) || opening[i] !== Math.fround(depth)) changed = true;
      damage[i] = nextDamage; opening[i] = depth;
      const length = Math.hypot(normals[j], normals[j + 1], normals[j + 2]) || 1;
      for (let k = 0; k < 3; k++) {
        const normal = normals[j + k] / length;
        const value = Math.fround(positions[j + k] + normal * polishShellParameters.gap);
        if (target[j + k] !== value || targetNormals[j + k] !== normals[j + k]) changed = true;
        target[j + k] = value; targetNormals[j + k] = normals[j + k];
      }
    }
    changed = constrainFilmOffsets(positions, target) || changed;
    if (changed) {
      shellGeometry.attributes.position.needsUpdate = true;
      shellGeometry.attributes.normal.needsUpdate = true;
      shellGeometry.attributes.polishDamage.needsUpdate = true;
      shellGeometry.attributes.polishOpening.needsUpdate = true;
      shellGeometry.attributes.polishResidual.needsUpdate = true;
    }
    dirty = false; return changed;
  }
  function end() { active = false; lastPoint = null; envelope.fill(0); }
  function reset() { end(); for (const array of [damage, opening, residual, maxDepth, fatigue, cyclePeak, cycleBase, contacts, counted]) array.fill(0); cycle = 0; dirty = true; sync(); }
  const state = () => ({ id: 'polish-shell', feelId, globalWidthGain: polishShellParameters.globalWidthGain, crackWidthGain, recoveredWidthGain, maxResidualOpening: Math.max(...residual), rimEnabled, active, disposed, cycle, detached: 0, falling: 0, fragmentCount: 0,
    maxDamage: Math.max(...damage), maxOpening: Math.max(...opening), damagedVertices: damage.reduce((sum, v) => sum + +(v > .045), 0),
    maxLocalContacts: Math.max(...contacts), vertexBudget: count, roughness: material.roughness });
  function getMetrics() {
    const shell = shellGeometry.attributes.position.array, core = geometry.attributes.position.array, indices = geometry.index.array;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), offset = new THREE.Vector3();
    let minGap = Infinity, maxGap = 0, samples = 0, violations = 0;
    // Actual rendered triangle corners, edge midpoints and centroids against
    // the corresponding current core face, rather than state-only assertions.
    for (let f = 0; f < indices.length; f += 3) {
      const ids = [indices[f], indices[f + 1], indices[f + 2]];
      a.fromArray(core, ids[0] * 3); b.fromArray(core, ids[1] * 3); c.fromArray(core, ids[2] * 3);
      normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const gaps = ids.map(i => offset.fromArray(shell, i * 3).sub(new THREE.Vector3().fromArray(core, i * 3)).dot(normal));
      for (const value of [...gaps, (gaps[0] + gaps[1]) / 2, (gaps[1] + gaps[2]) / 2, (gaps[2] + gaps[0]) / 2, (gaps[0] + gaps[1] + gaps[2]) / 3]) {
        minGap = Math.min(minGap, value); maxGap = Math.max(maxGap, value); samples++; if (value < -1e-6 || value > polishShellParameters.gap + 1e-6) violations++;
      }
    }
    return { gap: polishShellParameters.gap, minGap, maxGap, samples, violations, sourceFacePlaneSamples: samples, detached: 0,
      limitation: 'Source-face sample clearance; independent whole-core intersection and GPU images are separate checks.' };
  }
  sync();
  return { group, geometry: shellGeometry, material,
    begin(point) { if (disposed) return; if (active) end(); active = true; cycle++; envelope.fill(0); counted.fill(0); cyclePeak.fill(0); cycleBase.set(fatigue); lastPoint = pointArray(point); stamp(lastPoint); },
    move, end, release: end, cancel: end, sync,
    step() { const changed = sync(); return { changed, atRest: !active, needsFrame: false }; },
    reset, setReducedMotion() {}, setWorldMatrix() {}, setCollectionEnabled() {},
    getState: state, getMetrics,
    getSurfaceSnapshot() { return { positions: Array.from(shellGeometry.attributes.position.array), normals: Array.from(shellGeometry.attributes.normal.array),
      indices: Array.from(shellGeometry.index.array), damage: Array.from(damage), opening: Array.from(opening), residual: Array.from(residual), restPositions: Array.from(rest), contacts: Array.from(contacts) }; },
    dispose() { if (disposed) return; end(); disposed = true; group.removeFromParent(); shellGeometry.dispose(); material.dispose(); },
  };
}

// User-confirmed v10 appearance and behavior. Reuse this factory rather than
// copying the scene or retuning an approved coating for a new recipe.
export const polishShellPreset = Object.freeze({
  id: 'polish-shell', name: '指甲油脆皮', material: 'polish', version: 1,
  confirmedOn: '2026-11-05',
  supportedStyles: Object.freeze(['orb', 'cloud', 'cylinder', 'donut', 'pyramid', 'flower', 'star']),
  supportedFeels: Object.freeze(['clay', 'marshmallow', 'slow-rebound']),
  parameters: polishShellParameters, create: createPolishShell,
});
export function getPolishPreset(id = 'polish-shell') { if (id !== 'polish-shell') throw new RangeError(`Unknown polish preset: ${id}`); return polishShellPreset; }
