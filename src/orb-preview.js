import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getOrbPreset } from './orb-presets.mjs';
import { getOrbFeel } from './orb-feels.mjs';
import { getSquishyStyle } from './squishy-styles.mjs';
import { createSurfaceGeometry } from './surface-clay.mjs';
import { getOrbAppearance } from './orb-appearance.mjs';
import { bindOrbInput } from './orb-input.js';
import { bindOrbRotation } from './orb-rotation.js';
import { createOrbColor } from './orb-color.mjs';
import { orbColors } from '../detail/orb-colors.mjs';

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
export function createOrbPreview(mount, { onUnavailable = () => {}, presetId, feelId, styleId = 'orb', appearanceId } = {}) {
  const preset = presetId === undefined ? null : getOrbPreset(presetId);
  feelId ??= preset?.feelId ?? 'clay';
  appearanceId ??= preset?.appearanceId ?? 'matte';
  const feel = getOrbFeel(feelId);
  const appearance = getOrbAppearance(appearanceId);
  const interactionLabel = feel.id === 'slow-rebound' ? '缓慢按下，松开后缓慢完整回弹' : '可按压留痕';
  const style = getSquishyStyle(styleId);
  if (!style.supportedFeels.includes(feelId)) throw new RangeError(`${style.name}尚未支持此质感`);
  const isSurface = style.geometryAdapter === 'surface';
  const modelUrl = style.modelUrl;
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
    const mesh = root.getObjectByName(style.meshName);
    if (!mesh?.isMesh || !mesh.geometry.attributes.normal || !mesh.geometry.index || Array.isArray(mesh.material)) {
      releaseObject(root); throw new Error('Invalid squishy surface');
    }
    const geometry = mesh.geometry;
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    let deformation;
    try {
      deformation = isSurface
        ? getOrbPreset(feelId).createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, { surfaceGeometry: createSurfaceGeometry(geometry.attributes.position.array, geometry.attributes.normal.array, geometry.index.array, style.geometryOptions), reducedMotion: motionPreference.matches })
        : feel.createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array, { reducedMotion: motionPreference.matches });
    } catch (error) { releaseObject(root); throw error; }
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      releaseObject(root);
      throw Object.assign(error, { code: 'UNAVAILABLE' });
    }
    mesh.scale.multiply(new THREE.Vector3(...appearance.scale));
    const scene = new THREE.Scene();
    const pivot = new THREE.Group();
    const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    // Keep one immutable rotation center. A non-symmetric outline may change
    // its projected bounds while turning; the object origin never orbits.
    if (!isSurface) pivot.position.copy(center);
    root.position.sub(center); pivot.add(root); scene.add(pivot);
    const restingFloor = isSurface ? new THREE.Box3().setFromObject(root).min.y - .003 : -.908 * appearance.scale[1];
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
    key.position.set(...(isSurface ? [-3.8, 3.2, 2.1] : [-3.5, 2.4, 1.8]));
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
    floor.position.y = restingFloor;
    scene.add(floor);

    const camera = new THREE.OrthographicCamera(-2, 2, 1.6, -1.6, .1, 30);
    camera.position.set(...style.camera);
    camera.lookAt(0, -.02, 0);
    const frontFill = isSurface ? new THREE.DirectionalLight(0xffffff, .95) : null;
    if (frontFill) { frontFill.position.copy(camera.position); scene.add(frontFill); }
    const events = new AbortController();
    // Diffuse, solid surface. Colors share the existing geometry and material;
    // no new GLBs, textures, transparent shells or layered draw calls.
    const sourceMaterial = mesh.material;
    mesh.material = getOrbPreset(feelId).createMaterial(sourceMaterial);
    mesh.material.vertexColors = true;
    sourceMaterial.dispose();
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const coatingColors = new Float32Array(colors.length);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const restNormals = geometry.attributes.normal.array.slice();
    let computedRestNormals;
    if (isSurface) {
      const reference = geometry.clone(); reference.computeVertexNormals();
      computedRestNormals = reference.attributes.normal.array.slice(); reference.dispose();
    }
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const restSurface = new THREE.Mesh(geometry.clone(), mesh.material);
    let selectedColor = orbColors.find(color => color.id === initialColor) || orbColors[0];
    const coating = createOrbColor(coatingColors, new THREE.Color(selectedColor.hex).toArray(), { reducedMotion: motionPreference.matches });
    colors.set(coatingColors);
    const restPositions = geometry.attributes.position.array.slice();
    renderer.domElement.setAttribute('aria-label', `${selectedColor.name}${isSurface ? style.name : '圆球'}，${interactionLabel}`);
    const surface = document.createElement('button');
    surface.type = 'button'; surface.className = 'orb-input';
    surface.setAttribute('aria-label', feel.id === 'slow-rebound' ? '按住并拖动圆球，缓慢下陷，松开完整回弹；也可按住空格或回车' : '按住并拖动圆球，松开保留凹痕；也可按住空格或回车');
    if (feelId === 'marshmallow') surface.setAttribute('aria-label', '棉花糖，按住逐渐局部压陷，滑动留浅痕，松开完全保留；空格或回车也可按压，换色可复原');
    if (isSurface && feelId !== 'marshmallow') surface.setAttribute('aria-label', `按住并拖动${style.name}，松开保留凹痕；也可按住空格或回车`);
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
    if (style.id === 'pyramid') { initialOrientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.30); pivot.quaternion.copy(initialOrientation); }
    function beginRestore() {
      deformation.beginRestore();
      restorePose = { orientation: pivot.quaternion.clone(), floor: floor.position.y };
    }
    function interruptRestore() { deformation.interruptRestore(); restorePose = undefined; }
    function resize(width, height) {
      current.width = width; current.height = height;
      const halfHeight = Math.max(isSurface ? 1.6 : 1.43, (isSurface ? 1.48 : 1.25) * height / width);
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
        if (isSurface) {
          // Side-biased light exposes dent slopes; modest fill keeps the base
          // readable without washing out the concavity. Sphere is unchanged.
          fill.intensity = daylight ? .65 : .58;
          fill.groundColor.set(daylight ? 0xe4e6ed : 0xcac6da);
          key.intensity = daylight ? 2.7 : 2.5;
          rim.intensity = daylight ? .55 : .65;
          scene.environmentIntensity = daylight ? .28 : .25;
          renderer.toneMappingExposure = daylight ? 1.05 : .95;
        }
      }
      const dt = current.lastTime === null ? 1 / 60 : (time - current.lastTime) / 1000;
      const colorStep = coating.step(dt);
      if (restorePose && colorStep.progress !== undefined) {
        const progress = colorStep.progress, blend = 1 - (1 - progress) ** 3;
        deformation.applyRestore(progress);
        pivot.quaternion.slerpQuaternions(restorePose.orientation, initialOrientation, blend);
        floor.position.y = restorePose.floor + (restingFloor - restorePose.floor) * blend;
        if (progress === 1) { pivot.quaternion.copy(initialOrientation); floor.position.y = restingFloor; }
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
            colors[i + k] = pigment * visibility * appearance.pigmentGain;
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
        } else {
          geometry.computeVertexNormals();
          if (computedRestNormals) {
            // Blender and Three use different smoothing weights. Transport
            // only the deformation's normal delta, preserving the authored
            // rest smoothing everywhere the geometry has not changed.
            const normals = geometry.attributes.normal.array;
            for (let i = 0; i < normals.length; i += 3) {
              for (let k = 0; k < 3; k++) normals[i + k] += restNormals[i + k] - computedRestNormals[i + k];
              const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
              for (let k = 0; k < 3; k++) normals[i + k] /= Math.max(1e-8, length);
            }
          }
        }
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
    current.input = bindOrbInput({ surface, hitTest, deformation, invalidate, onBegin: interruptRestore,
      keyboardPoint: isSurface ? box => {
        // A ring has no surface at its projected center. Keyboard input must
        // select a real visible surface instead of pressing the empty hole.
        for (const [x, y] of [[.5, .5], [.75, .5], [.25, .5], [.5, .3], [.5, .7]]) {
          const hit = hitTest(box.x + box.width * x, box.y + box.height * y, true);
          if (hit) return hit;
        }
        return null;
      } : undefined,
      beforeRelease() {
        // Commit pending marshmallow path input while still pressed. A quick
        // swipe ending between rAF callbacks must not drop its final segment.
        if (feelId === 'marshmallow' && current.frame) {
          cancelAnimationFrame(current.frame); current.frame = 0;
          draw(performance.now());
        }
      },
    });
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
    current.selectColor = (id, { restore = false } = {}) => {
      const next = orbColors.find(color => color.id === id) || orbColors[0];
      if (next.id === selectedColor.id && !restore) return;
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
      coating.select(new THREE.Color(next.hex).toArray(), heights, { restart: restore });
      renderer.domElement.setAttribute('aria-label', `${next.name}${isSurface ? style.name : '圆球'}，${interactionLabel}`);
    };
    current.restore = () => current.selectColor(selectedColor.id, { restore: true });
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
    stopInput() {
      view?.input.cancel();
      view?.rotation.cancel();
    },
    restore() {
      if (!view) return;
      view.input.cancel({ preserveShape: true });
      view.rotation.cancel();
      view.restore();
      view.invalidate();
    },
    async prepare(config, { signal }) {
      if (disposed || signal.aborted) throw abortError();
      if (broken) { destroyView(); broken = false; }
      if (!view) {
        const response = await fetch(modelUrl, { signal });
        if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (signal.aborted || disposed) throw abortError();
        // Reject HTML fallback responses before passing bytes to the loader.
        if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB response');
        const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', new URL(modelUrl, location.href)).href);
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
          mount.dataset.style = style.id;
          mount.dataset.feelId = feelId;
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
