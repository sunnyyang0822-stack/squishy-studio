const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readMesh}=require('./helpers/squishy-mesh.cjs');
const styles=process.env.WAX_SLOW_STYLE?.split(',')||['cloud','paw','cylinder','donut','pyramid','flower','star'];
for(const id of styles)test(`${id} slow-rebound thin wax: exact core, progressive fracture and real recovering volume`,async t=>{
 const THREE=await import('three');const {getSquishyStyle}=await import('../src/squishy-styles.mjs');const {getOrbFeel}=await import('../src/orb-feels.mjs');const {getWaxPreset}=await import('../src/wax-presets.mjs');const {createSurfaceGeometry}=await import('../src/surface-clay.mjs');
 const style=getSquishyStyle(id),mesh=readMesh(`.${style.modelUrl}`),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
 const positions=g.attributes.position.array,barePositions=rest.slice();let direction=[0,.17715299831526515,.9841833239736953];
 const options=()=>({surfaceGeometry:createSurfaceGeometry(rest.slice(),normals.slice(),mesh.indices,{...style.geometryOptions,continuousFootprint:true}),getPressDirection:()=>direction});
 const core=getOrbFeel('slow-rebound').createDeformation(positions,normals.slice(),options()),bare=getOrbFeel('slow-rebound').createDeformation(barePositions,normals.slice(),options());let now=0,frames=0,lastShellTime=0;
 const wax=getWaxPreset('thin-wax').create({styleId:id,geometry:g,restPositions:rest,restNormals:normals,fullSurfaceSupport:true,clock:()=>now}),phases=[];
 const same=()=>{assert.deepEqual(positions,barePositions,'Every original slow-rebound core vertex is independent of the shell');assert.deepEqual(core.getState(),bare.getState());};
 const act=(method,...args)=>{core[method](...args);bare[method](...args);same();};
 function frame(sync=true){assert.deepEqual(core.step(1/60),bare.step(1/60));now+=1/60;frames++;if(sync){g.computeVertexNormals();const s=wax.step(now-lastShellTime);lastShellTime=now;if(!s.changed)wax.sync();}same();}
 function contact(x,y){let best=Infinity,point;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;point=Array.from(rest.slice(i,i+3));}}assert.ok(point);return point;}
 const target=id==='paw'?[0,.17]:id==='donut'?[.38,0]:id==='flower'?[.55,.05]:id==='star'?[.5,.15]:[.15,.05];
 function inspect(label){const m=wax.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0,`${id}/${label}: ${JSON.stringify(m)}`);assert.equal(m.detachedViolations,0,`${id}/${label}: ${JSON.stringify(m)}`);assert.ok(m.attachedMinGap>=m.gap-m.tolerance);assert.ok(m.maxThicknessError<=1e-5);assert.ok(m.attachedSurfaceSamples>10000&&m.wallSamples>1000);phases.push({label,coreDepth:core.getState().depth,detached:wax.getState().detached,thickness:m.thickness,gap:m.gap,minNormalGap:m.attachedMinGap,minSigned:m.attachedMinSignedDistance,maxSigned:m.attachedMaxSignedDistance,detachedMinSigned:m.detachedMinSignedDistance,thicknessError:m.maxThicknessError,attachedSamples:m.attachedSurfaceSamples,wallSamples:m.wallSamples,detachedSamples:m.detachedInteriorSamples});}
 try{
  inspect('intact');const p=contact(...target);act('begin',p);wax.begin(p);for(let i=0;i<29;i++)frame();assert.equal(wax.getState().detached,0);for(let i=0;i<3;i++)frame();assert.ok(wax.getState().detached>0);inspect('first post-threshold fracture');
  for(let i=0;i<88;i++)frame();assert.ok(core.getState().depth>.05);inspect('deep press');
  for(let i=1;i<=12;i++){const p=contact(target[0]+.22*i/12,target[1]-.12*i/12);act('move',p,.025);wax.move(p);frame();}inspect('drag through deformed surface');
  act('release');wax.end();const broken=wax.getState();
  // Core is integrated and compared at 60Hz throughout. Recovery shell also
  // exercises delayed 10Hz rendering; geometry is measured on actual output.
  for(let i=0;i<900;i++){frame(i%6===0);assert.equal(wax.getState().detached,broken.detached);assert.equal(wax.getState().cracked,broken.cracked);if([0,30,120,360,720].includes(i)){g.computeVertexNormals();wax.sync();inspect(`recovering ${i}`);}if(core.getState().depth===0)break;}
  g.computeVertexNormals();wax.sync();assert.deepEqual(positions,rest);inspect('exact natural recovery with permanent holes');
  const rim=contact(target[0]+.1,target[1]);act('begin',rim);wax.begin(rim);for(let i=0;i<70;i++)frame();inspect('broken rim pressed again');act('cancel');wax.end();const ended=wax.getState().detached;for(let i=0;i<24;i++)frame();assert.equal(wax.getState().detached,ended);inspect('cancel and recovery');
  wax.reset();assert.equal(wax.getState().living,0);assert.equal(wax.getState().detached,0);t.diagnostic(JSON.stringify({id,comparedCoreFrames:frames,phases}));
 }finally{wax.dispose();g.dispose();}
});
