const {test}=require('node:test');const assert=require('node:assert/strict');
const {partitionStats,localThickness,createFixture,contactPoint,completeClearance}=require('./helpers/thick-nonpaw-geometry.cjs');
const styles=process.env.THICK_NONPAW_STYLE?.split(',')||['cloud','cylinder','donut','pyramid','flower','star'];
const feels=process.env.THICK_NONPAW_FEEL?.split(',')||['clay','marshmallow','slow-rebound'];
const reducedMotion=process.env.THICK_NONPAW_REDUCED==='1';
for(const style of styles)for(const feel of feels)test(`${style}/${feel}: real thick pieces, local triple thickness, independent core and complete live clearance`,async t=>{
 const thin=await createFixture(style,'thin-wax',feel,reducedMotion),f=await createFixture(style,'thick-wax',feel,reducedMotion);const record={style,feel,reducedMotion,phases:[]};
 const inspect=label=>{const s=f.wax.getSurfaceSnapshot(),m=f.wax.getMetrics({exhaustive:true});const measured=completeClearance(f,s);assert.equal(m.attachedViolations,0,`${label}: ${JSON.stringify(m)}`);assert.equal(m.detachedViolations,0,`${label}: ${JSON.stringify(m)}`);assert.ok(m.attachedMinGap>=.004-1e-5);record.phases.push({label,frames:f.frames,depth:f.deformation.getState().depth,detached:f.wax.getState().detached,...localThickness(s,.042),...measured});if(process.env.THICK_NONPAW_PROGRESS==='1')console.log(JSON.stringify({style,feel,reducedMotion,label,frames:f.frames,minimum:measured.minimumSignedDistance}));};
 try{
  const original=f.wax.getSurfaceSnapshot(),a=partitionStats(thin.wax.getSurfaceSnapshot(),thin.mesh),b=partitionStats(original,f.mesh);localThickness(thin.wax.getSurfaceSnapshot(),.014);assert.ok(b.all.mean/a.all.mean>4);assert.ok(b.all.median/a.all.median>4);record.partitions={thin:a.all,thick:b.all,meanAreaRatio:b.all.mean/a.all.mean};
  if(style==='donut'){for(const key of ['mean','median','p10'])assert.ok(b.innerWholePanels[key]/a.innerWholePanels[key]>4,`Inner ring actual whole-piece ${key}`);record.innerRing={thin:a.innerWholePanels,thick:b.innerWholePanels};}
  inspect('intact');const target={cloud:[.4,.05],cylinder:[.12,.12],donut:[.38,0],pyramid:[.15,-.25],flower:[.55,.05],star:[.5,.15]}[style];const p=contactPoint(f.mesh,...target,style==='donut');f.begin(p);f.run(29);assert.equal(f.wax.getState().detached,0);inspect('attached-before-separation');
  const attached = f.wax.getSurfaceSnapshot(); let maximumAttachedSag = 0;
  for (let r = 0; r < attached.layers.length; r++) if (attached.layers[r] === 0 && !attached.detached[r]) {
    let sag = 0; for (let k = 0; k < 3; k++) sag += (original.positions[r * 3 + k] - attached.positions[r * 3 + k]) * attached.restSupportNormals[r * 3 + k];
    maximumAttachedSag = Math.max(maximumAttachedSag, sag);
  }
  assert.ok(maximumAttachedSag < .009, `Attached wax must retain its authored curvature: ${maximumAttachedSag}`);
  record.maximumAttachedSag = maximumAttachedSag;
  for(let frame=30;frame<=32;frame++){f.tick();inspect(`separation-path-${frame}`);}assert.ok(f.wax.getState().detached>0);inspect('first-separation');
  const detached=f.wax.getSurfaceSnapshot();f.run(2);const falling=f.wax.getSurfaceSnapshot();let edges=0;for(let i=0;i<detached.indices.length;i+=3){const ids=Array.from(detached.indices.slice(i,i+3));if(!detached.detached[ids[0]]||!falling.detached[ids[0]])continue;for(let e=0;e<3;e++){const a=ids[e],b=ids[(e+1)%3];const d=s=>Math.hypot(...[0,1,2].map(k=>s.positions[a*3+k]-s.positions[b*3+k]));assert.ok(Math.abs(d(detached)-d(falling))<1e-6);edges++;}}assert.ok(edges>100);assert.deepEqual(falling.indices,original.indices);assert.deepEqual(falling.restSupportPositions,original.restSupportPositions);
  f.run(86);inspect('deep-press');for(let i=1;i<=12;i++){f.move(contactPoint(f.mesh,target[0]+.16*i/12,target[1]-.08*i/12),.025);f.tick();}inspect('drag');f.end();const held=f.geometry.attributes.position.array.slice(),damage=f.wax.getState().detached;f.run(30);if(feel==='marshmallow')assert.deepEqual(f.geometry.attributes.position.array,held);assert.equal(f.wax.getState().detached,damage);inspect('released');
  if(feel==='slow-rebound'){for(let i=0;i<1000;i++){f.tick(i%6===0);if([30,120,400,800].includes(i)){f.sync();inspect(`natural-recovery-${i}`);}if(f.deformation.getState().depth===0)break;}f.sync();assert.deepEqual(f.geometry.attributes.position.array,f.rest);inspect('natural-recovery-complete');}
  f.setRotationMatrix(new f.THREE.Matrix4().makeRotationFromEuler(new f.THREE.Euler(.4,.6,.7)));f.run(18);inspect('rotated-falling');
  f.begin(contactPoint(f.mesh,target[0]+.08,target[1]));f.run(70);inspect('broken-rim-repeat');f.end();f.act('beginRestore');for(let i=0;i<=12;i++){f.restore(i/12);if([0,6,12].includes(i))inspect(`restore-${i}`);}assert.deepEqual(f.geometry.attributes.position.array,f.rest);f.wax.reset();inspect('reset');record.frames=f.frames;t.diagnostic(JSON.stringify(record));
 }catch(e){t.diagnostic(JSON.stringify(record));throw e;}finally{thin.dispose();f.dispose();}
});


