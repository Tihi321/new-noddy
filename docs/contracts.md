# Toybox Studio — data contracts

This file is the source of truth for every file passed between the engine (TS), Blender (`blender/`) and Godot (`godot/preview/`). The zod schemas in `src/shared/episode.ts` must match it. If you change a contract, change it here first.

## Units & coordinates
- **World units are "toy units".** A standard puppet is **1.0** tall, and a set is about **12 × 8** units of tabletop.
- **Blender convention everywhere in JSON:** right-handed and **Z-up**. Ground is z=0 and +Y is "into the set", away from the default camera. Rotations are **degrees**, XYZ Euler.
- The Godot preview converts on load: Blender `(x, y, z)` → Godot `(x, z, -y)`. The glTF exporter already converts meshes, so only track data needs converting.
- `[x, y]` marks are ground positions (z=0).

## Puppet (`PuppetSpec`)
```json
{
  "id": "tock", "name": "Tock",
  "body": "peg | teddy | soldier | gnome | cow | jack_box",
  "material": "wood | felt | knit | clay",
  "height": 1.0,
  "colors": { "skin": "#f2c9a0", "torso": "#d33b2c", "legs": "#2a4fa8", "hat": "#d22", "accent": "#ffd400" },
  "hat": "none | pompom | bell_cap | helmet | bonnet | gnome_cone | police | top_hat | beret",
  "accessories": ["scarf", "bow", "apron", "glasses", "backpack", "whistle", "key_back", "neckerchief"],
  "eyes": "dot | button", "nose": "round | snout | button | none", "ears": "none | round | cow",
  "vehicle": null,
  "voice": { "pitch": 1.2, "speed": 1.1, "timbre": "bright | warm | gruff | squeaky" }
}
```
`vehicle` is either `null` or `{ "kind": "van | car | bike | train", "color": "#ffd400", "accent": "#d33b2c" }`. A vehicle is built as its own object `<id>.vehicle`.

**Object names**, shared by Blender, glb and tracks. Each pivot sits at its joint:

| object | pivot |
|---|---|
| `<id>` | root empty at the feet centre (location, rot Z) |
| `<id>.hips` | pelvis (bob / lean) |
| `<id>.torso` | waist |
| `<id>.head` | neck |
| `<id>.arm_l`, `<id>.arm_r` | shoulder |
| `<id>.leg_l`, `<id>.leg_r` | hip joint |
| `<id>.hat` | top of head (child of head) |
| `<id>.mouth_0`, `<id>.mouth_1`, `<id>.mouth_2` | closed / mid / open replacement mouths (children of head). Only one is visible per frame. |
| `<id>.vehicle` | optional, ground centre |

The hierarchy is `root → hips → torso → (head → hat, mouths), (arm_l, arm_r)`, with `hips → leg_l, leg_r`. A body type with no legs (`jack_box`) or four legs (`cow`) still exposes `leg_l` and `leg_r`: the cow's front and back pairs are merged per side, and the jack_box gets empty placeholders.

## Set (`SetLayout`)
```json
{
  "id": "town_square", "name": "Town Square",
  "size": [12, 8],
  "ground": "grass | cobble | felt_green | snow | sand",
  "backdrop": "sky_day | sky_sunset | sky_night | sky_snow",
  "lighting": "day | evening | night | snow",
  "props": [ { "kind": "house", "pos": [-3, 2], "rot": 0, "scale": 1, "color": "#e8b04a", "accent": "#c0392b", "variant": 0, "id": "tocks_house" } ],
  "marks": { "center": [0, 0], "shop_door": [3, 1.4], "left": [-4, 0], "right": [4, 0] }
}
```
**Prop kinds:** `house, shop, station, tree_lollipop, tree_pine, bush, fence, road, lamp_post, bench, pond, hill, well, flower_patch, mailbox, signpost, bridge, cloud, rock, gate, market_stall, clock_tower`.

A prop with an `id` can be targeted by actions. Its door or front is in its local −Y direction.

## Style (`seed/styles/<id>.md` frontmatter)
```yaml
id: toyland-wood
fps: 12                # unique animation frames per second
output_fps: 24         # ffmpeg doubles frames ("on twos")
jitter_pos: 0.003      # units, per held pose
jitter_rot: 0.3        # degrees
light_flicker: 0.02    # ±fraction per frame (Blender only)
dof_fstop: 2.0
grain: 0.04
vignette: 0.25
key_light: "#ffe2b8"
fill_light: "#b8d4ff"
```

