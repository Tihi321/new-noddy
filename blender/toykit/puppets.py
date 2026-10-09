"""Procedural peg-doll puppets from a PuppetSpec (see docs/contracts.md).

Rest orientation: puppet faces -Y (towards the default camera), feet at z=0, +X is the puppet's LEFT.
Hierarchy: root -> hips -> torso -> (head -> hat, mouth_0..2), (arm_l, arm_r); hips -> leg_l, leg_r.
Every part is its own mesh object with its pivot at the joint (glTF friendly, no armature).
"""
import math

import bpy
from mathutils import Matrix, Vector

from . import materials as mt
from .geo import (Builder, bezier, box, capsule, circle_pts, cone, dome, facing, helix, lathe, prism_xz, rcyl,
                  rounded_profile, sphere, sphere_dir, torus, tube)

DEFAULT_COLORS = {"skin": "#f2c9a0", "torso": "#d33b2c", "legs": "#2a4fa8", "hat": "#d22222", "accent": "#ffd400"}


class Mats:
    """Material factory for one puppet."""

    def __init__(self, spec):
        self.kind = spec.get("material", "wood")
        c = dict(DEFAULT_COLORS)
        c.update(spec.get("colors") or {})
        self.c = c
        self.skin_kind = "clay" if self.kind == "knit" else self.kind

    def body(self, hexc):
        return mt.surface(self.kind, hexc)

    def skin(self, hexc=None):
        return mt.surface(self.skin_kind, hexc or self.c["skin"])

    def gloss(self, hexc, rough=0.2):
        return mt.paint(hexc, rough)


def _dark(c, f=0.45):
    return mt.shade(c, f)


# --------------------------------------------------------------- face
def _surf(hr, cz, x, z):
    """Point on the front of the head sphere at sideways x and height z (z relative to head pivot)."""
    dz = z - cz
    y2 = max(hr * hr - x * x - dz * dz, 0.0)
    return Vector((x, -math.sqrt(y2), z))


def _normal_at(hr, cz, p):
    return (Vector(p) - Vector((0, 0, cz))).normalized()


def make_face(head, spec, hr, cz, M, body):
    c = M.c
    eyes = spec.get("eyes", "dot")
    nose = spec.get("nose", "round")
    ears = spec.get("ears", "none")
    centre = Vector((0, 0, cz))
    er = hr * 0.155
    eye_az = 0.40
    eye_el = 0.06
    if body == "cow":
        er = hr * 0.17
        eye_az = 0.62
        eye_el = 0.22
    for sgn in (-1, 1):
        d = sphere_dir(sgn * eye_az, eye_el)
        pos = centre + d * hr * (0.965 if eyes == "dot" else 0.99)
        R = facing(d)
        if eyes == "dot":
            head.add(sphere(er, 14, 9), mt.paint("#1a1414", 0.08, 1.0), loc=pos, rot=R, scale=(0.92, 1.18, 0.62))
            hl = pos + d * er * 0.42 + R @ Vector((0.28 * er, 0.4 * er, 0))
            head.add(sphere(er * 0.3, 8, 6), mt.paint("#ffffff", 0.1, 0.0), loc=hl, rot=R, scale=(1, 1, 0.6))
        else:  # sewn button eye
            head.add(rcyl(er * 1.25, er * 0.7, er * 0.25, 16), mt.paint("#2a1b12", 0.25, 0.4), loc=pos - d * er * 0.2, rot=R)
            for hx in (-0.38, 0.38):
                head.add(sphere(er * 0.2, 8, 6), mt.paint("#0a0606", 0.2, 0.0), loc=pos + d * er * 0.52 + R @ Vector((hx * er, 0, 0)), rot=R, scale=(1, 1, 0.5))
            head.add(sphere(er * 0.28, 8, 6), mt.paint("#ffffff", 0.1, 0.0), loc=pos + d * er * 0.5 + R @ Vector((0.4 * er, 0.55 * er, 0)), rot=R, scale=(1, 1, 0.5))
    # rosy cheeks
    if body not in ("cow",):
        cheek = mt.paint(mt.mix_hex(c["skin"], "#ff5f6d", 0.55), 0.55, 0.0)
        for sgn in (-1, 1):
            d = sphere_dir(sgn * 0.82, -0.2)
            R = facing(d)
            head.add(sphere(hr * 0.2, 12, 8), cheek, loc=centre + d * hr * 0.975, rot=R, scale=(1, 0.85, 0.22))
    # nose
    if nose == "round":
        d = sphere_dir(0, -0.06)
        head.add(sphere(hr * 0.13, 12, 8), mt.paint(mt.mix_hex(c["skin"], "#e23b3b", 0.7), 0.25, 0.4),
                 loc=centre + d * hr * 1.0, rot=facing(d))
    elif nose == "button":
        d = sphere_dir(0, -0.08)
        head.add(sphere(hr * 0.1, 10, 8), mt.paint("#1d1414", 0.15, 0.8), loc=centre + d * hr * 1.0, rot=facing(d), scale=(1.2, 0.9, 0.9))
    elif nose == "snout":
        d = sphere_dir(0, -0.3)
        R = facing(d)
        big = 1.5 if body == "cow" else 1.0
        snout_col = "#f4a6ae" if body in ("cow", "peg", "jack_box") else mt.shade(mt.mix_hex(c["skin"], "#ffffff", 0.35), 1.0)
        head.add(sphere(hr * 0.3 * big, 16, 10), M.gloss(snout_col, 0.5) if M.kind == "wood" else mt.felt(snout_col),
                 loc=centre + d * hr * (0.98 + (0.08 if body == "cow" else 0.04)), rot=R, scale=(1.25 if body == "cow" else 1.0, 0.9, 0.85 if body == "cow" else 0.9))
        for sgn in (-1, 1):
            dn = sphere_dir(sgn * 0.17 * big, -0.3)
            head.add(sphere(hr * 0.04 * big, 6, 5), mt.paint("#3a1d22", 0.3, 0.0), loc=centre + dn * hr * (1.19 if body == "cow" else 1.06))
        if body == "teddy":
            head.add(sphere(hr * 0.09, 10, 8), mt.paint("#1d1414", 0.15, 0.8), loc=centre + sphere_dir(0, -0.18) * hr * 1.28, scale=(1.3, 0.9, 0.9))
    # ears
    if ears == "round":
        inner = mt.mix_hex(c["skin"], "#f6a6b0", 0.6)
        for sgn in (-1, 1):
            d = Vector((sgn * 0.68, -0.05, 0.74)).normalized()
            head.add(sphere(hr * 0.33, 14, 10), M.skin(), loc=centre + d * hr * 0.98, rot=facing(Vector((sgn * 0.4, -0.9, 0.2))), scale=(1, 1, 0.55))
            head.add(sphere(hr * 0.2, 10, 8), mt.felt(inner) if M.kind != "wood" else M.gloss(inner, 0.5),
                     loc=centre + d * hr * 0.98 + Vector((sgn * 0.0, -hr * 0.1, 0)), rot=facing(Vector((sgn * 0.4, -0.9, 0.2))), scale=(1, 1, 0.5))
    elif ears == "cow":
        inner = "#f4a6ae"
        for sgn in (-1, 1):
            base = centre + Vector((sgn * hr * 0.95, hr * 0.02, hr * 0.32))
            rot = Matrix.Rotation(sgn * -0.45, 3, 'Y') @ Matrix.Rotation(-0.05, 3, 'X')
            head.add(sphere(hr * 0.3, 14, 10), M.body(c["skin"]), loc=base + Vector((sgn * hr * 0.28, 0, -hr * 0.07)), rot=rot, scale=(1.35, 0.55, 0.8))
            head.add(sphere(hr * 0.2, 10, 8), mt.felt(inner), loc=base + Vector((sgn * hr * 0.3, -hr * 0.1, -hr * 0.07)), rot=rot, scale=(1.2, 0.35, 0.65))
    if body == "cow":  # horns
        for sgn in (-1, 1):
            head.add(cone(hr * 0.1, hr * 0.03, hr * 0.38, 10), M.gloss("#f1e7c9", 0.35), loc=centre + Vector((sgn * hr * 0.48, 0, hr * 0.88)),
                     rot=Matrix.Rotation(sgn * -0.5, 3, 'Y'))


