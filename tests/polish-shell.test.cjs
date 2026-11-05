const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');
async function fixture(shellOptions = {}) {
  const THREE = await import('three');
  const { createPolishShell } = await import('../src/polish-shell.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const data = readMesh('assets/models/squishy-orb.glb');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setIndex(data.indices);
  const rest = geometry.attributes.position.array.slice();
  const core = getOrbFeel(shellOptions.feelId || 'clay').createDeformation(geometry.attributes.position.array, geometry.attributes.normal.array);
  const shell = createPolishShell({ geometry, color: '#fff0cb', ...shellOptions });
  return { THREE, geometry, core, shell, rest };
}
function advance(f, duration, dt = 1 / 60, moves = 0) {
  for (let t = 0; t < duration - 1e-8; t += dt) {
    for (let k = 0; k < moves; k++) f.shell.move([0, .0175, 1]);
    f.core.step(Math.min(dt, duration - t)); f.geometry.computeVertexNormals(); f.shell.step(dt);
  }
}
function begin(f, p = [0, .0175, 1]) { f.core.begin(p); f.shell.begin(p); }
function end(f) { f.core.release(); f.shell.end(); }
test('independent immutable polish preset, opaque satin coating and fresh instance state', async () => {
  const { getPolishPreset } = await import('../src/polish-shell.mjs');
  assert.equal(getPolishPreset().id, 'polish-shell'); assert.ok(Object.isFrozen(getPolishPreset()));
  assert.throws(() => getPolishPreset('thin-wax'), RangeError);
  const f = await fixture(), g = await fixture(); begin(f); advance(f, 1);
  assert.equal(f.shell.material.transparent, false); assert.equal(f.shell.material.depthTest, true);
  assert.equal(f.shell.material.depthWrite, true); assert.equal(f.shell.material.metalness, 0);
  assert.ok(f.shell.material.roughness >= .43 && f.shell.material.roughness <= .55);
  assert.equal(g.shell.getState().maxDamage, 0);
  assert.deepEqual(g.geometry.attributes.position.array, g.rest);
  f.shell.dispose(); g.shell.dispose();
});
test('actual local depth grows cracks and openings, remote core and damage stay intact', async () => {
  const f = await fixture(); begin(f); advance(f, .14);
  const shallow = f.shell.getState(); advance(f, 2.5);
  const deep = f.shell.getState(), snapshot = f.shell.getSurfaceSnapshot();
  assert.ok(shallow.maxDamage > 0 && shallow.maxDamage < .15, JSON.stringify(shallow));
  assert.ok(deep.maxDamage > shallow.maxDamage + .35);
  assert.ok(deep.maxOpening > shallow.maxOpening + .25);
  for (let i = 0; i < snapshot.damage.length; i++) if (snapshot.restPositions[i * 3 + 2] < 0) {
    assert.equal(snapshot.damage[i], 0); assert.equal(snapshot.contacts[i], 0);
  }
  assert.equal(deep.fragmentCount, 0); f.shell.dispose();
});
test('one long hold and dense move events contribute one local contact, repeated cycles accumulate with a fixed budget', async () => {
  const f = await fixture(); begin(f); advance(f, 3, 1 / 60, 8);
  const first = f.shell.getState(); assert.equal(first.maxLocalContacts, 1);
  const budget = first.vertexBudget;
  end(f); advance(f, 1); begin(f); advance(f, .3); end(f);
  assert.equal(f.shell.getState().maxLocalContacts, 2);
  assert.ok(f.shell.getState().maxDamage > first.maxDamage);
  for (let n = 0; n < 30; n++) { begin(f); advance(f, .1); end(f); }
  assert.ok(f.shell.getState().maxDamage <= 1); assert.equal(f.shell.getState().vertexBudget, budget);
  assert.equal(f.shell.getState().maxLocalContacts, 12); f.shell.dispose();
});
test('frame step and stationary move density do not materially change damage', async () => {
  const a = await fixture(), b = await fixture(); begin(a); begin(b);
  advance(a, 2, 1 / 60, 0); advance(b, 2, 1 / 120, 5);
  assert.equal(a.shell.getState().maxLocalContacts, 1); assert.equal(b.shell.getState().maxLocalContacts, 1);
  assert.ok(Math.abs(a.shell.getState().maxDamage - b.shell.getState().maxDamage) < .02);
  assert.ok(Math.abs(a.shell.getState().maxOpening - b.shell.getState().maxOpening) < .01);
  a.shell.dispose(); b.shell.dispose();
});
test('sparse and dense moving samples share actual depth history; a sliding new region starts at one contact', async () => {
  const a = await fixture(), b = await fixture();
  const point = angle => [Math.sin(angle), .0175, Math.cos(angle)];
  const start = point(-.95), finish = point(.95);
  a.shell.begin(start); b.shell.begin(start);
  const retainedDepth = new Float32Array(a.rest.length / 3);
  for (let frame = 0; frame <= 24; frame++) {
    const angle = -.95 + 1.9 * frame / 24, p = point(angle);
    if (frame) {
      a.shell.move(p);
      for (let move = 1; move <= 10; move++) b.shell.move(point(-.95 + 1.9 * (frame - 1 + move / 10) / 24));
    }
    // Feed the exact same physical surface/depth trajectory to both shells.
    // Input event density is the only independent variable.
    for (let i = 0; i < retainedDepth.length; i++) {
      const j = i * 3, q = Math.hypot(...p.map((v, k) => a.rest[j + k] - v)) / .62;
      retainedDepth[i] = Math.max(retainedDepth[i], .12 * Math.max(0, 1 - q * q) ** 2);
      for (let k = 0; k < 3; k++) a.geometry.attributes.position.array[j + k] = a.rest[j + k] - a.geometry.attributes.normal.array[j + k] * retainedDepth[i];
    }
    b.geometry.attributes.position.array.set(a.geometry.attributes.position.array);
    a.shell.step(1 / 60); b.shell.step(1 / 60);
  }
  const sa = a.shell.getSurfaceSnapshot(), sb = b.shell.getSurfaceSnapshot();
  let error = 0;
  for (let i = 0; i < sa.damage.length; i++) error = Math.max(error, Math.abs(sa.damage[i] - sb.damage[i]));
  assert.ok(error < .012, `Moving sample-density damage error ${error}`);
  assert.equal(a.shell.getState().maxLocalContacts, 1); assert.equal(b.shell.getState().maxLocalContacts, 1);
  const nearest = p => {
    let index = 0, distance = Infinity;
    for (let i = 0; i < sa.damage.length; i++) {
      const d = Math.hypot(...p.map((v, k) => a.rest[i * 3 + k] - v));
      if (d < distance) { distance = d; index = i; }
    }
    return index;
  };
  const old = nearest(start), fresh = nearest(finish);
  assert.equal(sa.contacts[old], 1); assert.equal(sa.contacts[fresh], 1);
  const freshDamage = sa.damage[fresh];
  a.shell.end(); a.shell.begin(start); a.shell.sync();
  const repeated = a.shell.getSurfaceSnapshot();
  assert.equal(repeated.contacts[old], 2); assert.equal(repeated.contacts[fresh], 1);
  assert.ok(repeated.damage[old] > sa.damage[old]); assert.equal(repeated.damage[fresh], freshDamage);
  a.shell.dispose(); b.shell.dispose();
});
test('actual shell face, edge and centroid samples remain outside deep clay and explicit restore', async () => {
  const f = await fixture(); begin(f); advance(f, 3); end(f); advance(f, .5);
  for (const progress of [null, .1, .5, .9, 1]) {
    if (progress !== null) { if (progress === .1) f.core.beginRestore(); f.core.applyRestore(progress); f.core.step(0); f.geometry.computeVertexNormals(); f.shell.sync(); }
    const metrics = f.shell.getMetrics();
    assert.equal(metrics.violations, 0, JSON.stringify(metrics));
    assert.ok(metrics.minGap > .002, JSON.stringify(metrics));
    assert.ok(metrics.maxGap < .003501);
    assert.ok(metrics.samples > 30000);
  }
  f.shell.dispose();
});
test('independent full-core ray queries check real deep shell edges and face centers', async () => {
  const f = await fixture(); begin(f); advance(f, 3);
  const s = f.shell.getSurfaceSnapshot(), coreMesh = new f.THREE.Mesh(f.geometry, new f.THREE.MeshBasicMaterial());
  coreMesh.updateMatrixWorld(); let samples = 0;
  for (let t = 0; t < s.indices.length; t += 117) {
    const ids = s.indices.slice(t, t + 3);
    const weights = [[.5, .5, 0], [0, .5, .5], [.5, 0, .5], [1 / 3, 1 / 3, 1 / 3]];
    for (const w of weights) {
      const p = new f.THREE.Vector3(...[0, 1, 2].map(k => ids.reduce((sum, i, n) => sum + s.positions[i * 3 + k] * w[n], 0)));
      const normal = new f.THREE.Vector3(...[0, 1, 2].map(k => ids.reduce((sum, i, n) => sum + s.normals[i * 3 + k] * w[n], 0))).normalize();
      const ray = new f.THREE.Raycaster(p, normal.negate());
      const hit = ray.intersectObject(coreMesh)[0];
      assert.ok(hit, 'Whole rendered core under this actual skin sample');
      assert.ok(hit.distance >= .002 && hit.distance <= .0036, `Independent gap ${hit.distance}`);
      samples++;
    }
  }
  assert.ok(samples > 500); f.shell.dispose();
});
test('crack mask discards a real coating while independent core ray intersection stays visible', async () => {
  const f = await fixture(), { polishCrackVisible } = await import('../src/polish-shell.mjs');
  begin(f); advance(f, 3);
  const snapshot = f.shell.getSurfaceSnapshot(); let openings = 0;
  const coreMesh = new f.THREE.Mesh(f.geometry, new f.THREE.MeshBasicMaterial()); coreMesh.updateMatrixWorld();
  // Probe barycentric points on the actual core triangles under damaged mask.
  for (let n = 0; n < snapshot.indices.length; n += 3) {
    const ids = snapshot.indices.slice(n, n + 3);
    const rest = [0, 1, 2].map(k => ids.reduce((sum, i) => sum + snapshot.restPositions[i * 3 + k] / 3, 0));
    const damage = ids.reduce((sum, i) => sum + snapshot.damage[i] / 3, 0), opening = ids.reduce((sum, i) => sum + snapshot.opening[i] / 3, 0);
    if (!polishCrackVisible(rest, damage, opening)) continue;
    const p = new f.THREE.Vector3(...[0, 1, 2].map(k => ids.reduce((sum, i) => sum + f.geometry.attributes.position.array[i * 3 + k] / 3, 0)));
    const normal = new f.THREE.Vector3(...[0, 1, 2].map(k => ids.reduce((sum, i) => sum + f.geometry.attributes.normal.array[i * 3 + k] / 3, 0))).normalize();
    const ray = new f.THREE.Raycaster(p.clone().addScaledVector(normal, .02), normal.clone().negate());
    assert.ok(ray.intersectObject(coreMesh).length, 'The crack reveals the real core, not empty background');
    openings++;
  }
  assert.ok(openings > 5, `Actual open triangle samples ${openings}`);
  assert.equal(f.shell.material.color.getHexString(), 'fff0cb');
  assert.equal(f.geometry.attributes.color, undefined, 'Shell leaves core pigment ownership alone');
  f.shell.dispose();
});
test('release retains history, reset clears it, cancel/hidden end cannot detach and idle stops', async () => {
  const f = await fixture(); begin(f); advance(f, 2); const history = f.shell.getState().maxDamage;
  end(f); advance(f, 3); assert.equal(f.shell.getState().maxDamage, history);
  f.shell.cancel(); f.shell.end(); assert.equal(f.shell.getState().fragmentCount, 0);
  f.core.reset(); f.geometry.computeVertexNormals(); f.shell.reset();
  assert.equal(f.shell.getState().maxDamage, 0); assert.equal(f.shell.getState().maxLocalContacts, 0);
  assert.equal(f.shell.step(1 / 60).needsFrame, false); assert.equal(f.shell.step(1 / 60).changed, false);
  let geometryDisposed = 0, materialDisposed = 0;
  f.shell.geometry.addEventListener('dispose', () => geometryDisposed++); f.shell.material.addEventListener('dispose', () => materialDisposed++);
  f.shell.dispose(); f.shell.dispose(); assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1);
  assert.equal(f.geometry.attributes.position.array.length, f.rest.length);
});


