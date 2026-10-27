"""Run with Blender 4.4 and squishy-orb.blend open, or via:
blender --background assets-source/squishy-orb/squishy-orb.blend --python assets-source/squishy-orb/export.py
No external textures, addons, libraries or compression tools are required.
"""
from pathlib import Path
import json
import bpy

root = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes['Squishy_Orb_1A']
bpy.context.window.scene = scene
bpy.ops.object.select_all(action='DESELECT')
orb = scene.objects['Orb_Surface']
assert len(orb.data.vertices) == 2562
assert len(orb.data.polygons) == 5120
assert not any(item.library for item in bpy.data.objects)
assert not any(image.source == 'FILE' for image in bpy.data.images)
orb.hide_set(False)
orb.select_set(True)
bpy.context.view_layer.objects.active = orb

# The GLB suffix selects the exporter's binary default. Blender 4.4's dynamic
# export_format enum is empty in RNA introspection; no hardcoded enum needed.
bpy.ops.export_scene.gltf(
    filepath=str(root / 'assets/models/squishy-orb.glb'),
    use_selection=True, use_active_scene=True,
    export_yup=True, export_normals=True, export_texcoords=False,
    export_animations=False, export_cameras=False, export_lights=False,
    export_extras=True,
)
print(json.dumps({
    'blender': bpy.app.version_string,
    'scene': scene.name,
    'vertices': len(orb.data.vertices),
    'triangles': len(orb.data.polygons),
    'glb_bytes': (root / 'assets/models/squishy-orb.glb').stat().st_size,
    'linked_libraries': len(bpy.data.libraries),
    'source_only_core': scene.objects['Soft_Core_REFERENCE_ONLY'].hide_render,
}))