## Episode folder `episodes/<slug>/`
| file | written by |
|---|---|
| `episode.md` (frontmatter: stage, theme, type, style, lengthMin, approvals, approved{}, round, createdAt, error) | engine |
| `brief.json`, `outline.json`, `script.json`, `reviews/review-N.json` | producer / screenwriter / story editor |
| `cast.json` (`PuppetSpec[]`, includes guests), `sets.json` (`SetLayout[]`) | designers |
| `shots.json`, `actions/shot-NN.json`, `music.json`, `sfx.json`, `qa.json` | director / animator / composer / sound / QA |
| `audio/lines/<lineId>.wav` + `audio/lines/<lineId>.json` (mouth) | voice booth |
| `tracks/shot-NN.json` | animation compiler |
| `audio/shot-NN.wav`, `audio/episode.wav` | mixer |
| `assets/puppets/<id>-<hash8>.{blend,glb}`, `assets/sets/<id>-<hash8>.{blend,glb}` | puppet workshop |
| `preview/shot-NN.mp4`, `preview/thumbs/shot-NN.png`, `preview/animatic.mp4` | Godot preview |
| `render/shot-NN/f_####.png`, `render/shot-NN.mp4` | Blender render |
| `out/episode.mp4` | editor |

### `episode.md` frontmatter (as implemented in `src/shared/episode.ts` `EpisodeMeta`)
- **Identity:** `title, theme, type, style, lengthMin, characters[]`.
- **Status:** `stage, status, approvals {script, animatic}, approved {script, animatic}`.
- **Counters:**
  - `round`: the index of the review under way.
  - `roundBase`: where the editor's round budget starts after a user change request.
  - `qaRound`.
  - `cut`: bumped by each animatic change request.
  - `cutNote`.
- **Timestamps and errors:** `createdAt, updatedAt, error`.

### Other episode files
- `brief.md`, `outline.md`, `script.md`: human-readable twins of the JSON files.
- `reviews/review-N.json`: `{ verdict: approve|revise, source: editor|user, summary, scores, issues[] }`.
- `reviews/script-before-N.json`: the script as it was before rewrite N.
- `notes/writer.json`: `{ family, agent }`. The review uses it for `avoid_family`, and the rewrite uses it for `agent_hint`.
- `outline.json`: `{ title, sections: [{ id, name, setId, summary, beats[], approxSec }] }`.
- `qa.json`: `{ ok, round, issues: [{ task, unit?, severity: error|warning, code, message }], checkedAt }`.

### Job ids
**Format:** `<ep>--<task>--<unit|all>--<tag>`.

**Tags:**
- `rN`: script rounds, assets and voice.
- `c<cut>`: compile, mix, preview, render and edit.
- `c<cut>q<n>`: QA and its fixes.

**Fix tasks:** `fix_cast`, `fix_sets`, `fix_shots`, `fix_actions` (unit = shot id), `fix_music`, `fix_sfx`.

## Script (`script.json`)
```json
{ "title": "Tock and the Windy Day", "logline": "...", "moral": "...",
  "scenes": [ { "id": "sc1", "setId": "town_square", "summary": "...",
    "beats": [
      { "id": "b1", "kind": "action", "text": "Tock drives into the square, waving." },
      { "id": "b2", "kind": "line", "character": "tock", "lineId": "L001", "text": "Good morning, Bobbin!", "emotion": "happy" }
    ] } ] }
```
**Emotions:** `neutral, happy, sad, excited, worried, angry, surprised, sleepy, question, laugh`.

## Shots (`shots.json`)
```json
{ "shots": [ {
  "id": "shot-01", "sceneId": "sc1", "setId": "town_square", "duration": 12.0,
  "framing": "establishing | wide | medium | close | two_shot | over_shoulder",
  "angle": "eye | low | high",
  "cameraMove": "locked | pan_left | pan_right | push_in | pull_out | follow",
  "subjects": ["tock"],
  "cast": ["tock", "bobbin"],
  "startMarks": { "tock": "left", "bobbin": [1, 0.5] },
  "beats": ["b1", "b2"], "lines": ["L001"],
  "transitionIn": "cut | iris_in | fade", "transitionOut": "cut | iris_out | fade",
  "notes": "..." } ] }
```

