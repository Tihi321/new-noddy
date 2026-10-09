# M9 run notes (real end-to-end run, all-local models)

Run on 2026-10-09. No ANTHROPIC_API_KEY, so every role used LM Studio: `nail-qwen3.6-35b-a3b-mtp` (structured roles) and `ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp` (producer, screenwriter, story editor). Both were already loaded with a 32768 context, so nothing was reloaded. Cost 0 USD.

## How to run headless

```
npm run build:engine
node out/engine/index.js run-episode --data <dir> --theme "Tock loses his cap on a windy day" --type lesson --length 5 --approve-all
node out/engine/index.js run-episode --data <dir> --episode <id>      # carry on / retry an existing episode
```

Call `node out/engine/index.js` directly rather than `npm run engine -- ...`: npm on Windows passes a quoted argument through cmd.exe and the theme came out as `^Tock^ loses^ his^ ...` (the CLI now strips `^`, but the direct call is cleaner). Exit code 0 when done, 1 when failed. Stage times go to stderr and to `episodes/<id>/timings.json`.

## What broke and how it was fixed

| Problem | Fix |
|---|---|
| Animator replies had timing slips: actions running past the end of the shot, actions after the end, a missing `talk` for a line. 2 QA rounds did not fix them, so the episode failed at QA. | `src/engine/pipeline/repair.ts` `repairActions()`: shortens overrunning actions, drops those after the end, adds the missing `talk` (at the next free moment, placed after other talks). Applied in the `actions` handler and again at the start of `qa`. |
| `fix_shots` (QA warnings about total length) shortens shots after their actions were written, so every action list was stale and QA failed on timings. | Same `repairActions` pass in the `qa` handler, against the shots as they are now. |
| Animator gave actions to props (`cloud_a idle`, `lamp_left wobble`, `sun enter`) in an establishing shot with an empty cast. | `repairActions` drops actions whose actor is not in the shot cast. |
| Animator wrote a target as the string `"[2.2, -1.3]"`. | `repairActions` turns it into a real `[x, y]`. |
| Director planned 13 shots / 150 s for a 300 s episode, and re-asking via `fix_shots` only crept up (150, 186, 204 s). | `fitShotDurations()` scales the durations towards the target (within 6-20 s) when the total is outside 85-115 percent. The director prompt now says "at least N shots, 2 to 4 per scene". The next attempt gave 18 shots (198 s, scaled to 287 s). |
| Close-up/medium shots that start with a puppet entering from the edge were framed as a wide shot with the puppet at the frame edge (camera box included the whole walk). | `src/engine/anim/camera.ts`: for locked non-establishing shots whose walk is much wider than the framing, the box uses the 20th to 80th percentile of positions. |
| **Puppets were invisible in 12 of 18 shots**: seed set `the_hill` had the hill (pos y 4.2, scale 1.7) reaching to y -0.15, so marks `hill_foot` (y 1.9) and `path_start` were inside it (hill height there 1.35, puppets 1.0). Found only by looking at the frames. | `seed/sets/the_hill.md`: hill at y 4.6, scale 1.2. `PROP_RADIUS.hill` 1.5 to 2.6. New QA warning `mark_in_prop` (hills only) so a custom set from the designer is sent back. Set designer prompt example and footprint note fixed. The hill shots were re-rendered. |
| The e2e test relied on QA flagging a missing talk. | `tests/e2e/episode-mock.test.ts` now breaks an action target instead (a missing talk is repaired by code). |

Regression tests: `tests/unit/repair.test.ts`, `tests/unit/anim-camera.test.ts`, `tests/unit/qa-marks.test.ts` (also checks that no seed set has a mark inside a hill).

Not an engine bug but worth knowing: seed files are copied into the data folder once and never overwritten, so an existing data folder keeps the old `prompts/` and `sets/`. I copied the changed prompts into `.claude/temp/m9-full/prompts/` by hand.

## Timings (full run, 18 shots, 287 s of shots + 10 s of cards = 297 s)

The run was done in pieces because I fixed bugs between them, so the stages come from three engine sessions on the same episode.

| Stage | Time |
|---|---|
| brief | 12 s |
| outline | 47 s |
| script | 84 s |
| review (+2 rewrites, 3 reviews, 27B model) | 197 s |
| design (cast + sets in parallel) | 9 s |
| shots (first try, 13 shots) | 41 s; second try (18 shots) 56 s |
| animate (18 actions jobs, music, sfx) | 157 s (first try, 13 shots); 253 s (18 shots) |
| qa | 19 s (second try; first try 103 s with two fix_shots rounds) |
| assets (2 puppets + 3 sets in Blender) | 13 s (the sets cache, rebuilt hill about 10 s) |
| voice (54 lines) | under 1 s |
| compile | under 1 s |
| mix | 3.5 s |
| preview (18 Godot shots + animatic) | 86 s |
| render (3450 frames at 1280x720, 24 samples, Eevee) | 2733 s (45.5 min) all shots; 1443 s (24 min) for the 12 hill shots re-render |
| edit (ffmpeg) | 57 s |

