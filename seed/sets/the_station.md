---
id: the_station
name: The Station
size: [12, 8]
ground: sand
backdrop: sky_sunset
lighting: evening
props:
  - { kind: station, pos: [0, 3.4], rot: 0, scale: 1.2, color: "#e9d5a1", accent: "#2f6db5", variant: 0, id: station }
  - { kind: lamp_post, pos: [-4.6, 0.8], rot: 0, scale: 1.0, color: "#2c2c34", accent: "#ffd27a", variant: 0, id: lamp_left }
  - { kind: lamp_post, pos: [4.6, 0.8], rot: 0, scale: 1.0, color: "#2c2c34", accent: "#ffd27a", variant: 0, id: lamp_right }
  - { kind: bench, pos: [-2.6, 1.55], rot: 0, scale: 1.0, color: "#b8793c", accent: "#3b3b44", variant: 0, id: bench }
  - { kind: signpost, pos: [5.4, -0.4], rot: 0, scale: 1.0, color: "#c9955a", accent: "#e8e0c8", variant: 0, id: signpost }
  - { kind: tree_pine, pos: [-5.8, 3.4], rot: 0, scale: 1.2, color: "#2f8f4e", accent: "#ffd400", variant: 0, id: pine_a }
  - { kind: bush, pos: [5.6, 3.6], rot: 0, scale: 1.1, color: "#4ea84a", accent: "#e8436b", variant: 0, id: bush_a }
  - { kind: cloud, pos: [-3.0, 6.0], rot: 0, scale: 1.4, color: "#ffd2c0", accent: "#ffe9e0", variant: 1, id: cloud_a }
marks:
  center: [0, -0.6]
  platform: [0, 1.7]
  platform_left: [-2.4, 1.7]
  platform_right: [2.4, 1.7]
  ticket_door: [0, 2.3]
  track: [0, 0.4]
  bench: [-2.6, 1.0]
  left: [-4.5, -0.5]
  right: [4.5, -0.5]
---
A little sandy railway station at sunset. The station building has a clock tower, a striped platform canopy and a bench, and in front of the platform runs a short stretch of track (`track`) where the toy train rolls in and out. Warm lamp posts glow on either side. Characters wait on the `platform`, buy tickets at `ticket_door`, and wave goodbye as the train leaves. Mood: golden, gentle, a bit sleepy, good for farewells and arrivals.
