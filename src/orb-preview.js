import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getOrbFeel } from './orb-feels.mjs';
import { bindOrbInput } from './orb-input.js';
import { bindOrbRotation } from './orb-rotation.js';
import { createOrbColor } from './orb-color.mjs';
import { orbColors } from '../detail/orb-colors.mjs';

const MODEL_URL = '/assets/models/squishy-orb.glb';
const abortError = () => new DOMException('Aborted', 'AbortError');
function releaseObject(root) {
  root?.traverse(object => {
    object.geometry?.dispose();
    for (const material of [].concat(object.material || [])) {
      material.map?.dispose(); material.dispose();
    }
  });
}

// One renderer per page. Frames run only while deformation is changing or the
// viewport needs redrawing. Audio and shell fracture are outside this adapter.
export function createOrbPreview(mount, { onUnavailable = () => {}, feelId = 'clay' } = {}) {
  const feel = getOrbFeel(feelId);
  const interactionLabel = feel.id === 'slow-rebound' ? '缓慢按下，松开后缓慢完整回弹' : '可按压留痕';
  let view;
  let disposed = false;
  let broken = false;

  function destroyView() {
    if (!view) return;
    const old = view;
    view = undefined;
    old.events.abort();
    old.input.dispose();
    old.rotation.dispose();
    old.restSurface.geometry.dispose();
    old.resize.disconnect();
    old.theme.disconnect();
    cancelAnimationFrame(old.frame);
    releaseObject(old.scene);
    old.environment.dispose();
    old.renderer.dispose();
    old.renderer.forceContextLoss();
    old.renderer.domElement.remove();
    old.surface.remove();
    delete mount.dataset.renderCount;
  }

  function build(root, initialColor) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      releaseObject(root);
      throw Object.assign(error, { code: 'UNAVAILABLE' });
    }
    const scene = new THREE.Scene();
    const pivot = new THREE.Group();
    const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    pivot.position.copy(center); root.position.sub(center); pivot.add(root); scene.add(pivot);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '奶油粉色圆球，局部按压后部分恢复并保留凹痕');

    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(studio, .06);
    studio.dispose(); pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = .28;
    const fill = new THREE.HemisphereLight(0xfff7ef, 0x8a8293, .42);
    scene.add(fill);
    const key = new THREE.DirectionalLight(0xfff5ed, 2.6);
    key.position.set(-3.5, 2.4, 1.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe9e4ff, .55);
    rim.position.set(3, 2, -3); scene.add(rim);
    // Static soft contact shadow. No shadow-map pass for this appearance gate.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const context = shadowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(75, 43, 83, .32)');
    gradient.addColorStop(.4, 'rgba(75, 43, 83, .20)');
    gradient.addColorStop(1, 'rgba(75, 43, 83, 0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    shadowTexture.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.908;
    scene.add(floor);

    const camera = new THREE.OrthographicCamera(-2, 2, 1.6, -1.6, .1, 30);
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, -.02, 0);
    const events = new AbortController();
    const mesh = root.getObjectByName('Orb_Surface');
    const geometry = mesh.geometry;
    // Diffuse, solid surface. Colors share the existing geometry and material;
    // no new GLBs, textures, transparent shells or layered draw calls.
    mesh.material.color.set(0xffffff);
    mesh.material.roughness = .82;
    mesh.material.metalness = 0;
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const coatingColors = new Float32Array(colors.length);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const restNormals = geometry.attributes.normal.array.slice();
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const restSurface = new THREE.Mesh(geometry.clone(), mesh.material);
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    let selectedColor = orbColors.find(color => color.id === initialColor) || orbColors[0];
    const coating = createOrbColor(coatingColors, new THREE.Color(selectedColor.hex).toArray(), { reducedMotion: motionPreference.matches });
    colors.set(coatingColors);
    const restPositions = geometry.attributes.position.array.slice();
    renderer.domElement.setAttribute('aria-label', `${selectedColor.name}圆球，${interactionLabel}`);
    const deformation = feel.createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, { reducedMotion: motionPreference.matches });
    const surface = document.createElement('button');
    surface.type = 'button'; surface.className = 'orb-input';
    surface.setAttribute('aria-label', feel.id === 'slow-rebound' ? '按住并拖动圆球，缓慢下陷，松开完整回弹；也可按住空格或回车' : '按住并拖动圆球，松开保留凹痕；也可按住空格或回车');
    surface.setAttribute('aria-pressed', 'false');
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    restSurface.matrixWorld.copy(mesh.matrixWorld);
    function hitTest(x, y, actual) {
      pivot.updateMatrixWorld(true);
      restSurface.matrixWorld.copy(mesh.matrixWorld);
      const box = renderer.domElement.getBoundingClientRect();
      pointer.set((x - box.x) / box.width * 2 - 1, -(y - box.y) / box.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // Validate the current rendered surface on press; use the undeformed
      // surface for a stable drag anchor, so a stationary press cannot drift.
      if (actual && !raycaster.intersectObject(mesh, false).length) return null;
      const hit = raycaster.intersectObject(restSurface, false)[0];
      if (!hit) return null;
      return mesh.worldToLocal(hit.point).toArray();
    }
    const current = { renderer, scene, environment, camera, events, restSurface, surface, frame: 0, count: 0, lastTime: null, width: 0, height: 0 };
    let restorePose;
    let daylight = document.documentElement.dataset.theme !== 'night', colorLightingDirty = true;
    const initialOrientation = new THREE.Quaternion();
    function beginRestore() {
      deformation.beginRestore();
      restorePose = { orientation: pivot.quaternion.clone(), floor: floor.position.y };
    }
    function interruptRestore() { deformation.interruptRestore(); restorePose = undefined; }
    function resize(width, height) {
      current.width = width; current.height = height;
      const halfHeight = Math.max(1.43, 1.25 * height / width);
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.left = -halfHeight * width / height; camera.right = -camera.left;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      updateBounds();
      current.input.resize();
    }
    function updateBounds() {
      const { width, height } = current;
      if (!width || !height) return;
      pivot.updateMatrixWorld(true);
      restSurface.matrixWorld.copy(mesh.matrixWorld);
      // Only the projected toy reserves touch gestures. Transparent stage
      // margins and every other page region retain native scrolling.
      const projected = new THREE.Vector3();
      let left = 1, right = -1, top = -1, bottom = 1;
      const position = restSurface.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        projected.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(camera);
        left = Math.min(left, projected.x); right = Math.max(right, projected.x);
        top = Math.max(top, projected.y); bottom = Math.min(bottom, projected.y);
      }
      Object.assign(surface.style, { left: `${(left + 1) * width / 2}px`, top: `${(1 - top) * height / 2}px`, width: `${(right - left) * width / 2}px`, height: `${(top - bottom) * height / 2}px` });
    }
    function draw(time) {
      current.frame = 0;
      if (disposed || broken || view !== current || document.hidden) { current.lastTime = null; return; }
      const { width, height } = mount.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      if (width !== current.width || height !== current.height) resize(width, height);
      if (colorLightingDirty) {
        // A neutral daylight response keeps pastel pigment clear; the broad
        // pale fill lifts the grey underside without flattening the side key.
        // Night restores its original filmic response and warm/purple lights.
        renderer.toneMapping = daylight ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = daylight ? 1.15 : .95;
        fill.intensity = daylight ? .85 : .42;
        fill.color.set(daylight ? 0xffffff : 0xfff7ef);
        fill.groundColor.set(daylight ? 0xe4e6ed : 0x8a8293);
        key.color.set(daylight ? 0xffffff : 0xfff5ed);
      }
      const dt = current.lastTime === null ? 1 / 60 : (time - current.lastTime) / 1000;
      const colorStep = coating.step(dt);
      if (restorePose && colorStep.progress !== undefined) {
        const progress = colorStep.progress, blend = 1 - (1 - progress) ** 3;
        deformation.applyRestore(progress);
        pivot.quaternion.slerpQuaternions(restorePose.orientation, initialOrientation, blend);
        floor.position.y = restorePose.floor + (-.908 - restorePose.floor) * blend;
        if (progress === 1) { pivot.quaternion.copy(initialOrientation); floor.position.y = -.908; }
        updateBounds();
        if (progress === 1) restorePose = undefined;
      }
      const step = deformation.step(dt);
      const needsFrame = step.needsFrame || colorStep.needsFrame;
      current.lastTime = needsFrame ? time : null;
      if (colorStep.changed || step.changed || colorLightingDirty) {
        const positions = geometry.attributes.position.array;
        // Gentle cavity shading keeps retained impressions legible under the
        // broad fill. It is a bounded visual approximation, not a shadow pass.
        for (let i = 0; i < colors.length; i += 3) {
          const depth = Math.hypot(restPositions[i] - positions[i], restPositions[i + 1] - positions[i + 1], restPositions[i + 2] - positions[i + 2]);
          const visibility = 1 - Math.min(.24, depth);
          // Daylight compensation preserves pastel chroma through the soft
          // studio lighting/tone mapping. The palette and coating clock stay
          // in their original color space; night uses the unmodified color.
          const luminance = .2126 * coatingColors[i] + .7152 * coatingColors[i + 1] + .0722 * coatingColors[i + 2];
          for (let k = 0; k < 3; k++) {
            const pigment = daylight ? Math.max(0, Math.min(1, (luminance + (coatingColors[i + k] - luminance) * 1.3) * 1.06)) : coatingColors[i + k];
            colors[i + k] = pigment * visibility;
          }
        }
        colorLightingDirty = false;
        geometry.attributes.color.needsUpdate = true;
      }
      if (step.changed) {
        geometry.attributes.position.needsUpdate = true;
        if (step.atRest) {
          geometry.attributes.normal.array.set(restNormals);
          geometry.attributes.normal.needsUpdate = true;
        } else geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
      }
      try {
        renderer.render(scene, camera);
        mount.dataset.renderCount = String(++current.count);
        if (needsFrame) invalidate();
      } catch {
        broken = true; destroyView(); onUnavailable();
      }
    }
    function invalidate() {
      if (!current.frame && !disposed && !broken && view === current && !document.hidden) current.frame = requestAnimationFrame(draw);
    }
    current.input = bindOrbInput({ surface, hitTest, deformation, invalidate, onBegin: interruptRestore });
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const turn = new THREE.Quaternion(), worldPoint = new THREE.Vector3();
    current.rotation = bindOrbRotation({ isSqueezing: current.input.isActive, rotate(dx, dy) {
      interruptRestore();
      pivot.quaternion.premultiply(turn.setFromAxisAngle(up, dx));
      pivot.quaternion.premultiply(turn.setFromAxisAngle(right, dy));
      updateBounds();
      let lowest = Infinity;
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        worldPoint.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        lowest = Math.min(lowest, worldPoint.y);
      }
      floor.position.y = lowest - .003;
      invalidate();
    } });
    current.selectColor = id => {
      const next = orbColors.find(color => color.id === id) || orbColors[0];
      if (next.id === selectedColor.id) return;
      selectedColor = next;
      // A different color starts a fresh toy, without rebuilding the scene.
      // End captured gestures first so a held key/pointer cannot reapply a dent.
      current.input.cancel({ preserveShape: true });
      current.rotation.cancel();
      beginRestore();
      current.lastTime = null;
      geometry.computeBoundingSphere();
      updateBounds();
      pivot.updateMatrixWorld(true);
      const heights = new Float32Array(geometry.attributes.position.count);
      let low = Infinity, high = -Infinity;
      for (let i = 0; i < heights.length; i++) {
        worldPoint.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
        heights[i] = worldPoint.y; low = Math.min(low, heights[i]); high = Math.max(high, heights[i]);
      }
      for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] - low) / Math.max(.001, high - low);
      coating.select(new THREE.Color(next.hex).toArray(), heights);
      renderer.domElement.setAttribute('aria-label', `${next.name}圆球，${interactionLabel}`);
    };
    motionPreference.addEventListener('change', event => {
      deformation.setReducedMotion(event.matches); coating.setReducedMotion(event.matches); invalidate();
      if (restorePose) beginRestore();
    }, { signal: events.signal });
    current.resize = new ResizeObserver(invalidate);
    current.resize.observe(mount);
    current.theme = new MutationObserver(() => {
      daylight = document.documentElement.dataset.theme !== 'night';
      colorLightingDirty = true; invalidate();
    });
    current.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', () => {
      // Slow rebound pauses offscreen after input cancellation. Resume from the
      // current mesh, without integrating hidden wall time into a visible jump.
      if (feel.id === 'slow-rebound') current.lastTime = null;
      invalidate();
    }, { signal: events.signal });
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      broken = true;
      destroyView();
      onUnavailable();
    }, { signal: events.signal });
    current.invalidate = invalidate;
    return current;
  }

  return {
    async prepare(config, { signal }) {
      if (disposed || signal.aborted) throw abortError();
      if (broken) { destroyView(); broken = false; }
      if (!view) {
        const response = await fetch(MODEL_URL, { signal });
        if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (signal.aborted || disposed) throw abortError();
        // Reject HTML fallback responses before passing bytes to the loader.
        if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB response');
        const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', new URL(MODEL_URL, location.href)).href);
        if (signal.aborted || disposed) { releaseObject(gltf.scene); throw abortError(); }
        view = build(gltf.scene, config.color);
      }
      const prepared = view;
      return {
        commit() {
          if (disposed || prepared !== view) return;
          // Reattaching an unchanged button would lose active pointer capture.
          if (prepared.renderer.domElement.parentNode !== mount || prepared.surface.parentNode !== mount) {
            mount.replaceChildren(prepared.renderer.domElement, prepared.surface);
          }
          mount.dataset.color = config.color || orbColors[0].id;
          prepared.selectColor(config.color);
          prepared.invalidate();
        },
        // Preference handles share the page scene; only the adapter owns GPU resources.
        dispose() {},
      };
    },
    dispose() { if (!disposed) { disposed = true; destroyView(); } },
  };
}
