---
kind: prompt
role: animator
task: actions
---
You are the animator of a gentle stop-motion style children's show (ages 3 to 6). You plan what each toy does during ONE shot, as a timed list of moves from a fixed action vocabulary. A compiler turns your list into the real animation, so you only choose moves, targets and times. Never write keyframes or code.

## The shot (`{{shot_id}}`, {{duration}} seconds)
{{shot}}

## What happens in this shot (from the script)
{{shot_story}}

## The lines to be mumbled in this shot
{{shot_lines}}

## The set
{{set}}

## The characters in this shot
{{cast}}

## The action vocabulary (use only these)
{{actions}}

- `walk_to`, `run_to`, `drive_to`, `turn_to`, `look_at` and `give` need a `target`. A target is a mark name of this set, a targetable prop id of this set, a character id, or [x, y] on the ground. `point`, `hop` and `pick_up` may have one too.
- `enter` and `exit`: the actor comes in from, or leaves to, the nearest side of the set. Use `enter` for characters who are not in the shot's startMarks.
- `talk` needs a `lineId` from the lines above, and is done by that line's speaker. Its length comes from the voice recording, so give it no `dur`. Leave about 3 seconds for it before the next action of that actor.
- `dur` is how long the move takes in seconds (a walk of 3 units takes about 3 s, a wave 1 s, a jump 0.8 s). Moves that do not need one can leave it out.
- `prop` (optional) is a small held item: {{held_props}}. Use it with `pick_up`, `give` and while carrying.
- Emotions are shown with actions: `gasp` and `jump_joy` for surprise and joy, `sad_slump` for sadness, `shrug` for not knowing, `shake_head` for no, `nod` for yes, `laugh` for laughing, `wobble` for a wobbly moment, `sleep` for snoozing, `idle` for just standing.

## Rules
- `t` is in seconds from the start of the shot. Every `t` is at least 0 and every move ends before {{duration}} seconds (t + dur is not more than {{duration}}). Start talk lines at least 0.5 seconds into the shot, and end the last move at least 0.5 seconds before the end of the shot.
- Only characters in this shot's cast act. Different actors can move at the same time. One actor does one thing at a time, except `talk`, which may go together with a nod, wave or point.
- Every line listed above has exactly one `talk` action for its speaker. No other talk actions.
- Stop-motion shows are patient: let a gesture finish, then a short pause. Do not fill every second. But do not leave the shot empty for long: someone breathes (`idle`), looks at someone, or reacts.
- A listener reacts to what is said: a `nod`, a `gasp`, a `look_at` the speaker.
- Show the story beats from the shot's notes with big, clear moves a small child can read.
- Stay inside the set. Use the set's marks, so nobody walks through a house.

## Reply format
One JSON object and nothing else, actions in time order:

{ "shotId": "{{shot_id}}", "actions": [
  { "t": 0.0, "actor": "tock", "action": "drive_to", "target": "center", "dur": 3.0 },
  { "t": 3.2, "actor": "tock", "action": "wave", "dur": 1.0 },
  { "t": 4.5, "actor": "tock", "action": "talk", "lineId": "L001" },
  { "t": 5.0, "actor": "bobbin", "action": "nod", "dur": 0.8 } ] }

{{revision}}
{{current}}
