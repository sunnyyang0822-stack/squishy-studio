// Owns one independent selection scene. No toy model or fracture engine here.
export function createSamples(mount, options) {
  let scene, loading, disposed = false, active = false, chosen = false, auto = true, revision = 0, attempts = 0;
  async function update(draft) {
    const own = ++revision;
    if (!scene) {
      if (!loading) loading = import('/assets/shell-samples.js' + (attempts++ ? '?retry=' + attempts : ''));
      const module = await loading.catch(error => { loading = undefined; throw error; });
      if (disposed || own !== revision) return;
      scene ||= module.createShellSamples(mount, { ...options, onUnavailable() {
        scene?.dispose(); scene = undefined; options.onUnavailable?.();
      } });
      if (chosen) scene.choose(); scene.setAuto(auto); scene.setActive(active);
    }
    if (!disposed && own === revision) scene.update(draft);
  }
  return {
    update,
    setActive(value) { active = value; scene?.setActive(value); },
    choose() { chosen = true; scene?.choose(); },
    rotate(direction) { scene?.rotate(direction); },
    setAuto(value) { auto = value; scene?.setAuto(value); },
    compose(context) { return scene?.compose(context) || Promise.reject(new Error('Samples not ready')); },
    completeComposition() { scene?.completeComposition(); },
    dispose() { disposed = true; revision++; scene?.dispose(); },
  };
}