def make_mouths(b, spec, head, hr, cz):
    """mouth_0 closed smile, mouth_1 small open, mouth_2 big open."""
    pid = spec["id"]
    dark = mt.paint("#6e1f24", 0.35, 0.2)
    tongue = mt.paint("#f2767d", 0.4, 0.0)
    body = spec.get("body")
    zc = cz - hr * (0.45 if body not in ("cow",) else 0.62)
    xs = hr * (0.5 if body != "cow" else 0.42)
    m0 = b.part(f"{pid}.mouth_0", head)
    pts = []
    for i in range(11):
        t = -1 + 0.2 * i
        pts.append(tuple(_surf(hr, cz, t * xs * 0.5, zc + hr * 0.075 * t * t) * 1.004))
    m0.add(tube(pts, hr * 0.028, 6), dark)
    m1 = b.part(f"{pid}.mouth_1", head)
    p = _surf(hr, cz, 0, zc - hr * 0.02)
    n = _normal_at(hr, cz, p)
    m1.add(sphere(hr * 0.13, 14, 9), dark, loc=p * 1.0, rot=facing(n), scale=(1.15, 0.8, 0.5))
    m2 = b.part(f"{pid}.mouth_2", head)
    p = _surf(hr, cz, 0, zc - hr * 0.045)
    n = _normal_at(hr, cz, p)
    m2.add(sphere(hr * 0.19, 16, 10), dark, loc=p * 1.0, rot=facing(n), scale=(1.1, 1.0, 0.5))
    m2.add(sphere(hr * 0.11, 10, 8), tongue, loc=p * 1.0 + facing(n) @ Vector((0, -hr * 0.07, hr * 0.015)) , rot=facing(n), scale=(1.2, 0.7, 0.4))
    for m in (m1, m2):
        m.props["toykit_mouth"] = True
    return m0, m1, m2


