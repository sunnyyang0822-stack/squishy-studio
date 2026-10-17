import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import fontData from '../assets/fredoka-typeface.json';

const stage = document.querySelector('.brand-stage');
const canvas = document.querySelector('.brand-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

try {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.38;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1100 / 490, .1, 100);
  camera.position.set(0, .1, 6.2);
  camera.lookAt(0, .2, 0);

  const ambient = new THREE.AmbientLight(0xffe3ef, 1.35);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2e8, 3.8);
  key.position.set(-3.5, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9df5ff, 1.8);
  fill.position.set(4, -.4, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff83bd, 2.2);
  rim.position.set(1, 3, -4);
  scene.add(rim);

  const face = new THREE.MeshPhysicalMaterial({ color: 0xf72489, roughness: .49, metalness: 0, clearcoat: .5, clearcoatRoughness: .45, specularIntensity: .65 });
  const side = new THREE.MeshPhysicalMaterial({ color: 0xe82786, roughness: .52, metalness: 0, clearcoat: .4, clearcoatRoughness: .48, specularIntensity: .6 });
  const font = new FontLoader().parse(fontData);
  const title = new THREE.Group();
  title.rotation.set(-.09, -.1, -.018);
  title.position.y = -.27;
  scene.add(title);

  function addWord(word, size, y, z, tracking) {
    const group = new THREE.Group();
    const widths = [...word].map(char => fontData.glyphs[char].ha / fontData.resolution * size);
    const fullWidth = widths.reduce((sum, width) => sum + width, 0) + tracking * (word.length - 1);
    let cursor = -fullWidth / 2;
    [...word].forEach((char, index) => {
      const geometry = new TextGeometry(char, {
        font, size, depth: .46, curveSegments: 18, steps: 2,
        bevelEnabled: true, bevelThickness: .22, bevelSize: .125, bevelSegments: 8,
      });
      const letter = new THREE.Mesh(geometry, [face, side]);
      letter.position.set(cursor, 0, index % 3 === 1 ? .025 : 0);
      letter.rotation.y = (index % 3 - 1) * .025;
      letter.castShadow = true;
      letter.receiveShadow = true;
      group.add(letter);
      cursor += widths[index] + tracking;
    });
    group.position.set(0, y, z);
    title.add(group);
  }

  addWord('Squishy', 1.52, .55, -.04, -.065);
  addWord('Studio', 1.62, -.78, .3, -.055);

  const day = {
    ambient: new THREE.Color(0xffe3ef), key: new THREE.Color(0xfff2e8),
    fill: new THREE.Color(0x9df5ff), rim: new THREE.Color(0xff83bd),
    face: new THREE.Color(0xf72489), side: new THREE.Color(0xe82786),
    keyPower: 3.3, fillPower: 1.5, exposure: 1.38,
  };
  const night = {
    ambient: new THREE.Color(0x958bc8), key: new THREE.Color(0xffbee1),
    fill: new THREE.Color(0x80e7ff), rim: new THREE.Color(0xff70b4),
    face: new THREE.Color(0xf250a4), side: new THREE.Color(0xde479c),
    keyPower: 2.7, fillPower: 1.4, exposure: 1.48,
  };
  let light = document.documentElement.dataset.theme === 'night' ? 1 : 0;
  let from = light;
  let target = light;
  let start = performance.now();
  let frame = 0;

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }

  function render() {
    ambient.color.copy(day.ambient).lerp(night.ambient, light);
    key.color.copy(day.key).lerp(night.key, light);
    fill.color.copy(day.fill).lerp(night.fill, light);
    rim.color.copy(day.rim).lerp(night.rim, light);
    face.color.copy(day.face).lerp(night.face, light);
    side.color.copy(day.side).lerp(night.side, light);
    key.intensity = THREE.MathUtils.lerp(day.keyPower, night.keyPower, light);
    fill.intensity = THREE.MathUtils.lerp(day.fillPower, night.fillPower, light);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(day.exposure, night.exposure, light);
    renderer.render(scene, camera);
  }

  function tick(now) {
    const duration = reducedMotion.matches ? 180 : 1150;
    const progress = Math.min((now - start) / duration, 1);
    const eased = progress * progress * (3 - 2 * progress);
    light = THREE.MathUtils.lerp(from, target, eased);
    render();
    if (progress < 1) frame = requestAnimationFrame(tick);
  }

  new MutationObserver(() => {
    cancelAnimationFrame(frame);
    from = light;
    target = document.documentElement.dataset.theme === 'night' ? 1 : 0;
    start = performance.now();
    frame = requestAnimationFrame(tick);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  new ResizeObserver(resize).observe(stage);
  resize();
  stage.classList.add('is-3d-ready');
} catch (error) {
  console.error('3D 字标无法初始化，已显示备用字标。', error);
}
