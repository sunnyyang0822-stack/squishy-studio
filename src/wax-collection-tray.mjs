import * as THREE from 'three';

// Retained presentation asset for the final-experience owner. This factory
// creates no scene, input, timer or physics; callers own placement and disposal.
export const waxCollectionTrayStyle = Object.freeze({ radius: 1.42, physicalRadius: 1.35, height: .045, floorY: -1.35, segments: 64, dayColor: 0xf2e6de, nightColor: 0x514754 });
export function createWaxCollectionTray() {
  const s = waxCollectionTrayStyle;
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, s.height, s.segments), new THREE.MeshStandardMaterial({ color: s.dayColor, roughness: .96, metalness: 0 }));
  tray.name = 'Thin_Wax_Collection_Tray'; tray.position.y = s.floorY - s.height / 2;
  tray.receiveShadow = true; tray.visible = false;
  return tray;
}
