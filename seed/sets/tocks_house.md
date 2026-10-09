---
id: tocks_house
name: Tock's House
size: [12, 8]
ground: grass
backdrop: sky_day
lighting: day
props:
  - { kind: house, pos: [0, 2.4], rot: 0, scale: 1.4, color: "#f2a65a", accent: "#2f6db5", variant: 1, id: tocks_house }
  - { kind: fence, pos: [-3.2, 0.2], rot: 0, scale: 1.2, color: "#f6f1e6", accent: "#c9a36a", variant: 0, id: fence_left }
  - { kind: fence, pos: [3.2, 0.2], rot: 0, scale: 1.2, color: "#f6f1e6", accent: "#c9a36a", variant: 0, id: fence_right }
  - { kind: gate, pos: [0, 0.1], rot: 0, scale: 1.0, color: "#f6f1e6", accent: "#c9a36a", variant: 0, id: garden_gate }
  - { kind: tree_lollipop, pos: [-5.0, 2.8], rot: 0, scale: 1.2, color: "#5db24a", accent: "#ff7ab0", variant: 0, id: apple_tree }
  - { kind: tree_pine, pos: [5.2, 3.0], rot: 0, scale: 1.1, color: "#2f8f4e", accent: "#ffd400", variant: 0, id: pine }
  - { kind: mailbox, pos: [2.0, -0.8], rot: 0, scale: 1.0, color: "#d33b2c", accent: "#ffd400", variant: 0, id: mailbox }
  - { kind: flower_patch, pos: [-1.8, 0.9], rot: 0, scale: 1.3, color: "#ff6b9a", accent: "#ffd400", variant: 0, id: flowers_a }
  - { kind: flower_patch, pos: [1.8, 1.0], rot: 0, scale: 1.3, color: "#ffb347", accent: "#ffffff", variant: 1, id: flowers_b }
  - { kind: bush, pos: [-2.0, 3.3], rot: 0, scale: 1.0, color: "#4ea84a", accent: "#e8436b", variant: 0, id: bush_a }
  - { kind: bush, pos: [2.2, 3.3], rot: 0, scale: 1.0, color: "#58b455", accent: "#ffd400", variant: 0, id: bush_b }
  - { kind: road, pos: [-3, -2.6], rot: 0, scale: 1.0, color: "#5b5b66", accent: "#ffd400", variant: 0, id: road_left }
  - { kind: road, pos: [3, -2.6], rot: 0, scale: 1.0, color: "#5b5b66", accent: "#ffd400", variant: 0, id: road_right }
  - { kind: cloud, pos: [-3.0, 6.0], rot: 0, scale: 1.2, color: "#ffffff", accent: "#e8f0ff", variant: 2, id: cloud_a }
marks:
  center: [0, -0.4]
  door: [0, 0.2]
  garden: [-2.6, 0.2]
  garden_right: [2.6, 0.2]
  road_left: [-5, -2.6]
  road_right: [5, -2.6]
  mailbox: [2.0, -1.3]
  tree: [-4.2, 1.8]
---
Tock's little orange house with a blue roof, a white picket fence, a garden gate and a mailbox at the front. Flowers grow either side of the path, an apple-blossom tree stands on the left and a pine on the right. A road runs along the front of the set: Tock parks his yellow van there (`road_left` and `road_right` are the places to drive in and out). The gate at `door` opens onto the front step. Mood: homey, safe, morning light.
