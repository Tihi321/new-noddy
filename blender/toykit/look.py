"""The stop-motion look: Eevee setup, lighting presets, miniature DOF, flicker, grain + vignette."""
import math
import random

import bpy
from mathutils import Vector

from . import materials as mt

PRESETS = {
    "preview": dict(res=(640, 360), samples=16, dof=False, post=False),
    "final": dict(res=(1280, 720), samples=64, dof=True, post=True),
}

DEFAULT_STYLE = dict(fps=12, output_fps=24, jitter_pos=0.003, jitter_rot=0.3, light_flicker=0.02, dof_fstop=2.0,
                     grain=0.04, vignette=0.25, key_light="#ffe2b8", fill_light="#b8d4ff")

LIGHTING = {
    "day": dict(key=("#ffe2b8", 3.0, (-6.0, -9.0, 11.0)), fill=("#b8d4ff", 1.0, (9.0, -7.0, 5.0)), rim=("#fff0d8", 1.2, (3.0, 10.0, 7.0)),
                world=("#cfe6ff", 0.7), lamp=0.0, use_style=True),
    "evening": dict(key=("#ffb06e", 3.6, (-9.0, -6.0, 4.5)), fill=("#8f9cff", 1.0, (8.0, -8.0, 4.0)), rim=("#ffd0a0", 1.6, (4.0, 10.0, 5.0)),
                    world=("#ffcfa4", 0.55), lamp=140.0, use_style=False),
    "night": dict(key=("#a9bdff", 1.5, (6.0, -8.0, 9.0)), fill=("#4a5fc0", 0.5, (-8.0, -6.0, 4.0)), rim=("#8fa6ff", 0.8, (-3.0, 10.0, 6.0)),
                  world=("#16245a", 0.35), lamp=260.0, use_style=False),
    "snow": dict(key=("#fff1e0", 3.6, (-6.0, -9.0, 10.0)), fill=("#c1dbff", 2.0, (9.0, -7.0, 5.0)), rim=("#ffffff", 1.4, (3.0, 10.0, 7.0)),
                 world=("#e3f0ff", 1.3), lamp=0.0, use_style=True),
}


def full_style(style):
    s = dict(DEFAULT_STYLE)
    s.update(style or {})
    return s


def pick_engine():
    items = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if cand in items:
            return cand
    raise RuntimeError("no Eevee engine available: %s" % items)


def setup_render(scene, preset, style):
    p = PRESETS[preset]
    r = scene.render
    r.engine = pick_engine()
    r.resolution_x, r.resolution_y = p["res"]
    r.resolution_percentage = 100
    r.fps = int(style["fps"])
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"
    r.film_transparent = False
    ev = scene.eevee
    ev.taa_render_samples = p["samples"]
    for attr, val in (("use_shadows", True), ("use_raytracing", False), ("use_fast_gi", True)):
        if hasattr(ev, attr):
            try:
                setattr(ev, attr, val)
            except Exception:
                pass
    if hasattr(ev, "shadow_ray_count"):
        ev.shadow_ray_count = 2
        ev.shadow_step_count = 6
    vs = scene.view_settings
    for name in ("Standard",):
        try:
            vs.view_transform = name
        except Exception:
            pass
    try:
        vs.look = "None"
    except Exception:
        pass
    vs.exposure = 0.0
    scene.display_settings.display_device = "sRGB"


def _aim(obj, frm, to):
    obj.location = Vector(frm)
    d = Vector(to) - Vector(frm)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def setup_world(scene, color, strength):
    w = bpy.data.worlds.new("toykit_world")
    if bpy.app.version < (5, 0, 0):
        w.use_nodes = True  # always on (and deprecated) from Blender 5.0
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    if bg is None:
        nt.nodes.clear()
        bg = nt.nodes.new("ShaderNodeBackground")
        out = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs["Color"].default_value = mt.lin(color)
    bg.inputs["Strength"].default_value = strength
    scene.world = w


def setup_lights(scene, lighting, style, target=(0.0, 0.0, 0.5)):
    cfg = LIGHTING.get(lighting, LIGHTING["day"])
    rig = {}
    for key in ("key", "fill", "rim"):
        col, strength, pos = cfg[key]
        if cfg["use_style"] and key == "key":
            col = style["key_light"]
        if cfg["use_style"] and key == "fill":
            col = style["fill_light"]
        ld = bpy.data.lights.new("toykit_" + key, "SUN")
        ld.color = mt.lin(col)[:3]
        ld.energy = strength
        ld.angle = math.radians(6.0 if key == "key" else 22.0)
        if key == "rim":
            ld.use_shadow = False
        o = bpy.data.objects.new("toykit_" + key, ld)
        scene.collection.objects.link(o)
        _aim(o, pos, target)
        rig[key] = (o, strength)
    setup_world(scene, *cfg["world"])
    # lamp posts (point lights authored by sets.py)
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.get("toykit_lamp"):
            o.data.energy = cfg["lamp"] * float(o.get("toykit_lamp_scale", 1.0))
            o.hide_render = cfg["lamp"] <= 0
    return rig


def flicker(rig, style, frame, seed=0):
    amt = float(style.get("light_flicker", 0.0))
    rnd = random.Random(seed * 100003 + frame * 7919)
    for key, (o, base) in rig.items():
        o.data.energy = base * (1.0 + rnd.uniform(-amt, amt))


def make_camera(scene, lens=35.0):
    cd = bpy.data.cameras.new("toykit_cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cd.lens = lens
    cd.clip_start = 0.05
    cd.clip_end = 300.0
    cam = bpy.data.objects.new("toykit_cam", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def setup_dof(cam, preset, style):
    if PRESETS[preset]["dof"]:
        cam.data.dof.use_dof = True
        cam.data.dof.aperture_fstop = float(style["dof_fstop"])
    else:
        cam.data.dof.use_dof = False


def aim_camera(cam, loc, target, lens):
    loc, target = Vector(loc), Vector(target)
    cam.location = loc
    cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = float(lens)
    cam.data.dof.focus_distance = max((target - loc).length, 0.1)


def postprocess(path, style, frame=0):
    """Film grain + vignette on a rendered 8-bit PNG (numpy; done after render so it works on any Blender version)."""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=False)
    try:
        img.colorspace_settings.name = "Non-Color"
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        rgb = px[..., :3]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        nx = (xx / (w - 1) - 0.5) * 2.0
        ny = (yy / (h - 1) - 0.5) * 2.0 * (h / w)
        r2 = (nx * nx + ny * ny) / (1.0 + (h / w) ** 2)
        vig = 1.0 - float(style.get("vignette", 0.0)) * np.clip(r2, 0, 1) ** 1.1
        rng = np.random.default_rng(1000 + int(frame))
        grain = rng.standard_normal((h, w, 1)).astype(np.float32) * float(style.get("grain", 0.0)) * 0.5
        lum = rgb.mean(axis=2, keepdims=True)
        out = rgb * vig[..., None] + grain * (0.6 + 0.8 * (1 - np.abs(lum - 0.5) * 2))
        px[..., :3] = np.clip(out, 0, 1)
        px[..., 3] = 1.0
        img.pixels.foreach_set(px.reshape(-1))
        img.file_format = "PNG"
        img.filepath_raw = path
        img.save()
    finally:
        bpy.data.images.remove(img)
