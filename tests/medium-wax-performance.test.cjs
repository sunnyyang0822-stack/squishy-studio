const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readMesh}=require('./helpers/squishy-mesh.cjs');
for(const styleId of ['cloud','cylinder','donut','pyramid','flower','star'])for(const feelId of ['marshmallow','slow-rebound'])test(styleId+'/'+feelId+' preset optimizations preserve exhaustive unoptimized shell and fragment geometry',async t=>{
  const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{createThinWax}=await import('../src/thin-wax.mjs');
  const {getOrbFeel}=await import('../src/orb-feels.mjs'),{getSquishyStyle}=await import('../src/squishy-styles.mjs'),{createSurfaceGeometry}=await import('../src/surface-clay.mjs');
  const data=readMesh('./assets/models/squishy-'+styleId+'.glb'),rest=Float32Array.from(data.positions),normals=Float32Array.from(data.normals),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(data.indices);
  const core=getOrbFeel(feelId).createDeformation(g.attributes.position.array,normals.slice(),{surfaceGeometry:createSurfaceGeometry(rest,normals,data.indices,{...getSquishyStyle(styleId).geometryOptions,continuousFootprint:feelId==='slow-rebound'}),...(feelId==='slow-rebound'?{getPressDirection:()=>[0,0,1]}:{})});
  let now=0;const options={styleId,geometry:g,restPositions:rest,restNormals:normals,clock:()=>now,collectionEnabled:false};
  const {createVoronoiWax}=await import('../src/thin-wax-panels.mjs'); const {createWaxCollisionTree:optimizedTree}=await import('../src/thin-wax.mjs'); const preset=getWaxPreset('medium-wax'),fast=createVoronoiWax({...options,...preset.geometryOptionsForStyle(styleId),fullSurfaceSupport:true},preset.parametersForStyle(styleId),optimizedTree),reference=createThinWax({...options,...preset.geometryOptionsForStyle(styleId),performanceOptimizations:false,fullSurfaceSupport:true},preset.parametersForStyle(styleId));
  let maximumError=0,frames=0,fastQueries=0,referenceQueries=0,fastCpu=0,referenceCpu=0;
  fast.getQueryCounters(true);reference.getQueryCounters(true);
  function frame(){core.step(1/30);g.computeVertexNormals();now+=1/30;let cpu=process.cpuUsage();fast.step(1/30);fast.sync();let used=process.cpuUsage(cpu);fastCpu+=used.user+used.system;cpu=process.cpuUsage();reference.step(1/30);reference.sync();used=process.cpuUsage(cpu);referenceCpu+=used.user+used.system;
    const a=fast.getSurfaceSnapshot(),b=reference.getSurfaceSnapshot();for(let i=0;i<a.positions.length;i++){maximumError=Math.max(maximumError,Math.abs(a.positions[i]-b.positions[i]),Math.abs(a.normals[i]-b.normals[i]));}
    assert.ok(maximumError<5e-7,`Float32 geometry error ${maximumError}`);assert.deepEqual(fast.getState(),reference.getState());frames++;
    fastQueries+=fast.getQueryCounters().nearestCalls;referenceQueries+=reference.getQueryCounters().nearestCalls;
  }
  function point(x,y){let best=Infinity,result;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.2){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;result=Array.from(rest.slice(i,i+3));}}return result;}
  try{
    for(const p of [...(styleId==='donut'?[point(.38,0),point(-.38,.12)]:[point(0,.17),point(-.32,.4)])]){
      core.begin(p);fast.begin(p);reference.begin(p);for(let i=0;i<32;i++)frame();
      const q=point(p[0]+.1,p[1]-.04);core.move(q,.2);fast.move(q);reference.move(q);for(let i=0;i<4;i++)frame();
      core.release();fast.end();reference.end();for(let i=0;i<4;i++)frame();
      const m=fast.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0);assert.equal(m.detachedViolations,0);
    }
    assert.ok(fastQueries<referenceQueries,`${fastQueries} vs ${referenceQueries}`);
    t.diagnostic(JSON.stringify({styleId,feelId,frames,maximumError,fastQueries,referenceQueries,queryRatio:fastQueries/referenceQueries,fastCpuMs:fastCpu/1000,referenceCpuMs:referenceCpu/1000,detached:fast.getState().detached}));
  }finally{fast.dispose();reference.dispose();g.dispose();}
});