test('first contact keeps large cells; repeated pressure overlays finer layers without shrinking primary pieces', async () => {
  const { polishCrackLayers } = await import('../src/polish-shell.mjs');
  const f = await fixture(); begin(f); advance(f, 4);
  const first = f.shell.getState(), layers = polishCrackLayers(first.maxDamage, first.maxOpening);
  assert.ok(first.maxDamage <= .641, 'Even a deep first contact stays in the coarse stage');
  assert.equal(layers[0].scale, 2.15); assert.equal(layers[1].strength, 0); assert.equal(layers[2].strength, 0);
  const initialWidth = layers[0].width;
  for (let n = 0; n < 12; n++) { end(f); advance(f, .2); begin(f); advance(f, .4); }
  const later = polishCrackLayers(f.shell.getState().maxDamage, f.shell.getState().maxOpening);
  assert.ok(later[1].strength > .9 && later[2].strength > .9);
  assert.deepEqual(later.map(l => l.scale), layers.map(l => l.scale), 'Existing networks never rescale');
  assert.equal(later[0].width, initialWidth, 'Deeper repeated dents cannot keep widening the primary gap');
  assert.ok(later[1].width / later[1].scale < later[0].width / later[0].scale, 'Later lines stay finer');
  f.shell.dispose();
});

