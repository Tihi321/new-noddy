---
kind: pipeline
paused: false
approvals:
  script: true
  animatic: true
target_length_min: 5
shots_min: 15
shots_max: 25
fps: 12
output_fps: 24
render:
  preview: { width: 640, height: 360, samples: 16 }
  final: { width: 1280, height: 720, samples: 64 }
max_review_rounds: 2
max_qa_rounds: 2
max_attempts: 3
---
# Pipeline

How an episode is made. Edit the values above; the engine reloads them without a restart. The New Episode dialog can override `approvals` and the length for one episode.

- `approvals`: the checkpoints where the pipeline stops and waits for you. `script` is after the story editor passed the script. `animatic` is after the Godot preview. Set one to `false` to let the episode run on.
- `target_length_min`: the default episode length in minutes.
- `shots_min`, `shots_max`: how many shots the director plans.
- `fps`: unique animation frames per second (stop-motion "on twos").
- `output_fps`: frame rate of the final video. ffmpeg repeats frames to get there.
- `render.preview`, `render.final`: Blender render presets. Preview is the quick look, final is the real render (Eevee).
- `max_review_rounds`: how often the story editor may send the script back for a rewrite before it goes on to the checkpoint.
- `max_qa_rounds`: how many times QA problems are sent back to their owners (fix jobs) before the episode goes on, or fails if real errors remain.
- `max_attempts`: tries for a failing job before it is moved to `jobs/failed/`.
- `paused`: the "pause all" switch. The app writes it. While true, no new jobs start.
