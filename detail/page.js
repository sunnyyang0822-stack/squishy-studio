import { createDetailController, thicknessNames, materialNames } from './state.mjs';
import { createModelPreview, createSilentAudio } from './adapters.js';
import { createPanelMotion } from './panel-motion.js';

const stage = document.querySelector('.toy-stage');
const trigger = document.querySelector('.sound-trigger');
const panel = document.querySelector('.sound-panel');
const slider = document.querySelector('#volume');
const mute = document.querySelector('.mute-button');
const retry = document.querySelector('.retry-button');
const listeners = new AbortController();
const panelMotion = createPanelMotion(panel, { signal: listeners.signal });
let panelOpen = false;
const controller = createDetailController({
  renderer: createModelPreview(document.querySelector('.toy-mount'), { onUnavailable: () => controller.rendererUnavailable() }),
  audio: createSilentAudio(),
  onChange(state) {
    stage.dataset.state = state.resource;
    stage.setAttribute('aria-busy', String(state.resource === 'loading'));
    document.querySelector('.resource-message').hidden = state.resource === 'ready';
    document.querySelector('.resource-status').textContent = { loading: '正在加载圆球…', ready: '', error: '圆球暂时没能加载。可以重试，或先选择喜欢的搭配。', unavailable: '当前环境暂时无法展示圆球。可以重试，仍可调整下方偏好。' }[state.resource];
    retry.hidden = state.resource === 'ready' || state.resource === 'loading';
    document.querySelector('.configuration-summary').textContent = `已选择：${thicknessNames[state.config.thickness]}厚度 · ${materialNames[state.config.material]}`;
    document.querySelector('.configuration-error').hidden = !state.configError;
    document.querySelector('.configuration-error').textContent = '预览更新失败，已保留你的选择。';
    slider.value = state.audio.volume;
    slider.setAttribute('aria-valuetext', `${state.audio.volume}%${state.audio.muted ? '，已静音' : ''}`);
    document.querySelector('#volume-value').value = `${state.audio.volume}%`;
    mute.textContent = state.audio.muted ? '解除静音' : '静音';
    mute.setAttribute('aria-pressed', String(state.audio.muted));
    trigger.setAttribute('aria-label', `音量：${state.audio.muted ? '已静音' : `${state.audio.volume}%`}，打开调节面板`);
    document.querySelector('.sound-indicator').textContent = state.audio.muted ? '已静音' : `${state.audio.volume}%`;
    document.querySelector('.sound-muted-icon').toggleAttribute('hidden', !state.audio.muted);
    document.querySelector('.sound-on-icon').toggleAttribute('hidden', state.audio.muted);
  },
});
const on = (target, event, fn) => target.addEventListener(event, fn, { signal: listeners.signal });
function closePanel(restoreFocus = true, instant = true) {
  panelOpen = false; trigger.setAttribute('aria-expanded', 'false');
  panelMotion.setOpen(false, { instant });
  if (restoreFocus) trigger.focus();
}
on(trigger, 'click', event => {
  if (panelOpen) return closePanel(true, event.detail === 0);
  panelOpen = true; trigger.setAttribute('aria-expanded', 'true');
  panelMotion.setOpen(true, { instant: event.detail === 0 }); slider.focus();
});
on(document.querySelector('.panel-close'), 'click', event => closePanel(true, event.detail === 0));
on(document, 'keydown', event => { if (event.key === 'Escape' && panelOpen) { event.preventDefault(); closePanel(); } });
on(document, 'click', event => { if (panelOpen && !event.target.closest('.sound-tool')) closePanel(false, event.detail === 0); });
on(panel, 'focusout', event => { if (panelOpen && event.relatedTarget && !event.relatedTarget.closest('.sound-tool')) closePanel(false); });
on(slider, 'input', () => controller.setVolume(slider.value));
on(mute, 'click', () => controller.toggleMute());
on(retry, 'click', () => controller.retry());
for (const input of document.querySelectorAll('.choice-group input')) on(input, 'change', () => controller.select(input.name, input.value));
// pagehide also covers bfcache. Reinitializing on restore avoids retaining a
// disposed future WebGL/audio connection or duplicating its event handlers.
on(window, 'pagehide', () => { controller.dispose(); listeners.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
controller.load();