Whole pipeline from theme to mp4 is roughly 10 min of LLM work plus about 50 min of render and edit. The shakedown folder (`.claude/temp/m9-data`) used 24 samples and 4 to 8 shots. The full run (`.claude/temp/m9-full`) used the default config (64 samples): 3444 frames in 2733 s is about 0.8 s/frame, faster than the 1.5 s/frame estimate (the Eevee scenes are light).

## Model behaviour notes

- The 27B writer needed 2 rewrites: review 0 said the script stopped mid-story, review 1 said only one funny attempt; review 2 passed. The story reads well: wind takes Tock's cap, he fails alone, Bobbin and a jack-in-the-box help, happy ending, moral "friends help each other". It has 54 lines and 44 beats, 18 shots.
- The 35B structured model produces valid JSON almost every time (no chatJson repair failures were seen). Its mistakes are semantic: timings, actors, targets, shot counts.
- It ignores "15 to 25 shots" unless it is spelled out as a minimum with per-scene guidance.
- Music (15 cues) and SFX lists were valid and covered all shots.

## Output paths

- Final: `.claude/temp/m9-full/episodes/tock-loses-his-cap-on-a-windy-day/out/episode.mp4` (297.0 s, 1280x720, 24 fps, H.264 + AAC, 658 MB, mean volume -15.2 dB, peak -0.1 dB)
- Animatic: `.claude/temp/m9-full/episodes/tock-loses-his-cap-on-a-windy-day/preview/animatic.mp4` and `preview/thumbs/shot-NN.png`
- Final frames: `render/shot-NN/f_####.png`; review frames cut from the mp4 are in `.claude/temp/frames/` (`fin_sheet.png` is a six-frame contact sheet)
- Shakedown (1 min, 7 shots, 24 samples): `.claude/temp/m9-data/episodes/tock-loses-his-cap-on-a-windy-day/out/episode.mp4` (76.0 s = 5 + 66 + 5)
- Logs: `.claude/temp/m9-full/episodes/<id>/log.md`, engine stderr in `.claude/temp/m9-full*.err`

## Quality observations

- Look: warm, clean toy-town; cobblestone square, felt-green hill, grain and soft shadows read well. Vehicle, hat and teddy details are clear. It looks more like a modern toy cartoon than gritty stop-motion; the stop-motion feel comes from the 12 fps stepping.
- Story/staging: clear without words. Tock is always in his van (the seed cast gives him one), so "Tock walks" scenes are really "van drives". Every hill shot uses the same few marks, so the shots look alike (a lot of green hill, a signpost, a fence).
- Framing is mostly sane after the camera fix. Remaining: (a) a `close` shot of Tock in the van is still cut at the left edge because the camera box ignores the vehicle's length; (b) establishing shots leave a big empty foreground; (c) the opening establishing shot has an empty cast, so Tock is not seen until shot 2.
- A few shots have two puppets overlapping in the van (Bobbin riding with Tock): readable, but they intersect.
- Audio: mumble and music were NOT listened to, only measured: no clipping, peak -0.1 dB, audio length equals video length (296.98 s vs 297.0 s). The mix normalises to 0 dB peak; a ceiling of -1 dB would be safer for AAC.
- File size: 658 MB for 5 min (CRF 19 on top of film grain). CRF 23 or a lower grain amount would cut it a lot.

## Recommended next improvements

1. Listen to the audio and tune mumble levels, then add a -1 dB limiter ceiling and a lower bitrate / higher CRF for the final mp4.
2. Camera: count vehicle length in the box; pull establishing shots down so the ground is not half the frame; per-shot subject framing for vehicles.
3. Staging: shift the start positions of two puppets apart when they share a mark (a small separation pass in the compiler), and a check for characters sharing a vehicle.
4. Seed sets: add more marks per set and more variety on the hill (picnic, rock, tree) so shots do not repeat; review each seed set visually with a puppet standing on every mark (a contact-sheet tool would catch the hill bug at M4 time).
5. Prompt data folders are not updated when the seed changes (copy-never-overwrite). Add a "reset prompt/sets to seed" command, or version the seed files.
6. Director/QA: a QA `shot_count` warning is not fixable by the model in practice and costs a `fix_shots` round (about 60 to 100 s) each time. Consider not sending warnings-only shot issues to a fix job, or have the engine split/stretch deterministically.
7. Give the producer the option to put the hero into the opening establishing shot (cast not empty).
8. Try Claude for producer/screenwriter/editor, the roles that needed 2 rewrites locally; compare script quality and cost.
9. Run the render at preview quality for the animatic checkpoint to look at the real look earlier, since only 4 shots would be needed to judge the style.