# --------------------------------------------------------------- hats
def make_hat(b, spec, head, hr, cz, M):
    kind = spec.get("hat", "none")
    if kind in (None, "none", ""):
        return None
    c = M.c
    col, acc = c["hat"], c["accent"]
    pid = spec["id"]
    top = cz + hr * 0.9
    hp = b.part(f"{pid}.hat", head, (0, 0, top))
    cz0 = -hr * 0.9
    R = hr * 1.07
    hm = M.body(col)
    am = M.body(acc)
    if kind == "pompom":
        e0 = 0.36
        hp.add(dome(R, e0), hm, loc=(0, 0, cz0))
        hp.add(torus(R * math.cos(e0) * 0.99, hr * 0.095), am, loc=(0, 0, cz0 + R * math.sin(e0)))
        hp.add(sphere(hr * 0.3, 16, 10), am, loc=(0, 0, cz0 + R + hr * 0.14))
    elif kind == "bell_cap":
        e0 = 0.32
        hp.add(dome(R, e0), hm, loc=(0, 0, cz0))
        hp.add(torus(R * math.cos(e0) * 0.99, hr * 0.085), am, loc=(0, 0, cz0 + R * math.sin(e0)))
        T = Vector((0, 0, cz0 + R * 0.92))
        pts = bezier(T, T + Vector((hr * 0.5, hr * 0.15, hr * 1.0)), T + Vector((hr * 1.6, hr * 0.25, hr * 0.15)), 14)
        radii = [R * 0.55 * (1 - i / 14) + hr * 0.05 for i in range(15)]
        hp.add(tube(pts, 0.01, 12, radii=radii), hm)
        hp.add(sphere(hr * 0.17, 12, 8), mt.metal("#f2c230", 0.25), loc=Vector(pts[-1]) + Vector((hr * 0.02, 0, -hr * 0.1)))
    elif kind == "gnome_cone":
        e0 = 0.45
        zs = cz0 + R * math.sin(e0)
        H = hr * 2.6
        pts, radii = [], []
        n = 18
        for i in range(n + 1):
            t = i / n
            z = zs + H * (t - 0.35 * t ** 3) - hr * 1.0 * max(0, t - 0.65) ** 2 * 3
            y = hr * 1.2 * t ** 2.4
            pts.append((0, y, z))
            radii.append(R * math.cos(e0) * (1 - t) ** 0.95 + hr * 0.02)
        hp.add(tube(pts, 0.01, 18, radii=radii), hm)
        hp.add(torus(R * math.cos(e0) * 0.995, hr * 0.07), am, loc=(0, 0, zs + hr * 0.03))
        hp.add(sphere(hr * 0.12, 8, 6), am, loc=pts[-1])
    elif kind == "helmet":
        e0 = 0.3
        hp.add(dome(R * 1.05, e0), hm, loc=(0, 0, cz0))
        hp.add(torus(R * 1.05 * math.cos(e0) * 0.99, hr * 0.08), am, loc=(0, 0, cz0 + R * 1.05 * math.sin(e0)))
        hp.add(sphere(hr * 0.14, 10, 8), am, loc=(0, 0, cz0 + R * 1.05 + hr * 0.04))
        for sgn in (-1, 1):
            pts = [(sgn * R * 0.97 * math.cos(e), -hr * 0.1, cz0 + R * 0.97 * math.sin(e)) for e in (0.3, 0.1, -0.2, -0.55, -0.85)]
            hp.add(tube(pts, hr * 0.035, 6), am)
    elif kind == "police":
        zb = cz0 + hr * 0.52
        hp.add(rcyl(hr * 1.02, hr * 0.6, hr * 0.06, 28), hm, loc=(0, 0, zb))
        hp.add(rcyl(hr * 1.12, hr * 0.15, hr * 0.07, 28, ), hm, loc=(0, 0, zb + hr * 0.58))
        hp.add(torus(hr * 1.02, hr * 0.045), M.body("#f5f5f5"), loc=(0, 0, zb + hr * 0.2))
        hp.add(sphere(hr * 0.78, 20, 10), hm, loc=(0, -hr * 0.62, zb + hr * 0.02), rot=Matrix.Rotation(0.18, 3, 'X'), scale=(1.05, 0.62, 0.07))
        badge_p = (0, -hr * 1.05, zb + hr * 0.38)
        hp.add(rcyl(hr * 0.22, hr * 0.06, hr * 0.02, 16), mt.metal("#e8c24a", 0.25), loc=badge_p, rot=Matrix.Rotation(math.pi / 2, 3, 'X') @ Matrix.Rotation(math.pi, 3, 'X'))
    elif kind == "top_hat":
        zb = cz0 + hr * 0.7
        hp.add(rcyl(hr * 0.62, hr * 1.15, hr * 0.05, 24), hm, loc=(0, 0, zb))
        hp.add(rcyl(hr * 1.02, hr * 0.1, hr * 0.04, 28), hm, loc=(0, 0, zb))
        hp.add(torus(hr * 0.625, hr * 0.06), am, loc=(0, 0, zb + hr * 0.22))
    elif kind == "beret":
        hp.add(sphere(hr * 1.1, 24, 12), hm, loc=(hr * 0.1, 0, cz0 + hr * 1.0), rot=Matrix.Rotation(-0.25, 3, 'Y'), scale=(1.1, 1.05, 0.38))
        hp.add(tube([(hr * 0.1, 0, cz0 + hr * 1.18), (hr * 0.1, 0, cz0 + hr * 1.38)], hr * 0.05, 6), hm)
    elif kind == "bonnet":
        e = (math.radians(-45), math.radians(225))
        hp.add(lathe([(R * 1.06 * math.cos(a), R * 1.06 * math.sin(a)) for a in [-0.15 + i * (math.pi / 2 + 0.15) / 9 for i in range(10)]][:-1] + [(0.0, R * 1.06)], 24, arc=e), hm, loc=(0, 0, cz0))
        for ang in (e[0], e[1]):
            pts = [(R * 1.06 * math.cos(el) * math.cos(ang), R * 1.06 * math.cos(el) * math.sin(ang), R * 1.06 * math.sin(el)) for el in [-0.15 + i * 0.12 for i in range(12)]]
            hp.add(tube([(p[0], p[1], p[2] + cz0) for p in pts], hr * 0.045, 6), am)
        for sgn in (-1, 1):
            hp.add(tube(bezier((sgn * R * 0.95, -hr * 0.2, cz0 - hr * 0.15), (sgn * R * 0.5, -hr * 0.9, cz0 - hr * 0.7), (sgn * 0.05 * hr, -hr * 1.0, cz0 - hr * 1.05), 8), hr * 0.025, 5), am)
        hp.add(sphere(hr * 0.14, 10, 8), am, loc=(sgn * 0 + 0, -hr * 1.0, cz0 - hr * 1.05), scale=(1.5, 0.6, 0.8))
    return hp


# --------------------------------------------------------------- limbs
def make_arm(b, pid, side, parent, loc, length, r, M, hand_r, sleeve, glove, tilt, mitten=True):
    sgn = 1 if side == "l" else -1
    arm = b.part(f"{pid}.arm_{side}", parent, loc)
    R = Matrix.Rotation(-sgn * tilt, 3, 'Y')
    down = Matrix.Rotation(math.pi, 3, 'X')
    arm.add(capsule(r, length - r, 14), sleeve, rot=R @ down)
    hand = R @ Vector((0, 0, -(length + hand_r * 0.35)))
    arm.add(sphere(hand_r, 14, 10), glove, loc=hand, rot=R, scale=(1.0, 0.9, 1.05))
    if mitten:
        arm.add(sphere(hand_r * 0.42, 8, 6), glove, loc=hand + R @ Vector((-sgn * hand_r * 0.85, -hand_r * 0.35, hand_r * 0.35)))
    arm.props["toykit_hand"] = [hand.x * b.k, hand.y * b.k, hand.z * b.k]
    return arm


