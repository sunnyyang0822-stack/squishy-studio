import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { orbColors } from '../detail/orb-colors.mjs';
import { createShellSampleGeometry } from './shell-sample-geometry.mjs';
import { createOrbColor } from './orb-color.mjs';

const thicknesses = { thin: .014, medium: .028, thick: .042 };
const color = id => orbColors.find(c => c.id === id)?.hex || orbColors[0].hex;
export function createShellSamples(mount, { onSelect = () => {}, onUnavailable = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-3, 3, 2.2, -2.2, .1, 30);
  camera.position.set(0, .2, 6); camera.lookAt(0, 0, 0);
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; pmrem.dispose(); room.dispose();
  const fill = new THREE.HemisphereLight(0xffffff, 0xa8a4bd, 2);
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-2, 3, 5);
  scene.add(fill, key);
  const materials = {
    wax: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .54, metalness: 0, transmission: .13, thickness: .028, ior: 1.38, clearcoat: .08 }),
    polish: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .12, metalness: 0, clearcoat: 1, clearcoatRoughness: .1 }),
  };
  const samples = {};
  const pigments = {}, heights = {};
  for (const [i, id] of ['wax', 'polish'].entries()) {
    const mesh = new THREE.Mesh(createShellSampleGeometry(id === 'wax' ? .028 : .008), materials[id]);
    mesh.position.x = i === 0 ? -1.16 : 1.16; mesh.rotation.set(-.15, i === 0 ? -.42 : .42, 0);
    scene.add(mesh); samples[id] = mesh;
    const buffer = new Float32Array(mesh.geometry.attributes.position.array.length);
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(buffer, 3));
    pigments[id] = createOrbColor(buffer, new THREE.Color(color('rose')).toArray(), { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    heights[id] = Float32Array.from({ length: buffer.length / 3 }, (_, i) => (mesh.geometry.attributes.position.array[i * 3 + 1] + 1.2) / 2.4);
  }
  const canvas = renderer.domElement; canvas.className = 'shell-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  mount.replaceChildren(canvas);
  let active = false, disposed = false, frame = 0, last = 0, width = 0, height = 0, selected = 'wax', chosen = false, auto = true;
  let composition, pointer, thickness = 'medium';
  const events = new AbortController(), motion = matchMedia('(prefers-reduced-motion: reduce)');
  function resize() {
    const box = mount.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (box.width === width && box.height === height) return;
    width = box.width; height = box.height; renderer.setSize(width, height, false);
    const halfHeight = Math.max(1.6, 2.35 * height / width);
    camera.left = -halfHeight * width / height; camera.right = -camera.left; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
  }
  function draw(time) {
    frame = 0;
    if (!active || disposed || document.hidden) { last = 0; return; }
    resize(); if (!width || !height) return;
    const dt = last ? Math.min(.05, (time - last) / 1000) : 0; last = time;
    const rotating = auto && !motion.matches && !pointer && !composition;
    let coloring = false;
    for (const [id, pigment] of Object.entries(pigments)) {
      const colorStep = pigment.step(dt);
      if (colorStep.changed) samples[id].geometry.attributes.color.needsUpdate = true;
      coloring ||= colorStep.needsFrame;
    }
    if (rotating) for (const mesh of Object.values(samples)) mesh.rotation.y += dt * .16;
    if (composition) {
      composition.elapsed += dt;
      const progress = motion.matches ? 1 : Math.min(1, composition.elapsed / .65);
      const blend = 1 - (1 - progress) ** 3;
      samples[selected].position.x = composition.from * (1 - blend);
      samples[selected].rotation.y = composition.yaw * (1 - blend);
      const other = samples[selected === 'wax' ? 'polish' : 'wax']; other.scale.setScalar(1 - blend * .3);
      if (progress === 1) { const finish = composition.finish; composition = undefined; finish(); }
    }
    renderer.render(scene, camera);
    mount.dataset.renderCount = String(Number(mount.dataset.renderCount || 0) + 1);
    mount.dataset.yaw = String(samples[selected].rotation.y);
    if (rotating || composition || coloring) invalidate();
  }
  function invalidate() { if (!frame && active && !disposed && !document.hidden) frame = requestAnimationFrame(draw); }
  function settleComposition() { composition?.finish(); composition = undefined; resetPositions(); }
  function resetPositions() { samples.wax.position.x = -1.16; samples.polish.position.x = 1.16; samples.wax.scale.setScalar(1); samples.polish.scale.setScalar(1); }
  function update(draft) {
    settleComposition(); selected = draft.shellMaterial;
    if (thickness !== draft.waxThickness) {
      const colors = samples.wax.geometry.attributes.color;
      samples.wax.geometry.dispose(); samples.wax.geometry = createShellSampleGeometry(thicknesses[draft.waxThickness]);
      samples.wax.geometry.setAttribute('color', colors); thickness = draft.waxThickness;
    }
    materials.wax.thickness = thicknesses[thickness];
    for (const [id, material] of Object.entries(materials)) {
      pigments[id].select(new THREE.Color(color(draft.shellColors[id])).toArray(), heights[id]);
      material.color.setScalar(chosen && id !== selected ? .52 : 1);
      samples[id].position.z = chosen && id !== selected ? -.3 : 0;
    }
    mount.dataset.selected = selected; mount.dataset.thickness = thickness;
    mount.dataset.waxColor = draft.shellColors.wax; mount.dataset.polishColor = draft.shellColors.polish;
    invalidate();
  }
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: events.signal });
  on(canvas, 'pointerdown', event => {
    event.stopPropagation();
    if (event.button !== 0 || pointer || composition) return;
    const box = canvas.getBoundingClientRect(), id = event.clientX < box.x + box.width / 2 ? 'wax' : 'polish';
    chosen = true; selected = id; onSelect(id);
    pointer = { id: event.pointerId, start: event.clientX, last: event.clientX };
    canvas.setPointerCapture(event.pointerId);
  });
  on(canvas, 'pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    samples[selected].rotation.y += (event.clientX - pointer.last) * .012; pointer.last = event.clientX; invalidate();
  });
  function end() { if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id); pointer = undefined; last = 0; invalidate(); }
  on(canvas, 'pointerup', end); on(canvas, 'pointercancel', end); on(canvas, 'lostpointercapture', () => { pointer = undefined; });
  on(window, 'blur', end);
  on(document, 'visibilitychange', () => { end(); last = 0; if (document.hidden) { settleComposition(); cancelAnimationFrame(frame); frame = 0; } else invalidate(); });
  on(motion, 'change', () => { for (const pigment of Object.values(pigments)) pigment.setReducedMotion(motion.matches); last = 0; invalidate(); });
  on(canvas, 'webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(frame); frame = 0; onUnavailable(); });
  const resizeObserver = new ResizeObserver(invalidate); resizeObserver.observe(mount);
  const applyTheme = () => {
    const night = document.documentElement.dataset.theme === 'night';
    renderer.toneMappingExposure = night ? .9 : 1.05; fill.intensity = night ? 1.7 : 2; invalidate();
  };
  applyTheme();
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return {
    update,
    choose() { chosen = true; },
    rotate(direction) { samples[selected].rotation.y += direction * .32; invalidate(); },
    setAuto(value) { auto = value; invalidate(); },
    setActive(value) {
      active = value; last = 0;
      if (!value) { end(); settleComposition(); cancelAnimationFrame(frame); frame = 0; } else invalidate();
    },
    compose({ signal }) {
      if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      settleComposition(); end();
      return new Promise((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => { composition = undefined; signal.removeEventListener('abort', abort); resetPositions(); reject(new DOMException('Aborted', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        composition = { elapsed: 0, from: samples[selected].position.x, yaw: samples[selected].rotation.y, finish };
        invalidate();
      });
    },
    completeComposition: settleComposition,
    dispose() {
      if (disposed) return; disposed = true; events.abort(); settleComposition(); cancelAnimationFrame(frame); resizeObserver.disconnect(); themeObserver.disconnect();
      for (const sample of Object.values(samples)) { sample.geometry.dispose(); sample.material.dispose(); }
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
