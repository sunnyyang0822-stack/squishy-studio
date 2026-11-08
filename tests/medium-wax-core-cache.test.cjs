const {test}=require('node:test'),assert=require('node:assert/strict'),{readMesh}=require('./helpers/squishy-mesh.cjs');
test('uniform adaptive orb charts retain the exact main correction when safety caching is requested', async () => {
 const {createOffsetSafety}=await import('../src/surface-clay.mjs');
 const mesh=readMesh('./assets/models/squishy-orb.glb'),rest=Float32Array.from(mesh.positions),from=new Float32Array(rest.length);
 const cached=createOffsetSafety(rest,null,mesh.indices,{vectorOffsets:true,uniform:true,adaptiveChart:true,cacheSafety:true});
 const reference=createOffsetSafety(rest,null,mesh.indices,{vectorOffsets:true,uniform:true,adaptiveChart:true,cacheSafety:false});
 for(let frame=0;frame<40;frame++){
  const proposed=new Float32Array(rest.length),depth=.3*Math.sin(Math.PI*frame/39);
  for(let i=0;i<rest.length;i+=3)if(rest[i+2]>0)proposed[i+2]=depth*Math.exp(-12*(rest[i]**2+rest[i+1]**2));
  const original=proposed.slice();assert.equal(cached(from,proposed),reference(from,original));assert.deepEqual(proposed,original);from.set(proposed);
 }
});
for(const style of ['cloud','cylinder','donut','pyramid','flower','star'])for(const feelId of ['clay','marshmallow','slow-rebound'])test(`${style}/${feelId} exact core safety cache`,async t=>{
 const {getOrbFeel}=await import('../src/orb-feels.mjs'),{createSurfaceGeometry:original}=await import('../src/surface-clay.mjs'),{createSurfaceGeometry:optimized}=await import('../src/surface-clay.mjs');
 const mesh=readMesh(`./assets/models/squishy-${style}.glb`),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),a=rest.slice(),b=rest.slice();
 const make=(factory,cacheSafety)=>getOrbFeel(feelId).createDeformation(cacheSafety?a:b,normals.slice(),{surfaceGeometry:factory(rest,normals,mesh.indices,{continuousFootprint:feelId==='slow-rebound',cacheSafety}),...(feelId==='slow-rebound'?{getPressDirection:()=>[0,0,1]}:{})});
 const fast=make(optimized,true),reference=make(original,false);let frames=0,cpuFast=0,cpuRef=0;
 function same(){assert.deepEqual(a,b);assert.deepEqual(fast.getState(),reference.getState());}
 function act(method,...args){fast[method](...args);reference[method](...args);same();}
 function run(n){for(let i=0;i<n;i++){let cpu=process.cpuUsage();const x=fast.step(1/60);let used=process.cpuUsage(cpu);cpuFast+=used.user+used.system;cpu=process.cpuUsage();const y=reference.step(1/60);used=process.cpuUsage(cpu);cpuRef+=used.user+used.system;assert.deepEqual(x,y);same();frames++;}}
 function point(x,y){let best=Infinity,p;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25&&!(style==='donut'&&rest[i]*normals[i]+rest[i+1]*normals[i+1]>=-.03)){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;p=Array.from(rest.slice(i,i+3));}}return p;}
 for(const [x,y]of(style==='donut'?[[.38,0],[-.38,.12]]:[[.15,.1],[-.25,-.15]])){act('begin',point(x,y));run(100);for(let i=0;i<12;i++){act('move',point(x+.02*i,y-.01*i),.025);run(1);}act('release');run(45);act('begin',point(x,y));run(50);act('cancel');run(12);}
 act('beginRestore');for(let i=0;i<=30;i++){act('applyRestore',i/30);run(1);}act('reset');run(2);assert.deepEqual(a,rest);t.diagnostic(JSON.stringify({style,feelId,frames,cpuFastMs:cpuFast/1000,cpuReferenceMs:cpuRef/1000,positionError:0}));
});
