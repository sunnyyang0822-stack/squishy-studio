import { createMaker } from './controller.mjs';
import { coreNames, shellNames, thicknessNames, styles, readLocation, writeLocation } from './recipe.mjs';
import { orbColors, colorNames } from '../detail/orb-colors.mjs';
import { createCoreScene, createFinishedScene, finishedSupport } from './providers.js';
import { createSamples } from './samples-adapter.js';

const $ = selector => document.querySelector(selector);
const events = new AbortController();
const on = (el, type, fn) => el.addEventListener(type, fn, { signal: events.signal });
let maker, lastStep, started = false, auto = true;
function chooseShell(id) {
  samples.choose();
  void maker.select('shellMaterial', id).then(() => samples.update(maker.getState().draft));
}
const core = createCoreScene($('.toy-mount'), { onUnavailable: () => maker?.unavailable() });
const samples = createSamples($('.samples-mount'), { onSelect: chooseShell, onUnavailable: () => maker?.unavailable() });
for (const [selector, group, names, colors] of [
  ['.core-materials', 'coreMaterial', coreNames],
  ['.core-colors', 'coreColor', colorNames, true],
  ['.shell-colors', 'shellColor', colorNames, true],
  ['.wax-thickness', 'waxThickness', thicknessNames],
]) {
  for (const [id, name] of Object.entries(names)) {
    const label = document.createElement('label'); label.className = colors ? 'color-choice' : 'text-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = group; input.value = id; input.setAttribute('aria-label', name);
    const face = document.createElement('span'); face.className = colors ? 'color-face' : 'text-face';
    if (colors) {
      const hex = orbColors.find(color => color.id === id).hex;
      label.style.setProperty('--swatch-color', hex);
      const swatch = document.createElement('span'); swatch.className = 'color-swatch'; swatch.style.backgroundColor = hex;
      face.append(swatch);
    } else face.textContent = name;
    face.setAttribute('aria-hidden', 'true'); label.append(input, face); $(selector).append(label);
    on(input, 'change', () => { if (input.checked) void maker.select(group, id); });
  }
}
const stepOrder = ['shape', 'core', 'shell', 'making', 'play'];
const titles = { core: '内芯试捏', shell: '选壳片', making: '合成', play: '自己的捏捏' };
const initial = readLocation(location.href);
function render(state) {
  const { draft, recipe, step, status, error, support } = state;
  const style = styles.find(style => style.id === recipe.styleId);
  document.title = `制作${style.name}｜Squishy Studio`;
  $('.toy-area').setAttribute('aria-label', style.name);
  const collectionUrl = writeLocation(new URL('/collections/', location.href), { draft, step: 'core' });
  if (recipe.styleId !== 'orb') collectionUrl.hash = 'style-' + recipe.styleId;
  $('.detail-back').href = collectionUrl.pathname + collectionUrl.search + collectionUrl.hash;
  $('.step-panel').dataset.step = step;
  $('.maker-title').textContent = titles[step];
  $('.toy-stage').hidden = step !== 'core';
  $('.toy-stage').dataset.state = status === 'error' ? 'error' : 'ready';
  $('.toy-stage').setAttribute('aria-busy', String(status === 'loading'));
  $('.sample-stage').hidden = !['shell', 'making'].includes(step);
  $('.sample-stage').dataset.composing = String(step === 'making');
  $('.finished-stage').hidden = step !== 'play' || status === 'error';
  for (const id of ['core', 'shell', 'making', 'play']) $(`.${id}-settings`).hidden = step !== id;
  const thick = $('.thickness-group');
  if (recipe.shellMaterial !== 'wax' && thick.contains(document.activeElement)) document.activeElement.blur();
  thick.hidden = recipe.shellMaterial !== 'wax';
  for (const radio of document.querySelectorAll('.maker-options input')) {
    radio.checked = radio.value === (radio.name === 'shellColor' ? recipe.shellColor : draft[radio.name]);
  }
  for (const button of document.querySelectorAll('[data-shell]')) {
    button.setAttribute('aria-pressed', String(button.dataset.shell === recipe.shellMaterial));
    button.disabled = step === 'making';
  }
  for (const item of document.querySelectorAll('.workflow-progress li')) {
    const index = stepOrder.indexOf(item.dataset.step), current = stepOrder.indexOf(step);
    item.dataset.status = index < current ? 'complete' : index === current ? 'current' : 'upcoming';
    if (index === current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  }
  $('.support-message').hidden = step !== 'shell' || support.supported;
  $('.support-message').textContent = support.reason || '';
  $('.maker-error').hidden = !error;
  $('.maker-error').textContent = error;
  $('.preview-error').hidden = status !== 'error';
  $('.preview-error').textContent = status === 'error' ? error : '';
  $('.maker-retry').hidden = status !== 'error';
  $('.maker-next').hidden = !['core', 'shell'].includes(step);
  $('.maker-next').textContent = step === 'core' ? '选壳片' : '合成捏捏';
  $('.maker-next').disabled = status !== 'ready' || step === 'shell' && !support.supported;
  $('.maker-back').hidden = step === 'core';
  $('.maker-back').textContent = ['play', 'making'].includes(step) ? '返回修改' : '上一步';
  $('.restore-product').disabled = status !== 'ready' || state.restoring;
  $('.restore-product').textContent = state.restoring ? '恢复中' : '恢复成品';
  $('.recipe-caption').textContent = `${style.name} · ${coreNames[recipe.coreMaterial]} · ${shellNames[recipe.shellMaterial]}${recipe.shellMaterial === 'wax' ? ' · ' + thicknessNames[recipe.waxThickness] : ''}`;
  $('.maker-status').textContent = `${titles[step]}，${status === 'loading' ? '加载中' : status === 'ready' ? '可操作' : error}`;
  if (lastStep !== step && started) $('.maker-title').focus({ preventScroll: true });
  lastStep = step;
  history.replaceState({ maker: true }, '', writeLocation(location.href, state));
}
maker = createMaker({
  core, samples, initial, support: finishedSupport,
  createFinished: () => createFinishedScene($('.finished-mount'), { onUnavailable: () => maker?.unavailable() }),
  onChange: render,
});
function navigate(fn) {
  const before = location.href;
  void fn();
  const after = location.href;
  if (before !== after) { history.replaceState({ maker: true }, '', before); history.pushState({ maker: true }, '', after); }
}
on($('.maker-next'), 'click', () => navigate(() => maker.next()));
on($('.maker-back'), 'click', () => navigate(() => maker.back()));
on($('.maker-retry'), 'click', () => void maker.retry());
on($('.restore-product'), 'click', () => void maker.restore());
for (const button of document.querySelectorAll('[data-shell]')) on(button, 'click', () => chooseShell(button.dataset.shell));
on($('.rotate-left'), 'click', () => samples.rotate(-1));
on($('.rotate-right'), 'click', () => samples.rotate(1));
on($('.auto-rotate'), 'click', () => {
  auto = !auto; samples.setAuto(auto);
  $('.auto-rotate').setAttribute('aria-pressed', String(auto)); $('.auto-rotate').textContent = auto ? '自动转动' : '转动已停';
});
on($('.skip-composition'), 'click', () => samples.completeComposition());
on(window, 'popstate', () => void maker.restoreLocation(readLocation(location.href)));
on(window, 'pagehide', () => { maker.dispose(); events.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
render(maker.getState()); started = true; void maker.load();