test('maximum layered damage preserves film coverage and crossing cracks without unbounded erosion', async () => {
  const { polishCrackVisible, polishCrackLayers, polishCrackField } = await import('../src/polish-shell.mjs');
  let open = 0, samples = 0, overlaps = 0, coarse = 0;
  const layers = polishCrackLayers(1, 10);
  for (let y = -.65; y <= .65; y += .013) for (let x = -.65; x <= .65; x += .013) {
    if (x*x+y*y > .65*.65) continue;
    const p = [x, y, Math.sqrt(1-x*x-y*y)]; samples++;
    const hits = layers.map(l => { const field = polishCrackField(p, l.scale); return l.strength > field.threshold && field.edge < l.width; });
    if (hits[0]) coarse++; if (hits.filter(Boolean).length > 1) overlaps++;
    if (polishCrackVisible(p, 1, 10)) open++;
    assert.equal(polishCrackVisible(p, 1, .25), polishCrackVisible(p, 1, 10), 'Opening saturates independently from extreme depth');
  }
  assert.ok(coarse > 10 && overlaps > 0, 'Coarse cracks persist and fine networks can intersect them');
  assert.ok(open / samples < .13 * 1.5, `Film coverage at saturation ${1-open/samples}`);
  assert.ok(open / samples > .005, 'Real openings remain present');
});


