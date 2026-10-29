const {test}=require('node:test');const assert=require('node:assert/strict');const {createThickOrbCore}=require('./helpers/thick-orb-core.cjs');
test('fast indexed normals exactly match Three throughout slow rebound',async()=>{const {updateIndexedNormals}=await import('../src/orb-normals.mjs');const f=await createThickOrbCore('slow-rebound');try{f.begin();for(let frame=0;frame<150;frame++){if(frame===65)f.release();f.frame();const original=f.geometry.clone();original.computeVertexNormals();updateIndexedNormals(f.geometry);assert.deepEqual(f.geometry.attributes.normal.array,original.attributes.normal.array);original.dispose();}}finally{f.dispose()}});
for(const core of ['marshmallow','slow-rebound'])test(`${core} thick shell resists inward dents without changing core`,async()=>{const f=await createThickOrbCore(core);try{const rest=f.wax.getSurfaceSnapshot();f.begin();f.run(20);const s=f.wax.getSurfaceSnapshot();let sampled=0,max=0;for(let i=0;i<s.layers.length;i++){if(s.detached[i]||s.layers[i]!==0)continue;const at=i*3;let inward=0;for(let k=0;k<3;k++)inward+=(rest.positions[at+k]-s.positions[at+k])*s.restSupportNormals[at+k];max=Math.max(max,inward);sampled++;}assert.ok(sampled>1000);assert.ok(max<.009,`shell inward sag ${max}`);assert.ok(f.core.getState().depth>.02);f.same();}finally{f.dispose()}});
test('orb retains authored proportions and full-matte has no extra stretch',async()=>{const {readMesh}=require('./helpers/squishy-mesh.cjs');const {getOrbAppearance,getModelPresentationScale}=await import('../src/orb-appearance.mjs');const mesh=readMesh('assets/models/squishy-orb.glb');const extents=[0,1,2].map(k=>{const v=mesh.positions.filter((_,i)=>i%3===k);return Math.max(...v)-Math.min(...v)});assert.ok(Math.abs(extents[0]-extents[2])<1e-6);assert.ok(Math.abs(extents[1]/extents[0]-.9225)<1e-6);assert.deepEqual(getModelPresentationScale(getOrbAppearance('full-matte')), [1,1,1]);});


for (const feelId of ['marshmallow', 'slow-rebound']) test(`${feelId} clearance certificates preserve every fragment coordinate`, async t => {
  const fast = await createThickOrbCore(feelId), exact = await createThickOrbCore(feelId, { detachedClearanceCertificates: false });
  let fastQueries = 0, exactQueries = 0;
  try {
    fast.begin(); exact.begin();
    for (let i = 0; i < 90; i++) {
      if (i === 65) { fast.release(); exact.release(); }
      fast.frame(); exact.frame();
      assert.deepEqual(fast.wax.getSurfaceSnapshot().positions, exact.wax.getSurfaceSnapshot().positions);
      fastQueries += fast.wax.getQueryCounters().detachedNearestSamples;
      exactQueries += exact.wax.getQueryCounters().detachedNearestSamples;
    }
    assert.ok(fastQueries < exactQueries, `${fastQueries} versus ${exactQueries}`);
    t.diagnostic(JSON.stringify({ feelId, fastQueries, exactQueries, reduction: 1 - fastQueries / exactQueries }));
  } finally { fast.dispose(); exact.dispose(); }
});
