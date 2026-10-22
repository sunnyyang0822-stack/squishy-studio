"""Blender 4.4: --background --python scripts/build-styles.py -- [style ...].
Build only isolated scenes; never run this script in an unsaved interactive scene.
All forms are original geometry, one watertight surface, no baked textures.
"""
from pathlib import Path
import bpy, bmesh, math, json, sys, struct
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
IDS = ['cylinder', 'donut', 'cloud', 'paw', 'pyramid', 'flower', 'star']
NAMES = dict(zip(IDS, ['圆柱','甜甜圈','云朵','猫爪','三角锥','五瓣花朵','五角星']))
OUT = ROOT / 'artifacts/issue-30/models'
OUT.mkdir(parents=True, exist_ok=True)

def ellipsoid(location, scale):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=28, location=location)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj

def modifier(obj, kind, **kwargs):
    mod = obj.modifiers.new(kind, kind)
    for key, value in kwargs.items(): setattr(mod, key, value)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

def fuse(objects, voxel=.058, iterations=5):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    modifier(obj, 'REMESH', mode='VOXEL', voxel_size=voxel, use_smooth_shade=True)
    modifier(obj, 'SMOOTH', factor=.75, iterations=iterations)
    return obj

def inflated_outline(name, outline, depth, center=(0,0,0)):
    """One continuous plush surface; center has a convex cap, never a join pit."""
    n=160; rings=48
    verts=[(center[0],center[1]-depth,center[2])]
    for j in range(1,rings):
        phi=math.pi*j/rings
        for i in range(n):
            x,z=outline(math.tau*i/n)
            verts.append((center[0]+x*math.sin(phi),center[1]-depth*math.cos(phi),center[2]+z*math.sin(phi)))
    verts.append((center[0],center[1]+depth,center[2])); end=len(verts)-1
    faces=[(0,1+(i+1)%n,1+i) for i in range(n)]
    for j in range(rings-2):
        for i in range(n):
            a=1+j*n+i; b=1+j*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    faces += [(end,1+(rings-2)*n+i,1+(rings-2)*n+(i+1)%n) for i in range(n)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces)
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    return obj

def make(style):
    if style == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1, depth=1.45)
        obj = bpy.context.object
        modifier(obj, 'BEVEL', width=.30, segments=8)
        return fuse([obj], .052, 3)
    if style == 'donut':
        # Torus lies in X/Z; front opening faces Blender -Y / glTF +Z.
        bpy.ops.mesh.primitive_torus_add(major_segments=128, minor_segments=48,
            major_radius=.72, minor_radius=.44, rotation=(math.pi/2,0,0))
        obj = bpy.context.object
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return obj
    if style == 'cloud':
        lobes=[
            (-.82,-.14,.60,.65),(-.35,.32,.67,.73),(.36,.38,.69,.72),(.88,-.12,.59,.62),
            (0,-.25,.94,.56)]
        def cloud_outline(angle):
            dx,dz=math.cos(angle),math.sin(angle)
            radius=0
            for x,z,rx,rz in lobes:
                a=(dx/rx)**2+(dz/rz)**2
                b=-2*(dx*x/(rx*rx)+dz*z/(rz*rz))
                c=(x/rx)**2+(z/rz)**2-1
                discriminant=b*b-4*a*c
                if discriminant>=0:
                    radius=max(radius,(-b+math.sqrt(discriminant))/(2*a))
            return radius*dx,radius*dz
        # The silhouette retains five cloud lobes, while one convex depth cap
        # replaces sphere-intersection valleys on both front and back.
        return fuse([inflated_outline('Cloud_Convex_Cap',cloud_outline,.68)],.052,18)
    if style == 'paw':
        # Four toes and one broad palm. Five raised pads fuse into the body.
        parts = [ellipsoid((0,0,-.35),(.88,.43,.75))]
        for x,z,rx,rz in [(-.76,.36,.36,.47),(-.29,.70,.37,.50),(.29,.70,.37,.50),(.76,.36,.36,.47)]:
            parts.append(ellipsoid((x,0,z),(rx,.39,rz)))
            parts.append(ellipsoid((x,-.34,z+.015),(rx*.68,.18,rz*.62)))
        # Upside-down heart: rounded tip points up, two lobes face down.
        def inverted_heart(t):
            return .56*math.sin(t)**3,-.45*(13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t))/17
        parts.append(inflated_outline('Raised_Inverted_Heart_Pad',inverted_heart,.255,(0,-.47,-.40)))
        return fuse(parts, .043, 7)
    if style == 'flower':
        # Product review supersedes the original six-petal ring: five petal
        # balls plus ONE raised center ball, six total, one fused surface.
        parts=[ellipsoid((.68*math.cos(a),0,.68*math.sin(a)),(.60,.53,.60))
            for a in [math.pi/2+i*math.tau/5 for i in range(5)]]
        parts.append(ellipsoid((0,-.18,0),(.53,.53,.53)))
        return fuse(parts,.048,22)
    if style == 'pyramid':
        # Rounded tetrahedron: triangular base, three rising edges, apex.
        verts=[(0,0,1.20),(-1,-.64,-.72),(1,-.64,-.72),(0,1.05,-.72)]
        mesh=bpy.data.meshes.new('Rounded_Tetrahedron_Construction')
        mesh.from_pydata(verts,[],[(0,2,1),(0,3,2),(0,1,3),(1,2,3)])
        obj=bpy.data.objects.new('Tetrahedron',mesh)
        bpy.context.collection.objects.link(obj)
        obj.select_set(True); bpy.context.view_layer.objects.active=obj
        # Subdivision rounds a tetrahedron into a plump but recognizable volume.
        modifier(obj,'BEVEL',width=.32,segments=8)
        modifier(obj,'SUBSURF',levels=2,render_levels=2)
        obj=fuse([obj],.042,3)
        obj.scale=(1.30,1.30,1.30)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return obj
    if style == 'star':
        # Continuous rounded star ellipsoid, no extruded flat faces or sharp tips.
        verts=[(0, -.55, 0)]
        n=160; rings=48
        for j in range(1,rings):
            phi=math.pi*j/rings
            for i in range(n):
                angle=math.tau*i/n
                radial=(.94+.22*math.cos(5*(angle-math.pi/2)))*math.sin(phi)
                verts.append((radial*math.cos(angle),-.55*math.cos(phi),radial*math.sin(angle)))
        verts.append((0,.55,0)); end=len(verts)-1
        faces=[]
        for i in range(n): faces.append((0,1+(i+1)%n,1+i))
        for j in range(rings-2):
            for i in range(n):
                a=1+j*n+i; b=1+j*n+(i+1)%n
                faces.append((a,b,b+n,a+n))
        for i in range(n): faces.append((end,1+(rings-2)*n+i,1+(rings-2)*n+(i+1)%n))
        mesh=bpy.data.meshes.new('Puffy_Star_Surface'); mesh.from_pydata(verts,[],faces)
        obj=bpy.data.objects.new('Star',mesh); bpy.context.collection.objects.link(obj)
        # Remesh removes pole crowding and leaves even local-deformation edges.
        return fuse([obj],.045,2)

