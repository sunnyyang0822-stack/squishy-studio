const {test}=require('node:test');const assert=require('node:assert/strict');
test('non-paw thick geometry configuration preserves thin and confirmed orb parameters',async()=>{
 const {thickWaxParameters,thickWaxSurfaceParameters,thickWaxDonutParameters,getWaxPreset}=await import('../src/wax-presets.mjs');
 const {thinWaxParameters}=await import('../src/thin-wax.mjs');
 assert.equal(getWaxPreset('thin-wax').parameters,thinWaxParameters);
 for(const p of [thickWaxParameters,thickWaxSurfaceParameters,thickWaxDonutParameters]){
  assert.ok(Object.isFrozen(p));assert.equal(p.thickness,.042);assert.equal(p.gap,.004);assert.equal(p.maxInwardDeformation,.004);
  for(const key of Object.keys(thinWaxParameters))if(key!=='thickness')assert.equal(p[key],thinWaxParameters[key]);
 }
 assert.equal(thickWaxParameters.surfaceContact,undefined,'confirmed orb retains its original local selection');
 assert.equal(thickWaxSurfaceParameters.surfaceContact,true);
 assert.equal(thickWaxDonutParameters.surfaceContact,true);
 assert.equal(thinWaxParameters.surfaceContact,undefined);assert.equal(thinWaxParameters.detachedCollisionIterations,undefined);
 assert.equal(getWaxPreset('thick-wax').parameters,thickWaxParameters);
 assert.throws(()=>getWaxPreset('unknown'),RangeError);
});
