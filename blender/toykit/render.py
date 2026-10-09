"""Job implementations: build_puppet, build_set, render_shot, still."""
import json
import math
import os
import time

import bpy
from mathutils import Vector

from . import export, look, props, puppets, sets


def _reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def _read(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _new_collection(scene, name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


# ------------------------------------------------------------------ build jobs
def job_build_puppet(job, emit):
    scene = _reset()
    spec = job["spec"]
    coll = _new_collection(scene, "puppet." + spec["id"])
    root, objs = puppets.build_puppet(spec, coll)
    emit("PROGRESS", {"done": 1, "total": 3, "label": "built " + spec["id"]})
    out = []
    if job.get("out_blend"):
        export.save_blend(job["out_blend"])
        out.append(job["out_blend"])
    emit("PROGRESS", {"done": 2, "total": 3, "label": "blend saved"})
    if job.get("out_glb"):
        export.export_glb(job["out_glb"], objs)
        out.append(job["out_glb"])
    emit("PROGRESS", {"done": 3, "total": 3, "label": "glb exported"})
    return {"outputs": out}


def job_build_set(job, emit):
    scene = _reset()
    layout = job["layout"]
    coll = _new_collection(scene, "set." + layout["id"])
    objs = sets.build_set(layout, coll)
    emit("PROGRESS", {"done": 1, "total": 3, "label": "built " + layout["id"]})
    out = []
    if job.get("out_blend"):
        export.save_blend(job["out_blend"])
        out.append(job["out_blend"])
    emit("PROGRESS", {"done": 2, "total": 3, "label": "blend saved"})
    if job.get("out_glb"):
        export.export_glb(job["out_glb"], objs)
        out.append(job["out_glb"])
    emit("PROGRESS", {"done": 3, "total": 3, "label": "glb exported"})
    return {"outputs": out}


# ------------------------------------------------------------------ loading
def _link_blend(scene, path):
    path = os.path.abspath(path)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o is not None]
    for o in objs:
        scene.collection.objects.link(o)
    return objs


class Stage:
    """A loaded puppets+set scene ready to render."""

    def __init__(self, job, preset, lighting_override=None):
        self.style = look.full_style(job.get("style"))
        self.preset = preset
        self.scene = _reset()
        sc = self.scene
        self.set_objs = _link_blend(sc, job["set"])
        root = bpy.data.objects.get("set.root")
        lighting = lighting_override or (root.get("toykit_lighting") if root else None) or "day"
        self.puppets = {}
        for pid, path in (job.get("puppets") or {}).items():
            self._load_puppet(pid, path)
        look.setup_render(sc, preset, self.style)
        self.rig = look.setup_lights(sc, lighting, self.style)
        self.cam = look.make_camera(sc)
        look.setup_dof(self.cam, preset, self.style)
        self.rest = {}
        self.held = {}

    def _load_puppet(self, pid, path):
        objs = _link_blend(self.scene, path)
        if bpy.data.objects.get(pid) is None:
            raise RuntimeError("puppet blend %s has no root object %r" % (path, pid))
        self.puppets[pid] = objs

    def rest_of(self, obj):
        r = self.rest.get(obj.name)
        if r is None:
            r = (obj.location.copy(), Vector(obj.rotation_euler))
            self.rest[obj.name] = r
        return r

    def find(self, name):
        o = bpy.data.objects.get(name)
        if o is None:
            o = bpy.data.objects.get("prop." + name)
        return o

    def apply_objects(self, objects, f):
        for name, ch in objects.items():
            o = self.find(name)
            if o is None:
                continue
            loc0, rot0 = self.rest_of(o)
            if "loc" in ch and f < len(ch["loc"]):
                o.location = loc0 + Vector(ch["loc"][f])
            if "rot" in ch and f < len(ch["rot"]):
                r = ch["rot"][f]
                o.rotation_euler = (rot0.x + math.radians(r[0]), rot0.y + math.radians(r[1]), rot0.z + math.radians(r[2]))

    def apply_mouths(self, mouths, f):
        for pid in self.puppets:
            arr = mouths.get(pid)
            lvl = 0
            if arr is not None and f < len(arr):
                lvl = max(0, min(2, int(arr[f])))
            for i in range(3):
                o = bpy.data.objects.get("%s.mouth_%d" % (pid, i))
                if o is not None:
                    o.hide_render = (i != lvl)

    def apply_held(self, held, f):
        for pid, arr in held.items():
            kind = arr[f] if f < len(arr) else "none"
            cache = self.held.setdefault(pid, {})
            if kind != "none" and kind not in cache:
                arm = bpy.data.objects.get("%s.arm_r" % pid)
                if arm is not None and "toykit_hand" in arm:
                    k = bpy.data.objects[pid].get("toykit_height", 1.0)
                    cache[kind] = props.build_held(kind, arm, Vector(arm["toykit_hand"]), k, self.scene.collection)
            for kd, ob in cache.items():
                for o in ob:
                    o.hide_render = (kd != kind)

    def apply_camera(self, cam, f):
        loc = cam["loc"][f]
        tgt = cam["target"][f]
        lens = cam["lens"][f] if "lens" in cam else 35.0
        look.aim_camera(self.cam, loc, tgt, lens)


def job_render_shot(job, emit):
    tracks = _read(job["tracks"])
    preset = job.get("preset", "preview")
    st = Stage(job, preset)
    sc = st.scene
    total_frames = int(tracks["frames"])
    frames = job.get("frames")
    todo = list(range(total_frames)) if frames in (None, []) else [int(f) for f in frames if 0 <= int(f) < total_frames]
    out_dir = os.path.abspath(job["out_dir"])
    os.makedirs(out_dir, exist_ok=True)
    label = tracks.get("shotId", os.path.basename(out_dir))
    resume = bool(job.get("resume", True))
    seed = int(tracks.get("seed", 0))
    post = look.PRESETS[preset]["post"]
    done = rendered = skipped = 0
    t_render = 0.0
    for f in todo:
        path = os.path.join(out_dir, "f_%04d.png" % f)
        if resume and os.path.isfile(path) and os.path.getsize(path) > 0:
            skipped += 1
            done += 1
            emit("PROGRESS", {"done": done, "total": len(todo), "label": label, "skipped": True})
            continue
        st.apply_objects(tracks.get("objects", {}), f)
        st.apply_mouths(tracks.get("mouths", {}), f)
        if tracks.get("props"):
            st.apply_held(tracks["props"], f)
        st.apply_camera(tracks["camera"], f)
        look.flicker(st.rig, st.style, f, seed)
        tmp = path + ".part.png"
        sc.render.filepath = tmp
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        if post:
            look.postprocess(tmp, st.style, f)
        os.replace(tmp, path)
        t_render += time.time() - t0
        rendered += 1
        done += 1
        emit("PROGRESS", {"done": done, "total": len(todo), "label": label})
    return {"outputs": [out_dir], "frames": len(todo), "rendered": rendered, "skipped": skipped,
            "sec_per_frame": (t_render / rendered) if rendered else 0.0}


def job_still(job, emit):
    preset = job.get("preset", "final")
    st = Stage(job, preset, job.get("lighting"))
    sc = st.scene
    ids = list(st.puppets.keys())
    place = job.get("placements") or {}
    n = len(ids)
    spacing = 1.4
    marks = {}
    for o in bpy.data.objects:
        if o.name.startswith("mark."):
            marks[o.name[5:]] = (o.location.x, o.location.y)
    for i, pid in enumerate(ids):
        p = place.get(pid)
        x, y, rz = (i - (n - 1) / 2.0) * spacing, -1.2, 0.0
        if isinstance(p, dict):
            pos = p.get("pos", [x, y])
            rz = p.get("rot", 0.0)
        elif p is not None:
            pos = p
        else:
            pos = [x, y]
        if isinstance(pos, str):
            pos = marks.get(pos, [x, y])
        o = bpy.data.objects[pid]
        o.location = (pos[0], pos[1], 0.0)
        o.rotation_euler = (0, 0, math.radians(rz))
    cam = job.get("camera") or {"loc": [0, -8.2, 2.1], "target": [0, 0, 0.55], "lens": 30}
    look.aim_camera(st.cam, cam["loc"], cam["target"], cam.get("lens", 35))
    look.flicker(st.rig, {"light_flicker": 0.0}, 0)
    out = os.path.abspath(job["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sc.render.filepath = out
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    if look.PRESETS[preset]["post"]:
        look.postprocess(out, st.style, 0)
    emit("PROGRESS", {"done": 1, "total": 1, "label": "still"})
    return {"outputs": [out], "sec": time.time() - t0}
