extends Node3D
## Toybox Studio animatic preview.
##   godot --path godot/preview [--write-movie out.avi --fixed-fps 12 --resolution 640x360] -- \
##         --tracks t.json --set s.glb --puppet tock=tock.glb [--thumb out.png] [--frame N] [--sky #rrggbb]
## Movie mode (--write-movie): one track frame per rendered frame, then quits. --thumb: renders one frame to PNG, quits.
## Otherwise: interactive window with play/pause, scrub slider, frame counter and shot name.

const TrackPlayer = preload("res://track_player.gd")
var player := TrackPlayer.new()
var args := {}
var puppets := {}
var movie_mode := false
var thumb_path := ""
var thumb_frame := -1
var cur := 0
var playing := true
var acc := 0.0
var wait_frames := 0
var finishing := false
var slider: HSlider
var frame_label: Label
var play_button: Button

func _parse_args() -> void:
	var a := OS.get_cmdline_user_args()
	var i := 0
	args["puppet"] = {}
	while i < a.size():
		var k: String = a[i]
		if k.begins_with("--") and i + 1 < a.size():
			var v: String = a[i + 1]
			if k == "--puppet":
				var eq := v.find("=")
				if eq > 0:
					args["puppet"][v.substr(0, eq)] = v.substr(eq + 1)
			else:
				args[k.substr(2)] = v
			i += 2
		else:
			i += 1

func _ready() -> void:
	_parse_args()
	movie_mode = Engine.get_write_movie_path() != ""
	thumb_path = str(args.get("thumb", ""))
	if not args.has("tracks") or not player.load_tracks(str(args["tracks"])):
		push_error("--tracks <file> is missing or invalid")
		get_tree().quit(2)
		return
	_build_environment()
	var cam := Camera3D.new()
	cam.name = "ShotCamera"
	cam.keep_aspect = Camera3D.KEEP_WIDTH # fov is horizontal, like Blender's 36 mm sensor width
	cam.current = true
	add_child(cam)
	player.camera = cam
	if args.has("set"):
		var s := _load_glb(str(args["set"]))
		if s != null:
			s.name = "Set"
			add_child(s)
	for id in args["puppet"].keys():
		var p := _load_glb(str(args["puppet"][id]))
		if p == null:
			continue
		p.name = "puppet_" + str(id).replace(".", "_")
		add_child(p)
		player.register_puppet(str(id), p)
		puppets[id] = p
	for want in player.tracks.get("cast", []):
		if not puppets.has(want):
			push_warning("no glb for cast member " + str(want))
	if args.has("frame"):
		thumb_frame = int(args["frame"])
	elif thumb_path != "":
		thumb_frame = player.frames / 2
	player.apply_frame(0 if thumb_frame < 0 else thumb_frame)
	if not movie_mode and thumb_path == "":
		_build_ui()
	if args.has("dump"):
		_dump(thumb_frame if thumb_frame >= 0 else 0)
		return
	print("[preview] shot=%s frames=%d fps=%s puppets=%s missing=%s" % [player.shot_id, player.frames, player.fps, puppets.keys(), player.missing])

func _build_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.html(str(args.get("sky", "#a9d2f2")))
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(1.0, 0.96, 0.9)
	env.ambient_light_energy = 0.45
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.name = "Key"
	sun.light_color = Color(1.0, 0.89, 0.72)
	sun.light_energy = 0.95
	sun.shadow_enabled = true
	sun.rotation_degrees = Vector3(-50, 35, 0)
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.name = "Fill"
	fill.light_color = Color(0.72, 0.83, 1.0)
	fill.light_energy = 0.25
	fill.rotation_degrees = Vector3(-30, -140, 0)
	add_child(fill)

## Debug: prints the global position of every object at one frame (compare with Blender matrix_world), then quits.
func _dump(f: int) -> void:
	player.apply_frame(f)
	for k in player.nodes.keys():
		var n: Node3D = player.nodes[k]
		var p := n.global_position
		print("DUMP %s %.4f %.4f %.4f" % [k, p.x, p.y, p.z])
	get_tree().quit()

