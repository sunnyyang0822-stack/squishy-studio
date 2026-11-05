const {test}=require('node:test');
const assert=require('node:assert/strict');

test('approved thin wax has 21 non-paw recipes; pending slow paw and other shell presets stay excluded',async()=>{
 const {defaultRecipe,isThinWaxRecipe,canRestartThinWax,previewFor}=await import('../detail/state.mjs');
 const styles=['orb','cloud','cylinder','donut','pyramid','flower','star'];let checked=0;
 for(const styleId of styles)for(const coreMaterial of ['clay','marshmallow','butter']){
  const recipe={...defaultRecipe,styleId,coreMaterial,waxThickness:'thin'};
  assert.equal(isThinWaxRecipe(recipe),true);assert.equal(canRestartThinWax('shell',recipe),true);
  const shell=previewFor('shell',recipe),decoration=previewFor('decoration',recipe);
  assert.equal(shell.recipeKey,decoration.recipeKey);assert.equal(shell.coreColor,recipe.coreColor);assert.equal(shell.shellColor,recipe.shellColor);assert.equal(shell.waxCollection,false);
  for(const change of [{waxThickness:'medium'},{waxThickness:'thick'},{shellMaterial:'polish'},{shellMaterial:'sugar'}])assert.equal(isThinWaxRecipe({...recipe,...change}),false);
  checked++;
 }
 assert.equal(checked,21);assert.equal(isThinWaxRecipe({...defaultRecipe,styleId:'paw',coreMaterial:'butter',waxThickness:'thin'}),false);
 // Existing merged clay/marshmallow paw recipes are retained, not newly delivered.
 for(const coreMaterial of ['clay','marshmallow'])assert.equal(isThinWaxRecipe({...defaultRecipe,styleId:'paw',coreMaterial,waxThickness:'thin'}),true);
 assert.equal(defaultRecipe.waxThickness,'medium');
});
