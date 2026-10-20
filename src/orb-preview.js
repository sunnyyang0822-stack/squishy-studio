import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

// One renderer per page, regardless of preference changes. Stage 1A renders on
// demand; there is no animation loop, pointer handler, deformation or audio.
export function createOrbPreview(mount, { onUnavailable = () => {} } = {}) {
  let view;
  let disposed = false;
  let broken = false;

  function destroyView() {
    if (!view) return;
    const old = view;
    view = undefined;
    old.events.abort();
    old.resize.disconnect();
    old.theme.disconnect();
    cancelAnimationFrame(old.frame);
    releaseObject(old.scene);
    old.environment.dispose();
    old.renderer.dispose();
    old.renderer.forceContextLoss();
    old.renderer.domElement.remove();
    delete mount.dataset.renderCount;
  }

  function build(root) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      releaseObject(root);
      throw Object.assign(error, { code: 'UNAVAILABLE' });
    }
    const scene = new THREE.Scene();
    scene.add(root);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '奶油粉色圆球，饱满轮廓、柔和高光与底部阴影；当前为静态外观预览');

    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(studio, .06);
    studio.dispose(); pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = .8;
    const fill = new THREE.HemisphereLight(0xfff4ed, 0x897aab, .9);
    scene.add(fill);
    const key = new THREE.DirectionalLight(0xfff0e4, 2.3);
    key.position.set(-3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe6d8ff, 1.1);
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
    const current = { renderer, scene, environment, camera, events, frame: 0, count: 0 };
    function draw() {
      current.frame = 0;
      if (disposed || broken || view !== current || document.hidden) return;
      const { width, height } = mount.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      const halfHeight = Math.max(1.43, 1.25 * height / width);
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.left = -halfHeight * width / height; camera.right = -camera.left;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      try {
        renderer.render(scene, camera);
        mount.dataset.renderCount = String(++current.count);
      } catch {
        broken = true; destroyView(); onUnavailable();
      }
    }
    function invalidate() {
      if (!current.frame && !disposed && !broken) current.frame = requestAnimationFrame(draw);
    }
    current.resize = new ResizeObserver(invalidate);
    current.resize.observe(mount);
    current.theme = new MutationObserver(invalidate);
    current.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', invalidate, { signal: events.signal });
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
        view = build(gltf.scene);
      }
      const prepared = view;
      return {
        commit() {
          if (disposed || prepared !== view) return;
          mount.replaceChildren(prepared.renderer.domElement);
          mount.dataset.thickness = config.thickness;
          mount.dataset.material = config.material;
          prepared.invalidate();
        },
        // Preference handles share the page scene; only the adapter owns GPU resources.
        dispose() {},
      };
    },
    dispose() { if (!disposed) { disposed = true; destroyView(); } },
  };
}
