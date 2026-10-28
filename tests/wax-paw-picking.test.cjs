const {test}=require('node:test');const assert=require('node:assert/strict');const {readMesh}=require('./helpers/squishy-mesh.cjs');
test('paw spatial picking equals Three raycasts on live/rest surfaces, holes, sides, rotations and draw ranges',async t=>{
 const THREE=await import('three'),{createWaxCollisionTree}=await import('../src/thin-wax.mjs'),mesh=readMesh('./assets/models/squishy-paw.glb'),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));g.setIndex(mesh.indices);const rest=g.attributes.position.array.slice(),rg=g.clone(),material=new THREE.MeshBasicMaterial(),live=new THREE.Mesh(g,material),original=new THREE.Mesh(rg,material),tree=createWaxCollisionTree(g,{picking:true,restPositions:rest}),raycaster=new THREE.Raycaster(),out=new THREE.Vector3(),localRay=new THREE.Ray();let checks=0,maxError=0,linearMs=0,spatialMs=0;
 try{
  for(const depth of [0,.14]){
   for(let i=0;i<rest.length;i+=3)g.attributes.position.setZ(i/3,rest[i+2]-(rest[i+2]>0?depth*Math.max(0,1-Math.hypot(rest[i],rest[i+1]-.17)/.4):0));g.computeBoundingSphere();tree.refit();
   for(const pose of [[0,0,1,1,1],[.3,1.1,1.1,.9,1.2]]){
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(.1,-.2,.03),new THREE.Quaternion().setFromEuler(new THREE.Euler(pose[0],pose[1],0)),new THREE.Vector3(...pose.slice(2))),inverse=matrix.clone().invert();
    for(const object of [live,original]){object.matrixAutoUpdate=false;object.matrix.copy(matrix);object.updateMatrixWorld(true);}
    for(const side of [THREE.FrontSide,THREE.BackSide,THREE.DoubleSide])for(const partial of [false,true]){
     material.side=side;const count=partial?Math.floor(mesh.indices.length/6)*3:Infinity;g.setDrawRange(0,count);rg.setDrawRange(0,count);
     for(let x=-1.5;x<=1.5;x+=.3)for(let y=-1.5;y<=1.5;y+=.3)for(const useRest of [false,true]){
      raycaster.ray.set(new THREE.Vector3(x,y,4),new THREE.Vector3(0,0,-1)).applyMatrix4(matrix);localRay.copy(raycaster.ray).applyMatrix4(inverse);let expected,found;
      const slow=()=>{const start=performance.now();expected=raycaster.intersectObject(useRest?original:live,false)[0];linearMs+=performance.now()-start;};
      const fast=()=>{const start=performance.now();found=tree.raycastLocal(localRay,out,{rest:useRest,side});spatialMs+=performance.now()-start;};
      if(checks%2){fast();slow();}else{slow();fast();}assert.equal(found,Boolean(expected));if(found){const error=out.clone().applyMatrix4(matrix).distanceTo(expected.point);maxError=Math.max(maxError,error);assert.ok(error<1e-10,`Actual closest surface point error ${error}`);}checks++;
     }
    }
   }
  }
  t.diagnostic(JSON.stringify({checks,maxError,linearMs,spatialMs,note:'Same queries, alternating CPU measurement order; not browser FPS'}));
 }finally{material.dispose();g.dispose();rg.dispose();}
});
