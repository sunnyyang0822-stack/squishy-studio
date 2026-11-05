const {test}=require('node:test');const assert=require('node:assert/strict');const {readMesh}=require('./helpers/squishy-mesh.cjs');
for(const id of ['paw','donut'])for(const yaw of [0,110])test(`${id}: compact chips clear the live recovering core under world gravity at yaw ${yaw}`,async t=>{
 const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{getOrbFeel}=await import('../src/orb-feels.mjs'),{createSurfaceGeometry}=await import('../src/surface-clay.mjs');
 const mesh=readMesh(`./assets/models/squishy-${id}.glb`),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
 const core=getOrbFeel('slow-rebound').createDeformation(g.attributes.position.array,normals.slice(),{surfaceGeometry:createSurfaceGeometry(rest,normals,mesh.indices,{continuousFootprint:true,...(id==='paw'?{depthAxis:2}:{})}),getPressDirection:()=>[0,.17715299831526515,.9841833239736953]});
 let now=0;const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.2,THREE.MathUtils.degToRad(yaw),0)),wax=getWaxPreset().create({styleId:id,geometry:g,restPositions:rest,restNormals:normals,compactPanels:true,fullSurfaceSupport:true,worldMatrix:matrix,clock:()=>now});
 function frame(){core.step(1/60);g.computeVertexNormals();now+=1/60;const s=wax.step(1/60);if(!s.changed)wax.sync();}
 function check(){const m=wax.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0);assert.equal(m.detachedViolations,0);assert.ok(m.maxThicknessError<=1e-5);return{normalGap:m.attachedMinGap,detachedSigned:m.detachedMinSignedDistance};}
 const x=id==='paw'?0:.38,y=id==='paw'?.17:0;let score=Infinity,p;
 for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<score){score=d;p=Array.from(rest.slice(i,i+3));}}
 try{
  core.begin(p);wax.begin(p);for(let i=0;i<32;i++)frame();assert.equal(wax.getState().detached,3);const meta=wax.getSurfaceSnapshot(),groups=new Map();
  for(let i=0;i<meta.panelIds.length;i++)if(meta.detached[i]&&meta.layers[i]===1){const key=meta.panelIds[i];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
  const point=new THREE.Vector3();function yAt(positions,ids){let sum=0,nonzero=false;for(const i of ids){point.fromArray(positions,i*3);nonzero ||= point.lengthSq()>0;sum+=point.applyMatrix4(matrix).y;}return nonzero?sum/ids.length:null;}
  const trajectories=[...groups].map(([panel,ids])=>({panel,ids,startY:yAt(meta.positions,ids),samples:[]})),measurements=[check()];core.release();wax.end();
  for(let i=0;i<90;i++){frame();if(i%3===0){const s=wax.getSurfaceSnapshot({renderOnly:true});for(const item of trajectories){const y=yAt(s.positions,item.ids);if(y!==null)item.samples.push({time:now,y});}}if(i===12||i===30)measurements.push(check());}
  for(const item of trajectories)assert.ok(item.samples.some(sample=>sample.y<item.startY-.4),`Shard ${item.panel} must actually fall at least .4 world units before cleanup: ${JSON.stringify(item)}`);
  assert.equal(wax.getState().detached,3,'Release never strips the remaining shell');t.diagnostic(JSON.stringify({id,yaw,measurements,trajectories:trajectories.map(({ids,...record})=>record)}));
 }finally{wax.dispose();g.dispose();}
});