def point(obj, at=(0,0,0)):
    obj.rotation_euler=(Vector(at)-obj.location).to_track_quat('-Z','Y').to_euler()

def setup_render(scene):
    scene.render.engine='CYCLES'; scene.cycles.samples=24
    scene.render.resolution_x=400; scene.render.resolution_y=400
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.film_transparent=False
    scene.world.color=(.28,.28,.28)
    for name,loc,power,size in [('Key',(-3,-4,5),500,3),('Fill',(4,-1,1),170,3),('Rim',(1,4,3),350,3)]:
        data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
        obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj); obj.location=loc; point(obj)
    data=bpy.data.cameras.new('Review_Camera'); cam=bpy.data.objects.new('Review_Camera',data)
    scene.collection.objects.link(cam); scene.camera=cam; data.type='ORTHO'; data.ortho_scale=3.45
    return cam

def build(style):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene; scene.name='Squishy_'+style
    obj=make(style); obj.name='Squishy_Surface'
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY',center='BOUNDS'); obj.location=(0,0,0)
    bm=bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    assert all(e.is_manifold for e in bm.edges), style+' must be closed manifold'
    assert len(bmesh.ops.find_doubles(bm,verts=bm.verts,dist=.000001)['targetmap'])==0
    bm.to_mesh(obj.data); bm.free()
    for face in obj.data.polygons: face.use_smooth=True
    mat=bpy.data.materials.new('Runtime_Clay_Placeholder'); mat.diffuse_color=(.82,.43,.48,1)
    mat.use_nodes=True; bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value=(.82,.43,.48,1); bsdf.inputs['Roughness'].default_value=.65
    obj.data.materials.clear(); obj.data.materials.append(mat)
    obj['styleId']=style; obj['feelId']='clay'; obj['source']='Original procedural geometry'
    obj['geometryContract']='single-closed-surface; glTF Y-up; front +Z; origin bounds center'
    src=ROOT/('assets-source/squishy-'+style); src.mkdir(parents=True,exist_ok=True)
    target=ROOT/('assets/models/squishy-'+style+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(target),use_selection=True,use_active_scene=True,
        export_yup=True,export_normals=True,export_texcoords=False,export_animations=False,
        export_cameras=False,export_lights=False,export_extras=True)
    raw=target.read_bytes(); length=struct.unpack_from('<I',raw,12)[0]
    gltf=json.loads(raw[20:20+length]); primitive=gltf['meshes'][0]['primitives'][0]
    positions=gltf['accessors'][primitive['attributes']['POSITION']]
    meta={'id':style,'name':NAMES[style],'blender':bpy.app.version_string,
        'coordinates':'meters; glTF Y-up; front +Z; bounds-centered origin',
        'bboxMin':positions['min'],'bboxMax':positions['max'],
        'vertices':positions['count'],'triangles':gltf['accessors'][primitive['indices']]['count']//3,
        'glbBytes':len(raw),'meshes':1,'primitives':1,'materials':1,
        'closedManifold':True,'externalTextures':False,'feelId':'clay',
        'reviewStatus':'review revision: four toes + inverted heart palm; approved tetrahedron; five petals + one center'}
    (OUT/(style+'.json')).write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
    cam=setup_render(scene)
    for view,loc in [('front',(0,-6,.1)),('side',(6,0,.1)),('back',(0,6,.1)),('bottom',(0,0,-6))]:
        cam.location=loc; point(cam)
        scene.render.filepath=str(OUT/(style+'-'+view+'.png')); bpy.ops.render.render(write_still=True)
    cam.location=(3,-6,2); point(cam)
    scene.render.filepath=str(src/'preview.png'); bpy.ops.render.render(write_still=True)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(src/('squishy-'+style+'.blend')))
    (src/'README.md').write_text('# '+NAMES[style]+'：Issue #30 可编辑初稿\n\n'
        '仅复用 `clay`。源几何是单一闭合连续表面，无相交内部壳，无贴图。材质为可替换 PBR 占位；浏览器使用已有色卡与独立光学预设。\n\n'
        '坐标：米制、Blender Z-up，导出 glTF Y-up；正面为 glTF +Z。原点为包围盒中心，所有对象变换已应用。浏览器落地与相机按包围盒适配。\n\n'
        '复现：在仓库根目录运行 `blender --background --python scripts/build-styles.py -- '+style+'`。此脚本只用于独立后台进程，会清空当前场景；不要在未保存的交互场景中执行。导出仅选择表面，不含相机或灯光。`.blend` 保留可编辑表面与独立审阅灯光。\n\n'
        '几何统计和包围盒见 `artifacts/issue-30/models/'+style+'.json`；正、侧、背、底图在同目录。浏览器验证另由运行时测试记录，Blender 图不能代替可玩验收。\n\n'
        +('按产品评审修订：4 个趾体、4 个鼓起趾垫，加 1 个倒心形主肉垫（尖端朝上、下方双圆瓣）；肉垫全部真实融合。\n' if style=='paw' else '')
        +('产品已确认三角底四面体（3 个底角 + 1 个顶部），默认视角可略转以展示体积。\n' if style=='pyramid' else '')
        +('最新产品反馈覆盖最初六瓣环规格：5 个圆球为花瓣，1 个圆球为鼓起花蕊，总计 6 球融合。花蕊通过几何区分，不依赖固定材质或烘色。\n' if style=='flower' else '')
        +('按产品评审消除正背面的交汇凹点：云瓣外轮廓搭配单一连续凸起厚度曲面，保留自然瓣间轮廓，不在表面留下莫名凹陷。\n' if style=='cloud' else '')
        +('按最新产品评审加厚环体：主半径 0.72、管半径 0.44，管径由 0.72 增至 0.88（约 22%），外径 2.32，中孔直径 0.56 仍清楚贯通。仅改变几何，不改黏土参数。\n' if style=='donut' else '')
        +'\n网格、法线与封闭性由生成脚本断言；GLB 无外部依赖，单 mesh / primitive / material。回滚时成对恢复源 `.blend` 与运行时 `.glb`，然后重新运行资产测试。\n',encoding='utf8')
    print('STYLE_DONE '+json.dumps(meta,ensure_ascii=False),flush=True)

selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else IDS
for style in selected:
    assert style in IDS
    build(style)

# Review sheet is evidence, separate from the runtime preview assets.
rows=''.join('<section><h2>'+NAMES[s]+' · '+s+'</h2><div>'+''.join(
    '<figure><img src="'+s+'-'+v+'.png"><figcaption>'+label+'</figcaption></figure>'
    for v,label in [('front','正面'),('side','侧面'),('back','背面'),('bottom','底部')])+'</div></section>'
    for s in IDS if (OUT/(s+'-front.png')).exists())
(OUT/'review.html').write_text('<!doctype html><meta charset="utf-8"><title>Issue 30 模型初稿</title>'
    '<style>body{font:14px system-ui;background:#f6f1f1;color:#382e32;margin:24px;width:800px}'
    'h1{font-size:24px}h2{font-size:17px;margin:16px 0 8px}section div{display:flex;gap:8px}'
    'figure{margin:0;width:194px}img{display:block;width:194px;border-radius:12px}'
    'figcaption{text-align:center;padding:5px}p{line-height:1.7}</style>'
    '<h1>七种黏土样式 · Blender 多视角初稿</h1>'
    '<p>统一 clay；表面为单一闭合连续网格。猫爪：4 趾 + 倒心形鼓起主肉垫（尖端朝上）。'
    '三角锥：产品已确认圆钝三角底四面体。云朵：正背面无交汇凹点。'
    '花朵：最新规格为五圆球花瓣 + 一圆球花蕊，共六球。此图用于造型审阅，不代表浏览器交互验收。</p>'+rows,encoding='utf8')
