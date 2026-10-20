export const thicknessNames = Object.freeze({ thin: '薄', medium: '中', thick: '厚' });
export const materialNames = Object.freeze({ wax: '蜡', polish: '指甲油', sugar: '糖' });

// Rendering and audio are independent, injected adapters. No AudioContext or GLB is
// created by the UI. Async render work must prepare privately and commit only
// through its returned handle once this controller accepts its revision.
export function createDetailController({ renderer, audio, onChange = () => {} }) {
  let disposed = false;
  let revision = 0;
  let pending;
  let current;
  let state = {
    resource: 'loading', configStatus: 'idle', configError: false,
    config: { thickness: 'medium', material: 'wax' },
    audio: { volume: 0, muted: true, lastNonZero: 50, ready: Boolean(audio.ready) },
  };
  const snapshot = () => structuredClone(state);
  const emit = () => { if (!disposed) onChange(snapshot()); };
  const outputAudio = () => audio.setVolume({ volume: state.audio.volume / 100, muted: state.audio.muted });
  outputAudio();

  async function prepare() {
    if (disposed) return;
    const ownRevision = ++revision;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    state = { ...state, resource: current ? 'ready' : 'loading', configStatus: 'updating', configError: false };
    emit();
    try {
      const handle = await renderer.prepare({ ...state.config }, { signal: request.signal });
      if (disposed || ownRevision !== revision) { handle?.dispose(); return; }
      if (!handle) { state = { ...state, resource: 'unavailable', configStatus: 'idle' }; emit(); return; }
      handle.commit();
      current?.dispose();
      current = handle;
      state = { ...state, resource: 'ready', configStatus: 'applied' };
    } catch (error) {
      if (disposed || ownRevision !== revision) return;
      state = { ...state, resource: current ? 'ready' : error.code === 'UNAVAILABLE' ? 'unavailable' : 'error', configStatus: 'error', configError: Boolean(current) };
    }
    emit();
  }
  return {
    getState: snapshot,
    load: prepare,
    retry: prepare,
    rendererUnavailable() {
      if (disposed) return;
      ++revision; pending?.abort(); current?.dispose(); current = undefined;
      state = { ...state, resource: 'unavailable', configStatus: 'idle', configError: false };
      emit();
    },
    select(group, value) {
      if (disposed || !Object.hasOwn(group === 'thickness' ? thicknessNames : group === 'material' ? materialNames : {}, value)) return Promise.resolve();
      if (state.config[group] === value) return Promise.resolve();
      state = { ...state, config: { ...state.config, [group]: value } };
      return prepare();
    },
    setVolume(value) {
      if (disposed || !Number.isFinite(Number(value))) return;
      const volume = Math.round(Math.max(0, Math.min(100, Number(value))));
      state.audio = { ...state.audio, volume, muted: volume === 0, lastNonZero: volume || state.audio.lastNonZero };
      outputAudio(); emit();
    },
    toggleMute() { if (!disposed) this.setVolume(state.audio.muted ? state.audio.lastNonZero : 0); },
    dispose() {
      if (disposed) return;
      disposed = true; ++revision; pending?.abort(); current?.dispose(); renderer.dispose?.(); audio.dispose();
    },
  };
}
