const {test}=require('node:test');const assert=require('node:assert/strict');const {readMesh}=require('./helpers/squishy-mesh.cjs');
test('real paw fold corrections stay exact across moving, stationary, restore and repeated sync frames',async t=>{
 const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{createVoronoiWax}=await import('../src/thin-wax-panels.mjs'),{createWaxCollisionTree,smallThinWaxParameters}=await import('../src/thin-wax.mjs'),fixture=require('./fixtures/wax-paw-fold.json'),mesh=readMesh(fixture.asset),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
 let now=0,corrections=0,compared=0;const options={styleId:'paw',geometry:g,restPositions:rest,restNormals:normals,fullSurfaceSupport:true,compactPanels:true,collectionEnabled:false,clock:()=>now},fast=getWaxPreset().create(options),reference=createVoronoiWax({...options,cacheAttachedPanels:false,supportCertificates:false,relativeSupport:false},smallThinWaxParameters,(geometry,settings)=>createWaxCollisionTree(geometry,{...settings,queryCache:false,lazyFeatureNormals:false,exactGridTies:false}));
 function compare(){const a=fast.getSurfaceSnapshot({renderOnly:true}),b=reference.getSurfaceSnapshot({renderOnly:true});assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.normals,b.normals);assert.deepEqual(fast.getState(),reference.getState());compared++;}
 try{
  for(const example of fixture.cases){
   fast.begin(example.point);reference.begin(example.point);
   for(const blend of [0,.3,.6,1,1,1,.6,.2,0,0]){
    g.attributes.position.array.set(rest);for(const [index,value] of example.changes)g.attributes.position.array[index]=rest[index]+(value-rest[index])*blend;g.computeVertexNormals();now+=1/60;fast.sync();reference.sync();compare();
   }
   const metrics=fast.getMetrics({exhaustive:true});corrections+=metrics.attachedCorrectedSamples;assert.equal(metrics.attachedViolations,0,JSON.stringify(metrics));fast.end();reference.end();fast.reset();reference.reset();compare();
  }
  assert.ok(corrections>0,'The real projected-fold branch must run; a no-op comparison cannot validate its invalidation rules');t.diagnostic(JSON.stringify({compared,corrections,source:'Recorded real paw fold mesh changes, exact Float32 geometry comparison against all support caches disabled'}));
 }finally{fast.dispose();reference.dispose();g.dispose();}
});