def make_leg(b, pid, side, parent, loc, leg_len, r, M, col, shoe_col, shoe_h=0.045, shoe_len=1.9, shoe_mat=None):
    sgn = 1 if side == "l" else -1
    leg = b.part(f"{pid}.leg_{side}", parent, loc)
    L = leg_len - shoe_h * 1.0
    leg.add(capsule(r, L - r, 12), col, rot=Matrix.Rotation(math.pi, 3, 'X'))
    leg.add(sphere(1.0, 14, 10), shoe_mat or mt.paint(shoe_col, 0.25, 0.4), loc=(0, -r * 0.45, -leg_len + shoe_h), scale=(r * 1.3, r * shoe_len, shoe_h))
    return leg


# --------------------------------------------------------------- accessories
def make_accessories(b, spec, torso, head, hr, cz, M, tr, torso_h, head_loc_z):
    acc_list = spec.get("accessories") or []
    c = M.c
    acc = c["accent"]
    has_hat = spec.get("hat", "none") not in (None, "none", "")
    for a in acc_list:
        if a == "scarf":
            rr = tr(torso_h - 0.02) + 0.01
            torso.add(torus(rr, 0.05), M.body(acc), loc=(0, 0, torso_h - 0.03))
            pts = [(rr * 0.5, -rr * 0.9, torso_h - 0.04), (rr * 0.55, -rr * 1.05, torso_h - 0.1), (rr * 0.5, -rr * 1.08, torso_h - 0.22)]
            torso.add(tube(pts, 0.04, 8, radii=[0.04, 0.045, 0.04]), M.body(acc))
            torso.add(box(0.1, 0.03, 0.06, 0.01), M.body(mt.shade(acc, 0.85)), loc=(rr * 0.5, -rr * 1.1, torso_h - 0.25))
        elif a == "bow":
            if has_hat:
                p = Vector((0, -tr(torso_h) * 0.95, torso_h - 0.015))
                tgt = torso
            else:
                p = Vector((hr * 0.62, -hr * 0.3, cz + hr * 0.82))
                tgt = head
            for sgn in (-1, 1):
                tgt.add(sphere(0.05 if tgt is torso else hr * 0.2, 10, 8), M.body(acc), loc=p + Vector((sgn * (0.055 if tgt is torso else hr * 0.2), 0, 0)), scale=(1.2, 0.5, 0.9))
            tgt.add(sphere(0.03 if tgt is torso else hr * 0.1, 8, 6), M.body(mt.shade(acc, 0.8)), loc=p)
        elif a == "apron":
            col = acc if spec.get("body") != "gnome" else mt.mix_hex(c["hat"], "#ffffff", 0.45)
            z0, z1 = 0.0, torso_h * 0.78
            prof = [(tr(z0 + (z1 - z0) * i / 6) + 0.007, z0 + (z1 - z0) * i / 6) for i in range(7)]
            torso.add(lathe(prof, 16, arc=(math.radians(-90 - 52), math.radians(-90 + 52))), M.body(col))
            pr = [(tr(0.03 + 0.07 * i / 3) + 0.014, 0.03 + 0.07 * i / 3) for i in range(4)]
            torso.add(lathe([(tr(0.03 + 0.1 * i / 4) + 0.014, 0.03 + 0.1 * i / 4) for i in range(5)], 8, arc=(math.radians(-90 - 20), math.radians(-90 + 20))), M.body(mt.shade(col, 0.88)))
            neck_pts = [(-0.06, -tr(z1) - 0.01, z1), (-0.03, -tr(torso_h - 0.02) - 0.01, torso_h - 0.02), (0, -tr(torso_h) - 0.03, torso_h + 0.0),
                        (0.03, -tr(torso_h - 0.02) - 0.01, torso_h - 0.02), (0.06, -tr(z1) - 0.01, z1)]
            torso.add(tube(neck_pts, 0.012, 5), M.body(col))
        elif a == "glasses":
            fc = mt.paint("#2a2a30", 0.25, 0.3)
            for sgn in (-1, 1):
                d = sphere_dir(sgn * 0.40, 0.06)
                pc = Vector((0, 0, cz)) + d * hr * 1.02
                ring = [(pc.x + 0.062 * hr / 0.19 * math.cos(t), pc.y - 0.005, pc.z + 0.062 * hr / 0.19 * math.sin(t)) for t in [i * math.tau / 20 for i in range(20)]]
                head.add(tube(ring, hr * 0.022, 6, closed=True), fc)
                head.add(tube([(sgn * hr * 0.55, -hr * 0.82, cz + hr * 0.05), (sgn * hr * 0.98, -hr * 0.1, cz + hr * 0.05), (sgn * hr * 1.0, hr * 0.3, cz + hr * 0.05)], hr * 0.018, 5), fc)
                head.add(sphere(hr * 0.2, 12, 8), mt.glass("#d8f0ff"), loc=pc - Vector((0, 0.002, 0)), rot=facing(d), scale=(1, 1, 0.05))
            head.add(tube(bezier((-hr * 0.1, -hr * 0.99, cz + hr * 0.07), (0, -hr * 1.04, cz + hr * 0.12), (hr * 0.1, -hr * 0.99, cz + hr * 0.07), 5), hr * 0.02, 5), fc)
        elif a == "backpack":
            torso.add(box(0.2, 0.09, 0.2, 0.025), M.body(acc), loc=(0, tr(0.15) + 0.04, torso_h * 0.5))
            torso.add(box(0.14, 0.04, 0.09, 0.015), M.body(mt.shade(acc, 0.8)), loc=(0, tr(0.15) + 0.095, torso_h * 0.4))
            for sgn in (-1, 1):
                torso.add(tube([(sgn * 0.07, tr(0.25) * 0.4 + 0.1, torso_h * 0.75), (sgn * 0.09, -tr(0.22) * 0.3, torso_h * 0.88), (sgn * 0.075, -tr(0.1) * 0.5, torso_h * 0.3)], 0.012, 5), M.body(mt.shade(acc, 0.7)))
        elif a == "whistle":
            chain = [(-0.1, -tr(torso_h - 0.02) + 0.0, torso_h - 0.02), (-0.09, -tr(torso_h * 0.7) - 0.01, torso_h * 0.7), (0.0, -tr(torso_h * 0.6) - 0.012, torso_h * 0.55)]
            torso.add(tube(chain, 0.007, 5), mt.metal("#c8c8cc", 0.3))
            torso.add(rcyl(0.022, 0.07, 0.01, 12), mt.metal("#e5e5e8", 0.2), loc=(0.0, -tr(torso_h * 0.55) - 0.025, torso_h * 0.5), rot=Matrix.Rotation(math.pi / 2, 3, 'Y'))
        elif a == "key_back":
            yb = tr(torso_h * 0.5) + 0.02
            torso.add(rcyl(0.018, 0.08, 0.004, 10), mt.metal("#d9b04a", 0.3), loc=(0, yb - 0.02, torso_h * 0.5), rot=Matrix.Rotation(-math.pi / 2, 3, 'X'))
            for sgn in (-1, 1):
                torso.add(sphere(0.06, 14, 10), mt.metal("#d9b04a", 0.3), loc=(sgn * 0.065, yb + 0.07, torso_h * 0.5), scale=(1, 0.22, 1.1))
        elif a == "neckerchief":
            rr = tr(torso_h - 0.02) + 0.008
            torso.add(torus(rr, 0.03), M.body(acc), loc=(0, 0, torso_h - 0.035))
            tri = [(-rr * 0.9, torso_h - 0.04), (rr * 0.9, torso_h - 0.04), (0, torso_h - 0.2)]
            torso.add(prism_xz(tri, -rr * 1.02, -rr * 1.02 - 0.012), M.body(acc))