test('crack rim is enabled only for identical core and film pigment, without changing apertures', async () => {
  const equal = await fixture({ coreColor: '#fff0cb' }), different = await fixture({ coreColor: '#ADCFB4' }), unknown = await fixture();
  try {
    for (const f of [equal, different, unknown]) { begin(f); advance(f, 3); }
    assert.equal(equal.shell.getState().rimEnabled, true);
    assert.equal(different.shell.getState().rimEnabled, false);
    assert.equal(unknown.shell.getState().rimEnabled, false);
    for (const [f, enabled] of [[equal, 1], [different, 0], [unknown, 0]]) {
      const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' };
      f.shell.material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.polishRimEnabled.value, enabled);
      assert.ok(shader.fragmentShader.includes('rim*polishRimEnabled'));
    }
    assert.deepEqual(equal.shell.getSurfaceSnapshot(), different.shell.getSurfaceSnapshot(), 'Outline choice must not change geometry, damage or opening');
  } finally { for (const f of [equal, different, unknown]) f.shell.dispose(); }
});


test('marshmallow film cracks by 60ms at small actual pressure, without changing its core yield', async () => {
  const f = await fixture({ feelId: 'marshmallow' }), normal = await fixture({ feelId: 'marshmallow' });
  begin(f); begin(normal); advance(f, .06); advance(normal, .06);
  const s = f.shell.getState(), snapshot = f.shell.getSurfaceSnapshot();
  const { polishCrackVisible } = await import('../src/polish-shell.mjs');
  assert.ok(s.maxOpening > 0 && s.maxOpening < .03, JSON.stringify(s));
  assert.ok(s.maxDamage > .08, 'Light actual core displacement activates the early coarse film');
  let visible = 0;
  for (let n=0;n<snapshot.indices.length;n+=3) {
    const ids=snapshot.indices.slice(n,n+3);
    for(const w of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6],[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]]){
      const p=[0,1,2].map(k=>ids.reduce((a,i,j)=>a+snapshot.restPositions[i*3+k]*w[j],0));
      const d=ids.reduce((a,i,j)=>a+snapshot.damage[i]*w[j],0), o=ids.reduce((a,i,j)=>a+snapshot.opening[i]*w[j],0);
      if(polishCrackVisible(p,d,o,0,s.crackWidthGain))visible++;
    }
  }
  assert.ok(visible>0, 'A real early mask opening occurs by 60ms');
  assert.deepEqual(f.geometry.attributes.position.array,normal.geometry.attributes.position.array);
  f.shell.dispose();normal.shell.dispose();
});

