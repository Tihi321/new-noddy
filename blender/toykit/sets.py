"""Build a SetLayout into a miniature tabletop diorama: ground, painted cardboard backdrop, props, marks."""
import math
import random

import bpy
from mathutils import Vector

from . import materials as mt, props
from .geo import Builder, lathe, prism, rcyl, box, smooth_by_angle, sphere

BACK_R = 10.5
BACK_H = 8.5

HILLS = {
    "sky_day": ["#8fd16a", "#6cbd5a", "#4ea84f"],
    "sky_sunset": ["#9a6fb0", "#7c5a9e", "#5e4a8a"],
    "sky_night": ["#1d2f6a", "#16265a", "#101d4a"],
    "sky_snow": ["#e6eef8", "#d4e0f0", "#c3d3ea"],
}


def _arc_strip(r, a0, a1, z0, z1, n=48, top=None):
    """Vertical cardboard strip on an arc around the origin, +Y centred (angle 90 deg = +Y). Faces inward."""
    verts, faces = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        x, y = r * math.cos(a), r * math.sin(a)
        zt = z1 if top is None else top(a, i / n)
        verts.append((x, y, z0))
        verts.append((x, y, zt))
    for i in range(n):
        b = i * 2
        faces.append([b, b + 1, b + 3, b + 2])  # normals inward? fixed by recalc below
    return verts, faces, False


def build_set(layout, collection):
    sid = layout["id"]
    size = layout.get("size") or [12, 8]
    ground_kind = layout.get("ground", "grass")
    backdrop = layout.get("backdrop", "sky_day")
    lighting = layout.get("lighting", "day")
    b = Builder(1.0)
    root = b.empty("set.root")
    root.props.update({"toykit_kind": "set", "toykit_set_id": sid, "toykit_lighting": lighting,
                       "toykit_backdrop": backdrop, "toykit_ground": ground_kind,
                       "toykit_size": [float(size[0]), float(size[1])]})
    # tabletop slab (visible plane the puppets walk on)
    gx, gy0, gy1 = 12.5, -7.0, BACK_R + 0.5
    gm = mt.ground(ground_kind)
    gp = b.part("set.ground", root, (0, 0, 0))
    gp.add(_slab(gx, gy0, gy1), gm)
    # table edge
    tp = b.part("set.table", root, (0, 0, 0))
    tp.add(box(2 * gx + 0.4, gy1 - gy0 + 0.4, 0.3, 0.05), mt.wood("#b8793c"), loc=(0, (gy0 + gy1) / 2, -0.17))
    # backdrop (curved painted sky) + layered cardboard hills
    bp = b.part("set.backdrop", root, (0, 0, 0))
    a0, a1 = math.radians(14), math.radians(166)
    bp.add(_arc_strip(BACK_R, a0, a1, -0.1, BACK_H, 60), mt.sky(backdrop, BACK_H))
    hp = b.part("set.hills", root, (0, 0, 0))
    cols = HILLS.get(backdrop, HILLS["sky_day"])
    rng = random.Random(sid)
    for li, (rad, base, amp) in enumerate([(BACK_R - 0.5, 0.3, 1.1), (BACK_R - 1.4, 0.0, 0.7), (BACK_R - 2.4, 0.0, 0.4)]):
        ph = rng.uniform(0, 6)
        f1, f2 = rng.uniform(2.0, 3.5), rng.uniform(5, 8)

        def top(a, t, base=base, amp=amp, ph=ph, f1=f1, f2=f2):
            return base + amp * (0.55 + 0.35 * math.sin(t * f1 * math.pi + ph) + 0.1 * math.sin(t * f2 * math.pi + ph * 2))
        a0b, a1b = math.radians(10 + li * 4), math.radians(170 - li * 4)
        hp.add(_arc_strip(rad, a0b, a1b, -0.1, 0, 60, top), mt.cardboard(cols[li]))
    # props
    lamps = []
    prop_objs = []
    for i, pr in enumerate(layout.get("props") or []):
        pid = pr.get("id") or "%s_%d" % (pr["kind"], i)
        o = props.build_prop(pr, "prop." + pid, collection, lamps)
        o.parent = None
        prop_objs.append(o)
    objs = b.build(collection)
    for o in prop_objs:
        o.parent = root.obj
    # marks
    for name, xy in (layout.get("marks") or {}).items():
        e = bpy.data.objects.new("mark." + name, None)
        e.empty_display_type = 'PLAIN_AXES'
        e.empty_display_size = 0.15
        e.location = (xy[0], xy[1], 0.0)
        collection.objects.link(e)
        e.parent = root.obj
        objs.append(e)
    # lamp post lights (energy is set at render time by look.py)
    for k, (obj, off, sc) in enumerate(lamps):
        ld = bpy.data.lights.new("lamp_%d" % k, 'POINT')
        ld.color = (1.0, 0.82, 0.5)
        ld.energy = 0.0
        ld.shadow_soft_size = 0.15
        lo = bpy.data.objects.new("lamp_%d" % k, ld)
        lo["toykit_lamp"] = True
        lo["toykit_lamp_scale"] = sc
        collection.objects.link(lo)
        lo.parent = obj
        lo.location = off + Vector((0, 0.0, 0.05 * sc))
    all_objs = list(objs) + prop_objs
    return [o for o in all_objs if o.type != 'LIGHT']


def _slab(gx, y0, y1, t=0.05):
    verts = [(-gx, y0, 0), (gx, y0, 0), (gx, y1, 0), (-gx, y1, 0)]
    faces = [[0, 1, 2, 3]]
    return verts, faces, False