# --------------------------------------------------------------- humanoids
HUMANOID = {
    # leg_len, leg_r, torso_h, tr0, tr1, head_r, arm_len, arm_r, hand_r, tilt, shoe_h, shoe_len
    "peg": dict(leg_len=0.27, leg_r=0.062, torso_h=0.31, tr0=0.165, tr1=0.125, fillet=0.06, head_r=0.19, arm_len=0.21, arm_r=0.05, hand_r=0.056, tilt=0.18, shoe_h=0.045, shoe_len=1.9, head_cz_f=0.82),
    "teddy": dict(leg_len=0.22, leg_r=0.082, torso_h=0.31, tr0=0.185, tr1=0.15, fillet=0.09, head_r=0.215, arm_len=0.2, arm_r=0.058, hand_r=0.06, tilt=0.35, shoe_h=0.055, shoe_len=1.7, head_cz_f=0.8),
    "soldier": dict(leg_len=0.35, leg_r=0.058, torso_h=0.32, tr0=0.15, tr1=0.14, fillet=0.03, head_r=0.18, arm_len=0.25, arm_r=0.046, hand_r=0.052, tilt=0.07, shoe_h=0.06, shoe_len=1.9, head_cz_f=0.82),
    "gnome": dict(leg_len=0.13, leg_r=0.065, torso_h=0.33, tr0=0.225, tr1=0.15, fillet=0.1, head_r=0.18, arm_len=0.18, arm_r=0.055, hand_r=0.055, tilt=0.3, shoe_h=0.06, shoe_len=1.8, head_cz_f=0.8),
}


