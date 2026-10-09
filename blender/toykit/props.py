"""Set-dressing prop kit + small held items. All props: origin on the ground, front/door faces local -Y,
unit scale (house ~2.2 wide, tree ~2 tall) scaled by the layout's `scale`."""
import math
import random

from mathutils import Matrix, Vector

from . import materials as mt
from .geo import (Builder, bezier, box, capsule, cone, dome, lathe, prism, prism_xz, rcyl, rounded_profile, sphere,
                  torus, tube)

RX90 = Matrix.Rotation(math.pi / 2, 3, 'X')
RY90 = Matrix.Rotation(math.pi / 2, 3, 'Y')

DEFAULTS = {
    "house": ("#e8b04a", "#c0392b"), "shop": ("#7fc8e8", "#e85d5d"), "station": ("#e9d5a1", "#2f6db5"),
    "tree_lollipop": ("#5db24a", "#ff7ab0"), "tree_pine": ("#2f8f4e", "#ffd400"), "bush": ("#4ea84a", "#e8436b"),
    "fence": ("#f6f1e6", "#c9a36a"), "road": ("#5b5b66", "#ffd400"), "lamp_post": ("#2c2c34", "#ffd27a"),
    "bench": ("#b8793c", "#3b3b44"), "pond": ("#4fb4e8", "#7ac24a"), "hill": ("#5db24a", "#ffd400"),
    "well": ("#b9a98f", "#c0392b"), "flower_patch": ("#ff6b9a", "#ffd400"), "mailbox": ("#d33b2c", "#ffd400"),
    "signpost": ("#c9955a", "#e8e0c8"), "bridge": ("#b8793c", "#8a5a34"), "cloud": ("#ffffff", "#e8f0ff"),
    "rock": ("#9a9a9e", "#6aa84f"), "gate": ("#f6f1e6", "#c9a36a"), "market_stall": ("#e85d5d", "#f6f1e6"),
    "clock_tower": ("#d98b5f", "#2f6db5"),
}


BIG = {"house": 1.35, "shop": 1.35, "station": 1.3, "clock_tower": 1.3, "well": 1.2}


def _roof(p, w, d, h0, rh, over, col, ovy=0.25):
    p.add(prism_xz([(-w / 2 - over, 0), (w / 2 + over, 0), (0, rh)], -d / 2 - ovy, d / 2 + ovy), mt.roof_tiles(col), loc=(0, 0, h0))
    p.add(tube([(0, -d / 2 - ovy, h0 + rh), (0, d / 2 + ovy, h0 + rh)], 0.04, 6), mt.wood(mt.shade(col, 0.7)))


def _window(p, x, z, w, h, y, frame, shutter=None, glow=False):
    p.add(box(w + 0.1, 0.06, h + 0.1, 0.015), mt.wood(frame), loc=(x, y, z))
    p.add(box(w, 0.04, h, 0.005), mt.glass("#a9dcff" if not glow else "#ffd98a", 1.5 if glow else 0.0), loc=(x, y - 0.02, z))
    p.add(box(0.025, 0.05, h, 0.004), mt.wood(frame), loc=(x, y - 0.03, z))
    p.add(box(w, 0.05, 0.025, 0.004), mt.wood(frame), loc=(x, y - 0.03, z))
    p.add(box(w + 0.16, 0.12, 0.04, 0.012), mt.wood(frame), loc=(x, y - 0.05, z - h / 2 - 0.07))
    if shutter:
        for s in (-1, 1):
            p.add(box(0.14, 0.04, h + 0.1, 0.01), mt.wood(shutter), loc=(x + s * (w / 2 + 0.17), y - 0.01, z))


