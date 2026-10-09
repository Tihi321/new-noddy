---
id: the_pond
name: The Pond
size: [12, 8]
ground: grass
backdrop: sky_day
lighting: day
props:
  - { kind: pond, pos: [0, 2.6], rot: 0, scale: 1.3, color: "#4fb4e8", accent: "#7ac24a", variant: 0, id: pond }
  - { kind: bridge, pos: [0, 2.6], rot: 0, scale: 1.7, color: "#b8793c", accent: "#8a5a34", variant: 0, id: bridge }
  - { kind: rock, pos: [-5.0, 0.8], rot: 0, scale: 1.2, color: "#9a9a9e", accent: "#6aa84f", variant: 0, id: rock_a }
  - { kind: rock, pos: [5.2, 1.0], rot: 40, scale: 0.9, color: "#a4a4a8", accent: "#6aa84f", variant: 0, id: rock_b }
  - { kind: tree_lollipop, pos: [-5.4, 3.6], rot: 0, scale: 1.3, color: "#5db24a", accent: "#ff7ab0", variant: 0, id: tree_left }
  - { kind: tree_pine, pos: [5.6, 3.6], rot: 0, scale: 1.2, color: "#2f8f4e", accent: "#ffd400", variant: 0, id: tree_right }
  - { kind: bush, pos: [-3.6, 0.4], rot: 0, scale: 1.0, color: "#4ea84a", accent: "#e8436b", variant: 0, id: bush_a }
  - { kind: flower_patch, pos: [3.4, -0.2], rot: 0, scale: 1.2, color: "#7ab8ff", accent: "#ffd400", variant: 1, id: flowers_a }
  - { kind: bench, pos: [-2.4, -1.4], rot: 0, scale: 1.0, color: "#b8793c", accent: "#3b3b44", variant: 0, id: bench }
  - { kind: cloud, pos: [-2.0, 6.0], rot: 0, scale: 1.2, color: "#ffffff", accent: "#e8f0ff", variant: 0, id: cloud_a }
marks:
  center: [0, -0.4]
  bridge_left: [-3.4, 2.0]
  bridge_right: [3.4, 2.0]
  pond_edge: [0, 0.6]
  bench: [-2.4, -0.8]
  left: [-4.2, -0.8]
  right: [4.2, -0.8]
  rock: [-5.0, 0.1]
---
A quiet round pond with lily pads, reeds and a little wooden arched bridge. Rocks, bushes and trees frame the water, and a bench on the left is a lovely place to sit and chat. Characters can stand at the `pond_edge` and look in, cross the bridge between `bridge_left` and `bridge_right`, or sit on the `bench`. Mood: calm, curious, splashy things can happen here (a dropped ball, a wobbly bridge).
