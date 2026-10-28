const {test}=require('node:test');const assert=require('node:assert/strict');
test('pending wax upload ranges stay bounded across repeated syncs and independent buffer consumption',async t=>{
 const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),g=new THREE.SphereGeometry(.9,12,8),wax=getWaxPreset().create({geometry:g}),shell=wax.group.children[0].geometry;
 try{
  const max=wax.getState().panels,position=shell.attributes.position,normal=shell.attributes.normal;
  for(let i=0;i<200;i++)wax.sync();assert.ok(position.updateRanges.length<=max);assert.ok(normal.updateRanges.length<=max);
  position.clearUpdateRanges();wax.sync();assert.ok(position.updateRanges.length>0&&position.updateRanges.length<=max);assert.ok(normal.updateRanges.length<=max);
  normal.clearUpdateRanges();wax.sync();assert.ok(normal.updateRanges.length>0&&normal.updateRanges.length<=max);assert.ok(position.updateRanges.length<=max);
  for(const attr of [position,normal]){const covered=new Uint8Array(attr.array.length);for(const range of attr.updateRanges){assert.ok(range.start>=0&&range.start+range.count<=attr.array.length);covered.fill(1,range.start,range.start+range.count);}assert.ok(covered.every(v=>v===1),'Unconsumed full-surface writes remain queued even across multiple syncs');}
  wax.reset();assert.equal(wax.getState().detached,0);t.diagnostic(JSON.stringify({panels:max,positionRanges:position.updateRanges.length,normalRanges:normal.updateRanges.length,floatsPerBuffer:position.array.length}));
 }finally{wax.dispose();g.dispose();}
});
