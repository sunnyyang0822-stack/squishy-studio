import { squishyStyles } from '../src/squishy-styles.mjs';
import { colorNames } from './orb-colors.mjs';
export { colorNames } from './orb-colors.mjs';

export const steps = Object.freeze(['core', 'shell', 'decoration', 'making', 'play']);
export const stepNames = Object.freeze({ core: '内芯设置', shell: '外壳设置', decoration: '装饰选择', making: '制作准备', play: '开始捏捏' });
export const coreNames = Object.freeze({ clay: '黏土', marshmallow: '棉花糖', butter: '慢回弹' });
export const fillingNames = Object.freeze({ none: '不加', perlite: '珍珠岩', rice: '仿真米粒', burst: '爆浆' });
export const materialNames = Object.freeze({ wax: '蜡', polish: '指甲油', sugar: '糖' });
export const thicknessNames = Object.freeze({ thin: '薄', medium: '中', thick: '厚' });
export const decorationNames = Object.freeze({ one: '1', two: '2', three: '3' });
export const styleNames = Object.freeze(Object.fromEntries(Object.entries(squishyStyles).map(([id, style]) => [id, style.name])));
export const defaultRecipe = Object.freeze({ styleId: 'orb', coreMaterial: 'clay', coreColor: 'rose', filling: 'none', shellMaterial: 'wax', shellColor: 'rose', waxThickness: 'medium', decoration: 'one' });
const groups = Object.freeze({ styleId: styleNames, coreMaterial: coreNames, coreColor: colorNames, filling: fillingNames, shellMaterial: materialNames, shellColor: colorNames, waxThickness: thicknessNames, decoration: decorationNames });
export const effectiveRecipe = recipe => ({ ...recipe, waxThickness: recipe.shellMaterial === 'wax' ? recipe.waxThickness : null });
export const isThinWaxRecipe = recipe => Object.hasOwn(squishyStyles, recipe.styleId) && squishyStyles[recipe.styleId].supportedFeels.includes(recipe.coreMaterial === 'butter' ? 'slow-rebound' : recipe.coreMaterial) && (['clay', 'marshmallow'].includes(recipe.coreMaterial) || recipe.coreMaterial === 'butter' && recipe.styleId === 'orb') && recipe.shellMaterial === 'wax' && recipe.waxThickness === 'thin';
const isLegacyOrbClayWax = recipe => recipe.styleId === 'orb' && recipe.coreMaterial === 'clay' && isThinWaxRecipe(recipe);
export const canRestartThinWax = (step, recipe) => isThinWaxRecipe(recipe) && (['shell', 'decoration'].includes(step) || step === 'play' && isLegacyOrbClayWax(recipe));
// Thick wax composes with the three verified orb cores. Non-clay cores
// remain making previews; their legacy final play still restores the bare core.
export const isThickWaxRecipe = recipe => recipe.styleId === 'orb' && ['clay', 'marshmallow', 'butter'].includes(recipe.coreMaterial) && recipe.shellMaterial === 'wax' && recipe.waxThickness === 'thick';
export const canRestartWax = (step, recipe) => canRestartThinWax(step, recipe) || isThickWaxRecipe(recipe) && (['shell', 'decoration'].includes(step) || step === 'play' && recipe.coreMaterial === 'clay');
// Fixed ordering makes identity independent of URL/object property order. Mode is
// deliberately separate: navigating the same recipe must not repair its shell.
export const recipeKeyFor = recipe => JSON.stringify(Object.keys(defaultRecipe).map(key => effectiveRecipe(recipe)[key]));
export const previewFor = (step, recipe) => ({
  presetId: recipe.coreMaterial === 'butter' ? 'slow-rebound' : recipe.coreMaterial,
  mode: step === 'core' ? 'core' : step === 'making' ? 'hidden' : 'shell',
  // Making previews have no collection tray. Leave the existing final view
  // contract unchanged for its separate owner. This is not recipe identity.
  ...(step === 'play' ? {} : { waxCollection: false }),
  feelId: recipe.coreMaterial === 'butter' ? 'slow-rebound' : recipe.coreMaterial === 'marshmallow' ? 'marshmallow' : 'clay',
  appearanceId: recipe.coreMaterial === 'butter' ? 'full-matte' : 'matte',
  color: step === 'core' ? recipe.coreColor : recipe.shellColor,
  coreColor: recipe.coreColor, shellColor: recipe.shellColor,
  shellMaterial: recipe.shellMaterial, waxThickness: effectiveRecipe(recipe).waxThickness,
  styleId: recipe.styleId, recipeKey: recipeKeyFor(recipe),
});

