extends RefCounted
## Applies compiled tracks (docs/contracts.md, "Tracks") to loaded glTF scenes and a camera.
##
## Coordinates: tracks are Blender Z-up, rotations in degrees, XYZ Euler. Godot is Y-up.
## Blender (x, y, z) -> Godot (x, z, -y). A rotation by `a` around Blender axis `v` is a rotation by `a`
## around Godot axis conv(v), so a Blender XYZ Euler (R = Rz * Ry * Rx) becomes Bz * By * Bx with the axes converted.
## Names: the glTF importer turns '.' in node names into '_' ("tock.head" -> "tock_head"), so every name is normalised
## ('.' -> '_') on both sides. Lookups are done inside each puppet's own subtree.

const SENSOR_WIDTH_MM := 36.0

var tracks: Dictionary = {}
var frames: int = 0
var fps: float = 12.0
var shot_id: String = ""
var camera: Camera3D
## normalised object name -> Node3D
var nodes: Dictionary = {}
## actor id -> [Node3D mouth_0, mouth_1, mouth_2]
var mouths: Dictionary = {}
var missing: Array = []
## normalised object name -> {pos: Vector3 (Godot), euler: Vector3 (Blender degrees XYZ)} of the rest pose
var rest: Dictionary = {}

static func norm(n: String) -> String:
	return n.replace(".", "_")

static func conv_pos(v: Array) -> Vector3:
	return Vector3(float(v[0]), float(v[2]), -float(v[1]))

static func conv_rot(deg: Array) -> Basis:
	var bx := Basis(Vector3(1, 0, 0), deg_to_rad(float(deg[0])))
	var by := Basis(Vector3(0, 0, -1), deg_to_rad(float(deg[1])))
	var bz := Basis(Vector3(0, 1, 0), deg_to_rad(float(deg[2])))
	return bz * by * bx

## Rest rotation of a node as a Blender XYZ Euler in degrees (the inverse of conv_rot).
static func blender_euler_deg(n: Node3D) -> Vector3:
	var c := Basis(Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0))
	var bb := c.inverse() * Basis(n.quaternion) * c
	var e := bb.get_euler(EULER_ORDER_ZYX)
	return Vector3(rad_to_deg(e.x), rad_to_deg(e.y), rad_to_deg(e.z))

static func hfov_deg(lens_mm: float) -> float:
	return rad_to_deg(2.0 * atan(SENSOR_WIDTH_MM * 0.5 / maxf(lens_mm, 1.0)))

func load_tracks(path: String) -> bool:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("cannot read tracks: " + path)
		return false
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("tracks are not a JSON object: " + path)
		return false
	tracks = parsed
	frames = int(tracks.get("frames", 0))
	fps = float(tracks.get("fps", 12))
	shot_id = str(tracks.get("shotId", ""))
	return frames > 0

func _index(n: Node, into: Dictionary) -> void:
	if n is Node3D:
		into[norm(String(n.name))] = n
	for c in n.get_children():
		_index(c, into)

## Registers a loaded puppet scene. Its nodes are found by contract names ("<id>", "<id>.head", ...).
func register_puppet(id: String, scene_root: Node3D) -> void:
	var local := {}
	_index(scene_root, local)
	var prefix := norm(id)
	for k in local.keys():
		if k == prefix or k.begins_with(prefix + "_"):
			nodes[k] = local[k]
			rest[k] = {"pos": local[k].position, "euler": blender_euler_deg(local[k])}
	if not nodes.has(prefix):
		nodes[prefix] = scene_root
		rest[prefix] = {"pos": scene_root.position, "euler": blender_euler_deg(scene_root)}
	var ms: Array = []
	for i in 3:
		ms.append(local.get(prefix + "_mouth_" + str(i), null))
	mouths[id] = ms

func find_node3d(obj_name: String) -> Node3D:
	return nodes.get(norm(obj_name), null)

func _frame_value(arr: Array, f: int) -> Variant:
	if arr.is_empty():
		return null
	return arr[clampi(f, 0, arr.size() - 1)]

func apply_frame(f: int) -> void:
	f = clampi(f, 0, frames - 1)
	var objects: Dictionary = tracks.get("objects", {})
	for obj_name in objects.keys():
		var n: Node3D = find_node3d(obj_name)
		var ch: Dictionary = objects[obj_name]
		if n == null:
			if not missing.has(obj_name):
				missing.append(obj_name)
			continue
		# every channel is an offset from the rest pose (root loc/rot have rest 0, so they are absolute), like blender/toykit/render.py
		var rst: Dictionary = rest.get(norm(obj_name), {"pos": Vector3.ZERO, "euler": Vector3.ZERO})
		if ch.has("loc"):
			var l: Variant = _frame_value(ch["loc"], f)
			if l != null:
				n.position = rst["pos"] + conv_pos(l)
		if ch.has("rot"):
			var r: Variant = _frame_value(ch["rot"], f)
			if r != null:
				var e: Vector3 = rst["euler"]
				n.quaternion = conv_rot([e.x + float(r[0]), e.y + float(r[1]), e.z + float(r[2])]).get_rotation_quaternion()
	var mt: Dictionary = tracks.get("mouths", {})
	for id in mt.keys():
		var shapes: Array = mouths.get(id, [])
		var v: Variant = _frame_value(mt[id], f)
		if v == null or shapes.is_empty():
			continue
		var idx := clampi(int(v), 0, 2)
		for i in shapes.size():
			if shapes[i] != null:
				shapes[i].visible = (i == idx)
	var cam: Dictionary = tracks.get("camera", {})
	if camera != null and cam.has("loc") and cam.has("target"):
		var loc: Variant = _frame_value(cam["loc"], f)
		var tgt: Variant = _frame_value(cam["target"], f)
		if loc != null and tgt != null:
			var p := conv_pos(loc)
			var t := conv_pos(tgt)
			if p.distance_to(t) > 0.0001:
				camera.look_at_from_position(p, t, Vector3.UP)
		if cam.has("lens"):
			var lens: Variant = _frame_value(cam["lens"], f)
			if lens != null:
				camera.fov = hfov_deg(float(lens))
