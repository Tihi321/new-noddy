"""Geometry helpers: pure-python shape generators + Builder/Part that make bpy objects.

Shapes return (verts, faces, fix) where fix says "recalculate normals" (closed solids).
Parts collect shapes in the *joint-local* frame, so every pivot sits at its joint.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

TAU = math.tau


# ----------------------------------------------------------------- shapes
def lathe(profile, seg=24, arc=None, fix=False):
    """Revolve a (r, z) profile around Z. Outward = right-hand side of profile direction."""
    a0, a1 = (0.0, TAU) if arc is None else arc
    full = arc is None
    n = seg if full else seg + 1
    verts, rings = [], []
    for (r, z) in profile:
        if r < 1e-7:
            verts.append((0.0, 0.0, z))
            rings.append([len(verts) - 1] * n)
        else:
            ring = []
            for k in range(n):
                t = a0 + (a1 - a0) * (k / seg)
                verts.append((r * math.cos(t), r * math.sin(t), z))
                ring.append(len(verts) - 1)
            rings.append(ring)
    faces = []
    last = seg if full else seg
    for i in range(len(profile) - 1):
        for k in range(last):
            k2 = (k + 1) % n
            a, b, c, d = rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]
            if a == b and c == d:
                continue
            if a == b:
                faces.append([a, c, d])
            elif c == d:
                faces.append([a, b, c])
            else:
                faces.append([a, b, c, d])
    return verts, faces, fix


def sphere(r=1.0, seg=20, rings=12):
    prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    prof[0] = (0.0, -r)
    prof[-1] = (0.0, r)
    return lathe(prof, seg)


def rounded_profile(r0, r1, h, f0=0.0, f1=0.0, n=4):
    """Solid of revolution from z=0..h, bottom radius r0, top r1, rounded edges f0/f1."""
    pts = [(0.0, 0.0)]
    f0 = min(f0, r0, h / 2)
    f1 = min(f1, r1, h / 2)
    if f0 > 1e-6:
        for i in range(n + 1):
            t = -math.pi / 2 + (math.pi / 2) * i / n
            pts.append((r0 - f0 + f0 * math.cos(t), f0 + f0 * math.sin(t)))
    else:
        pts.append((r0, 0.0))
    if f1 > 1e-6:
        for i in range(n + 1):
            t = (math.pi / 2) * i / n
            pts.append((r1 - f1 + f1 * math.cos(t), h - f1 + f1 * math.sin(t)))
    else:
        pts.append((r1, h))
    pts.append((0.0, h))
    return pts


def rcyl(r, h, fillet=0.02, seg=24, r1=None):
    return lathe(rounded_profile(r, r if r1 is None else r1, h, fillet, fillet if r1 is None else min(fillet, r1)), seg)


def capsule(r, length, seg=16, r1=None):
    """Capsule along Z from z=0 (bottom cap centre at z=r) ... total height length+2r? -> spans z in [-r, length+r]."""
    r1 = r if r1 is None else r1
    prof = [(0.0, -r)]
    for i in range(1, 7):
        t = -math.pi / 2 + (math.pi / 2) * i / 6
        prof.append((r * math.cos(t), r * math.sin(t)))
    for i in range(1, 6):
        t = (math.pi / 2) * i / 6
        prof.append((r1 * math.cos(t), length + r1 * math.sin(t)))
    prof.append((0.0, length + r1))
    return lathe(prof, seg)


def cone(r0, r1, h, seg=24, cap=True):
    prof = [(0.0, 0.0), (r0, 0.0), (r1, h), (0.0, h)] if cap else [(r0, 0.0), (r1, h)]
    return lathe(prof, seg)


def torus(R, r, seg=28, rseg=8):
    prof = [(R + r * math.cos(TAU * i / rseg), r * math.sin(TAU * i / rseg)) for i in range(rseg + 1)]
    return lathe(prof, seg, fix=True)


def dome(R, elev0=0.4, seg=24, rings=8):
    """Open spherical cap from elevation elev0 (rad) to the pole, centred at origin."""
    prof = []
    for i in range(rings + 1):
        e = elev0 + (math.pi / 2 - elev0) * i / rings
        prof.append((R * math.cos(e), R * math.sin(e)))
    prof[-1] = (0.0, R)
    return lathe(prof, seg)


def _cleanup(verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    v = [tuple(x.co) for x in bm.verts]
    f = [[x.index for x in fc.verts] for fc in bm.faces]
    bm.free()
    return v, f


def box(sx, sy, sz, bevel=0.0, bsegs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bevel = min(bevel, min(sx, sy, sz) * 0.45)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type='OFFSET', segments=bsegs, affect='EDGES')
    bm.verts.index_update()
    v = [tuple(x.co) for x in bm.verts]
    f = [[x.index for x in fc.verts] for fc in bm.faces]
    bm.free()
    return v, f, True


def prism(pts, z0, z1):
    """Polygon (x, y) extruded between z0 and z1 (z up)."""
    n = len(pts)
    verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    faces = [list(range(n)), [n + i for i in range(n)]]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return verts, faces, True


def prism_xz(pts, y0, y1):
    """Polygon (x, z) extruded along Y between y0 and y1."""
    n = len(pts)
    verts = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
    faces = [list(range(n)), [n + i for i in range(n)]]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return verts, faces, True


def tube(points, radius=0.02, seg=8, closed=False, radii=None, caps=True):
    pts = [Vector(p) for p in points]
    n = len(pts)
    if radii is None:
        radii = [radius] * n
    verts, ring_ids = [], []
    prev_n = None
    for i, p in enumerate(pts):
        if closed:
            t = (pts[(i + 1) % n] - pts[(i - 1) % n])
        elif i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        t.normalize()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            nn = ref.cross(t).normalized()
        else:
            nn = prev_n - t * prev_n.dot(t)
            if nn.length < 1e-6:
                nn = Vector((1, 0, 0)).cross(t).normalized()
            nn.normalize()
        prev_n = nn
        bb = t.cross(nn).normalized()
        ids = []
        for k in range(seg):
            a = TAU * k / seg
            v = p + (nn * math.cos(a) + bb * math.sin(a)) * radii[i]
            verts.append(tuple(v))
            ids.append(len(verts) - 1)
        ring_ids.append(ids)
    faces = []
    rng = n if closed else n - 1
    for i in range(rng):
        i2 = (i + 1) % n
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append([ring_ids[i][k], ring_ids[i][k2], ring_ids[i2][k2], ring_ids[i2][k]])
    if caps and not closed:
        faces.append(list(reversed(ring_ids[0])))
        faces.append(list(ring_ids[-1]))
    return verts, faces, True


def circle_pts(R, n=24, plane='xz', center=(0, 0, 0)):
    out = []
    for i in range(n):
        a = TAU * i / n
        c, s = R * math.cos(a), R * math.sin(a)
        if plane == 'xz':
            out.append((center[0] + c, center[1], center[2] + s))
        elif plane == 'xy':
            out.append((center[0] + c, center[1] + s, center[2]))
        else:
            out.append((center[0], center[1] + c, center[2] + s))
    return out


def helix(R, height, turns, n_per=10, r_tube=0.012):
    pts = []
    N = int(turns * n_per)
    for i in range(N + 1):
        t = i / N
        a = TAU * turns * t
        pts.append((R * math.cos(a), R * math.sin(a), height * t))
    return tube(pts, r_tube, seg=6)


def bezier(p0, p1, p2, n=10):
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2))
    return out


def sphere_dir(az, el):
    """Unit vector on a front-facing (-Y) sphere. az: sideways (+ = +X), el: up."""
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def facing(d):
    """Rotation matrix whose local +Z points along d."""
    return d.to_track_quat('Z', 'Y').to_matrix()


def _to_matrix(rot):
    if rot is None:
        return Matrix.Identity(3)
    if isinstance(rot, Matrix):
        return rot.to_3x3()
    if isinstance(rot, Quaternion):
        return rot.to_matrix()
    return Euler(tuple(rot), 'XYZ').to_matrix()


# ----------------------------------------------------------------- builder
class Part:
    def __init__(self, builder, name, parent, loc, kind='MESH'):
        self.b, self.name, self.parent, self.loc, self.kind = builder, name, parent, tuple(loc), kind
        self.pieces = []  # (verts, faces, fix, material, Matrix4)
        self.props = {}
        self.obj = None

    def add(self, geo, mat, loc=(0, 0, 0), rot=None, scale=(1, 1, 1)):
        verts, faces, fix = geo
        if isinstance(scale, (int, float)):
            scale = (scale, scale, scale)
        M = Matrix.Translation(Vector(loc)) @ _to_matrix(rot).to_4x4() @ Matrix.Diagonal(Vector((*scale, 1.0)))
        self.pieces.append((verts, faces, fix, mat, M))
        return self

    def build(self, collection):
        k = self.b.k
        if self.kind == 'EMPTY' or not self.pieces:
            obj = bpy.data.objects.new(self.name, None)
            obj.empty_display_type = 'PLAIN_AXES'
            obj.empty_display_size = 0.1
        else:
            allv, allf, allm = [], [], []
            mats = []
            for verts, faces, fix, mat, M in self.pieces:
                if fix:
                    verts, faces = _cleanup(verts, faces)
                if mat not in mats:
                    mats.append(mat)
                mi = mats.index(mat)
                base = len(allv)
                for v in verts:
                    w = M @ Vector(v)
                    allv.append((w.x * k, w.y * k, w.z * k))
                for f in faces:
                    allf.append([i + base for i in f])
                    allm.append(mi)
            mesh = bpy.data.meshes.new(self.name)
            mesh.from_pydata(allv, [], allf)
            mesh.update()
            for m in mats:
                mesh.materials.append(m)
            mesh.polygons.foreach_set("material_index", allm)
            mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
            mesh.update()
            obj = bpy.data.objects.new(self.name, mesh)
        obj.location = (self.loc[0] * k, self.loc[1] * k, self.loc[2] * k)
        collection.objects.link(obj)
        if self.parent is not None:
            obj.parent = self.parent.obj
        for key, val in self.props.items():
            obj[key] = val
        self.obj = obj
        return obj


class Builder:
    def __init__(self, k=1.0):
        self.k = k
        self.parts = []
        self.lamps = []

    def part(self, name, parent=None, loc=(0, 0, 0)):
        p = Part(self, name, parent, loc)
        self.parts.append(p)
        return p

    def empty(self, name, parent=None, loc=(0, 0, 0)):
        p = Part(self, name, parent, loc, kind='EMPTY')
        self.parts.append(p)
        return p

    def build(self, collection):
        objs = [p.build(collection) for p in self.parts]
        smooth_by_angle([o for o in objs if o.type == 'MESH'])
        return objs


def smooth_by_angle(objs, angle=50.0):
    objs = [o for o in objs if o.type == 'MESH']
    if not objs:
        return
    try:
        vl = bpy.context.view_layer
        for o in vl.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        vl.objects.active = objs[0]
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass
