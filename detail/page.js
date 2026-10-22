import { createDetailController, colorNames } from './state.mjs';
import { orbColors } from './orb-colors.mjs';
import { createModelPreview, createSilentAudio } from './adapters.js';

const stage = document.querySelector('.toy-stage');
const retry = document.querySelector('.retry-button');
const listeners = new AbortController();
const palette = document.querySelector('.color-options');
// Names, native controls and the renderer share one color table.
for (const color of orbColors) {
  const label = document.createElement('label');
  label.className = 'color-choice';
  const input = document.createElement('input');
  input.type = 'radio'; input.name = 'color'; input.value = color.id;
  input.checked = color.id === 'rose';
  const face = document.createElement('span'); face.className = 'color-face';
  const swatch = document.createElement('span');
  swatch.className = 'color-swatch'; swatch.style.backgroundColor = color.hex;
  swatch.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span'); name.textContent = color.name;
  face.append(swatch, name); label.append(input, face); palette.append(label);
}
const controller = createDetailController({
  renderer: createModelPreview(document.querySelector('.toy-mount'), { feelId: document.querySelector('.toy-mount').dataset.feelId || 'clay', onUnavailable: () => controller.rendererUnavailable() }),
  audio: createSilentAudio(),
  onChange(state) {
    stage.dataset.state = state.resource;
    stage.setAttribute('aria-busy', String(state.resource === 'loading'));
    document.querySelector('.preview-badge').textContent = { loading: '加载中', ready: '捏压原型', error: '加载失败', unavailable: '暂不可用' }[state.resource];
    document.querySelector('.resource-message').hidden = state.resource === 'ready' && !state.configError;
    document.querySelector('.resource-status').textContent = { loading: '正在加载圆球…', ready: state.configError ? '颜色暂时没能更新，可以重新加载。' : '', error: '圆球暂时没能加载。可以重试，或先选个喜欢的颜色。', unavailable: '当前环境暂时无法展示圆球。可以重试，仍可选择下方颜色。' }[state.resource];
    retry.hidden = !state.configError && (state.resource === 'ready' || state.resource === 'loading');
    document.querySelector('.configuration-summary').textContent = `已选择：${colorNames[state.config.color]}`;
    for (const input of palette.querySelectorAll('input')) input.checked = input.value === state.config.color;
    document.querySelector('.configuration-error').hidden = !state.configError;
    document.querySelector('.configuration-error').textContent = '已保留你的颜色选择。';
  },
});
const on = (target, event, fn) => target.addEventListener(event, fn, { signal: listeners.signal });
on(retry, 'click', () => controller.retry());
for (const input of palette.querySelectorAll('input')) on(input, 'change', () => controller.select('color', input.value));
on(window, 'pagehide', () => { controller.dispose(); listeners.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
controller.load();
