# Toykit (Blender)

Procedural stop-motion toy puppets, miniature sets and the render look. Needs Blender 4.2+ (tested on 5.2 LTS; Eevee only).
Data formats: `docs/contracts.md`. One job file per invocation:

    blender -b --factory-startup --python blender/run.py -- job.json

stdout lines: `@@PROGRESS {...}`, `@@DONE {"outputs": [...]}`, `@@ERROR {"message": ...}`; exit code is non-zero on error.

## Jobs by hand
- `build_puppet`: `{"kind":"build_puppet","spec":{...PuppetSpec},"style":{},"out_blend":"tock.blend","out_glb":"tock.glb"}`
- `build_set`: `{"kind":"build_set","layout":{...SetLayout},"style":{},"out_blend":"town.blend","out_glb":"town.glb"}`
- `render_shot`: `{"kind":"render_shot","tracks":"shot-01.json","puppets":{"tock":"tock.blend"},"set":"town.blend","style":{},"preset":"preview","out_dir":"render/shot-01","frames":null,"resume":true}`
  (`frames`: null or a list of frame numbers; with `resume` existing `f_####.png` are skipped)
- `still`: `{"kind":"still","puppets":{...},"set":"town.blend","style":{},"out":"x.png","preset":"final","camera":{"loc":[0,-8,2],"target":[0,0,0.6],"lens":30}}`

## Dev driver (builds from `seed/`, no PyYAML needed)
    python blender/tests/smoke.py build .claude/temp/toykit-test
    python blender/tests/smoke.py still .claude/temp/toykit-test town_square tock bobbin --cam "0,-4.6,1,0,0,.55,42"
    python blender/tests/smoke.py shot  .claude/temp/toykit-test tests/fixtures/episode-golden/tracks/shot-02.json final
`BLENDER=path/to/blender.exe` overrides the auto-detected install.

## Layout
`toykit/geo.py` shapes + Builder (one mesh object per joint, pivot at the joint), `puppets.py`, `props.py`, `sets.py`,
`materials.py` (procedural painted wood / felt / knit / clay / cardboard sky), `look.py` (Eevee, lights, DOF, flicker,
grain + vignette applied with numpy after each final frame), `render.py` (jobs), `export.py` (.blend + .glb; procedural
links are dropped for the glb so glTF carries `baseColorFactor`).
