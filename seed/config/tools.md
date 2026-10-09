---
kind: tools
blender: ""
godot: ""
ffmpeg: ""
---
# Tools

Paths to the programs that make the pictures and the video. Empty means "look on PATH and in the usual install folders" (Program Files, WinGet). Fill in a full path (for example `C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`) to pin a version.

- `blender`: the final render (Eevee) and the puppet and set building.
- `godot`: Godot 4, for the fast animatic preview (Movie Maker mode).
- `ffmpeg`: titles, transitions and the final mix.

Run `npm run doctor` to see what was found.
