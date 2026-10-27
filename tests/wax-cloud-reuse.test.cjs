const {test}=require('node:test');const assert=require('node:assert/strict');const {readMesh}=require('./helpers/squishy-mesh.cjs');
test('changed-triangle bounds invalidate even a face sweeping completely across an unchanged shell region',async()=>{
 const THREE=await import('three'),{createWaxCollisionTree}=await import('../src/thin-wax.mjs');const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-2,-.5,-.5,-2,.5,-.5,-2,0,.5],3));g.setIndex([0,1,2]);const tree=createWaxCollisionTree(g,{trackChanges:true}),box=new THREE.Box3(new THREE.Vector3(-.1,-.1,-.1),new THREE.Vector3(.1,.1,.1));tree.refit();assert.equal(tree.intersectsChanges(box),false);for(let i=0;i<3;i++)g.attributes.position.setX(i,2);tree.refit();assert.equal(tree.intersectsChanges(box),true,'Both endpoints miss, but the swept changed-face bounds cross the cached shell');tree.refit();assert.equal(tree.intersectsChanges(box),false);g.dispose();
});
for(const feelId of ['slow-rebound','marshmallow'])test(`cloud ${feelId}: reused shell and lazy feature normals equal fully recomputed actual Float32 geometry`,async t=>{
 const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{getOrbFeel}=await import('../src/orb-feels.mjs'),{createSurfaceGeometry}=await import('../src/surface-clay.mjs'),{createVoronoiWax}=await import('../src/thin-wax-panels.mjs'),{createWaxCollisionTree,thinWaxParameters}=await import('../src/thin-wax.mjs');
 const mesh=readMesh('./assets/models/squishy-cloud.glb'),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
 const options=()=>({surfaceGeometry:createSurfaceGeometry(rest.slice(),normals.slice(),mesh.indices,{continuousFootprint:feelId==='slow-rebound'}),...(feelId==='slow-rebound'?{getPressDirection:()=>[0,.17715299831526515,.9841833239736953]}:{})});
 const core=getOrbFeel(feelId).createDeformation(g.attributes.position.array,normals.slice(),options());let now=0,reused=0,frames=0;const waxOptions={styleId:'cloud',geometry:g,restPositions:rest,restNormals:normals,fullSurfaceSupport:true,collectionEnabled:false,clock:()=>now};
 const fast=getWaxPreset('thin-wax').create(waxOptions),reference=createVoronoiWax({...waxOptions,cacheAttachedPanels:false,supportCertificates:false},thinWaxParameters,(geometry,settings)=>createWaxCollisionTree(geometry,{...settings,queryCache:false,lazyFeatureNormals:false,exactGridTies:false}));
 function compare(){const a=fast.getSurfaceSnapshot({renderOnly:true}),b=reference.getSurfaceSnapshot({renderOnly:true});assert.deepEqual(a.positions,b.positions,'Actual uploaded shell positions must stay byte-identical to full uncached support');assert.deepEqual(a.normals,b.normals);assert.deepEqual(fast.getState(),reference.getState());reused+=fast.getQueryCounters().reusedAttachedPanels;}
 function frame(){core.step(1/60);g.computeVertexNormals();now+=1/60;const a=fast.step(1/60),b=reference.step(1/60);if(!a.changed)fast.sync();if(!b.changed)reference.sync();compare();frames++;}
 function point(x,y){let best=Infinity,p;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;p=Array.from(rest.slice(i,i+3));}}return p;}
 try{let p=point(.4,.05);core.begin(p);fast.begin(p);reference.begin(p);for(let i=0;i<75;i++)frame();
 for(let i=0;i<12;i++){p=point(.4+.02*i,.05-.01*i);core.move(p,.03);fast.move(p);reference.move(p);frame();}core.release();fast.end();reference.end();for(let i=0;i<50;i++)frame();
 core.beginRestore();for(let i=0;i<=8;i++){core.applyRestore(i/8);frame();}fast.reset();reference.reset();compare();
 assert.ok(reused>500,'The real remote attached-plate reuse path must actually run');const m=fast.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0);assert.equal(m.detachedViolations,0);t.diagnostic(JSON.stringify({feelId,frames,reused,thickness:m.thickness,minGap:m.attachedMinGap,minActualSigned:m.attachedMinSignedDistance}));
 }finally{fast.dispose();reference.dispose();g.dispose();}
});

test('lazy feature normals match full feature normals after local motion, seam changes and restoration',async t=>{
 const THREE=await import('three'),{createWaxCollisionTree}=await import('../src/thin-wax.mjs');const mesh=readMesh('./assets/models/squishy-cloud.glb'),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));g.setIndex(mesh.indices);const rest=g.attributes.position.array.slice(),fast=createWaxCollisionTree(g,{featureNormals:true,queryCache:false}),full=createWaxCollisionTree(g,{featureNormals:true,queryCache:false,lazyFeatureNormals:false,exactGridTies:false}),p=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3();let compared=0;
 for(const amount of [0,.001,.09,.12,.02,0]){for(let i=0;i<rest.length;i+=3)if(Math.hypot(rest[i]-.4,rest[i+1]-.05)<.7&&rest[i+2]>0)g.attributes.position.setZ(i/3,rest[i+2]-amount);fast.refit();full.refit();for(let i=0;i<rest.length;i+=3*37){p.fromBufferAttribute(g.attributes.position,i/3);p.z+=.004;const x=fast.signedDistance(p,a),y=full.signedDistance(p,b);assert.equal(x,y);assert.deepEqual(a,b);compared++;}}
 t.diagnostic(JSON.stringify({compared}));g.dispose();
});

test('grid ties preserve exact BVH closest face, sign and feature normal on all seven real meshes',async t=>{
 const THREE=await import('three'),{createWaxCollisionTree}=await import('../src/thin-wax.mjs');let compared=0;
 for(const id of ['cloud','paw','cylinder','donut','pyramid','flower','star']){
  const mesh=readMesh(`./assets/models/squishy-${id}.glb`),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));g.setIndex(mesh.indices);
  const rest=g.attributes.position.array.slice(),fast=createWaxCollisionTree(g,{nearestGrid:true,featureNormals:true,queryCache:false}),reference=createWaxCollisionTree(g,{nearestGrid:true,featureNormals:true,queryCache:false,exactGridTies:false,lazyFeatureNormals:false}),point=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3();
  for(const amount of [0,.03,.12,.005,0]){
   for(let i=0;i<rest.length;i+=3)g.attributes.position.setZ(i/3,rest[i+2]-(rest[i+2]>0?amount*Math.max(0,1-Math.hypot(rest[i],rest[i+1])/.8):0));fast.refit();reference.refit();
   for(let i=0;i<mesh.indices.length;i+=3*19){
    const face=i/3,tri=mesh.indices.slice(i,i+3);
    for(const kind of [0,1,2]){point.fromBufferAttribute(g.attributes.position,tri[0]);if(kind){point.add(new THREE.Vector3().fromBufferAttribute(g.attributes.position,tri[1]));if(kind===2)point.add(new THREE.Vector3().fromBufferAttribute(g.attributes.position,tri[2]));point.multiplyScalar(1/(kind+1));}point.z+=.004;
     const x=fast.signedDistance(point,a,face),y=reference.signedDistance(point,b,face);assert.equal(x,y,`${id} distance`);assert.deepEqual(a,b,`${id} normal`);assert.equal(fast.getLastNearestFace(),reference.getLastNearestFace(),`${id} tie face`);compared++;
    }
   }
  }g.dispose();
 }t.diagnostic(JSON.stringify({compared}));
});