def build_humanoid(b, root, spec, M):
    pid = spec["id"]
    body = spec["body"]
    H = HUMANOID[body]
    c = M.c
    hip_z = H["leg_len"]
    torso_h = H["torso_h"]
    tr0, tr1 = H["tr0"], H["tr1"]
    hr = H["head_r"]

    def tr(z):
        return tr0 + (tr1 - tr0) * max(0.0, min(1.0, z / torso_h))

    hips = b.part(f"{pid}.hips", root, (0, 0, hip_z))
    hips.add(rcyl(tr0 * 0.97, 0.09, 0.035, 24), M.body(c["legs"]), loc=(0, 0, -0.07))
    torso = b.part(f"{pid}.torso", hips, (0, 0, 0.02))
    torso.add(lathe(rounded_profile(tr0, tr1, torso_h + 0.04, H["fillet"], H["fillet"] * 1.1, 5), 28), M.body(c["torso"]), loc=(0, 0, -0.04))
    fur = body == "teddy"
    shoe_col = c["skin"] if fur else "#2a1c16"
    shoe_mat = M.skin() if fur else None
    if body == "soldier":
        shoe_col = "#15151a"
        torso.add(torus(tr(0.06) + 0.006, 0.016), mt.paint("#151515", 0.3, 0.3), loc=(0, 0, 0.06))
        torso.add(box(0.045, 0.02, 0.035, 0.005), mt.metal("#e2bd4a", 0.25), loc=(0, -tr(0.06) - 0.022, 0.06))
        for row in range(3):
            for sgn in (-1, 1):
                torso.add(sphere(0.017, 8, 6), mt.metal("#e8c24a", 0.22), loc=(sgn * 0.045, -tr(0.15 + row * 0.07) + 0.001 - 0.01, 0.15 + row * 0.07))
        for sgn in (-1, 1):
            torso.add(sphere(0.04, 10, 8), mt.metal("#e8c24a", 0.3), loc=(sgn * (tr(torso_h) + 0.02), 0, torso_h - 0.02), scale=(1.2, 1, 0.45))
    if body == "gnome":
        torso.add(torus(tr(0.1) + 0.004, 0.022), mt.paint("#2b1a14", 0.4, 0.2), loc=(0, 0, 0.1))
        torso.add(box(0.07, 0.02, 0.05, 0.006), mt.metal("#e2bd4a", 0.25), loc=(0, -tr(0.1) - 0.016, 0.1))
        for i in range(3):
            torso.add(sphere(0.02, 8, 6), mt.metal("#e8c24a", 0.25), loc=(0, -tr(0.17 + i * 0.07) - 0.002, 0.17 + i * 0.07))
    leg_x = {"peg": 0.085, "teddy": 0.105, "soldier": 0.075, "gnome": 0.1}[body]
    for side, sgn in (("l", 1), ("r", -1)):
        make_leg(b, pid, side, hips, (sgn * leg_x, 0, 0), H["leg_len"], H["leg_r"], M, M.body(c["legs"]), shoe_col, H["shoe_h"], H["shoe_len"], shoe_mat)
    # arms
    sleeve = M.body(c["torso"])
    glove = M.skin() if body != "soldier" else M.body("#f5f5f5")
    if body == "gnome":
        glove = M.skin()
    for side, sgn in (("l", 1), ("r", -1)):
        z = torso_h - H["arm_r"] * 1.7
        make_arm(b, pid, side, torso, (sgn * (tr(z) + H["arm_r"] * 0.35), 0, z), H["arm_len"], H["arm_r"], M, H["hand_r"], sleeve, glove, H["tilt"], mitten=(body != "teddy"))
    # head
    head_cz = hr * H["head_cz_f"]
    head = b.part(f"{pid}.head", torso, (0, 0, torso_h))
    head_mat = M.skin()
    head.add(sphere(hr, 32, 20), head_mat, loc=(0, 0, head_cz))
    head.add(rcyl(hr * 0.45, head_cz * 0.55, 0.01, 16), head_mat, loc=(0, 0, -0.03))
    if body == "gnome":
        # white beard, moustache
        bc = c["accent"] if c["accent"].lower() not in ("#ffd400",) else "#f4f1ea"
        bm = M.body(bc) if M.kind != "wood" else mt.felt(bc)
        beard_p = [(0.0, 0.0), (0.12, -0.02), (0.145, -0.11), (0.105, -0.26), (0.05, -0.38), (0.0, -0.43)]
        prof = [(0.0, -0.30), (0.04, -0.27), (0.09, -0.19), (0.125, -0.09), (0.12, -0.01), (0.0, 0.0)]
        head.add(lathe([(r * hr / 0.18, z * hr / 0.18) for r, z in prof], 20),
                 bm, loc=(0, -hr * 0.62, head_cz - hr * 0.34), rot=Matrix.Rotation(0.2, 3, 'X'), scale=(1.0, 0.85, 1.0))
        for sgn in (-1, 1):
            head.add(sphere(hr * 0.17, 12, 8), bm, loc=(sgn * hr * 0.2, -hr * 0.9, head_cz - hr * 0.3), scale=(1.2, 0.8, 0.7))
    make_face(head, spec, hr, head_cz, M, body)
    make_mouths(b, spec, head, hr, head_cz)
    hat = make_hat(b, spec, head, hr, head_cz, M)
    torso_ref = torso
    make_accessories(b, spec, torso, head, hr, head_cz, M, tr, torso_h, 0)
    return head_cz, hr