## Post-M9 fixes

Done after the real run, against the same episode data (copy in `.claude/temp/post-m9/data`, nothing in `m9-full` was changed).

1. **File size.** `src/engine/tools/handlers/edit.ts`: x264 `-preset slow -crf 25 -tune animation`, AAC 160k, `+faststart` (the Godot preview/animatic encodes in `godot.ts` use crf 24 and 160k audio). Re-edited the 18 rendered shots: CRF 23 gave 184 MB, CRF 24 117 MB, CRF 25 **75 MB** (297 s, 1280x720, 2.0 Mbit/s). CRF 26 smooths the film grain away completely, so 25 is the pick. Frame at 150 s checked: `.claude/temp/post-m9/edit/frame150.png`; grain kept lightly, edges clean. Script that re-ran the edit with the same builders: `.claude/temp/post-m9/edit.mts` (output `.claude/temp/post-m9/edit/episode.mp4`).
2. **Audio ceiling.** `audio/dsp.ts` `softLimit(x, knee, ceiling)`; `audio/mix.ts` final stage limits to `CEILING_DB = -1` dBFS. Re-mixed the run's audio: peak -1.0 dB (was -0.0), mean/gated RMS -15.2 dB (unchanged). Tests in `audio-mix.test.ts` and `anim-audio-tools.test.ts`.
3. **Title.** `EpisodeStore.setTitle()` writes it into `episode.md` as soon as the brief (and again after every script write or rewrite) has one. The summary already fell back to script/brief; now the file itself is right. Tests: `tests/unit/episode-title.test.ts`, assertion in the e2e run.
4. **Reset to seed.** `store/dataFolder.ts`: `resetToSeed(dataDir, seedDir, {only?, backup})` (backs up replaced files to `<data>/.backup/<timestamp>/`, adds missing, never touches files only in the data folder), `findSeedDrift()`, `readSeedManifest()`, `.seed-manifest.json` (sha256 of each seed file written when it is copied, or noted when an existing file already equals the seed). CLI `reset-seed [--only prompts,sets] [--no-backup] [--seed dir]` (`cli.ts` `resetSeed`, wired in `index.ts`). At engine start `index.ts` logs and sends `engine.warning` when seed files changed since they were copied. Old data folders: a file only counts as in sync when it equals the seed at the first start with the new code, so a folder that is already stale (like m9-full) gets no warning for those files; run `reset-seed` once. Tests: `tests/unit/seed-reset.test.ts`.
5. **Framing** (`anim/camera.ts`, `anim/compile.ts`). (a) vehicle front/back end points (`VEHICLE_LENGTH` 1.6 along the heading) go into the framing box; a followed vehicle is at least that wide. (b) lower, nearly level cameras (establishing 5 deg, wide 4, medium 3, close 1.5; heights about 0.8 to 1.1) and the look-at point is lifted by a fraction of the picture height (`lift`) so subjects sit in the lower middle third. (c) an establishing shot with an empty cast frames the bounding box of the set's props (`propsBox`). Godot thumbnails before/after: `.claude/temp/post-m9/base1.png` and `after1.png` (shots 01, 02, 05, 07, 06, 14), `after2.png` (11, 13, 17, 03). Blender preview stills with the compiled camera: `.claude/temp/post-m9/bl/still_01.png`, `still_07.png` (puppets there are in rest pose, only the framing counts).
6. **Overlap.** `compile.ts` `separateActors()`: at the start and the end of a shot, two puppets closer than 0.6 are moved apart sideways (their whole path, rigidly, perpendicular to the camera axis); a puppet within 0.95 of a vehicle owner is seated 0.75 beside the vehicle (on the side it is already on). Tests in `anim-compile.test.ts`.
7. **QA warnings.** `pipeline/advance.ts`: warnings never start a fix round. A fix job is only made for an owner (task/unit) that has at least one error; its warnings are listed in the prompt for context. Tests in `advance.test.ts`.
8. **Blender.** Removed the `if False else` leftovers in `blender/toykit/props.py`; `use_nodes = True` in `materials.py` and `look.py` only runs below Blender 5.0. `python blender/tests/smoke.py build` builds all seed puppets and sets on Blender 5.2.

Open: the Godot preview has no sky backdrop (white), so empty areas look emptier there than in Blender; the establishing shot at 28 mm still shows the faint edge of the sky dome at the very top. Hill shots with a wide spread still have small subjects (the spread decides the width). The real render was not repeated with the new framing/overlap, only previews and stills, so a full re-render is still needed to see it in the final film.
