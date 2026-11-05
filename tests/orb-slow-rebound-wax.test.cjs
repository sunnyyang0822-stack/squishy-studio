const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

for (const reducedMotion of [false, true]) test(`local slow-rebound orb + thin wax: exact bare-core trajectory, live recovery support and permanent holes (${reducedMotion ? 'reduced' : 'normal'})`, async t => {
  const THREE = await import('three');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('./assets/models/squishy-orb.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals);
  const g = new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
  const positions = g.attributes.position.array, barePositions = rest.slice();let direction=[0,0,1];
  function options(){const safety=createSurfaceGeometry(rest.slice(),normals.slice(),mesh.indices);return {reducedMotion,getPressDirection:()=>direction,constrainPress:safety.createContactSafety(),getPressRadius:(i,d)=>safety.contactRadius(i,d)};}
  const core=getOrbFeel('slow-rebound').createDeformation(positions,normals.slice(),options()),bare=getOrbFeel('slow-rebound').createDeformation(barePositions,normals.slice(),options());
  let now=0,compared=0;
  const wax=getWaxPreset('thin-wax').create({styleId:'orb',geometry:g,restPositions:rest,restNormals:normals,reducedMotion,clock:()=>now});
  const records=[];
  const same=()=>{assert.deepEqual(positions,barePositions);assert.deepEqual(core.getState(),bare.getState());};
  function act(method,...args){core[method](...args);bare[method](...args);same();}
  function frame(){assert.deepEqual(core.step(1/60),bare.step(1/60));now+=1/60;g.computeVertexNormals();const result=wax.step(1/60);if(!result.changed)wax.sync();same();compared++;}
  function contact(x=0,y=.02){let best=Infinity,point;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;point=Array.from(rest.slice(i,i+3));}}return point;}
  function inspect(label){const m=wax.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0,JSON.stringify(m));assert.equal(m.detachedViolations,0,JSON.stringify(m));assert.ok(m.attachedMinGap>=.004-1e-5);assert.ok(m.maxThicknessError<1e-5);records.push({label,thickness:m.thickness,gap:m.gap,minNormalGap:m.attachedMinGap,minActualSigned:m.attachedMinSignedDistance,detachedMinSigned:m.detachedMinSignedDistance,attachedSamples:m.attachedSurfaceSamples,detachedSamples:m.detachedInteriorSamples,wallSamples:m.wallSamples,thicknessError:m.maxThicknessError});}
  try{
    const p=contact();act('begin',p);wax.begin(p);for(let i=0;i<29;i++)frame();assert.equal(wax.getState().detached,0);
    for(let i=0;i<91;i++)frame();assert.ok(wax.getState().detached>0);assert.ok(core.getState().depth>.4);inspect('deep press');
    act('release');wax.end();const broken=wax.getState();let previous=core.getState().depth;
    for(let i=0;i<900;i++){frame();assert.ok(core.getState().depth<=previous+1e-6);previous=core.getState().depth;assert.equal(wax.getState().detached,broken.detached);assert.equal(wax.getState().cracked,broken.cracked);if([1,30,120,400,800].includes(i))inspect(`natural recovery ${i}`);if(core.getState().depth===0)break;}
    assert.deepEqual(positions,rest,'Natural slow recovery must reach exact original positions without resetting the shell');inspect('fully rebounded with permanent holes');
    const left=contact(-.45);act('begin',left);wax.begin(left);
    for(let i=0;i<12;i++){const point=contact(-.45+.9*i/11);act('move',point,.04);wax.move(point);frame();}
    act('cancel');wax.end();inspect('fast sweep cancelled');const ended=wax.getState().detached;for(let i=0;i<30;i++)frame();assert.equal(wax.getState().detached,ended);
    const rim=contact(.2);act('begin',rim);wax.begin(rim);for(let i=0;i<80;i++)frame();inspect('repeated rim press');act('release');wax.end();
    wax.reset();assert.equal(wax.getState().detached,0);assert.equal(wax.getState().cracked,0);assert.equal(wax.getState().living,0);
    t.diagnostic(JSON.stringify({reducedMotion,comparedCoreFrames:compared,records}));
  }finally{wax.dispose();g.dispose();}
});