test('fine cracks develop from the primary network with a blended junction instead of an unrelated overlay', async () => {
  const { polishCrackSample, polishCrackLayers } = await import('../src/polish-shell.mjs');
  let childSamples=0, joined=0;
  for(let y=-.6;y<=.6;y+=.012)for(let x=-.6;x<=.6;x+=.012){
    if(x*x+y*y>.36)continue;
    const p=[x,y,Math.sqrt(1-x*x-y*y)], sample=polishCrackSample(p,.72,.2);
    const reach=.015+.60*polishCrackLayers(.72,.2)[1].strength;
    if(sample.fields[0].edge>reach+.08)assert.equal(sample.layers[1].strength,0);
    if(sample.hits[1]){childSamples++;assert.ok(sample.fields[0].edge<reach+.08);}
    if(sample.fields[0].edge<.02 && sample.hits[1]){
      assert.ok(sample.layers[1].width>polishCrackLayers(.72,.2)[1].width,'Child opening blends into the primary junction');joined++;
    }
  }
  assert.ok(childSamples>10 && joined>0,JSON.stringify({childSamples,joined}));
});

test('slow-rebound coating remembers a small bounded area loss after the actual core fully recovers', async () => {
  const f=await fixture({feelId:'slow-rebound'}), {polishCrackLayers,polishCrackVisible}=await import('../src/polish-shell.mjs');
  begin(f);advance(f,2);const pressed=f.shell.getState(), history=f.shell.getSurfaceSnapshot().damage;
  assert.ok(pressed.maxResidualOpening>0 && pressed.maxResidualOpening<=.070001);
  end(f);advance(f,18);
  const recovered=f.shell.getState(),s=f.shell.getSurfaceSnapshot();
  assert.equal(recovered.maxOpening,0);assert.equal(recovered.maxResidualOpening,pressed.maxResidualOpening);
  assert.deepEqual(s.damage,history);assert.deepEqual(f.geometry.attributes.position.array,f.rest);
  let added=0;
  for(let n=0;n<s.indices.length;n+=3){
    const ids=s.indices.slice(n,n+3),p=[0,1,2].map(k=>ids.reduce((a,i)=>a+s.restPositions[i*3+k]/3,0));
    const d=ids.reduce((a,i)=>a+s.damage[i]/3,0),r=ids.reduce((a,i)=>a+s.residual[i]/3,0);
    if(polishCrackVisible(p,d,0,r)&&!polishCrackVisible(p,d,0,0))added++;
  }
  assert.ok(added>0,'Recovered real apertures retain wider uncovered film than reversible-only seams');
  assert.ok(polishCrackLayers(1,0,.07)[0].width<polishCrackLayers(1,.25,.07)[0].width,'Residual is a fraction of a held opening');
  assert.equal(f.shell.getMetrics().violations,0);
  f.core.reset();f.geometry.computeVertexNormals();f.shell.reset();assert.equal(f.shell.getState().maxResidualOpening,0);f.shell.dispose();
});


test('residual film contraction stays bounded even at maximum damage and extreme depth', async () => {
  const {polishCrackVisible}=await import('../src/polish-shell.mjs');let samples=0,held=0,recovered=0;
  for(let y=-.65;y<=.65;y+=.018)for(let x=-.65;x<=.65;x+=.018){
    if(x*x+y*y>.65*.65)continue;const p=[x,y,Math.sqrt(1-x*x-y*y)];samples++;
    held+=+polishCrackVisible(p,1,1,.07);recovered+=+polishCrackVisible(p,1,0,.07);
  }
  assert.ok(held/samples<.17 * 1.5,`Extreme held coverage ${1-held/samples}`);
  assert.ok(recovered/samples<.10 * 1.5,`Recovered coverage ${1-recovered/samples}`);
  assert.ok(recovered>0 && recovered<held,'The residual seam is visible but does not erode the whole coating');
});


