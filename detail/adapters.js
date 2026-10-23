// Lazy import keeps settings and retry usable if the engine bundle fails.
export function createModelPreview(mount, options) {
  let renderer;
  let disposed = false;
  let rendererKey;
  let attempt = 0;
  let revision = 0;
  const preparing = new Set();
  return {
    async prepare(config, context) {
      const nextFeel = config.feelId || options?.feelId || 'clay';
      const styleId = config.styleId || options?.styleId || 'orb';
      const appearanceId = config.appearanceId || options?.appearanceId || 'matte';
      const key = `${styleId}:${nextFeel}:${appearanceId}`;
      const ownRevision = ++revision;
      let candidate = key === rendererKey ? renderer : undefined;
      let owned = false, committed = false;
      if (!candidate) {
        // Failed module fetches are cached by browsers; a retry needs a fresh URL.
        const url = '/assets/orb-preview.js' + (attempt ? `?retry=${attempt}` : '');
        attempt++;
        const module = await import(url);
        if (disposed || context.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (ownRevision !== revision) throw new DOMException('Aborted', 'AbortError');
        candidate = module.createOrbPreview(mount, { ...options, feelId: nextFeel, styleId, appearanceId });
        owned = true; preparing.add(candidate);
      }
      try {
        const handle = await candidate.prepare(config, context);
        if (disposed || context.signal.aborted || ownRevision !== revision) throw new DOMException('Aborted', 'AbortError');
        return {
          commit() {
            if (disposed || context.signal.aborted || ownRevision !== revision) return;
            if (candidate !== renderer) { renderer?.dispose(); renderer = candidate; rendererKey = key; }
            preparing.delete(candidate); committed = true; handle.commit(); mount.dataset.appearanceId = appearanceId;
          },
          dispose() { handle.dispose(); if (owned && !committed) { preparing.delete(candidate); candidate.dispose(); } },
        };
      } catch (error) {
        if (owned) { preparing.delete(candidate); candidate.dispose(); }
        throw error;
      }
    },
    stopInput() { renderer?.stopInput?.(); },
    restore() { renderer?.restore?.(); },
    dispose() { disposed = true; revision++; renderer?.dispose(); for (const candidate of preparing) candidate.dispose(); preparing.clear(); },
  };
}

// Retained illustration adapter for independent UI fixtures and future assets.
// Preparing never mutates the live mount. Only a current revision may commit.
export function createStaticPreview(mount, url = '/assets/samples/cloud-preview.svg') {
  return {
    async prepare(config, { signal }) {
      if (typeof Image === 'undefined') throw Object.assign(new Error('No image renderer'), { code: 'UNAVAILABLE' });
      const image = new Image(640, 410);
      image.alt = '饱满圆润、带柔和高光的奶油小云静态外观';
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        const clean = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
        const abort = () => { clean(); image.removeAttribute('src'); reject(new DOMException('Aborted', 'AbortError')); };
        image.onload = () => { clean(); resolve(); };
        image.onerror = () => { clean(); reject(new Error('Preview image failed')); };
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        image.src = url;
      });
      return {
        commit() { mount.replaceChildren(image); mount.dataset.thickness = config.thickness; mount.dataset.material = config.material; },
        dispose() { image.remove(); image.removeAttribute('src'); },
      };
    },
    dispose() { mount.replaceChildren(); },
  };
}

// The normalized master gain contract for a future audio adapter. No sound is
// played, loaded, or synthesized. ready stays false until real sources exist.
export function createSilentAudio() {
  return { ready: false, setVolume({ volume, muted }) { this.output = { volume, muted }; }, dispose() { this.output = { volume: 0, muted: true }; } };
}
