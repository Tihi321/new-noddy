"""Smoke test / dev driver (plain python, not run inside Blender).

  python blender/tests/smoke.py build   <outdir>      # build every seed puppet + set (.blend + .glb)
  python blender/tests/smoke.py still   <outdir> <set_id> [cast ids...] [--preset final|preview] [--out x.png]
  python blender/tests/smoke.py shot    <outdir> <tracks.json> <preset> [--set id] [--out dir]

Needs Blender: set BLENDER env var or install it in the default location.
"""
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import seedload  # noqa: E402


def blender_exe():
    if os.environ.get("BLENDER"):
        return os.environ["BLENDER"]
    c = sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender*\blender.exe"))
    return c[-1] if c else "blender"


def run_job(job, label="job"):
    outdir = os.path.join(ROOT, ".claude", "temp")
    os.makedirs(outdir, exist_ok=True)
    jp = os.path.join(outdir, "job_%s.json" % label)
    with open(jp, "w") as f:
        json.dump(job, f)
    p = subprocess.run([blender_exe(), "-b", "--factory-startup", "--python", os.path.join(ROOT, "blender", "run.py"), "--", jp],
                       capture_output=True, text=True)
    lines = [l for l in p.stdout.splitlines() if l.startswith("@@")]
    for l in lines[-3:]:
        print("  ", l[:300])
    if p.returncode != 0 or any(l.startswith("@@ERROR") for l in lines):
        print(p.stdout[-3000:], p.stderr[-2000:])
        raise SystemExit("job %s failed (rc=%s)" % (label, p.returncode))
    return lines


def seed(kind):
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "seed", kind, "*.md"))):
        data, _ = seedload.load(path)
        out[data["id"]] = data
    return out


def style():
    return seedload.load(os.path.join(ROOT, "seed", "styles", "toyland-wood.md"))[0]


def build_all(outdir):
    os.makedirs(outdir, exist_ok=True)
    for pid, spec in seed("cast").items():
        print("puppet", pid)
        run_job({"kind": "build_puppet", "spec": spec, "style": style(), "out_blend": os.path.join(outdir, pid + ".blend"),
                 "out_glb": os.path.join(outdir, pid + ".glb")}, "p_" + pid)
    for sid, layout in seed("sets").items():
        print("set", sid)
        run_job({"kind": "build_set", "layout": layout, "style": style(), "out_blend": os.path.join(outdir, "set_" + sid + ".blend"),
                 "out_glb": os.path.join(outdir, "set_" + sid + ".glb")}, "s_" + sid)


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    cmd, outdir = a[0], a[1]
    if cmd == "build":
        build_all(outdir)
    elif cmd == "still":
        preset = "final"
        out = None
        rest = a[2:]
        if "--preset" in rest:
            i = rest.index("--preset")
            preset = rest[i + 1]
            del rest[i:i + 2]
        if "--out" in rest:
            i = rest.index("--out")
            out = rest[i + 1]
            del rest[i:i + 2]
        cam = None
        if "--cam" in rest:
            i = rest.index("--cam")
            v = [float(x) for x in rest[i + 1].replace(":", ",").split(",")]
            cam = {"loc": v[0:3], "target": v[3:6], "lens": v[6]}
            del rest[i:i + 2]
        sid, ids = rest[0], rest[1:] or list(seed("cast").keys())
        job = {"kind": "still", "puppets": {i: os.path.join(outdir, i + ".blend") for i in ids},
               "set": os.path.join(outdir, "set_" + sid + ".blend"), "style": style(), "preset": preset,
               "out": out or os.path.join(outdir, "still_%s_%s.png" % (sid, preset))}
        if cam:
            job["camera"] = cam
        run_job(job, "still")
    elif cmd == "shot":
        tracks, preset = a[2], a[3]
        rest = a[4:]
        fx = os.path.join(ROOT, "tests", "fixtures", "episode-golden")
        t = json.load(open(tracks))
        sid = rest[rest.index("--set") + 1] if "--set" in rest else t["setId"]
        out = rest[rest.index("--out") + 1] if "--out" in rest else os.path.join(outdir, "render", t["shotId"] + "_" + preset)
        job = {"kind": "render_shot", "tracks": tracks, "puppets": {i: os.path.join(outdir, i + ".blend") for i in t["cast"]},
               "set": os.path.join(outdir, "set_" + sid + ".blend"), "style": style(), "preset": preset, "out_dir": out,
               "frames": None, "resume": True}
        run_job(job, "shot")


if __name__ == "__main__":
    main()
