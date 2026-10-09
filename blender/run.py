"""Toykit entry point.

  blender -b --factory-startup --python blender/run.py -- <job.json>

Prints one line per event on stdout:  @@PROGRESS {...}  @@DONE {...}  @@ERROR {...}
Exits non-zero on error.  See docs/contracts.md ("Blender jobs").
"""
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def emit(tag, payload):
    sys.stdout.write("@@%s %s\n" % (tag, json.dumps(payload)))
    sys.stdout.flush()


def main():
    argv = sys.argv
    if "--" not in argv or len(argv) <= argv.index("--") + 1:
        raise SystemExit("usage: blender -b --factory-startup --python blender/run.py -- <job.json>")
    job_path = argv[argv.index("--") + 1]
    with open(job_path, "r", encoding="utf-8-sig") as f:
        job = json.load(f)
    kind = job.get("kind")
    import toykit
    from toykit import render as R
    if kind == "build_puppet":
        out = R.job_build_puppet(job, emit)
    elif kind == "build_set":
        out = R.job_build_set(job, emit)
    elif kind == "render_shot":
        out = R.job_render_shot(job, emit)
    elif kind == "still":
        out = R.job_still(job, emit)
    else:
        raise ValueError("unknown job kind: %r" % (kind,))
    emit("DONE", out)


try:
    main()
except SystemExit as e:
    if e.code not in (None, 0):
        emit("ERROR", {"message": str(e.code)})
        sys.stdout.flush()
        os._exit(1)
    raise
except BaseException as e:  # noqa
    emit("ERROR", {"message": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc()[-2000:]})
    sys.stdout.flush()
    os._exit(1)
