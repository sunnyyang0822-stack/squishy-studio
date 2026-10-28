const {test}=require('node:test');
const assert=require('node:assert/strict');
const state=import('../detail/state.mjs');
const settle=()=>new Promise(r=>setImmediate(r));

test('slow-rebound wax/thin making scope includes registered shapes; legacy play stays excluded',async()=>{
 const {defaultRecipe,styleNames,isThinWaxRecipe,canRestartThinWax,previewFor}=await state;
 for(const styleId of Object.keys(styleNames)){
  const recipe={...defaultRecipe,styleId,coreMaterial:'butter',waxThickness:'thin'};
  assert.equal(isThinWaxRecipe(recipe),true);assert.equal(canRestartThinWax('shell',recipe),true);assert.equal(canRestartThinWax('play',recipe),false);
  const p=previewFor('shell',recipe);assert.equal(p.feelId,'slow-rebound');assert.equal(p.presetId,'slow-rebound');assert.equal(p.appearanceId,'full-matte');assert.equal(p.waxCollection,false);
  for(const change of [{waxThickness:'medium'},{waxThickness:'thick'},{shellMaterial:'polish'},{shellMaterial:'sugar'}])assert.equal(isThinWaxRecipe({...recipe,...change}),false);
 }
 assert.equal(defaultRecipe.waxThickness,'medium');
});
test('slow orb making navigation preserves damage identity; final play restores core with hidden shell preserved',async()=>{
 const {createDetailController}=await state,prepared=[],restored=[];
 const c=createDetailController({renderer:{async prepare(config){prepared.push(config);return{commit(){},dispose(){}}},restore(options){restored.push(options)},stopInput(){},dispose(){}},audio:{ready:false,setVolume(){},dispose(){}},recipe:{coreMaterial:'butter',coreColor:'mint',shellColor:'rose',waxThickness:'thin'}});
 try{await c.load();c.setStep('shell');await settle();const shell=prepared.at(-1);assert.equal(shell.coreColor,'mint');assert.equal(shell.shellColor,'rose');
 c.setStep('decoration');await settle();assert.equal(prepared.at(-1).recipeKey,shell.recipeKey);assert.deepEqual(restored,[]);
 c.setStep('making');c.setStep('play');await settle();assert.deepEqual(restored,[{preserveShell:true}]);
 c.setStep('shell');await settle();assert.equal(prepared.at(-1).recipeKey,shell.recipeKey);c.restart();assert.deepEqual(restored,[{preserveShell:true},undefined]);
 await c.select('shellColor','sky');assert.notEqual(prepared.at(-1).recipeKey,shell.recipeKey);assert.equal(prepared.at(-1).coreColor,'mint');
 }finally{c.dispose();}
});
