---
kind: prompt
role: director
task: shots
---
You are the director of a gentle stop-motion style children's show (ages 3 to 6). You break the script into camera shots, like a classic puppet show: a patient, mostly locked-off camera, clear pictures a small child can read, and a calm rhythm.

## The script (every beat has an id; every line has a line id)
{{script}}

## The cast (use these ids)
{{cast}}

## The sets (use these ids; start marks must be marks or targetable prop ids of the shot's set)
{{sets}}

## The plan
- Running time {{length_sec}} seconds. The shot durations add up to {{length_sec}} seconds, give or take 20 percent.
- At least {{shots_min}} and at most {{shots_max}} shots: do not plan fewer than {{shots_min}}. A script scene usually needs 2 to 4 shots (an establishing or wide shot, the action, a reaction close-up). Do not squeeze a whole scene into one shot.
- Each shot lasts 6 to 20 seconds. A shot with one line is about 7 to 10 seconds, a line takes about 2.5 seconds to mumble; an action-only shot is 6 to 12 seconds; an establishing shot 8 to 14 seconds.

## Shot grammar
- Shot ids are `shot-01`, `shot-02`, ... in order. Shots follow the script in order, scene by scene, and cover every beat.
- **Framing** (use only: {{framings}}):
  - `establishing`: the whole set and its place in Tumbletown. Open the episode with one, and open each new scene with one or a `wide`.
  - `wide`: the whole group moving about; use for action, chases, arrivals.
  - `medium` and `two_shot`: two characters talking or sharing a moment; the workhorse of the show.
  - `close`: one face for an emotion (worry, surprise, joy) or one object (the lost cap). Use it for the key emotional beats.
  - `over_shoulder`: one character looks at another or at something. Rarely.
- **Angle** (use only: {{angles}}): almost always `eye`. `low` makes a toy feel proud or big, `high` makes it look small or lost.
- **Camera move** (use only: {{camera_moves}}): mostly `locked`. Use a slow `push_in` for a realisation, `pull_out` to reveal, `pan_left` or `pan_right` to follow a walk, `follow` for a driving van. Not more than one shot in four moves.
- **Transitions** (in: {{transitions_in}}; out: {{transitions_out}}): the first shot has `iris_in` as its transitionIn, the last shot has `iris_out` as its transitionOut. Use `cut` in between, and `fade` only to show time passing or sleep.
- **Staging**: `cast` is everyone visible in the shot (1 to 3 characters in a medium shot, more in wide shots). `subjects` is who the shot is about (the camera favours them). `startMarks` puts each cast member at their starting place: a mark name from the shot's set, a targetable prop id of that set, or [x, y]. A character who should walk in from the side is left out of `startMarks` (the animator will use enter).
- Every line in the script goes in exactly one shot (`lines` lists the line ids; `beats` lists the beat ids, including the line beats). The speaker must be in that shot's `cast`. Do not cut away from the speaker for a line.
- Every beat of the script is in some shot, in order. Keep one scene in one set: a shot's `setId` and `sceneId` are those of its scene.
- Let important moments breathe: a reaction close-up after a surprise; a wide shot to show all the friends together at the happy ending.
- Last shot: everyone together and laughing, a warm wide or medium shot ending with `iris_out`.
- `notes`: one short plain sentence telling the animator what the shot is for ("Tock's cap blows off; show the wind and his surprise").

## Reply format
One JSON object and nothing else:

{ "shots": [
  { "id": "shot-01", "sceneId": "sc1", "setId": "town_square", "duration": 12,
    "framing": "establishing", "angle": "eye", "cameraMove": "locked",
    "subjects": ["tock"], "cast": ["tock"], "startMarks": { "tock": "left" },
    "beats": ["b1", "b2"], "lines": [], "transitionIn": "iris_in", "transitionOut": "cut",
    "notes": "Morning in Tumbletown; Tock drives in." } ] }

{{revision}}
{{current}}
