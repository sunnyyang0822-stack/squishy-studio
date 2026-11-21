import { normalizeDraft, effectiveRecipe } from './recipe.mjs';

export function createMaker({ core, samples, createFinished, support, initial = {}, onChange = () => {} }) {
  let state = { draft: normalizeDraft(initial.draft), step: ['core', 'shell', 'play'].includes(initial.step) ? initial.step : 'core',
    status: 'idle', error: '', restoring: false };
  let disposed = false, request, revision = 0, finished, coreApplied, playingRecipe;
  const snapshot = () => ({ ...structuredClone(state), recipe: effectiveRecipe(state.draft), support: support(effectiveRecipe(state.draft)) });
  const emit = () => { if (!disposed) onChange(snapshot()); };
  function cancel() { revision++; request?.abort(); request = undefined; core.stopInput(); finished?.stopInput(); }
  function releaseFinished() { finished?.dispose(); finished = undefined; playingRecipe = undefined; }
  async function render() {
    cancel();
    const own = revision, context = new AbortController(); request = context;
    const recipe = effectiveRecipe(state.draft);
    if (state.step !== 'core') { core.suspend?.(); coreApplied = undefined; }
    state = { ...state, status: 'loading', error: '', restoring: false }; emit();
    try {
      if (state.step === 'shell') {
        samples.setActive(true); await samples.update(state.draft);
      } else if (state.step === 'core') {
        samples.setActive(false);
        const key = JSON.stringify([recipe.styleId, recipe.coreMaterial, recipe.coreColor]);
        if (key !== coreApplied) { await core.update(recipe, { signal: context.signal }); if (own === revision) coreApplied = key; }
      } else {
        const capability = support(recipe);
        if (!capability.supported) {
          state.step = 'shell'; samples.setActive(true); await samples.update(state.draft);
          if (own !== revision || disposed) return;
          state.status = 'ready'; state.error = capability.reason; emit(); return;
        }
        if (state.step === 'making') {
          samples.setActive(true); await samples.update(state.draft);
        } else samples.setActive(false);
        if (disposed || own !== revision) return;
        releaseFinished();
        const candidate = createFinished(); finished = candidate;
        await Promise.all([
          candidate.initialize(recipe, { signal: context.signal }),
          state.step === 'making' ? samples.compose({ signal: context.signal }) : Promise.resolve(),
        ]);
        if (disposed || own !== revision) return;
        playingRecipe = recipe; state.step = 'play'; samples.setActive(false);
      }
      if (disposed || own !== revision) return;
      state.status = 'ready'; request = undefined; emit();
    } catch (error) {
      if (disposed || own !== revision) return;
      samples.completeComposition?.();
      state.status = 'error'; state.error = error.code === 'UNSUPPORTED' ? error.message : '加载失败，请重试'; request = undefined;
      if (['play', 'making'].includes(state.step)) releaseFinished();
      emit();
    }
  }
  return {
    getState: snapshot, load: render, retry: render,
    select(group, value) {
      if (disposed || !['core', 'shell'].includes(state.step)) return Promise.resolve();
      const next = structuredClone(state.draft);
      if (group === 'shellColor') next.shellColors[next.shellMaterial] = value;
      else if (['styleId', 'coreMaterial', 'coreColor', 'shellMaterial', 'waxThickness'].includes(group)) next[group] = value;
      else return Promise.resolve();
      const normalized = normalizeDraft(next);
      if (JSON.stringify(normalized) === JSON.stringify(state.draft)) return Promise.resolve();
      state.draft = normalized;
      return render();
    },
    next() {
      if (disposed || state.status !== 'ready') return Promise.resolve();
      if (state.step === 'core') state.step = 'shell';
      else if (state.step === 'shell') {
        const capability = support(effectiveRecipe(state.draft));
        if (!capability.supported) { state.error = capability.reason; emit(); return Promise.resolve(); }
        state.step = 'making';
      } else return Promise.resolve();
      return render();
    },
    back() {
      if (disposed || state.step === 'core') return Promise.resolve();
      state.step = state.step === 'shell' ? 'core' : 'shell';
      cancel(); releaseFinished(); return render();
    },
    restoreLocation(next) {
      if (disposed) return Promise.resolve();
      cancel(); releaseFinished();
      state = { ...state, draft: normalizeDraft(next.draft), step: ['core', 'shell', 'play'].includes(next.step) ? next.step : 'core', error: '' };
      return render();
    },
    async restore() {
      if (disposed || state.step !== 'play' || state.status !== 'ready' || state.restoring || !playingRecipe) return;
      const own = revision; state.restoring = true; emit();
      try { await finished.restore(); }
      catch { if (own === revision && !disposed) { state.error = '恢复失败，请重试'; state.status = 'error'; } }
      finally { if (own === revision && !disposed) { state.restoring = false; emit(); } }
    },
    unavailable() {
      if (disposed) return;
      cancel(); coreApplied = undefined; state.status = 'error'; state.error = '无法显示模型，请重试'; emit();
    },
    dispose() { if (!disposed) { cancel(); disposed = true; core.dispose(); samples.dispose(); releaseFinished(); } },
  };
}
