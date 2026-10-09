"""Save .blend and export .glb (object names preserved, pivots untouched)."""
import os

import bpy


def _ensure_dir(path):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)


def save_blend(path):
    _ensure_dir(path)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), compress=True)


def export_glb(path, objects=None):
    """Export objects (default: all in scene) to a binary glTF. Unknown operator args are filtered out."""
    _ensure_dir(path)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    objs = list(objects) if objects is not None else list(vl.objects)
    for o in objs:
        o.select_set(True)
    flatten_materials(objs)
    wanted = dict(filepath=os.path.abspath(path), export_format='GLB', use_selection=True, export_yup=True,
                  export_apply=True, export_cameras=False, export_lights=False, export_materials='EXPORT',
                  export_extras=False, export_animations=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    kw = {k: v for k, v in wanted.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)


def flatten_materials(objs):
    """glTF only keeps a base colour when the socket is unlinked: drop the procedural links (the Base Color
    default_value already holds the spec colour). Call only after the .blend has been saved."""
    seen = set()
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in seen or not m.node_tree:
                continue
            seen.add(m.name)
            nt = m.node_tree
            for n in nt.nodes:
                if n.type != 'BSDF_PRINCIPLED':
                    continue
                for key in ('Base Color', 'Normal', 'Emission Color'):
                    sk = n.inputs.get(key)
                    if sk is not None:
                        for l in list(sk.links):
                            nt.links.remove(l)
