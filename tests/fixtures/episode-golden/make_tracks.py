"""Generates the golden fixture episode (cast.json, sets.json, tracks/shot-0N.json).

Plain python, no dependencies:   python tests/fixtures/episode-golden/make_tracks.py
Everything is deterministic (seeded), so re-running reproduces the committed JSON exactly.

Conventions (docs/contracts.md): Z-up, degrees, puppets face -Y at rest, rot Z +90 faces +X,
arm hangs down -Z (rot Y -150 on arm_l swings it up and out to +X), 12 fps, every array has `frames` entries.
Child `loc` channels are offsets added to the built position.
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "blender", "tests"))
import seedload  # noqa: E402

FPS = 12


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


class Shot:
    def __init__(self, shot_id, frames, seed, cast, set_id):
        self.id, self.frames, self.seed, self.cast, self.set_id = shot_id, frames, seed, cast, set_id
        self.rng = random.Random(seed)
        self.objects = {}
        self.mouths = {}
        self.props = {}
        self.events = []
        self.camera = None

    def chan(self, name, kind):
        o = self.objects.setdefault(name, {})
        if kind not in o:
            o[kind] = [[0.0, 0.0, 0.0] for _ in range(self.frames)]
        return o[kind]

    def set(self, name, kind, f, vec):
        self.chan(name, kind)[f] = [round(float(v), 4) for v in vec]

    def jitter(self, name, f, pos=0.003, rot=0.3):
        """Hand-placement wobble on a root object (baked, held per frame)."""
        loc = self.chan(name, "loc")[f]
        rt = self.chan(name, "rot")[f]
        r = self.rng
        self.set(name, "loc", f, [loc[0] + r.uniform(-pos, pos), loc[1] + r.uniform(-pos, pos), loc[2]])
        self.set(name, "rot", f, [rt[0], rt[1], rt[2] + r.uniform(-rot, rot)])

    def static_camera(self, loc, target, lens):
        self.camera = {"loc": [list(loc)] * self.frames, "target": [list(target)] * self.frames, "lens": [lens] * self.frames}

    def doc(self):
        return {"shotId": self.id, "setId": self.set_id, "fps": FPS, "frames": self.frames, "seed": self.seed,
                "cast": self.cast, "camera": self.camera, "objects": self.objects, "mouths": self.mouths,
                "props": self.props, "events": self.events}


def talk_levels(frames, start, end, rng):
    """Mouth cycle 0 closed / 1 mid / 2 open, like a voice envelope."""
    out = [0] * frames
    f = start
    while f < end:
        run = rng.choice([1, 1, 2])
        lvl = rng.choice([1, 2, 2, 1, 0])
        for k in range(run):
            if f + k < end:
                out[f + k] = lvl
        f += run
    if end < frames:
        out[end] = 0
    return out


def rest_pose(s, pid, frames=None):
    for part in ("hips", "torso", "head", "arm_l", "arm_r", "leg_l", "leg_r"):
        s.chan("%s.%s" % (pid, part), "rot")


# ---------------------------------------------------------------- shot 01: wide, Tock drives in
def shot01():
    n = 48
    s = Shot("shot-01", n, 1101, ["tock", "bobbin"], "town_square")
    s.static_camera((0.0, -9.6, 2.7), (0.0, 0.6, 0.8), 30)
    for pid in ("tock", "bobbin"):
        rest_pose(s, pid)
    x0, x1, y = -7.2, -1.6, -0.8
    drive_end = 30
    for f in range(n):
        t = f / drive_end
        x = lerp(x0, x1, smooth(t)) if f <= drive_end else x1
        z = 0.012 * (f % 2) if f < drive_end else 0.0
        s.set("tock", "loc", f, [x, y, z])
        turn = smooth((f - drive_end) / 6.0) if f > drive_end else 0.0
        s.set("tock", "rot", f, [0, 0, lerp(90, -10, turn)])
        s.jitter("tock", f)
        # head looks ahead, then around
        s.set("tock.head", "rot", f, [0, 0, 8 * math.sin(f * 0.5) * turn])
        # arms: hold wheel until stop, then wave
        if f > drive_end + 3:
            k = f - drive_end - 3
            s.set("tock.arm_l", "rot", f, [-15, -150 + 18 * math.sin(k * 1.6), 0])
            s.set("tock.arm_r", "rot", f, [-35, 0, 0])
        else:
            s.set("tock.arm_l", "rot", f, [-55, 0, 0])
            s.set("tock.arm_r", "rot", f, [-55, 0, 0])
        # Bobbin idles, looks at Tock, waves at the very end
        s.set("bobbin", "loc", f, [2.4, -0.3, 0.0])
        s.set("bobbin", "rot", f, [0, 0, lerp(0, -25, smooth((f - 10) / 14.0))])
        s.jitter("bobbin", f)
        s.set("bobbin.head", "rot", f, [0, 0, lerp(0, 20, smooth((f - 6) / 18.0))])
        s.set("bobbin.hips", "loc", f, [0, 0, 0.006 * math.sin(f * 0.7)])
        if f > 38:
            k = f - 38
            s.set("bobbin.arm_l", "rot", f, [-10, -145 + 20 * math.sin(k * 1.8), 0])
    s.mouths = {"tock": [0] * n, "bobbin": [0] * n}
    s.events = [{"frame": 0, "kind": "sfx", "cue": "engine_putter"}, {"frame": 31, "kind": "sfx", "cue": "horn_parp"}]
    return s


# ---------------------------------------------------------------- shot 02: medium two shot, talking + waving
def shot02():
    n = 60
    s = Shot("shot-02", n, 1202, ["tock", "bobbin"], "town_square")
    s.static_camera((0.0, -4.7, 1.15), (0.0, 0.0, 0.62), 40)
    for pid in ("tock", "bobbin"):
        rest_pose(s, pid)
    rng = random.Random(77)
    talk = talk_levels(n, 6, 44, rng)
    held = ["none"] * n
    for f in range(n):
        s.set("tock", "loc", f, [-0.95, 0.0, 0.0])
        s.set("tock", "rot", f, [0, 0, 22])
        s.jitter("tock", f)
        nod = 5 * math.sin(f * 0.9) if 6 <= f < 44 else 0
        s.set("tock.head", "rot", f, [nod, 0, 6 * math.sin(f * 0.37)])
        s.set("tock.hips", "loc", f, [0, 0, 0.008 * (f % 2)])
        if 6 <= f < 44:
            s.set("tock.arm_r", "rot", f, [-25 + 12 * math.sin(f * 0.8), 20 + 8 * math.sin(f * 0.6), 0])
        s.set("tock.arm_l", "rot", f, [-18, 0, 0])
        # Bobbin: waves, then offers a flower
        s.set("bobbin", "loc", f, [0.95, 0.0, 0.0])
        s.set("bobbin", "rot", f, [0, 0, -22])
        s.jitter("bobbin", f)
        s.set("bobbin.head", "rot", f, [0, 0, -8 + 4 * math.sin(f * 0.3)])
        if f < 24:
            k = f
            s.set("bobbin.arm_l", "rot", f, [-8, -152 + 22 * math.sin(k * 1.7), 0])
        if f >= 28:
            held[f] = "flower"
            s.set("bobbin.arm_r", "rot", f, [-70 * smooth((f - 28) / 6.0), -15 * smooth((f - 28) / 6.0), 0])
    s.mouths = {"tock": talk, "bobbin": [0] * n}
    s.props = {"bobbin": held}
    s.events = [{"frame": 6, "kind": "line", "lineId": "L001", "actor": "tock"}, {"frame": 28, "kind": "sfx", "cue": "twinkle"}]
    return s


# ---------------------------------------------------------------- shot 03: close on Tock, hopping happily
def shot03():
    n = 48
    s = Shot("shot-03", n, 1303, ["tock"], "town_square")
    s.static_camera((-0.25, -3.1, 1.02), (0.0, 0.0, 0.66), 50)
    rest_pose(s, "tock")
    for f in range(n):
        s.set("tock", "loc", f, [-0.2, 0.0, 0.0])
        s.set("tock", "rot", f, [0, 0, 10 * math.sin(f * 0.26)])
        s.jitter("tock", f)
        phase = (f % 12) / 12.0
        hop = 0.17 * math.sin(math.pi * phase) if phase < 1 else 0
        squash = -0.03 if f % 12 == 0 else 0.0
        s.set("tock.hips", "loc", f, [0, 0, hop + squash])
        up = -150 - 14 * math.sin(phase * math.tau)
        s.set("tock.arm_l", "rot", f, [-8, up, 0])
        s.set("tock.arm_r", "rot", f, [-8, -up, 0])
        s.set("tock.head", "rot", f, [-6 + 10 * math.sin(phase * math.tau), 0, 7 * math.sin(f * 0.5)])
        s.set("tock.leg_l", "rot", f, [-30 * math.sin(math.pi * phase), 0, 0])
        s.set("tock.leg_r", "rot", f, [-30 * math.sin(math.pi * phase), 0, 0])
    laugh = [2 if (f % 12) < 6 else 1 for f in range(n)]
    s.mouths = {"tock": laugh}
    s.events = [{"frame": 0, "kind": "sfx", "cue": "boing"}, {"frame": 24, "kind": "sfx", "cue": "boing"}]
    return s


def main():
    out = HERE
    os.makedirs(os.path.join(out, "tracks"), exist_ok=True)
    cast = []
    for pid in ("tock", "bobbin"):
        cast.append(seedload.load(os.path.join(ROOT, "seed", "cast", pid + ".md"))[0])
    sets = [seedload.load(os.path.join(ROOT, "seed", "sets", "town_square.md"))[0]]
    with open(os.path.join(out, "cast.json"), "w", encoding="utf-8") as f:
        json.dump(cast, f, indent=1)
        f.write("\n")
    with open(os.path.join(out, "sets.json"), "w", encoding="utf-8") as f:
        json.dump(sets, f, indent=1)
        f.write("\n")
    for fn in (shot01, shot02, shot03):
        s = fn()
        for name, ch in s.objects.items():
            for k, arr in ch.items():
                assert len(arr) == s.frames, (s.id, name, k)
        for k in ("loc", "target", "lens"):
            assert len(s.camera[k]) == s.frames
        for k, arr in list(s.mouths.items()) + list(s.props.items()):
            assert len(arr) == s.frames, (s.id, k)
        with open(os.path.join(out, "tracks", s.id + ".json"), "w", encoding="utf-8") as f:
            json.dump(s.doc(), f, separators=(",", ":"))
            f.write("\n")
        print("wrote", s.id, s.frames, "frames")


if __name__ == "__main__":
    main()