## Actions (`actions/shot-NN.json`)
```json
{ "shotId": "shot-01", "actions": [
  { "t": 0.0, "actor": "tock", "action": "drive_to", "target": "center", "dur": 3.0 },
  { "t": 3.2, "actor": "tock", "action": "wave", "dur": 1.0 },
  { "t": 4.5, "actor": "tock", "action": "talk", "lineId": "L001" } ] }
```
- **Vocabulary:** `walk_to, run_to, hop, turn_to, look_at, wave, nod, shake_head, point, jump_joy, sad_slump, shrug, sit, stand, drive_to, pick_up, give, talk, gasp, laugh, sleep, wobble, idle, enter, exit`.
- `target` is a mark name, a prop id, a character id, or `[x, y]`.
- `talk` takes its duration from the line's wav.
- `enter` / `exit` move the actor from or to off-set at the nearest side.
- `prop` is optional: a small held item (`cap, ball, letter, flower, cake, key, umbrella, balloon`).

## Tracks (`tracks/shot-NN.json`) — compiled, single source of animation truth
```json
{ "shotId": "shot-01", "setId": "town_square", "fps": 12, "frames": 144, "seed": 1234,
  "cast": ["tock", "bobbin"],
  "camera": { "loc": [[x,y,z], ...], "target": [[x,y,z], ...], "lens": [35, ...] },
  "objects": {
    "tock":       { "loc": [[x,y,z], ...], "rot": [[rx,ry,rz], ...] },
    "tock.head":  { "rot": [[rx,ry,rz], ...] },
    "tock.arm_l": { "rot": [...] }
  },
  "mouths": { "tock": [0, 0, 2, 1, ...] },
  "props":  { "tock": ["none", "none", "cap", ...] },
  "events": [ { "frame": 54, "kind": "line", "lineId": "L001", "actor": "tock" },
              { "frame": 10, "kind": "sfx", "cue": "horn_parp" } ] }
```
- **Orientation:** at rest a puppet faces **−Y** and its left is +X. Root heading is `rotZ = atan2(dx, -dy)` in degrees.
- **Root vs children:** root `loc` and `rot` are **absolute**. Every other object's channels are **offsets from its rest pose**.
- **Vehicle:** `<id>.vehicle` is a child of the root and moves with it. Its own channels carry the suspension bounce.
- **Sfx events** may carry an optional `gain` (0–1).
- **Every array has exactly `frames` entries** and is sampled per animation frame (constant interpolation).
- Omitted channels are rest pose: rot 0, and loc as built.
- Hand-placement jitter is already baked in by the compiler.

## Audio
- **Episode audio layout:** `audio/episode.wav` is a **5 s title jingle**, then every shot back to back at its exact duration, then a **5 s end jingle**. `mix_audio` also writes `audio/episode.json` with `{ titleSec, endStart, endSec, duration, shots: { "<id>": { start, duration } } }`. The editor and the animatic align their video to this file.
- **Mouth file** `audio/lines/<lineId>.json`: `{ "lineId": "L001", "duration": 1.75, "fps": 12, "levels": [0,1,2,...] }`.
- **Music** (`music.json`): `{ "tempo": 104, "key": "C", "theme": { "instrument": "music_box", "melody": [{"p": "C5", "d": 0.5}], "bass": [] }, "cues": [ { "id": "cue1", "shots": ["shot-01","shot-02"], "mood": "cheerful", "instrument": "ukulele", "tempo": 104, "melody": [...], "bass": [...], "loop": true, "gain": 0.5 } ] }`
  - Instruments: `music_box, glockenspiel, ukulele, tuba, xylophone, recorder`.
  - `p` is a note name or MIDI number, or `"r"` for a rest. `d` is in beats.
- **SFX** (`sfx.json`): `{ "cues": [ { "shotId": "shot-01", "t": 0.8, "cue": "horn_parp", "gain": 0.8 } ], "voices": { "tock": { "pitch": 1.2, "speed": 1.1, "timbre": "bright" } } }`
  - Cue library: `bell_jingle, horn_parp, squeak_step, boing, door_knock, door_open, birds, wind, splash, pop, whistle, clock_tick, twinkle, soft_crash, engine_putter, rain, snore, gasp_whoosh, drum_roll, ta_da`.

