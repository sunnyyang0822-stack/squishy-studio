const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMesh } = require('./helpers/squishy-mesh.cjs');

test('marshmallow paw clearance certificates preserve actual shell geometry through deep/drag/release/restore', async t => {
  const THREE = await import('three');
  const { getWaxPreset } = await import('../src/wax-presets.mjs');
  const { createVoronoiWax } = await import('../src/thin-wax-panels.mjs');
  const { createWaxCollisionTree, smallThinWaxParameters } = await import('../src/thin-wax.mjs');
  const { getOrbFeel } = await import('../src/orb-feels.mjs');
  const { getSquishyStyle } = await import('../src/squishy-styles.mjs');
  const { createSurfaceGeometry } = await import('../src/surface-clay.mjs');
  const mesh = readMesh('./assets/models/squishy-paw.glb'), rest = Float32Array.from(mesh.positions), normals = Float32Array.from(mesh.normals), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rest, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(mesh.indices);
  const core = getOrbFeel('marshmallow').createDeformation(geometry.attributes.position.array, normals.slice(), { surfaceGeometry: createSurfaceGeometry(rest, normals, mesh.indices, { ...getSquishyStyle('paw').geometryOptions, continuousFootprint: false }) });
  let seconds=0;
  const options={styleId:'paw',geometry,restPositions:rest,restNormals:normals,fullSurfaceSupport:true,clock:()=>seconds};
  const fast=getWaxPreset('thin-wax').create(options), reference=createVoronoiWax({...options,collectionEnabled:false,supportCertificates:false},smallThinWaxParameters,(g,settings)=>createWaxCollisionTree(g,{...settings,queryCache:false}));
  let samples=0;
  function frame() {
    core.step(1/60);geometry.computeVertexNormals();seconds+=1/60;fast.step(1/60);reference.step(1/60);
    const a=fast.getSurfaceSnapshot(),b=reference.getSurfaceSnapshot();
    assert.deepEqual(a.positions,b.positions,'Every actual Float32 shell position must match the exhaustive support path');
    assert.deepEqual(a.normals,b.normals);assert.deepEqual(fast.getState(),reference.getState());samples++;
  }
  let best=Infinity,point;
  for(let i=0;i<rest.length;i+=3)if(normals[i+2]>.25){const d=rest[i]**2+(rest[i+1]-.3)**2;if(d<best){best=d;point=Array.from(rest.slice(i,i+3));}}
  core.begin(point);fast.begin(point);reference.begin(point);for(let i=0;i<50;i++)frame();
  for(let i=0;i<10;i++){const p=[point[0]+i*.018,point[1]-.01*i,point[2]];core.move(p,.02);fast.move(p);reference.move(p);frame();}
  core.release();fast.end();reference.end();for(let i=0;i<8;i++)frame();
  core.beginRestore();for(let i=0;i<=8;i++){core.applyRestore(i/8);frame();}
  const m=fast.getMetrics({exhaustive:true});assert.equal(m.attachedViolations,0);assert.equal(m.detachedViolations,0);t.diagnostic(JSON.stringify({samples,thickness:m.thickness,attachedMinSignedDistance:m.attachedMinSignedDistance,detachedViolations:m.detachedViolations}));
  fast.dispose();reference.dispose();geometry.dispose();
});