func _strip_extras(n: Node) -> void:
	for c in n.get_children():
		if c is Camera3D or c is Light3D:
			n.remove_child(c)
			c.queue_free()
		else:
			_strip_extras(c)

func _load_glb(path: String) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(path, state)
	if err != OK:
		push_error("cannot load glb (%d): %s" % [err, path])
		return null
	var root := doc.generate_scene(state)
	if root == null or not (root is Node3D):
		push_error("glb has no 3D scene: " + path)
		return null
	_strip_extras(root)
	_fix_materials(root)
	return root as Node3D

## Toykit "wood"/"felt" surfaces are node groups that the glTF exporter cannot turn into a base colour, but the material
## name carries it ("wood_#d33b2c"). White, untextured materials get that colour. The preview is only a blocking pass.
var _hex_re := RegEx.create_from_string("#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})")

func _fix_materials(n: Node) -> void:
	if n is MeshInstance3D and n.mesh != null:
		for i in n.mesh.get_surface_count():
			var m: Material = n.mesh.surface_get_material(i)
			if m is StandardMaterial3D and m.albedo_texture == null and m.albedo_color.is_equal_approx(Color.WHITE):
				var hit := _hex_re.search(m.resource_name)
				if hit != null:
					m.albedo_color = Color.html("#" + hit.get_string(1))
	for c in n.get_children():
		_fix_materials(c)

# ---- playback ----

func _process(delta: float) -> void:
	if thumb_path != "":
		_process_thumb()
		return
	if movie_mode:
		# one track frame per rendered frame; the extra last call only quits (the encoder trims by frame count)
		if cur >= player.frames:
			get_tree().quit()
			return
		player.apply_frame(cur)
		cur += 1
		return
	if playing:
		acc += delta * player.fps
		var step := int(acc)
		if step > 0:
			acc -= step
			cur = (cur + step) % player.frames
			player.apply_frame(cur)
			_sync_ui()

func _process_thumb() -> void:
	wait_frames += 1
	if wait_frames < 4 or finishing:
		return
	finishing = true
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var e := img.save_png(thumb_path)
	if e != OK:
		push_error("cannot write thumbnail: " + thumb_path)
	get_tree().quit(0 if e == OK else 3)

# ---- interactive UI ----

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	layer.add_child(panel)
	var row := HBoxContainer.new()
	panel.add_child(row)
	play_button = Button.new()
	play_button.text = "Pause"
	play_button.pressed.connect(_toggle_play)
	row.add_child(play_button)
	slider = HSlider.new()
	slider.min_value = 0
	slider.max_value = max(player.frames - 1, 1)
	slider.step = 1
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.custom_minimum_size = Vector2(200, 24)
	slider.value_changed.connect(_on_scrub)
	row.add_child(slider)
	frame_label = Label.new()
	row.add_child(frame_label)
	_sync_ui()

func _toggle_play() -> void:
	playing = not playing
	play_button.text = "Pause" if playing else "Play"

func _on_scrub(v: float) -> void:
	if int(v) == cur:
		return
	playing = false
	play_button.text = "Play"
	cur = int(v)
	acc = 0.0
	player.apply_frame(cur)
	_sync_ui()

func _sync_ui() -> void:
	frame_label.text = " %s  frame %d / %d  (%.1f s)" % [player.shot_id, cur + 1, player.frames, cur / player.fps]
	slider.set_value_no_signal(cur)

func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and play_button != null:
		if ev.keycode == KEY_SPACE:
			_toggle_play()
		elif ev.keycode == KEY_LEFT:
			slider.value = max(cur - 1, 0)
		elif ev.keycode == KEY_RIGHT:
			slider.value = min(cur + 1, player.frames - 1)
		elif ev.keycode == KEY_ESCAPE:
			get_tree().quit()