## Blender jobs (`blender -b --factory-startup --python blender/run.py -- <job.json>`)
```json
{ "kind": "build_puppet", "spec": PuppetSpec, "style": Style, "out_blend": "...", "out_glb": "..." }
{ "kind": "build_set", "layout": SetLayout, "style": Style, "out_blend": "...", "out_glb": "..." }
{ "kind": "render_shot", "tracks": "path/shot-01.json", "puppets": {"tock": "path.blend"}, "set": "path.blend",
  "style": Style, "preset": "preview | final", "out_dir": "render/shot-01", "frames": null | [0, 12, 24],
  "resume": true }
{ "kind": "still", "puppets": {...}, "set": "...", "style": Style, "out": "x.png", "camera": {"loc": [...], "target": [...], "lens": 35} }
// still extras (optional): "preset": "preview | final" (default final), "lighting": "day|evening|night|snow" (default: the set's), "placements": { "tock": [x, y] | "markName" | {"pos": [x, y], "rot": 0} } (default: lined up along x at y=-1.2)
```
- **stdout protocol** (one JSON object per line, with a prefix):
  - `@@PROGRESS {"done": 12, "total": 144, "label": "shot-01"}`
  - `@@DONE {"outputs": [...]}`
  - `@@ERROR {"message": "..."}`
- `render_shot` writes `f_0000.png …`. When `resume` is set, it skips frames that already exist.
- Presets:
  - `preview` = 640×360, Eevee, 16 samples.
  - `final` = 1280×720, Eevee, 64 samples, DOF, compositor grain + vignette.

## Pipeline stages & job tasks
`episode.md` `stage` values, in order. `advance()` in `src/engine/pipeline/advance.ts` enqueues the jobs for each stage.

| stage | task(s) (job `task`) | kind | owner module |
|---|---|---|---|
| `brief` | `brief` | llm producer | pipeline/handlers |
| `outline` | `outline` | llm screenwriter | pipeline/handlers |
| `script` | `script` | llm screenwriter | pipeline/handlers |
| `review` | `review` → (`rewrite` → `review`)* up to `max_rounds` | llm story_editor / screenwriter | pipeline/handlers |
| `approve_script` | — (waits for the `approve`/`requestChanges` command when `approvals.script`) | user | pipeline |
| `design` | `cast`, `sets` (parallel) | llm designers | pipeline/handlers |
| `shots` | `shots` | llm director | pipeline/handlers |
| `animate` | `actions` per shot (unit = shot id), `music`, `sfx` (parallel) | llm animator/composer/sound | pipeline/handlers |
| `qa` | `qa` (deterministic validate; on failure enqueue `fix_<task>` for the owning role, max 2 rounds) | llm qa | pipeline/handlers + pipeline/qa.ts |
| `assets` | `build_puppet` per cast member (unit = id), `build_set` per set | tool puppet_workshop | tools/handlers/blender.ts |
| `voice` | `voice_lines` | tool foley_booth | tools/handlers/animAudio.ts |
| `compile` | `compile_tracks` (all shots) | tool animation_compiler | tools/handlers/animAudio.ts |
| `mix` | `mix_audio` (per shot wav + episode wav) | tool foley_booth | tools/handlers/animAudio.ts |
| `preview` | `preview_shot` per shot, then `animatic` | tool preview_crew | tools/handlers/godot.ts |
| `approve_animatic` | — (when `approvals.animatic`) | user | pipeline |
| `render` | `render_shot` per shot | tool render_farm | tools/handlers/blender.ts |
| `edit` | `edit_episode` | tool editor | tools/handlers/edit.ts |
| `done` / `failed` | — | | |

Each tools module exports a `register…(scheduler, deps)` function: `registerAnimAudioTools`, `registerBlenderTools`, `registerGodotTools`, `registerEditTools`. `installPipeline(engine)` calls every registrar that exists. A stage whose registrar is missing stays parked, with a warning event, rather than failing. Every handler is idempotent: it reads its inputs from the episode folder and writes its outputs there atomically.

## Godot preview
`godot --path godot/preview [--write-movie out.avi --fixed-fps 12 --resolution 640x360] -- --tracks <tracks.json> --set <set.glb> --puppet tock=<path.glb> --puppet bobbin=<path.glb> [--thumb out.png]`
- It plays the tracks once and quits when the movie is written.
- Without `--write-movie` it opens an interactive window with play/pause and a scrub slider.

## Toykit object naming (set .blend / .glb)
`set.root` (empty, custom props toykit_lighting/toykit_set_id), `set.ground`, `set.backdrop`, `set.hills`, `set.table`, one mesh per prop named `prop.<id>` (or `prop.<kind>_<n>` without id), marks `mark.<name>`. Track `objects` keys not found in the scene (also tried with a `prop.` prefix) are ignored.
