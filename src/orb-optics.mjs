import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';

// Each scene owns its optical material. No texture, noise, or extra render pass.
export function createOrbMaterial(source, feelId) {
  const material = source.clone();
  material.color.set(0xffffff); material.roughness = .82; material.metalness = 0;
  if (feelId !== 'marshmallow') return material;
  const soft = new MeshPhysicalMaterial();
  MeshStandardMaterial.prototype.copy.call(soft, material); material.dispose();
  soft.defines = { STANDARD: '', PHYSICAL: '' };
  soft.roughness = 1; soft.sheen = .8;
  soft.sheenColor.set(0xffffff); soft.sheenRoughness = 1;
  soft.envMapIntensity = .35;
  return soft;
}
