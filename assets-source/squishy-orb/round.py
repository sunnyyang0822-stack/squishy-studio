"""Rebuild the shared orb as a true unit sphere, preserving its indexed topology.

Run in an isolated Blender process, never in a user's unsaved interactive scene:
blender --background squishy-orb.blend --python round.py
Then export.py writes the corresponding runtime GLB.
"""
from pathlib import Path
import json
import runpy
import bpy

folder = Path(__file__).resolve().parent
scene = bpy.data.scenes['Squishy_Orb_1A']
bpy.context.window.scene = scene
orb = scene.objects['Orb_Surface']
mesh = orb.data
assert len(mesh.vertices) == 2562 and len(mesh.polygons) == 5120
assert max(abs(value - 1) for value in orb.scale) < 1e-6
assert orb.location.length < 1e-6

# The former asset flattened its vertical axis and base. Geometry, not a
# camera-facing scale or material preset, now defines the shared round shape.
for vertex in mesh.vertices:
    assert vertex.co.length > 0
    vertex.co.normalize()
for polygon in mesh.polygons:
    polygon.use_smooth = True
mesh.update()
mesh.normals_split_custom_set_from_vertices([tuple(vertex.co) for vertex in mesh.vertices])
orb['rest_radius'] = 1.0
orb['rest_shape'] = 'Unit sphere; equal axes; no flattened base'

# Source-only structural reference remains hidden and is never exported.
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(folder / 'squishy-orb.blend'))
runpy.run_path(str(folder / 'export.py'), run_name='__main__')
print(json.dumps({
    'shape': 'unit-sphere',
    'max_radius_error': max(abs(vertex.co.length - 1) for vertex in mesh.vertices),
    'vertices': len(mesh.vertices),
    'triangles': len(mesh.polygons),
    'source_file': 'assets-source/squishy-orb/squishy-orb.blend',
    'runtime_file': 'assets/models/squishy-orb.glb',
}))
