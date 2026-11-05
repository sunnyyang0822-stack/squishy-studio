const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readMesh}=require('./helpers/squishy-mesh.cjs');

async function setup(id){
  const THREE=await import('three'),{getWaxPreset}=await import('../src/wax-presets.mjs'),{createThinWax,thinWaxParameters}=await import('../src/thin-wax.mjs');
  const data=readMesh(`./assets/models/squishy-${id}.glb`),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));g.setIndex(data.indices);
  let now=0;const options={styleId:id,geometry:g,clock:()=>now,collectionEnabled:false};
  const old=createThinWax({...options,fullSurfaceSupport:id==='paw',freezeRenderedFragments:true},{...thinWaxParameters,thickness:.028,seedCount:96});
  const oversized=createThinWax({...options,fullSurfaceSupport:id==='paw',freezeRenderedFragments:true},{...thinWaxParameters,thickness:.028,seedCount:id==='paw'?32:48,partitionSpace:'surface'});
  const wax=getWaxPreset('medium-wax').create(options);
  return {THREE,data,g,old,oversized,wax,advance(dt){now+=dt;old.step(dt);oversized.step(dt);wax.step(dt);},dispose(){old.dispose();oversized.dispose();wax.dispose();g.dispose();}};
}
function measure(THREE,wax,region){
  const s=wax.getSurfaceSnapshot(),areas=new Map(),local=new Map(),a=new THREE.Vector3(),b=a.clone(),c=a.clone(),center=a.clone(),normal=a.clone();
  for(let i=0;i<s.indices.length;i+=3){const ids=Array.from(s.indices.slice(i,i+3));if(!ids.every(v=>s.layers[v]===1))continue;
    a.fromArray(s.restSupportPositions,ids[0]*3);b.fromArray(s.restSupportPositions,ids[1]*3);c.fromArray(s.restSupportPositions,ids[2]*3);center.copy(a).add(b).add(c).multiplyScalar(1/3);
    normal.set(0,0,0);for(const v of ids)normal.add(new THREE.Vector3().fromArray(s.restSupportNormals,v*3));normal.normalize();
    const area=b.sub(a).cross(c.sub(a)).length()*.5,id=s.panelIds[ids[0]];areas.set(id,(areas.get(id)||0)+area);if(region(center,normal))local.set(id,(local.get(id)||0)+area);
  }
  const sorted=[...local.keys()].map(id=>areas.get(id)).sort((a,b)=>a-b),weight=[...local.values()].reduce((a,b)=>a+b,0);
  return {areas,localPanels:sorted.length,median:sorted[sorted.length>>1],weightedArea:[...local].reduce((sum,[id,area])=>sum+area*areas.get(id),0)/weight,coveredArea:weight};
}
for(const id of ['donut','paw'])test(`${id}: medium cavity cells avoid tiny slivers without oversized first releases`,async t=>{
  const f=await setup(id);try{
    const regions=id==='donut'?[{name:'inner ring',target:[.38,0],test:(p,n)=>p.x*n.x+p.y*n.y<-.03}]:[
      {name:'palm-to-toe recess',target:[0,.17],test:(p,n)=>Math.abs(p.x)<.45&&p.y>.06&&p.y<.4&&n.z>.2},
      {name:'left recessed connection',target:[-.32,.4],test:(p,n)=>p.x>-.55&&p.x<-.12&&p.y>.2&&p.y<.55&&n.z>.2},
    ];
    for(const r of regions){
      const old=measure(f.THREE,f.old,r.test),oversized=measure(f.THREE,f.oversized,r.test),current=measure(f.THREE,f.wax,r.test);assert.ok(old.localPanels>0&&current.localPanels>0);
      assert.ok(current.weightedArea<oversized.weightedArea*.8,`${r.name}: moderate ${current.weightedArea} vs oversized ${oversized.weightedArea}`);
      let best=Infinity,point;for(let i=0;i<f.data.positions.length;i+=3){const p=new f.THREE.Vector3().fromArray(f.data.positions,i),n=new f.THREE.Vector3().fromArray(f.data.normals,i);if(n.z<.2||!r.test(p,n))continue;const d=(p.x-r.target[0])**2+(p.y-r.target[1])**2;if(d<best){best=d;point=p.toArray();}}
      assert.ok(point);for(const wax of [f.old,f.oversized,f.wax]){wax.reset();wax.begin(point);}f.advance(.501);for(const wax of [f.old,f.oversized,f.wax])wax.end();
      const detachedMean=(wax,areas)=>{const s=wax.getSurfaceSnapshot(),ids=new Set(Array.from(s.panelIds).filter((_,i)=>s.detached[i]));assert.ok(ids.size>0);return [...ids].reduce((sum,id)=>sum+areas.get(id),0)/ids.size;};
      const oldFirst=detachedMean(f.old,old.areas),oversizedFirst=detachedMean(f.oversized,oversized.areas),newFirst=detachedMean(f.wax,current.areas);
      assert.ok(newFirst>oldFirst*1.4,`${r.name} first detached bodies: ${newFirst} vs ${oldFirst}`);
      assert.ok(newFirst<oversizedFirst*.65,`${r.name}: moderate first release ${newFirst} vs oversized ${oversizedFirst}`);
      t.diagnostic(JSON.stringify({id,region:r.name,point,previous:{cells:old.localPanels,weightedArea:old.weightedArea,median:old.median,firstDetachedMean:oldFirst},oversized:{weightedArea:oversized.weightedArea,firstDetachedMean:oversizedFirst},current:{cells:current.localPanels,weightedArea:current.weightedArea,median:current.median,firstDetachedMean:newFirst}}));
    }
  }finally{f.dispose();}
});
