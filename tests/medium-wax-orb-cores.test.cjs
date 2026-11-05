const {test}=require('node:test'),assert=require('node:assert/strict');
const {readMesh}=require('./helpers/squishy-mesh.cjs');
for(const feelId of ['marshmallow','slow-rebound'])for(const reducedMotion of [false,true])test(`${feelId} orb medium: unchanged core, clock, full fragment edges and recovery (${reducedMotion})`,async t=>{
  const THREE=await import('three'),{getOrbFeel}=await import('../src/orb-feels.mjs'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{createSurfaceGeometry}=await import('../src/surface-clay.mjs');
  const mesh=readMesh('./assets/models/squishy-orb.glb'),rest=Float32Array.from(mesh.positions),normals=Float32Array.from(mesh.normals),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(mesh.indices);
  const positions=g.attributes.position.array,barePositions=rest.slice();let seconds=0,frames=0;
  function options(){if(feelId!=='slow-rebound')return {reducedMotion};const surface=createSurfaceGeometry(rest,normals,mesh.indices);return {reducedMotion,getPressDirection:()=>[0,0,1],constrainPress:surface.createContactSafety(),getPressRadius:(i,direction)=>surface.contactRadius(i,direction)};}
  const feel=getOrbFeel(feelId),core=feel.createDeformation(positions,normals.slice(),options()),bare=feel.createDeformation(barePositions,normals.slice(),options());
  const wax=getWaxPreset('medium-wax').create({styleId:'orb',geometry:g,restPositions:rest,restNormals:normals,clock:()=>seconds,reducedMotion,collectionEnabled:false});
  const transform=new THREE.Matrix4().compose(new THREE.Vector3(.2,.3,0),new THREE.Quaternion().setFromEuler(new THREE.Euler(.1,.35,0)),new THREE.Vector3(1,feelId==='slow-rebound'?1.06:1,feelId==='slow-rebound'?1.1:1));wax.setWorldMatrix(transform);
  const reports=[];
  function same(){assert.deepEqual(positions,barePositions);assert.deepEqual(core.getState(),bare.getState());}
  function act(method,...args){core[method](...args);bare[method](...args);same();}
  function frame(){assert.deepEqual(core.step(1/60),bare.step(1/60));same();g.computeVertexNormals();seconds+=1/60;const step=wax.step(1/60);if(!step.changed)wax.sync();same();frames++;}
  function run(n){for(let i=0;i<n;i++)frame();}
  function contact(x=0,y=.02){let best=Infinity,point;for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;point=Array.from(rest.slice(i,i+3));}}return point;}
  function begin(p=contact()){act('begin',p);wax.begin(p);}
  function release(){act('release');wax.end();}
  function inspect(label){const m=wax.getMetrics({exhaustive:true});assert.equal(m.thickness,.028);assert.equal(m.gap,.004);assert.equal(m.patches,96);assert.equal(m.attachedViolations,0,label+': '+JSON.stringify(m));assert.equal(m.detachedViolations,0,label+': '+JSON.stringify(m));assert.ok(m.maxThicknessError<1e-5);assert.ok(m.attachedSurfaceSamples>10000&&m.wallSamples>1000);reports.push({label,attached:m.attachedViolations,detached:m.detachedViolations,maxThicknessError:m.maxThicknessError,detachedInteriorSamples:m.detachedInteriorSamples});return m;}
  try{
    inspect('intact');begin();run(29);assert.equal(wax.getState().detached,0);assert.ok(wax.getState().cracked>0);run(3);assert.ok(wax.getState().detached>0);assert.ok(inspect('first separation').detachedInteriorSamples>0,'Actually sample the freshly detached faces and edges near the core');run(118);inspect('deep hold');
    release();const released=positions.slice(),damage=wax.getState().detached;run(90);assert.equal(wax.getState().detached,damage);
    if(feelId==='marshmallow')assert.deepEqual(positions,released);else assert.ok(core.getState().depth<.15,'slow rebound retains its original gradual recovery');inspect('released');
    const start=contact(-.35);begin(start);for(let i=1;i<=10;i++){const p=contact(-.35+.07*i);act('move',p,.07);wax.move(p);frame();}release();inspect('drag across broken rim');
    begin(contact(.3,.07));run(120);inspect('repeat press');release();
    act('beginRestore');for(let i=0;i<=30;i++){act('applyRestore',i/30);frame();if(i%10===0)inspect('explicit restore '+i);}
    assert.deepEqual(positions,rest);const detached=wax.getState().detached;run(30);assert.equal(wax.getState().detached,detached);wax.reset();inspect('restart');assert.equal(wax.getState().detached,0);
    run(220);inspect('cleanup');t.diagnostic(JSON.stringify({feelId,reducedMotion,frames,reports}));
  }finally{wax.dispose();assert.equal(wax.getState().disposed,true);g.dispose();}
});