test('only marshmallow film gains another 50% aperture width over the previous 1.5 preset, without changing branches or rim color rules', async () => {
  const {polishCrackSample}=await import('../src/polish-shell.mjs');
  const f=await fixture({feelId:'marshmallow'}), g=await fixture({feelId:'slow-rebound'}), c=await fixture();
  assert.equal(f.shell.getState().crackWidthGain,2.25);assert.equal(g.shell.getState().crackWidthGain,1);assert.equal(c.shell.getState().crackWidthGain,1);
  const p=[.1,.2,Math.sqrt(.95)], baseline=polishCrackSample(p,.8,.2), wider=polishCrackSample(p,.8,.2,0,2.25);
  for(let i=0;i<3;i++){assert.equal(wider.layers[i].width,baseline.layers[i].width*2.25);assert.equal(wider.layers[i].strength,baseline.layers[i].strength);}
  for(const a of [f,g,c])a.shell.dispose();
});


test('slow rebound recovered aperture is 50% wider while held aperture and other cores remain unchanged', async () => {
  const {polishCrackSample}=await import('../src/polish-shell.mjs');
  const p=[.1,.2,Math.sqrt(.95)];
  for(const opening of [0,.25]){
    const old=polishCrackSample(p,.8,opening,.05,1,1), next=polishCrackSample(p,.8,opening,.05,1,1.5);
    for(let i=0;i<3;i++)assert.ok(Math.abs(next.layers[i].width-old.layers[i].width*(opening===0?1.5:1))<1e-12);
  }
  for(const feelId of ['clay','marshmallow','slow-rebound']){
    const f=await fixture({feelId});assert.equal(f.shell.getState().recoveredWidthGain,feelId==='slow-rebound'?1.5:1);f.shell.dispose();
  }
});


test('global aperture multiplier adds exactly 50% for all layers and every core, including recovered slow rebound', async () => {
  const {polishCrackSample,polishShellParameters}=await import('../src/polish-shell.mjs');
  assert.equal(polishShellParameters.globalWidthGain,1.5);
  const p=[.1,.2,Math.sqrt(.95)];
  for(const [feelId,gain,recovered] of [['clay',1,1],['marshmallow',2.25,1],['slow-rebound',1,1.5]]){
    const f=await fixture({feelId});assert.equal(f.shell.getState().globalWidthGain,1.5);
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};f.shell.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.polishWidthGain.value,gain*1.5);
    for(const opening of [0,.12,.3]){
      const previous=polishCrackSample(p,.95,opening,.05,gain,recovered,1),next=polishCrackSample(p,.95,opening,.05,gain,recovered);
      for(let i=0;i<3;i++){
        assert.ok(Math.abs(next.layers[i].width-previous.layers[i].width*1.5)<1e-12);
        assert.equal(next.layers[i].strength,previous.layers[i].strength);
      }
    }
    f.shell.dispose();
  }
});


test('confirmed reusable polish preset preserves the reviewed scope and final response settings', async () => {
  const {getPolishPreset}=await import('../src/polish-shell.mjs');const p=getPolishPreset('polish-shell');
  assert.equal(p.material,'polish');assert.equal(p.version,1);assert.equal(p.confirmedOn,'2026-11-05');
  assert.deepEqual(p.supportedStyles,['orb','cloud','cylinder','donut','pyramid','flower','star']);
  assert.deepEqual(p.supportedFeels,['clay','marshmallow','slow-rebound']);
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.parameters)&&Object.isFrozen(p.supportedStyles)&&Object.isFrozen(p.supportedFeels));
  assert.deepEqual([p.parameters.globalWidthGain,p.parameters.marshmallowWidthGain,p.parameters.slowReboundRecoveredWidthGain],[1.5,2.25,1.5]);
  assert.deepEqual([p.parameters.marshmallowOnsetDepth,p.parameters.marshmallowFullDamageDepth],[.00008,.032]);
});