def build_cow(b, root, spec, M):
    pid = spec["id"]
    c = M.c
    bm = M.body(c["torso"])
    hips = b.part(f"{pid}.hips", root, (0, 0, 0.32))
    hips.add(sphere(0.2, 16, 10), bm, loc=(0, 0.28, 0.14), scale=(1, 1.1, 1))
    torso = b.part(f"{pid}.torso", hips, (0, 0, 0.02))
    barrel = lathe(rounded_profile(0.205, 0.205, 0.78, 0.12, 0.14, 6), 28)
    torso.add(barrel, bm, loc=(0, 0.39, 0.15), rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
    # spots
    spot = M.body(c["accent"])
    for (x, y, z, s) in [(0.17, 0.12, 0.26, 0.1), (-0.15, 0.3, 0.26, 0.12), (0.2, 0.34, 0.12, 0.08), (-0.2, -0.05, 0.16, 0.09)]:
        n = Vector((x, 0, z - 0.15)).normalized()
        torso.add(sphere(s, 12, 8), spot, loc=(x * 1.02, y, 0.15 + (z - 0.15) * 1.02), rot=facing(n), scale=(1, 1, 0.3))
    torso.add(sphere(0.085, 12, 8), M.body("#f6a8b2"), loc=(0, 0.38, -0.04), scale=(1, 1.3, 0.7))
    torso.add(tube(bezier((0, 0.75, 0.25), (0, 0.9, 0.2), (0.02, 0.95, 0.0), 8), 0.018, 6), bm)
    torso.add(sphere(0.045, 10, 8), spot, loc=(0.02, 0.95, -0.03), scale=(0.8, 0.8, 1.4))
    hr = 0.185
    cz = hr * 0.8
    head = b.part(f"{pid}.head", torso, (0, -0.4, 0.3))
    head.add(sphere(hr, 28, 18), M.skin(c["skin"]), loc=(0, 0, cz))
    make_face(head, spec, hr, cz, M, "cow")
    make_mouths(b, spec, head, hr, cz)
    make_hat(b, spec, head, hr, cz, M)
    for sgn in (-1, 1):
        hp = b.part(f"{pid}.leg_{'l' if sgn > 0 else 'r'}", hips, (sgn * 0.13, 0, 0))
        for y in (-0.25, 0.28):
            hp.add(capsule(0.066, 0.17, 12), M.body(c["legs"]), loc=(0, y, 0.0), rot=Matrix.Rotation(math.pi, 3, 'X'))
            hp.add(rcyl(0.074, 0.07, 0.02, 12), mt.paint("#3b2a22", 0.4, 0.2), loc=(0, y, -0.32))
    for side in ("l", "r"):
        a = b.empty(f"{pid}.arm_{side}", torso, (0.18 if side == "l" else -0.18, -0.3, 0.2))
    make_accessories(b, spec, torso, head, hr, cz, M, lambda z: 0.2, 0.3, 0)
    return cz, hr


def build_jack(b, root, spec, M):
    pid = spec["id"]
    c = M.c
    hips = b.part(f"{pid}.hips", root, (0, 0, 0.04))
    hips.add(box(0.46, 0.46, 0.05, 0.012), M.body(mt.shade(c["torso"], 0.6)), loc=(0, 0, -0.025))
    torso = b.part(f"{pid}.torso", hips, (0, 0, 0.02))
    bh = 0.4
    tm = M.body(c["torso"])
    torso.add(box(0.42, 0.42, bh, 0.025), tm, loc=(0, 0, bh / 2))
    torso.add(box(0.46, 0.46, 0.05, 0.015), M.body(c["accent"]), loc=(0, 0, bh + 0.0))
    torso.add(box(0.46, 0.46, 0.05, 0.015), M.body(c["accent"]), loc=(0, 0, 0.03))
    for i, z in enumerate((0.13, 0.27)):
        torso.add(box(0.435, 0.435, 0.03, 0.006), M.body(c["accent"]), loc=(0, 0, z))
    for sx in (-1, 1):
        torso.add(box(0.03, 0.2, 0.03, 0.008), M.body("#f5f5f5"), loc=(sx * 0.212, 0, 0.2))
    torso.add(tube([(0.24, 0, 0.2), (0.3, 0, 0.2), (0.34, 0, 0.26)], 0.012, 6), mt.metal("#d9b04a"))
    torso.add(sphere(0.035, 10, 8), M.body("#e23b3b"), loc=(0.34, 0, 0.28))
    hr = 0.19
    spring = 0.22
    cz = spring + hr * 0.95
    head = b.part(f"{pid}.head", torso, (0, 0, bh + 0.02))
    head.add(helix(0.07, spring + 0.03, 6, 12, 0.014), mt.metal("#c8ccd2", 0.3), loc=(0, 0, -0.02))
    head.add(sphere(hr, 30, 18), M.skin(), loc=(0, 0, cz))
    make_face(head, spec, hr, cz, M, "jack_box")
    make_mouths(b, spec, head, hr, cz)
    make_hat(b, spec, head, hr, cz, M)
    glove = M.body("#fafafa")
    for side, sgn in (("l", 1), ("r", -1)):
        make_arm(b, pid, side, torso, (sgn * 0.235, 0, bh - 0.06), 0.16, 0.045, M, 0.058, M.body(c["accent"]), glove, 0.75)
    for side, sgn in (("l", 1), ("r", -1)):
        b.empty(f"{pid}.leg_{side}", hips, (sgn * 0.1, 0, 0))
    make_accessories(b, spec, torso, head, hr, cz, M, lambda z: 0.21, bh, 0)
    return cz, hr


# --------------------------------------------------------------- vehicles
def _wheel(p, x, y, z, r, w, tyre, hub):
    sgn = 1 if x > 0 else -1
    p.add(rcyl(r, w, w * 0.4, 20), tyre, loc=(x - w / 2, y, z), rot=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    p.add(rcyl(r * 0.5, w * 0.35, 0.01, 14), hub, loc=(x + sgn * w * 0.3, y, z), rot=Matrix.Rotation(sgn * math.pi / 2, 3, 'Y'))


def build_vehicle(b, root, spec, M):
    v = spec.get("vehicle")
    if not v:
        return None
    pid = spec["id"]
    col, acc = v.get("color", "#ffd400"), v.get("accent", "#d33b2c")
    kind = v.get("kind", "van")
    veh = b.part(f"{pid}.vehicle", root, (0, 0, 0))
    body = mt.wood(col)
    ac = mt.wood(acc)
    tyre = mt.rubber()
    hub = mt.wood(acc)
    chrome = mt.metal("#e8e8ec", 0.2)
    headlight = mt.glow("#fff3b0", 3.0)
    glassm = mt.glass("#bfe3ff")
    if kind in ("van", "car"):
        veh.add(box(0.98, 1.6, 0.1, 0.03), mt.wood("#3b3b44"), loc=(0, 0, 0.16))
        veh.add(box(0.92, 1.56, 0.07, 0.02), body, loc=(0, 0, 0.2))
        for sx in (-1, 1):
            for sy in (-0.52, 0.52):
                _wheel(veh, sx * 0.5, sy, 0.15, 0.15, 0.1, tyre, hub)
            veh.add(box(0.07, 0.52, 0.22, 0.02), body, loc=(sx * 0.425, -0.02, 0.33))
            veh.add(box(0.075, 0.5, 0.04, 0.012), ac, loc=(sx * 0.427, -0.02, 0.4))
            veh.add(box(0.12, 0.38, 0.03, 0.01), ac, loc=(sx * 0.48, -0.55, 0.2), rot=None)
            veh.add(sphere(0.06, 12, 8), headlight, loc=(sx * 0.28, -0.82, 0.38), scale=(1, 0.6, 1))
        veh.add(box(0.9, 0.55, 0.26, 0.04), body, loc=(0, -0.55, 0.35))
        veh.add(box(0.5, 0.04, 0.17, 0.01), ac, loc=(0, -0.835, 0.36))
        for i in range(3):
            veh.add(box(0.42, 0.01, 0.015, 0.003), chrome, loc=(0, -0.858, 0.31 + i * 0.045))
        veh.add(box(0.96, 0.07, 0.07, 0.02), chrome, loc=(0, -0.85, 0.2))
        wf = mt.wood("#2b2b30")
        for sx in (-1, 1):
            veh.add(tube([(sx * 0.42, -0.28, 0.45), (sx * 0.42, -0.3, 0.68)], 0.018, 6), wf)
        veh.add(tube([(-0.42, -0.3, 0.68), (0.42, -0.3, 0.68)], 0.018, 6), wf)
        if kind == "van":
            veh.add(box(0.94, 0.62, 0.62, 0.05), body, loc=(0, 0.55, 0.55))
            veh.add(box(0.98, 0.66, 0.05, 0.02), ac, loc=(0, 0.55, 0.88))
            veh.add(box(0.97, 0.64, 0.09, 0.01), ac, loc=(0, 0.55, 0.4))
            veh.add(box(0.6, 0.02, 0.3, 0.01), mt.wood(mt.shade(col, 0.85)), loc=(0, 0.88, 0.6))
            veh.add(sphere(0.045, 8, 6), chrome, loc=(0.17, 0.9, 0.6))
            veh.add(sphere(0.04, 10, 8), mt.glow("#ff5040", 1.5), loc=(0.38, 0.87, 0.34))
            veh.add(sphere(0.04, 10, 8), mt.glow("#ff5040", 1.5), loc=(-0.38, 0.87, 0.34))
            veh.add(rcyl(0.05, 0.05, 0.015, 12), mt.wood("#d33b2c"), loc=(0, 0.55, 0.93))
            veh.add(sphere(0.035, 8, 6), mt.glow("#ffe9a0", 2.0), loc=(0, 0.55, 0.99))
        else:
            veh.add(box(0.9, 0.6, 0.28, 0.04), body, loc=(0, 0.55, 0.38))
            veh.add(box(0.82, 0.5, 0.05, 0.02), ac, loc=(0, 0.55, 0.54))
    elif kind == "bike":
        for y in (-0.55, 0.55):
            veh.add(torus(0.28, 0.03, 24, 6), tyre, loc=(0, y, 0.31), rot=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            veh.add(sphere(0.05, 8, 6), hub, loc=(0, y, 0.31))
            for ang in range(0, 360, 45):
                a = math.radians(ang)
                veh.add(tube([(0, y, 0.31), (0, y + 0.27 * math.cos(a), 0.31 + 0.27 * math.sin(a))], 0.005, 4), chrome)
        fr = mt.wood(col)
        veh.add(tube([(0, 0.55, 0.31), (0, 0.15, 0.55), (0, -0.4, 0.62), (0, -0.55, 0.31)], 0.028, 8), fr)
        veh.add(tube([(0, 0.15, 0.55), (0, 0.1, 0.35), (0, 0.0, 0.2)], 0.028, 8), fr)
        veh.add(tube([(0, -0.4, 0.62), (0, -0.48, 0.78)], 0.026, 8), fr)
        veh.add(tube([(-0.2, -0.48, 0.8), (0.2, -0.48, 0.8)], 0.02, 8), chrome)
        veh.add(box(0.12, 0.22, 0.05, 0.02), ac, loc=(0, 0.2, 0.6))
        veh.add(box(0.1, 0.3, 0.03, 0.01), ac, loc=(0, 0.0, 0.1), rot=None)
        veh.add(sphere(0.05, 10, 8), headlight, loc=(0, -0.55, 0.9))
    else:  # train
        sm = mt.wood(col)
        veh.add(box(0.8, 2.0, 0.1, 0.03), mt.wood("#2b2b30"), loc=(0, -0.1, 0.22))
        veh.add(rcyl(0.3, 1.1, 0.06, 24), sm, loc=(0, -0.65, 0.5), rot=Matrix.Rotation(-math.pi / 2, 3, 'X') @ Matrix.Identity(3))
        veh.add(rcyl(0.07, 0.3, 0.02, 14), mt.wood("#222228"), loc=(0, -1.0, 0.8))
        veh.add(rcyl(0.11, 0.05, 0.02, 14), ac, loc=(0, -1.0, 1.1))
        veh.add(sphere(0.08, 10, 8), headlight, loc=(0, -1.18, 0.5))
        for sx in (-1, 1):
            for y in (-0.8, -0.2, 0.5):
                _wheel(veh, sx * 0.42, y, 0.22, 0.2 if y > 0 else 0.14, 0.09, ac, mt.metal("#d0d0d6"))
            veh.add(box(0.06, 0.62, 0.34, 0.015), sm, loc=(sx * 0.37, 0.4, 0.46))
            veh.add(tube([(sx * 0.35, 0.05, 0.6), (sx * 0.35, 0.05, 1.12)], 0.02, 6), ac)
            veh.add(tube([(sx * 0.35, 0.85, 0.6), (sx * 0.35, 0.85, 1.12)], 0.02, 6), ac)
        veh.add(box(0.8, 0.9, 0.05, 0.02), ac, loc=(0, 0.45, 1.14))
        veh.add(box(0.75, 0.05, 0.4, 0.015), sm, loc=(0, 0.88, 0.45))
        veh.add(prism_xz([(-0.3, 0), (0.3, 0), (0.0, 0.3)], -1.35, -1.15), ac, loc=(0, 0, 0.2), rot=None)
    return veh


# --------------------------------------------------------------- entry
def build_puppet(spec, collection):
    """Create the puppet's objects in `collection`; returns the root object."""
    spec = dict(spec)
    body = spec.get("body", "peg")
    spec["body"] = body
    M = Mats(spec)
    k = float(spec.get("height", 1.0)) or 1.0
    b = Builder(k)
    root = b.empty(spec["id"])
    if body == "cow":
        build_cow(b, root, spec, M)
    elif body == "jack_box":
        build_jack(b, root, spec, M)
    else:
        build_humanoid(b, root, spec, M)
    build_vehicle(b, root, spec, M)
    objs = b.build(collection)
    r = b.parts[0].obj
    r.empty_display_type = 'ARROWS'
    r.empty_display_size = 0.3
    r["toykit_kind"] = "puppet"
    r["toykit_body"] = body
    r["toykit_height"] = k
    arm = bpy.data.objects.get(f"{spec['id']}.arm_r")
    if arm is not None and "toykit_hand" in arm:
        r["toykit_hand_r"] = list(arm["toykit_hand"])
    # mouths: only mouth_0 visible by default
    for i in (1, 2):
        o = bpy.data.objects.get(f"{spec['id']}.mouth_{i}")
        if o:
            o.hide_render = True
    return r, objs
