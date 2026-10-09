---
id: the_hill
name: The Hill
size: [12, 8]
ground: grass
backdrop: sky_day
lighting: day
props:
  - { kind: hill, pos: [0, 4.6], rot: 0, scale: 1.2, color: "#5db24a", accent: "#ffd400", variant: 0, id: big_hill }
  - { kind: tree_pine, pos: [-5.3, 1.8], rot: 0, scale: 1.2, color: "#2f8f4e", accent: "#ffd400", variant: 0, id: pine_a }
  - { kind: tree_pine, pos: [5.2, 2.2], rot: 0, scale: 1.0, color: "#3a9a58", accent: "#ffd400", variant: 0, id: pine_b }
  - { kind: signpost, pos: [-2.2, 0.6], rot: 0, scale: 1.0, color: "#c9955a", accent: "#e8e0c8", variant: 0, id: signpost }
  - { kind: fence, pos: [3.0, 0.4], rot: 0, scale: 1.2, color: "#f6f1e6", accent: "#c9a36a", variant: 0, id: fence }
  - { kind: flower_patch, pos: [1.6, 0.9], rot: 0, scale: 1.3, color: "#ff6b9a", accent: "#ffd400", variant: 2, id: flowers_a }
  - { kind: rock, pos: [-3.6, 0.0], rot: 0, scale: 1.0, color: "#9a9a9e", accent: "#6aa84f", variant: 0, id: rock }
  - { kind: cloud, pos: [-3.5, 6.0], rot: 0, scale: 1.5, color: "#ffffff", accent: "#e8f0ff", variant: 0, id: cloud_a }
  - { kind: cloud, pos: [4.0, 6.0], rot: 0, scale: 1.1, color: "#ffffff", accent: "#e8f0ff", variant: 2, id: cloud_b }
marks:
  center: [0, 0]
  hill_foot: [0, 1.9]
  path_start: [0.6, 1.2]
  signpost: [-2.2, 0.0]
  picnic: [2.2, -0.5]
  left: [-4, -0.5]
  right: [4, -0.5]
---
A big, soft felt hill rises at the back of the set, with a stitched path winding up it, flowers sprinkled on the slope, pine trees on both sides and a signpost at the start of the path. Marks stay on the flat grass at the hill's foot (`hill_foot`, `path_start`); characters do not climb the slope, they stop at the bottom and look up, or roll things down toward the camera. Great for races, kites, picnics (`picnic`) and rolling-ball gags.