def _door(p, x, y, w, h, col, knob=True):
    p.add(box(w + 0.12, 0.06, h + 0.06, 0.015), mt.wood("#fff3df"), loc=(x, y, (h + 0.06) / 2))
    p.add(box(w, 0.05, h - 0.1, 0.01), mt.wood(col), loc=(x, y - 0.015, (h - 0.1) / 2))
    p.add(rcyl(w / 2, 0.05, 0.01, 18), mt.wood(col), loc=(x, y - 0.015, h - 0.1), rot=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    if knob:
        p.add(sphere(0.03, 8, 6), mt.metal("#e2bd4a", 0.25), loc=(x + w * 0.32, y - 0.06, h * 0.45))


def build_house(p, col, acc, v, rnd):
    w, d, h = 2.2, 1.8, (1.3 if v % 2 == 0 else 1.65)
    p.add(box(w + 0.1, d + 0.1, 0.1, 0.02), mt.wood("#a9a49a"), loc=(0, 0, 0.05))
    p.add(box(w, d, h, 0.04), mt.wood(col), loc=(0, 0, h / 2 + 0.05))
    p.add(box(w + 0.02, d + 0.02, 0.06, 0.01), mt.wood(mt.shade(col, 0.8)), loc=(0, 0, h + 0.03))
    rh = 0.8
    _roof(p, w, d, h + 0.05, rh, 0.22, acc)
    yf = -d / 2 - 0.005
    _door(p, 0, yf, 0.46, 0.8, "#7a4a2a")
    p.add(box(0.6, 0.3, 0.06, 0.02), mt.wood("#a9a49a"), loc=(0, yf - 0.15, 0.08))
    for s in (-1, 1):
        _window(p, s * 0.72, 0.62 if v % 2 == 0 else 0.7, 0.34, 0.38, yf, "#fff3df", acc)
        p.add(box(0.46, 0.14, 0.1, 0.02), mt.wood("#6f4a2a"), loc=(s * 0.72, yf - 0.1, 0.45))
        for i in range(3):
            p.add(sphere(0.06, 8, 6), mt.felt(["#ff6b9a", "#ffd400", "#ff8a3d"][i]), loc=(s * 0.72 + (i - 1) * 0.13, yf - 0.1, 0.55))
    if v % 2 == 1:
        _window(p, 0, 1.3, 0.34, 0.34, yf, "#fff3df", acc)
    else:
        p.add(sphere(0.14, 12, 8), mt.wood("#fff3df"), loc=(0, yf - 0.01, h + 0.05 + rh * 0.42), rot=RX90, scale=(1, 0.2, 1))
        p.add(sphere(0.1, 12, 8), mt.glass("#a9dcff"), loc=(0, yf - 0.03, h + 0.05 + rh * 0.42), scale=(1, 0.2, 1))
    cx, cy = 0.6, 0.25
    ch_top = h + 0.05 + rh * (1 - cx / (w / 2 + 0.22)) + 0.35
    p.add(box(0.26, 0.26, ch_top - h * 0.7, 0.02), mt.brick("#b5543a"), loc=(cx, cy, (ch_top + h * 0.7) / 2))
    p.add(box(0.32, 0.32, 0.05, 0.015), mt.wood("#9a9a9e"), loc=(cx, cy, ch_top))


def build_shop(p, col, acc, v, rnd):
    w, d, h = 3.1, 2.0, 1.25
    p.add(box(w + 0.1, d + 0.1, 0.1, 0.02), mt.wood("#a9a49a"), loc=(0, 0, 0.05))
    p.add(box(w, d, h, 0.04), mt.wood(col), loc=(0, 0, h / 2 + 0.05))
    _roof(p, w, d, h + 0.05, 0.6, 0.2, mt.shade(acc, 0.8))
    yf = -d / 2 - 0.005
    # sign board
    p.add(box(1.7, 0.1, 0.32, 0.03), mt.wood("#fff3df"), loc=(0, yf - 0.05, h - 0.12))
    for i, c in enumerate(["#e85d5d", "#ffd400", "#4aa3e8", "#5db24a", "#ff8a3d"]):
        p.add(sphere(0.09, 10, 8), mt.paint(c, 0.25), loc=(-0.64 + i * 0.32, yf - 0.115, h - 0.12), scale=(1, 0.5, 1))
    # awning
    aw = mt.stripes(acc, "#fff7ea", 8.0, 'X')
    p.add(box(w - 0.1, 0.75, 0.05, 0.01), aw, loc=(0, yf - 0.36, h - 0.52), rot=(-0.38, 0, 0))
    for i in range(14):
        x = -(w - 0.1) / 2 + 0.11 + i * ((w - 0.1 - 0.22) / 13)
        p.add(sphere(0.115, 8, 6), mt.paint(acc if i % 2 == 0 else "#fff7ea", 0.6, 0.0), loc=(x, yf - 0.7, h - 0.69), scale=(1, 0.4, 0.6))
    for s in (-1, 1):
        p.add(tube([(s * (w / 2 - 0.12), yf - 0.62, 0.1), (s * (w / 2 - 0.12), yf - 0.62, h - 0.62)], 0.025, 6), mt.wood("#fff3df"))
    # big window with goods + door
    p.add(box(1.7, 0.07, 0.55, 0.02), mt.wood("#fff3df"), loc=(-0.55, yf, 0.55))
    p.add(box(1.58, 0.05, 0.43, 0.01), mt.glass("#a9dcff", 0.8), loc=(-0.55, yf - 0.02, 0.55))
    p.add(box(1.7, 0.2, 0.05, 0.01), mt.wood("#fff3df"), loc=(-0.55, yf - 0.08, 0.28))
    for i, (c, s) in enumerate([("#e85d5d", 0.1), ("#4aa3e8", 0.12), ("#ffd400", 0.09), ("#5db24a", 0.11)]):
        p.add(sphere(s, 10, 8), mt.paint(c, 0.25), loc=(-1.0 + i * 0.32, yf - 0.1, 0.33 + s * 0.9))
    p.add(box(0.2, 0.08, 0.16, 0.02), mt.wood("#c9955a"), loc=(-0.2, yf - 0.1, 0.38))
    _door(p, 0.95, yf, 0.55, 0.85, "#2f6db5")
    p.add(box(0.12, 0.02, 0.08, 0.005), mt.paint("#fff7ea", 0.4), loc=(0.95, yf - 0.06, 0.62))
    p.add(box(0.1, 0.08, 0.1, 0.01), mt.wood("#c9955a"), loc=(1.45, yf - 0.1, 0.1))
    for i in range(3):
        p.add(sphere(0.06, 8, 6), mt.felt(["#e85d5d", "#ffd400", "#4aa3e8"][i]), loc=(1.35 + i * 0.0, yf - 0.1 - 0.0, 0.0), scale=(0.01, 0.01, 0.01))


def build_station(p, col, acc, v, rnd):
    w, d, h = 3.6, 1.4, 1.0
    p.add(box(w, d, h, 0.04), mt.wood(col), loc=(0, 0, h / 2 + 0.05))
    _roof(p, w, d, h + 0.05, 0.55, 0.22, acc)
    yf = -d / 2 - 0.005
    p.add(box(0.9, 0.9, 1.9, 0.04), mt.wood(mt.shade(col, 1.04)), loc=(0, 0.1, 0.95 + 0.05))
    p.add(cone(0.78, 0.0, 0.7, 4), mt.roof_tiles(acc), loc=(0, 0.1, 1.95), rot=(0, 0, math.pi / 4))
    p.add(rcyl(0.33, 0.05, 0.015, 24), mt.paint("#fffaf0", 0.3), loc=(0, 0.1 - 0.455, 1.5), rot=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    for i in range(12):
        a = math.tau * i / 12
        p.add(box(0.025, 0.01, 0.06 if i % 3 else 0.08, 0.004), mt.paint("#222", 0.5), loc=(0.27 * math.sin(a), 0.1 - 0.462, 1.5 + 0.27 * math.cos(a)), rot=(0, -a, 0))
    p.add(box(0.025, 0.012, 0.2, 0.004), mt.paint("#222", 0.4), loc=(0, 0.1 - 0.468, 1.5 + 0.08))
    p.add(box(0.2, 0.012, 0.025, 0.004), mt.paint("#222", 0.4), loc=(0.07, 0.1 - 0.468, 1.5))
    p.add(sphere(0.06, 8, 6), mt.metal("#e2bd4a"), loc=(0, 0.1, 2.68))
    for s in (-1, 1):
        _window(p, s * 1.2, 0.55, 0.4, 0.4, yf, "#fff3df", acc)
        _window(p, s * 0.62, 0.55, 0.3, 0.4, yf, "#fff3df", None)
    p.add(box(0.5, 0.07, 0.75, 0.02), mt.wood("#7a4a2a"), loc=(0, yf - 0.0, 0.43))
    # platform + canopy + rails
    p.add(box(w + 1.0, 0.9, 0.14, 0.03), mt.wood("#b9b4aa"), loc=(0, -d / 2 - 0.55, 0.07))
    p.add(box(w + 1.0, 0.05, 0.14, 0.01), mt.paint("#ffd400", 0.5, 0.0), loc=(0, -d / 2 - 0.97, 0.075))
    for x in (-1.5, 1.5):
        p.add(tube([(x, -d / 2 - 0.85, 0.14), (x, -d / 2 - 0.85, 1.0)], 0.03, 6), mt.wood(acc))
    p.add(box(w - 0.3, 0.85, 0.05, 0.015), mt.stripes(acc, "#fff7ea", 8.0, 'X'), loc=(0, -d / 2 - 0.6, 1.02), rot=(-0.06, 0, 0))
    p.add(box(1.0, 0.08, 0.3, 0.02), mt.wood("#fff3df"), loc=(-1.0, -d / 2 - 0.12, 0.55), rot=None)
    ry = -d / 2 - 1.55
    for off in (-0.28, 0.28):
        p.add(box(w + 1.4, 0.04, 0.05, 0.01), mt.metal("#c8c8cc", 0.3), loc=(0, ry + off, 0.1))
    for i in range(17):
        p.add(box(0.08, 0.8, 0.05, 0.01), mt.wood("#7a4a2a"), loc=(-(w + 1.2) / 2 + i * ((w + 1.2) / 16), ry, 0.04))


def build_tree_lollipop(p, col, acc, v, rnd):
    p.add(rcyl(0.1, 1.0, 0.03, 14, r1=0.07), mt.wood("#8a5a34"), loc=(0, 0, 0))
    fm = mt.felt(col)
    p.add(sphere(0.72, 24, 14), fm, loc=(0, 0, 1.4))
    for i in range(9):
        a = math.tau * i / 9 + rnd.random() * 0.4
        e = rnd.uniform(-0.3, 0.9)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        p.add(sphere(0.32, 14, 10), fm, loc=Vector((0, 0, 1.4)) + d * 0.55)
    for i in range(6):
        a = math.tau * i / 6 + 0.5
        e = rnd.uniform(0.0, 0.7)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        p.add(sphere(0.07, 8, 6), mt.felt(acc), loc=Vector((0, 0, 1.4)) + d * 0.9)


def build_tree_pine(p, col, acc, v, rnd):
    p.add(rcyl(0.09, 0.5, 0.03, 12), mt.wood("#8a5a34"))
    fm = mt.felt(col)
    for i, (r, h, z) in enumerate([(0.8, 0.85, 0.35), (0.62, 0.75, 0.85), (0.45, 0.7, 1.35)]):
        p.add(lathe([(0.0, 0.0), (r, 0.0), (r * 0.96, 0.05), (r * 0.12, h), (0.0, h + 0.02)], 22), mt.felt(mt.shade(col, 1.0 + i * 0.08)), loc=(0, 0, z))
    p.add(sphere(0.09, 8, 6), mt.metal("#ffd400", 0.3), loc=(0, 0, 2.08), scale=(1, 1, 1.3))


def build_bush(p, col, acc, v, rnd):
    fm = mt.felt(col)
    for (x, y, z, r) in [(0, 0, 0.3, 0.38), (0.35, 0.05, 0.25, 0.3), (-0.35, 0.0, 0.25, 0.3), (0.1, 0.25, 0.28, 0.28), (-0.05, -0.25, 0.25, 0.28)]:
        p.add(sphere(r, 16, 10), fm, loc=(x, y, z))
    for i in range(5):
        a = math.tau * i / 5
        p.add(sphere(0.045, 8, 6), mt.paint(acc, 0.3), loc=(0.45 * math.cos(a), 0.4 * math.sin(a) - 0.1, 0.4 + 0.1 * math.sin(i)))


def build_fence(p, col, acc, v, rnd):
    wm = mt.wood(col)
    n = 7
    for i in range(n):
        x = -1.0 + i * (2.0 / (n - 1))
        p.add(box(0.14, 0.05, 0.5, 0.012), wm, loc=(x, 0, 0.27))
        p.add(prism_xz([(-0.07, 0), (0.07, 0), (0, 0.1)], -0.025, 0.025), wm, loc=(x, 0, 0.52))
    for z in (0.18, 0.4):
        p.add(box(2.2, 0.05, 0.07, 0.01), wm, loc=(0, 0.045, z))
    for x in (-1.1, 1.1):
        p.add(box(0.1, 0.1, 0.62, 0.015), wm, loc=(x, 0.03, 0.31))


def build_road(p, col, acc, v, rnd):
    rm = mt.felt(col)
    curb = mt.wood("#efe6d0")
    if v % 2 == 0:
        p.add(box(6.0, 1.4, 0.05, 0.015), rm, loc=(0, 0, 0.025))
        for s in (-1, 1):
            p.add(box(6.0, 0.08, 0.07, 0.02), curb, loc=(0, s * 0.72, 0.035))
        for i in range(6):
            p.add(box(0.4, 0.07, 0.054, 0.01), mt.paint(acc, 0.5, 0.0), loc=(-2.5 + i * 1.0, 0, 0.028))
    else:
        R = 3.0
        def arc(r0, r1, n=18):
            pts = [(r0 * math.cos(a), R + r0 * math.sin(a)) for a in [(-math.pi / 2) + (math.pi / 2) * i / n for i in range(n + 1)]]
            pts += [(r1 * math.cos(a), R + r1 * math.sin(a)) for a in [(-math.pi / 2) + (math.pi / 2) * i / n for i in reversed(range(n + 1))]]
            return pts
        p.add(prism(arc(R - 0.7, R + 0.7), 0, 0.05), rm)
        p.add(prism(arc(R - 0.78, R - 0.7), 0, 0.07), curb)
        p.add(prism(arc(R + 0.7, R + 0.78), 0, 0.07), curb)
        for i in range(5):
            a = (-math.pi / 2) + (math.pi / 2) * (i + 0.5) / 5
            p.add(box(0.35, 0.07, 0.054, 0.01), mt.paint(acc, 0.5, 0.0), loc=(R * math.cos(a), R + R * math.sin(a), 0.028), rot=(0, 0, a + math.pi / 2))


def build_lamp_post(p, col, acc, v, rnd):
    dm = mt.wood(col)
    p.add(rcyl(0.11, 0.14, 0.04, 14), dm)
    p.add(rcyl(0.04, 1.65, 0.015, 10), dm, loc=(0, 0, 0.1))
    p.add(rcyl(0.07, 0.06, 0.02, 12), dm, loc=(0, 0, 1.68))
    p.add(box(0.2, 0.2, 0.28, 0.03), mt.glow(acc, 3.0), loc=(0, 0, 1.9))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(tube([(sx * 0.1, sy * 0.1, 1.76), (sx * 0.1, sy * 0.1, 2.04)], 0.012, 5), dm)
    p.add(lathe([(0.0, 0.0), (0.17, 0.0), (0.02, 0.17), (0.0, 0.19)], 4), dm, loc=(0, 0, 2.03), rot=(0, 0, math.pi / 4))
    p.add(sphere(0.03, 6, 5), dm, loc=(0, 0, 2.22))
    p.b.lamps.append((0.0, 0.0, 1.9))


def build_bench(p, col, acc, v, rnd):
    wm = mt.wood(col)
    dm = mt.wood(acc)
    for y in (-0.18, 0.0, 0.18):
        p.add(box(1.4, 0.15, 0.06, 0.015), wm, loc=(0, y, 0.45))
    for z in (0.7, 0.88):
        p.add(box(1.4, 0.05, 0.14, 0.015), wm, loc=(0, 0.3, z), rot=(-0.12, 0, 0))
    for s in (-1, 1):
        p.add(box(0.07, 0.5, 0.06, 0.012), dm, loc=(s * 0.62, 0, 0.42))
        p.add(box(0.07, 0.06, 0.45, 0.012), dm, loc=(s * 0.62, -0.2, 0.22))
        p.add(box(0.07, 0.06, 0.45, 0.012), dm, loc=(s * 0.62, 0.2, 0.22))
        p.add(box(0.07, 0.06, 0.55, 0.012), dm, loc=(s * 0.62, 0.3, 0.7), rot=(-0.12, 0, 0))


def build_pond(p, col, acc, v, rnd):
    p.add(lathe([(2.45, 0.0), (2.25, 0.12), (2.0, 0.15), (1.8, 0.08), (1.6, 0.03)], 32), mt.felt("#6fbf5a"), scale=(1, 0.74, 1))
    p.add(rcyl(1.72, 0.05, 0.01, 40), mt.water(col), loc=(0, 0, 0.0), scale=(1, 0.74, 1))
    for i in range(14):
        a = math.tau * i / 14 + rnd.random() * 0.2
        r = 0.9 + rnd.random() * 0.25
        p.add(sphere(r * 0.22, 10, 8), mt.clay("#a6a6aa"), loc=(1.95 * math.cos(a), 1.95 * 0.74 * math.sin(a), 0.1), scale=(1.2, 1, 0.7))
    for (x, y, r) in [(-0.5, 0.1, 0.22), (0.4, -0.2, 0.18), (0.6, 0.25, 0.16), (-0.1, -0.35, 0.15)]:
        p.add(rcyl(r, 0.02, 0.006, 16), mt.felt(acc), loc=(x, y, 0.045))
    p.add(sphere(0.07, 8, 6), mt.felt("#ff8ab8"), loc=(-0.5, 0.1, 0.09), scale=(1, 1, 0.8))
    for (x, y) in [(1.6, 0.5), (1.75, 0.3), (-1.8, 0.6), (-1.6, 0.8)]:
        p.add(tube([(x, y, 0.1), (x + 0.05, y, 0.65)], 0.012, 5), mt.felt("#5a9a3a"))
        p.add(rcyl(0.035, 0.14, 0.015, 8), mt.felt("#7a4a2a"), loc=(x + 0.05, y, 0.55))


def build_hill(p, col, acc, v, rnd):
    R, h = 3.2, 1.5
    prof = []
    n = 14
    for i in range(n + 1):
        r = R * (1 - i / n)
        z = h * math.cos(math.pi / 2 * (r / R)) ** 1.6
        prof.append((max(r, 0.0), z))
    prof[-1] = (0.0, h)
    p.add(lathe(prof, 36), mt.felt(col), scale=(1, 0.8, 1))
    for i in range(10):
        a = rnd.random() * math.tau
        r = rnd.uniform(0.4, 2.8)
        x, y = r * math.cos(a), r * math.sin(a) * 0.8
        z = h * math.cos(math.pi / 2 * (r / R)) ** 1.6
        p.add(sphere(0.07, 8, 6), mt.felt(["#ffd400", "#ff7ab0", "#ffffff"][i % 3]), loc=(x, y, z + 0.03))
    # stitched path
    for i in range(10):
        r = R * (1 - (i + 0.5) / 11)
        z = h * math.cos(math.pi / 2 * (r / R)) ** 1.6
        p.add(box(0.5 - 0.02 * i, 0.12, 0.03, 0.01), mt.felt("#e3c58a"), loc=(math.sin(i * 0.5) * 0.3 * (1 - r / R), -r * 0.8, z + 0.01), rot=(0.7 * (r / R) * 0, 0, 0.0))


def build_well(p, col, acc, v, rnd):
    stone = mt.ground("cobble", col)
    p.add(lathe([(0.0, 0.0), (0.62, 0.0), (0.62, 0.5), (0.5, 0.56), (0.0, 0.5)], 22), stone)
    p.add(rcyl(0.46, 0.02, 0.0, 22), mt.water("#2a6a9a"), loc=(0, 0, 0.51))
    wm = mt.wood("#8a5a34")
    for s in (-1, 1):
        p.add(box(0.07, 0.07, 1.0, 0.012), wm, loc=(s * 0.52, 0, 0.98))
    p.add(box(1.2, 0.05, 0.05, 0.01), wm, loc=(0, 0, 0.85), rot=None)
    p.add(prism_xz([(-0.75, 0), (0.75, 0), (0, 0.42)], -0.5, 0.5), mt.roof_tiles(acc), loc=(0, 0, 1.45))
    p.add(rcyl(0.04, 1.0, 0.01, 8), wm, loc=(0, 0.0, 0.85), rot=RY90)
    p.add(rcyl(0.1, 0.12, 0.03, 12), mt.wood("#b8793c"), loc=(0.2, 0, 0.58))
    p.add(tube([(0.2, 0, 0.7), (0.0, 0, 0.9)], 0.01, 4), mt.paint("#444", 0.6))


def build_flower_patch(p, col, acc, v, rnd):
    palette = [col, mt.mix_hex(col, "#ffffff", 0.5), "#ffd400", "#ff7ab0", "#7ab8ff", "#ffffff"]
    for i in range(12):
        x, y = rnd.uniform(-0.6, 0.6), rnd.uniform(-0.45, 0.45)
        hgt = rnd.uniform(0.18, 0.34)
        pc = palette[i % len(palette)]
        p.add(tube([(x, y, 0), (x + rnd.uniform(-0.03, 0.03), y, hgt)], 0.012, 5), mt.felt("#4a9a3a"))
        for j in range(5):
            a = math.tau * j / 5
            p.add(sphere(0.055, 8, 6), mt.felt(pc), loc=(x + 0.06 * math.cos(a), y + 0.06 * math.sin(a), hgt), scale=(1, 1, 0.5))
        p.add(sphere(0.045, 8, 6), mt.paint(acc, 0.4, 0.0), loc=(x, y, hgt + 0.02))
        p.add(sphere(0.07, 8, 6), mt.felt("#4a9a3a"), loc=(x + 0.09, y + 0.03, 0.04), scale=(1.6, 0.6, 0.5))


def build_mailbox(p, col, acc, v, rnd):
    p.add(rcyl(0.04, 0.85, 0.01, 8), mt.wood("#8a5a34"))
    mm = mt.wood(col)
    p.add(box(0.28, 0.5, 0.2, 0.03), mm, loc=(0, 0, 0.95))
    p.add(rcyl(0.14, 0.5, 0.03, 16), mm, loc=(0, 0.25, 1.05), rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
    p.add(box(0.2, 0.02, 0.15, 0.005), mt.paint("#222", 0.5), loc=(0, -0.26, 0.98))
    p.add(box(0.03, 0.03, 0.2, 0.008), mt.wood(acc), loc=(0.16, 0.1, 1.08))
    p.add(box(0.03, 0.12, 0.08, 0.008), mt.wood(acc), loc=(0.16, 0.05, 1.2))


def build_signpost(p, col, acc, v, rnd):
    wm = mt.wood("#8a5a34")
    p.add(rcyl(0.05, 1.5, 0.015, 10), wm)
    p.add(sphere(0.07, 8, 6), wm, loc=(0, 0, 1.52))
    for i, (z, ang, c) in enumerate([(1.28, 0.15, col), (1.02, -0.2, mt.mix_hex(col, "#e85d5d", 0.5))]):
        sgn = 1 if i == 0 else -1
        pts = [(-0.45 * sgn, -0.11), (0.3 * sgn, -0.11), (0.52 * sgn, 0), (0.3 * sgn, 0.11), (-0.45 * sgn, 0.11)]
        p.add(prism_xz(pts if sgn > 0 else pts[::-1], -0.025, 0.025), mt.wood(c), loc=(0, -0.06, z), rot=(0, 0, ang))
        p.add(box(0.28, 0.01, 0.025, 0.003), mt.paint(acc, 0.5), loc=(0.05 * sgn, -0.09, z), rot=(0, 0, ang))


def build_bridge(p, col, acc, v, rnd):
    wm = mt.wood(col)
    dm = mt.wood(acc)
    L, rise = 3.2, 0.5
    def zf(x):
        return rise * (1 - (x / (L / 2)) ** 2) + 0.1
    n = 11
    for i in range(n):
        x = -L / 2 + 0.15 + i * ((L - 0.3) / (n - 1))
        slope = -rise * 2 * x / ((L / 2) ** 2)
        p.add(box(0.3, 1.1, 0.07, 0.015), wm, loc=(x, 0, zf(x)), rot=(0, math.atan(-slope), 0))
    for s in (-1, 1):
        pts = [(x, s * 0.56, zf(x) + 0.33) for x in [-L / 2 + 0.1 + i * ((L - 0.2) / 12) for i in range(13)]]
        p.add(tube(pts, 0.03, 6), dm)
        for i in range(0, 13, 2):
            x = pts[i][0]
            p.add(tube([(x, s * 0.56, zf(x)), (x, s * 0.56, zf(x) + 0.33)], 0.025, 6), dm)
    for s in (-1, 1):
        p.add(tube([(x, s * 0.45, zf(x) - 0.06) for x in [-L / 2 + 0.1 + i * ((L - 0.2) / 12) for i in range(13)]], 0.035, 6), dm)


def build_cloud(p, col, acc, v, rnd):
    z0 = 3.6 + 0.4 * (v % 3)
    cm = mt.felt(col)
    for (x, y, z, r) in [(0, 0, 0, 0.55), (0.6, 0.05, -0.05, 0.42), (-0.6, -0.03, -0.05, 0.45), (0.25, 0.1, 0.28, 0.38), (-0.3, 0.0, 0.25, 0.36), (1.0, 0.0, -0.12, 0.28), (-1.0, 0.0, -0.12, 0.28)]:
        p.add(sphere(r, 16, 10), cm, loc=(x, y, z0 + z), scale=(1.05, 0.8, 0.85))


def build_rock(p, col, acc, v, rnd):
    rm = mt.clay(col)
    for (x, y, z, r, sx, sy, sz) in [(0, 0, 0.22, 0.38, 1.2, 1.0, 0.8), (0.4, 0.1, 0.14, 0.24, 1.0, 1.1, 0.8), (-0.35, -0.1, 0.12, 0.2, 1.1, 1.0, 0.75)]:
        p.add(sphere(r, 14, 10), rm, loc=(x, y, z), rot=(0, 0, rnd.random() * 3), scale=(sx, sy, sz))
    p.add(sphere(0.22, 12, 8), mt.felt(acc), loc=(0.0, 0.0, 0.42), scale=(1.1, 1.0, 0.35))


def build_gate(p, col, acc, v, rnd):
    wm = mt.wood(col)
    for s in (-1, 1):
        p.add(box(0.14, 0.14, 1.0, 0.02), wm, loc=(s * 0.8, 0, 0.5))
        p.add(sphere(0.1, 10, 8), mt.wood(acc), loc=(s * 0.8, 0, 1.05))
    for s in (-1, 1):
        x0 = s * 0.08
        for i in range(4):
            x = s * (0.14 + i * 0.145)
            p.add(box(0.09, 0.04, 0.6 + (0.05 if i % 2 else 0), 0.01), wm, loc=(x, -0.02, 0.4))
        for z in (0.25, 0.55):
            p.add(box(0.7, 0.04, 0.06, 0.01), wm, loc=(s * 0.4, 0.02, z))
    p.add(tube(bezier((-0.8, 0, 1.0), (0, 0, 1.55), (0.8, 0, 1.0), 14), 0.035, 6), mt.wood(acc))


def build_market_stall(p, col, acc, v, rnd):
    wm = mt.wood("#b8793c")
    for sx in (-1, 1):
        p.add(rcyl(0.04, 1.35, 0.01, 8), wm, loc=(sx * 0.95, -0.5, 0))
        p.add(rcyl(0.04, 1.6, 0.01, 8), wm, loc=(sx * 0.95, 0.5, 0))
    p.add(box(2.0, 0.6, 0.55, 0.03), wm, loc=(0, -0.35, 0.28))
    p.add(box(2.06, 0.66, 0.05, 0.015), mt.stripes(col, acc, 6.0, 'X'), loc=(0, -0.35, 0.57))
    p.add(box(2.4, 1.5, 0.05, 0.015), mt.stripes(col, acc, 12.0, 'X'), loc=(0, 0.0, 1.5), rot=(0.27, 0, 0))
    for i in range(12):
        x = -1.1 + i * 0.2
        p.add(sphere(0.1, 8, 6), mt.paint(col if i % 2 == 0 else acc, 0.6, 0.0), loc=(x, -0.74, 1.33), scale=(1, 0.4, 0.7))
    cols = ["#e63b2e", "#ff9a2a", "#ffd23a", "#7ac24a"]
    for i in range(10):
        x = -0.75 + (i % 5) * 0.3 + rnd.uniform(-0.03, 0.03)
        y = -0.35 + (0.1 if i < 5 else -0.12)
        p.add(sphere(0.085, 10, 8), mt.paint(cols[(i // 2) % 4], 0.3), loc=(x, y, 0.69))
    p.add(box(0.4, 0.3, 0.2, 0.02), wm, loc=(0.0, 0.3, 0.1))


def build_clock_tower(p, col, acc, v, rnd):
    bm = mt.brick(col)
    p.add(box(1.2, 1.2, 2.6, 0.04), bm, loc=(0, 0, 1.3))
    p.add(box(1.34, 1.34, 0.12, 0.03), mt.wood("#fff3df"), loc=(0, 0, 2.62))
    p.add(box(1.1, 1.1, 0.95, 0.04), mt.wood("#fff3df"), loc=(0, 0, 3.15))
    for y in (-1, 1):
        p.add(rcyl(0.4, 0.05, 0.015, 28), mt.paint("#fffaf0", 0.3), loc=(0, y * 0.56, 3.15), rot=Matrix.Rotation(-y * math.pi / 2, 3, 'X'))
        for i in range(12):
            a = math.tau * i / 12
            p.add(box(0.03, 0.012, 0.07 if i % 3 == 0 else 0.04, 0.003), mt.paint("#222", 0.5), loc=(0.32 * math.sin(a), y * 0.585, 3.15 + 0.32 * math.cos(a)), rot=(0, -a, 0))
        p.add(box(0.035, 0.014, 0.28, 0.004), mt.paint("#222", 0.4), loc=(0, y * 0.595, 3.15 + 0.11), rot=(0, 0.4, 0))
        p.add(box(0.03, 0.014, 0.2, 0.004), mt.paint("#222", 0.4), loc=(0.07, y * 0.595, 3.15 - 0.03), rot=(0, 2.0, 0))
    p.add(box(1.3, 1.3, 0.1, 0.03), mt.wood(acc), loc=(0, 0, 3.67))
    p.add(lathe([(0.0, 0.0), (0.98, 0.0), (0.0, 1.1)], 4), mt.roof_tiles(acc), loc=(0, 0, 3.72), rot=(0, 0, math.pi / 4))
    p.add(sphere(0.07, 8, 6), mt.metal("#e2bd4a"), loc=(0, 0, 4.85))
    p.add(box(0.32, 0.06, 0.55, 0.02), mt.wood("#7a4a2a"), loc=(0, -0.61, 0.28))
    for z in (1.1, 1.8):
        p.add(box(0.2, 0.04, 0.3, 0.01), mt.glass("#a9dcff"), loc=(0, -0.61, z))


BUILDERS = {
    "house": build_house, "shop": build_shop, "station": build_station, "tree_lollipop": build_tree_lollipop,
    "tree_pine": build_tree_pine, "bush": build_bush, "fence": build_fence, "road": build_road, "lamp_post": build_lamp_post,
    "bench": build_bench, "pond": build_pond, "hill": build_hill, "well": build_well, "flower_patch": build_flower_patch,
    "mailbox": build_mailbox, "signpost": build_signpost, "bridge": build_bridge, "cloud": build_cloud, "rock": build_rock,
    "gate": build_gate, "market_stall": build_market_stall, "clock_tower": build_clock_tower,
}


def build_prop(prop, name, collection, lamps_out):
    """Build one prop object (origin on the ground at its pos). Returns the object."""
    import bpy
    kind = prop["kind"]
    if kind not in BUILDERS:
        raise ValueError("unknown prop kind %r" % kind)
    dcol, dacc = DEFAULTS[kind]
    col = prop.get("color") or dcol
    acc = prop.get("accent") or dacc
    scale = float(prop.get("scale", 1.0) or 1.0) * BIG.get(kind, 1.0)
    variant = int(prop.get("variant", 0) or 0)
    pos = prop.get("pos", [0, 0])
    b = Builder(scale)
    part = b.part(name, None, (0, 0, 0))
    part.b = b
    rnd = random.Random(hash((kind, variant, name)) & 0xFFFF)
    BUILDERS[kind](part, col, acc, variant, rnd)
    objs = b.build(collection)
    obj = objs[0]
    obj.location = (pos[0], pos[1], 0.0)
    obj.rotation_euler = (0, 0, math.radians(float(prop.get("rot", 0.0) or 0.0)))
    obj["toykit_kind"] = kind
    if prop.get("id"):
        obj["toykit_id"] = prop["id"]
    for (lx, ly, lz) in b.lamps:
        lamps_out.append((obj, Vector((lx * scale, ly * scale, lz * scale)), scale))
    return obj


# ---------------------------------------------------------------- held items
def build_held(kind, arm, hand, k, collection):
    """Small item in the puppet's right hand. Returns a list of objects (hidden unless used)."""
    b = Builder(k)
    p = b.part("held." + kind, None, (hand.x / k, hand.y / k, hand.z / k))
    if kind == "cap":
        p.add(dome(0.1, 0.1, 18), mt.felt("#d22222"), loc=(0, 0, 0.02))
        p.add(sphere(0.035, 8, 6), mt.felt("#ffd400"), loc=(0, 0, 0.12))
    elif kind == "ball":
        p.add(sphere(0.1, 16, 12), mt.paint("#e63b2e", 0.3), loc=(0, -0.05, 0.05))
        p.add(torus(0.1, 0.012, 20, 6), mt.paint("#fff", 0.3), loc=(0, -0.05, 0.05))
    elif kind == "letter":
        p.add(box(0.16, 0.02, 0.11, 0.004), mt.paint("#fff8e8", 0.6, 0.0), loc=(0, -0.06, 0.04))
        p.add(sphere(0.022, 8, 6), mt.paint("#d22", 0.3), loc=(0, -0.075, 0.04), scale=(1, 0.4, 1))
    elif kind == "flower":
        p.add(tube([(0, 0, -0.04), (0, 0, 0.2)], 0.008, 5), mt.felt("#4a9a3a"))
        for j in range(6):
            a = math.tau * j / 6
            p.add(sphere(0.04, 8, 6), mt.felt("#ff6b9a"), loc=(0.05 * math.cos(a), 0.05 * math.sin(a), 0.22), scale=(1, 1, 0.5))
        p.add(sphere(0.035, 8, 6), mt.paint("#ffd400", 0.4, 0.0), loc=(0, 0, 0.23))
    elif kind == "cake":
        p.add(rcyl(0.13, 0.06, 0.012, 18), mt.paint("#f4b6c8", 0.5, 0.0), loc=(0, -0.05, 0.0))
        p.add(rcyl(0.1, 0.06, 0.012, 18), mt.paint("#fff0f4", 0.5, 0.0), loc=(0, -0.05, 0.06))
        p.add(rcyl(0.01, 0.07, 0.003, 6), mt.paint("#4aa3e8", 0.4), loc=(0, -0.05, 0.12))
        p.add(sphere(0.014, 6, 5), mt.glow("#ffd24a", 4.0), loc=(0, -0.05, 0.2))
    elif kind == "key":
        p.add(tube([(0, 0, -0.02), (0, 0, 0.2)], 0.01, 6), mt.metal("#e2bd4a", 0.25))
        p.add(torus(0.045, 0.01, 16, 6), mt.metal("#e2bd4a", 0.25), loc=(0, 0, 0.25), rot=RX90)
        p.add(box(0.06, 0.012, 0.02, 0.003), mt.metal("#e2bd4a", 0.25), loc=(0.03, 0, 0.0))
    elif kind == "umbrella":
        p.add(tube([(0, 0, -0.05), (0, 0, 0.45)], 0.008, 6), mt.metal("#333", 0.4))
        p.add(dome(0.38, 0.25, 20), mt.soft("#e63b2e", 0.5), loc=(0, 0, 0.3))
    elif kind == "balloon":
        p.add(tube([(0, 0, 0.02), (0.02, 0, 0.4)], 0.003, 4), mt.paint("#eee", 0.8, 0.0))
        p.add(sphere(0.16, 16, 12), mt.paint("#e63b2e", 0.12, 0.8), loc=(0.02, 0, 0.55), scale=(1, 1, 1.2))
    else:
        return []
    objs = b.build(collection)
    for o in objs:
        o.parent = arm
        o.hide_render = True
    return objs
