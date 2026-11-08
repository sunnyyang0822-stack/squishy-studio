const {test}=require('node:test'),assert=require('node:assert/strict'),{readMesh}=require('./helpers/squishy-mesh.cjs');
test('incremental collision memberships survive repeated cell crossings and exact restoration',async t=>{
 const THREE=await import('three'),{createWaxCollisionTree:fastTree}=await import('../src/thin-wax.mjs'),{createWaxCollisionTree:referenceTree}=await import('../src/thin-wax.mjs');let checks=0;
 for(const style of ['cloud','cylinder','donut','pyramid','flower','star']){
  const mesh=readMesh(`./assets/models/squishy-${style}.glb`),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));g.setIndex(mesh.indices);const rest=g.attributes.position.array.slice(),options={nearestGrid:true,featureNormals:true,featureTieConsensus:true,restPositions:rest},fast=fastTree(g,{...options,performanceOptimizations:true}),ref=referenceTree(g,options),n=new THREE.Vector3(),m=n.clone();
  const hints=Array.from({length:24},()=>({faceIndex:0}));
  for(let frame=0;frame<45;frame++){
   for(let i=0;i<rest.length;i+=3){const radius=Math.hypot(rest[i]-.25,rest[i+1]-.1),z=radius<.5?Math.sin(frame*.7)*.06*(1-radius/.5):0;g.attributes.position.array[i+2]=rest[i+2]+z;}
   if(frame===44)g.attributes.position.array.set(rest);fast.refit();ref.refit();
   for(let k=0;k<24;k++){const id=(k*463+frame*17)%g.attributes.position.count,point=new THREE.Vector3().fromBufferAttribute(g.attributes.position,id).addScaledVector(new THREE.Vector3().fromArray(mesh.normals,id*3),k%2?.004:-.003),a=fast.signedDistance(point,n,hints[k]),b=ref.signedDistance(point,m,{faceIndex:0});assert.ok(Math.abs(a-b)<1e-12,`${style}/${frame}: ${a} vs ${b}`);assert.ok(n.distanceTo(m)<1e-12,`${style}/${frame}: exact feature normal`);checks++;}
  }g.dispose();
 }t.diagnostic(JSON.stringify({checks}));
});