// Renderer handles are private until commit. A revision rejects late work.
export function createDetailController({ renderer, audio, onChange = () => {}, styleId = 'orb', recipe: initialRecipe = {}, step = 'core' }) {
  let disposed = false, revision = 0, pending, current, applied;
  const recipe = { ...defaultRecipe, styleId: Object.hasOwn(styleNames, styleId) ? styleId : 'orb' };
  for (const [group, value] of Object.entries(initialRecipe)) {
    if (Object.hasOwn(groups[group] || {}, value)) recipe[group] = value;
  }
  let state = {
    step: steps.includes(step) ? step : 'core', resource: 'loading', configStatus: 'idle', configError: false,
    recipe, selectionNotice: '',
    effectiveRecipe: null, preview: null,
    audio: { volume: 0, muted: true, lastNonZero: 50, ready: Boolean(audio.ready) },
  };
  const refreshDerived = () => { state.effectiveRecipe = effectiveRecipe(state.recipe); state.preview = previewFor(state.step, state.recipe); };
  refreshDerived();
  const snapshot = () => structuredClone(state);
  const emit = () => { if (!disposed) onChange(snapshot()); };
  audio.setVolume({ volume: 0, muted: true });

  async function prepare(force = false) {
    if (disposed) return;
    if (state.step === 'making') { emit(); return; }
    const target = { ...state.preview, recipe: structuredClone(state.effectiveRecipe) };
    if (!force && !pending && !state.configError && applied && applied.mode === target.mode && applied.waxCollection === target.waxCollection && applied.recipeKey === target.recipeKey && state.resource === 'ready') { emit(); return; }
    const ownRevision = ++revision;
    pending?.abort();
    const request = new AbortController(); pending = request;
    state = { ...state, resource: current ? 'ready' : 'loading', configStatus: 'updating', configError: false }; emit();
    try {
      const handle = await renderer.prepare(target, { signal: request.signal });
      if (disposed || ownRevision !== revision) { handle?.dispose(); return; }
      pending = undefined;
      if (!handle) { state = { ...state, resource: 'unavailable', configStatus: 'idle' }; emit(); return; }
      handle.commit(); current?.dispose(); current = handle; applied = target;
      state = { ...state, resource: 'ready', configStatus: 'applied' };
    } catch (error) {
      if (disposed || ownRevision !== revision) return;
      pending = undefined;
      state = { ...state, resource: current ? 'ready' : error.code === 'UNAVAILABLE' ? 'unavailable' : 'error', configStatus: 'error', configError: Boolean(current) };
    }
    emit();
  }
  function setStep(step) {
    if (disposed || !steps.includes(step) || state.step === step) return;
    const wasMaking = state.step === 'making';
    state = { ...state, step }; refreshDerived();
    if (step === 'making') { ++revision; pending?.abort(); pending = undefined; renderer.stopInput?.(); emit(); return; }
    const preserveDamage = (isThickWaxRecipe(state.recipe) || isThinWaxRecipe(state.recipe)) && (step !== 'play' || isLegacyOrbClayWax(state.recipe) || isThickWaxRecipe(state.recipe) && state.recipe.coreMaterial === 'clay');
    if (wasMaking && step === 'play' && !preserveDamage) {
      // Preview-only recipes keep the legacy final core restore without
      // repairing the same recipe's temporarily hidden preview shell.
      if ((isThinWaxRecipe(state.recipe) || isThickWaxRecipe(state.recipe)) && !isLegacyOrbClayWax(state.recipe)) renderer.restore?.({ preserveShell: true });
      else renderer.restore?.();
    }
    void prepare(step === 'play' && !preserveDamage);
  }
  return {
    getState: snapshot, load: () => prepare(true), retry: () => prepare(true), setStep,
    restart() {
      if (disposed || pending || state.resource !== 'ready' || state.configError || !canRestartWax(state.step, state.recipe)) return;
      renderer.restore?.();
    },
    restoreLocation({ styleId = 'orb', recipe: restored = {}, step = 'core' }) {
      if (disposed) return Promise.resolve();
      const recipe = { ...defaultRecipe, styleId: Object.hasOwn(styleNames, styleId) ? styleId : 'orb' };
      for (const [group, value] of Object.entries(restored)) if (Object.hasOwn(groups[group] || {}, value)) recipe[group] = value;
      ++revision; pending?.abort(); pending = undefined; renderer.stopInput?.();
      state = { ...state, recipe, step: steps.includes(step) ? step : 'core', selectionNotice: '' };
      refreshDerived();
      return prepare();
    },
    next() { const index = steps.indexOf(state.step); if (index < steps.length - 1) setStep(steps[index + 1]); },
    previous() { const index = steps.indexOf(state.step); if (index > 0) setStep(steps[index - 1]); },
    select(group, value) {
      if (disposed || !Object.hasOwn(groups[group] || {}, value) || state.recipe[group] === value) return Promise.resolve();
      state = { ...state, recipe: { ...state.recipe, [group]: value }, selectionNotice: '' }; refreshDerived();
      return prepare();
    },
    rendererUnavailable() {
      if (disposed) return;
      ++revision; pending?.abort(); current?.dispose(); current = undefined; applied = undefined;
      state = { ...state, resource: 'unavailable', configStatus: 'idle', configError: false }; emit();
    },
    setVolume(value) {
      if (disposed || !Number.isFinite(Number(value))) return;
      const volume = Math.round(Math.max(0, Math.min(100, Number(value))));
      state.audio = { ...state.audio, volume, muted: volume === 0, lastNonZero: volume || state.audio.lastNonZero };
      audio.setVolume({ volume: volume / 100, muted: volume === 0 }); emit();
    },
    toggleMute() { if (!disposed) this.setVolume(state.audio.muted ? state.audio.lastNonZero : 0); },
    dispose() { if (disposed) return; disposed = true; ++revision; pending?.abort(); current?.dispose(); renderer.dispose?.(); audio.dispose(); },
  };
}
