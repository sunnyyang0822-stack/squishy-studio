import { createDetailController, steps, stepNames, coreNames, fillingNames, materialNames, thicknessNames, decorationNames, colorNames } from './state.mjs';
import { orbColors } from './orb-colors.mjs';
import { createModelPreview, createSilentAudio } from './adapters.js';

const stage = document.querySelector('.toy-stage');
const mount = document.querySelector('.toy-mount');
const options = document.querySelector('.step-options');
const retry = document.querySelector('.retry-button');
const back = document.querySelector('.step-back');
const next = document.querySelector('.step-next');
const listeners = new AbortController();
const on = (target, event, fn) => target.addEventListener(event, fn, { signal: listeners.signal });
const groups = [
  { step: 'core', id: 'coreMaterial', label: '内芯材质', names: coreNames },
  { step: 'core', id: 'coreColor', label: '内芯颜色', names: colorNames, colors: true },
  { step: 'core', id: 'filling', label: '填充物', names: fillingNames },
  { step: 'shell', id: 'shellColor', label: '外壳颜色', names: colorNames, colors: true },
  { step: 'shell', id: 'shellMaterial', label: '外壳材质', names: materialNames },
  { step: 'shell', id: 'waxThickness', label: '蜡的厚度', names: thicknessNames },
  { step: 'decoration', id: 'decoration', label: '装饰', names: decorationNames },
];
const panels = new Map();
const categoryButtons = new Map();
const selectedGroups = { core: 'coreMaterial', shell: 'shellColor', decoration: 'decoration' };
const categoryTabs = document.querySelector('.category-tabs');
const desktopLayout = matchMedia('(min-width: 761px)');
const categoryLabels = { coreMaterial: '材质', coreColor: '颜色', shellColor: '颜色', shellMaterial: '材质', waxThickness: '厚度' };
let controller;
for (const group of groups) {
  const fieldset = document.createElement('fieldset');
  fieldset.id = `group-${group.id}`;
  fieldset.className = `choice-group ${group.colors ? 'color-picker' : ''}`;
  fieldset.dataset.group = group.id;
  fieldset.setAttribute('aria-label',group.label);
  const legend = document.createElement('legend'); legend.textContent = categoryLabels[group.id] || group.label;
  legend.className = 'sr-only';
  if (group.step !== 'decoration') {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'category-button'; button.dataset.category = group.id;
    button.textContent = categoryLabels[group.id] || group.label;
    button.setAttribute('aria-controls', fieldset.id);
    categoryTabs.append(button); categoryButtons.set(group.id, button);
    on(button, 'click', () => { selectedGroups[group.step] = group.id; showGroups(controller.getState()); });
  }
  const choices = document.createElement('div'); choices.className = group.colors ? 'color-options' : 'text-options';
  for (const [id, name] of Object.entries(group.names)) {
    const label = document.createElement('label'); label.className = group.colors ? 'color-choice' : 'text-choice';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = group.id === 'coreColor' ? 'color' : group.id;
    input.value = group.id === 'shellColor' ? `shell-${id}` : id;
    input.dataset.choice = id;
    const face = document.createElement('span'); face.className = group.colors ? 'color-face' : 'text-face';
    if (group.colors) {
      const swatch = document.createElement('span'); swatch.className = 'color-swatch';
      swatch.style.backgroundColor = orbColors.find(color => color.id === id).hex;
      swatch.setAttribute('aria-hidden', 'true'); face.append(swatch);
    }
    const text = document.createElement('span'); text.textContent = name;
    if (group.colors) { text.className = 'color-name'; input.setAttribute('aria-label',name); }
    face.append(text);
    label.append(input, face); choices.append(label);
    on(input, 'change', () => { if (input.checked) void controller.select(group.id, id); });
  }
  fieldset.append(legend, choices); options.append(fieldset); panels.set(group.id, { fieldset, step: group.step });
}
function showGroups(state) {
  const { step, recipe } = state;
  if (selectedGroups.shell === 'waxThickness' && recipe.shellMaterial !== 'wax') selectedGroups.shell = 'shellMaterial';
  categoryTabs.hidden = desktopLayout.matches || !['core','shell'].includes(step);
  for (const [id, panel] of panels) {
    const available = panel.step === step && (id !== 'waxThickness' || recipe.shellMaterial === 'wax');
    const visible = available && (desktopLayout.matches || selectedGroups[step] === id);
    panel.fieldset.querySelector('legend').classList.toggle('sr-only',!desktopLayout.matches);
    const button = categoryButtons.get(id);
    if (button) {
      if (!available && document.activeElement === button) button.blur();
      button.hidden = !available;
      button.setAttribute('aria-expanded',String(visible));
    }
    if (!visible && panel.fieldset.contains(document.activeElement)) document.activeElement.blur();
    panel.fieldset.hidden = !visible;
    for (const input of panel.fieldset.querySelectorAll('input')) input.checked = input.dataset.choice === recipe[id];
  }
}
const url = new URL(location.href);
const styleId = url.searchParams.get('style') || 'orb';
const initialUrl = new URL(location.href);
initialUrl.searchParams.set('style', 'orb');
initialUrl.searchParams.delete('step');
history.replaceState({ squishyStep: 'core' }, '', initialUrl);
controller = createDetailController({
  renderer: createModelPreview(mount, { feelId: 'clay', onUnavailable: () => controller.rendererUnavailable() }),
  audio: createSilentAudio(), styleId,
  onChange(state) {
    const { step, recipe, resource } = state;
    document.querySelector('.step-panel').dataset.step = step;
    const making = step === 'making';
    stage.hidden = making;
    document.querySelector('.making-blank').hidden = !making;
    stage.dataset.state = resource;
    stage.setAttribute('aria-busy', String(resource === 'loading'));
    document.querySelector('.resource-message').hidden = resource === 'ready' && !state.configError;
    document.querySelector('.resource-status').textContent = { loading: '加载中…', ready: state.configError ? '颜色更新失败' : '', error: '加载失败', unavailable: '无法显示圆球' }[resource];
    retry.hidden = !state.configError && (resource === 'ready' || resource === 'loading');
    for (const item of document.querySelectorAll('.workflow-progress li')) {
      const itemIndex = steps.indexOf(item.dataset.step), currentIndex = steps.indexOf(step);
      const status = itemIndex < currentIndex ? 'complete' : itemIndex === currentIndex ? 'current' : 'upcoming';
      item.dataset.status = status;
      if (status === 'current') item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.setAttribute('aria-label', `${itemIndex + 1}. ${stepNames[item.dataset.step]}，${status === 'complete' ? '已完成' : status === 'current' ? '当前步骤' : '未开始'}`);
    }
    document.querySelector('.step-title').textContent = stepNames[step];
    showGroups(state);
    back.hidden = step === 'core';
    back.textContent = step === 'making' || step === 'play' ? '返回修改' : '上一步';
    next.hidden = step === 'play';
    next.textContent = step === 'making' ? '开始捏捏' : '下一步';
    document.querySelector('.configuration-summary').textContent = `当前${stepNames[step]}：内芯${coreNames[recipe.coreMaterial]}、${colorNames[recipe.coreColor]}，填充${fillingNames[recipe.filling]}；外壳${materialNames[recipe.shellMaterial]}、${colorNames[recipe.shellColor]}；装饰${decorationNames[recipe.decoration]}`;
    document.querySelector('.configuration-error').hidden = !state.configError;
  },
});
function navigate(step, replace = false) {
  if (!steps.includes(step) || controller.getState().step === step) return;
  controller.setStep(step);
  const target = new URL(location.href);
  target.searchParams.set('step', step);
  history[replace ? 'replaceState' : 'pushState']({ squishyStep: step }, '', target);
}
on(back, 'click', () => navigate(controller.getState().step === 'play' ? 'decoration' : steps[steps.indexOf(controller.getState().step) - 1]));
on(next, 'click', () => navigate(steps[steps.indexOf(controller.getState().step) + 1]));
on(retry, 'click', () => void controller.retry());
on(desktopLayout, 'change', () => showGroups(controller.getState()));
on(window, 'popstate', event => controller.setStep(steps.includes(event.state?.squishyStep) ? event.state.squishyStep : 'core'));
on(window, 'pagehide', () => { controller.dispose(); listeners.abort(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void controller.load();
