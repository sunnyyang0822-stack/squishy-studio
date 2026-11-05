const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../detail/state.mjs');
test('medium sphere mapping only adds marshmallow and butter preview; defaults and unsupported combinations remain bounded',async()=>{
  const {isMediumWaxRecipe,canRestartWax,defaultRecipe,previewFor,styleNames}=await modulePromise;
  for(const styleId of Object.keys(styleNames))for(const coreMaterial of ['clay','marshmallow','butter']){
    const recipe={...defaultRecipe,styleId,coreMaterial},enabled=styleId!=='paw';
    assert.equal(isMediumWaxRecipe(recipe),enabled);assert.equal(canRestartWax('shell',recipe),enabled);assert.equal(canRestartWax('decoration',recipe),enabled);
    assert.equal(canRestartWax('play',recipe),styleId==='orb'&&coreMaterial==='clay');
    assert.equal(canRestartWax('core',recipe),false);assert.equal(canRestartWax('making',recipe),false);
  }
  assert.equal(Object.keys(styleNames).flatMap(styleId=>['clay','marshmallow','butter'].map(coreMaterial=>({...defaultRecipe,styleId,coreMaterial}))).filter(isMediumWaxRecipe).length,21);
  for(const coreMaterial of ['marshmallow','butter']){
    const recipe={...defaultRecipe,coreMaterial},p=previewFor('shell',recipe);
    assert.equal(p.presetId,coreMaterial==='butter'?'slow-rebound':'marshmallow');assert.equal(p.feelId,p.presetId);assert.equal(p.appearanceId,coreMaterial==='butter'?'full-matte':'matte');assert.equal(p.waxCollection,false);
    for(const patch of [{waxThickness:'thick'},{waxThickness:'thin'},{shellMaterial:'polish'},{shellMaterial:'sugar'},{styleId:'unknown'},{coreMaterial:'unknown'}])assert.equal(isMediumWaxRecipe({...recipe,...patch}),false);
  }
  assert.equal(defaultRecipe.coreMaterial,'clay');assert.equal(defaultRecipe.waxThickness,'medium');
});
test('both new sphere previews preserve navigation damage, explicit restart and hidden legacy final contract',async()=>{
  const {createDetailController}=await modulePromise;
  for(const coreMaterial of ['marshmallow','butter']){
    const configs=[],restores=[];let disposed=0;
    const c=createDetailController({recipe:{coreMaterial},step:'shell',renderer:{async prepare(config){configs.push(config);return {commit(){},dispose(){disposed++;}};},restore(o){restores.push(o);},stopInput(){},dispose(){}},audio:{ready:false,setVolume(){},dispose(){}}});
    const settle=()=>new Promise(r=>setImmediate(r));
    try{
      await c.load();const key=configs.at(-1).recipeKey;c.restart();assert.deepEqual(restores,[undefined]);restores.length=0;
      c.setStep('decoration');await settle();c.setStep('shell');await settle();assert.equal(configs.at(-1).recipeKey,key);assert.equal(restores.length,0);
      c.setStep('making');c.setStep('play');await settle();assert.deepEqual(restores,[{preserveShell:true}]);assert.equal(configs.at(-1).waxCollection,undefined);
      c.restart();assert.equal(restores.length,1);c.setStep('shell');await settle();assert.equal(configs.at(-1).waxCollection,false);assert.equal(configs.at(-1).recipeKey,key);
      await c.select('waxThickness','thick');await c.select('waxThickness','medium');await c.select('shellColor','mint');assert.equal(configs.at(-1).shellColor,'mint');assert.ok(disposed>0);
    }finally{c.dispose();}
  }
});
test('late core or thickness preparation is disposed and cannot overwrite last committed recipe',async()=>{
  const {createDetailController}=await modulePromise;const pending=[],commits=[],disposed=[];
  const c=createDetailController({step:'shell',renderer:{prepare(config){return new Promise(resolve=>pending.push({config,resolve}));},stopInput(){},dispose(){}},audio:{ready:false,setVolume(){},dispose(){}}});
  function finish(i){const p=pending[i];p.resolve({commit(){commits.push(p.config);},dispose(){disposed.push(p.config);}});}
  try{const initial=c.load();finish(0);await initial;const a=c.select('coreMaterial','marshmallow'),b=c.select('coreMaterial','butter'),d=c.select('waxThickness','thick'),e=c.select('waxThickness','medium');finish(4);await e;for(const i of [3,2,1])finish(i);await Promise.all([a,b,d]);assert.equal(commits.at(-1).feelId,'slow-rebound');assert.equal(commits.at(-1).waxThickness,'medium');assert.equal(commits.length,2);assert.equal(disposed.length,4);}finally{c.dispose();}
});
