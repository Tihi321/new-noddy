import Phaser from 'phaser'
import { STATE_ICON, isLocalModel, roleColor, shortModel, type AgentView } from '../store/model'
import type { ToyState } from '../store/store'

export const FONT_DISPLAY = 'Fredoka, "Baloo 2", system-ui, sans-serif'
export const FONT_BODY = 'Nunito, "Segoe UI", system-ui, sans-serif'

const INK = 0x4a2f1b
const SKIN = 0xf3cfa4

/**
 * Renders a finished Graphics once into a texture and returns an Image that shows it. Static parts of a figure
 * (body, head, desk) are baked this way, because a Graphics replays all its drawing commands on every frame.
 * The Graphics is drawn around (0, 0); `ox`, `oy` is where (0, 0) lies inside the `w` x `h` texture.
 */
export function bake(scene: Phaser.Scene, key: string, w: number, h: number, ox: number, oy: number, g: Phaser.GameObjects.Graphics): Phaser.GameObjects.Image {
  if (!scene.textures.exists(key)) {
    const rt = scene.make.renderTexture({ width: w, height: h }, false)
    rt.draw(g, ox, oy)
    rt.saveTexture(key)
  }
  g.destroy()
  return scene.add.image(0, 0, key).setOrigin(ox / w, oy / h)
}

function hex(c: string): number {
  return Phaser.Display.Color.HexStringToColor(c).color
}

function shade(c: number, amount: number): number {
  const col = Phaser.Display.Color.IntegerToColor(c)
  return amount >= 0 ? col.clone().lighten(amount).color : col.clone().darken(-amount).color
}

export function text(scene: Phaser.Scene, x: number, y: number, s: string, size: number, color: string, family = FONT_BODY, bold = true): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, s, { fontFamily: family, fontSize: `${size}px`, color, fontStyle: bold ? '700' : '400', resolution: 2 })
    .setOrigin(0.5)
}

const VERB: Record<string, string> = {
  brief: 'planning the brief',
  outline: 'writing the outline',
  script: 'writing script',
  review: 'reviewing script',
  rewrite: 'rewriting',
  cast: 'designing the cast',
  sets: 'designing sets',
  shots: 'planning shots',
  actions: 'animating',
  music: 'composing a tune',
  sfx: 'picking sound effects',
  qa: 'checking everything',
  build_puppet: 'building',
  build_set: 'building',
  voice_lines: 'mumbling lines',
  compile_tracks: 'compiling tracks',
  mix_audio: 'mixing sound',
  preview_shot: 'previewing',
  render_shot: 'rendering',
  edit_episode: 'editing the episode'
}

/** "writing script...", "rendering shot-07 42/144". */
export function taskText(a: AgentView, progress?: { label: string; done: number; total: number }): string {
  if (a.state === 'idle') return ''
  if (a.state === 'paused') return 'paused'
  if (a.state === 'waiting-provider') return a.task && a.task !== 'loading model...' ? `waiting: ${a.task}` : 'waiting for the model'
  const task = a.task ?? ''
  const [first = '', ...rest] = task.split(/\s+/)
  const verb = VERB[first.replace(/^fix_/, '')] ?? first
  if (progress && progress.total > 0) return `${verb} ${progress.label} ${progress.done}/${progress.total}`
  const unit = rest.join(' ')
  return unit ? `${verb} ${unit}...` : `${verb}...`
}

const TOOL_EMBLEM: Record<string, string> = {
  puppet_workshop: '🔧',
  animation_compiler: '⏱️',
  foley_booth: '🎵',
  render_farm: '🎞️',
  preview_crew: '▶️',
  editor: '✂️'
}

/** One crew member: a toy puppet (or a tin robot for tool crews) at a desk, with bubble, badge and state icon. */
export class AgentSprite {
  readonly root: Phaser.GameObjects.Container
  private bob: Phaser.GameObjects.Container
  private armL: Phaser.GameObjects.Container
  private armR: Phaser.GameObjects.Container
  private key?: Phaser.GameObjects.Graphics
  private screen: Phaser.GameObjects.Graphics
  private lights: Phaser.GameObjects.Graphics
  private icon: Phaser.GameObjects.Text
  private iconBg: Phaser.GameObjects.Graphics
  private bubble: Phaser.GameObjects.Container
  private bubbleG: Phaser.GameObjects.Graphics
  private bubbleT: Phaser.GameObjects.Text
  private nameT: Phaser.GameObjects.Text
  private badgeG: Phaser.GameObjects.Graphics
  private badgeT: Phaser.GameObjects.Text
  private barG: Phaser.GameObjects.Graphics
  private ring: Phaser.GameObjects.Graphics
  private shadow: Phaser.GameObjects.Ellipse
  private lastBubble = '\u0000'
  private lastBadge = '\u0000'
  private bubbleW = 150
  private phase = Math.random() * 6.28
  private color: number
  private tool: boolean

  constructor(
    private scene: Phaser.Scene,
    readonly id: string,
    a: AgentView,
    onClick: (id: string, pointer: Phaser.Input.Pointer) => void
  ) {
    this.color = hex(roleColor(a.role))
    this.tool = a.kind === 'tool'
    this.root = scene.add.container(0, 0)
    this.shadow = scene.add.ellipse(0, 0, 70, 14, 0x000000, 0.18)
    this.ring = scene.add.graphics()
    this.bob = scene.add.container(0, 0)
    this.armL = scene.add.container(-19, -56)
    this.armR = scene.add.container(19, -56)

    const legs = scene.make.graphics({}, false)
    const body = scene.make.graphics({}, false)
    const head = scene.make.graphics({}, false)
    if (this.tool) this.drawRobot(legs, body, head, a.role)
    else this.drawPuppet(legs, body, head, a.role)
    const headPos = { x: head.x, y: head.y }
    head.setPosition(0, 0)
    const kind = `${this.tool ? 'robot' : 'puppet'}-${a.role}`
    const legsImg = bake(scene, `${kind}-legs`, 100, 100, 50, 80, legs)
    const bodyImg = bake(scene, `${kind}-body`, 100, 100, 50, 80, body)
    const headImg = bake(scene, `${kind}-head`, 130, 150, 65, 100, head).setPosition(headPos.x, headPos.y)
    const arms = (g: Phaser.GameObjects.Graphics, side: number) => {
      g.fillStyle(this.tool ? shade(this.color, -0.1) : this.color, 1).lineStyle(3, INK, 1)
      g.fillRoundedRect(-5 + side * 0, 0, 10, 26, 5).strokeRoundedRect(-5, 0, 10, 26, 5)
      g.fillStyle(this.tool ? 0xcfd6dc : SKIN, 1).fillCircle(0, 27, 6).strokeCircle(0, 27, 6)
    }
    const aL = scene.make.graphics({}, false)
    const aR = scene.make.graphics({}, false)
    arms(aL, -1)
    arms(aR, 1)
    this.armL.add(bake(scene, `arm-${kind}`, 40, 60, 20, 10, aL))
    this.armR.add(bake(scene, `arm-${kind}-r`, 40, 60, 20, 10, aR))
    this.bob.add([legsImg, bodyImg, this.armL, this.armR, headImg])
    if (this.tool) {
      this.key = scene.add.graphics()
      this.key.fillStyle(0xf0c040, 1).lineStyle(3, INK, 1)
      this.key.fillCircle(0, 0, 7).strokeCircle(0, 0, 7)
      this.key.fillRect(-14, -3, 28, 6)
      this.key.strokeRect(-14, -3, 28, 6)
      this.key.setPosition(-30, -62)
      this.bob.add(this.key)
      const emblem = text(scene, 0, -42, TOOL_EMBLEM[a.role] ?? '⚙️', 18, '#fff')
      this.bob.add(emblem)
    }

    // desk, in front of the figure
    const deskG = scene.make.graphics({}, false)
    deskG.fillStyle(0x000000, 0.15).fillRoundedRect(-52, 6, 108, 38, 8)
    deskG.fillStyle(0xd9a066, 1).lineStyle(4, INK, 1).fillRoundedRect(-54, -4, 108, 18, 7).strokeRoundedRect(-54, -4, 108, 18, 7)
    deskG.fillStyle(0xb57a45, 1).fillRoundedRect(-50, 14, 100, 24, 5).strokeRoundedRect(-50, 14, 100, 24, 5)
    deskG.fillStyle(0x8a5a2f, 1).fillRoundedRect(-14, 20, 28, 8, 4)
    const desk = bake(scene, 'desk', 130, 70, 65, 10, deskG)
    this.screen = scene.add.graphics()
    this.lights = scene.add.graphics()

    this.iconBg = scene.add.graphics()
    this.icon = text(scene, 34, -114, STATE_ICON[a.state], 16, '#fff')
    this.bubbleG = scene.add.graphics()
    this.bubbleT = text(scene, 0, 0, '', 12, '#4a2f1b', FONT_BODY)
    this.bubbleT.setAlign('center')
    this.bubble = scene.add.container(0, -128, [this.bubbleG, this.bubbleT])
    this.nameT = text(scene, 0, 44, a.name.replace(/^The /, ''), 13, '#4a2f1b', FONT_DISPLAY).setOrigin(0.5, 0)
    this.nameT.setWordWrapWidth(124, true).setAlign('center').setLineSpacing(-3)
    this.badgeG = scene.add.graphics()
    this.badgeT = text(scene, 0, 95, '', 11, '#ffffff')
    this.barG = scene.add.graphics()

    this.root.add([this.shadow, this.ring, this.bob, desk, this.screen, this.lights, this.nameT, this.badgeG, this.badgeT, this.barG, this.iconBg, this.icon, this.bubble])
    this.root.setSize(124, 280).setInteractive(new Phaser.Geom.Rectangle(-62, -150, 124, 280), Phaser.Geom.Rectangle.Contains)
    this.root.input!.cursor = 'pointer'
    this.root.on('pointerover', () => this.root.setScale(1.04))
    this.root.on('pointerout', () => this.root.setScale(1))
    this.root.on('pointerdown', (pointer: Phaser.Input.Pointer) => onClick(id, pointer))
    this.shadow.setPosition(0, -2)
  }

  private drawPuppet(legs: Phaser.GameObjects.Graphics, body: Phaser.GameObjects.Graphics, head: Phaser.GameObjects.Graphics, role: string): void {
    legs.fillStyle(shade(this.color, -0.25), 1).lineStyle(3, INK, 1)
    for (const x of [-9, 9]) legs.fillRoundedRect(x - 5, -26, 10, 26, 4).strokeRoundedRect(x - 5, -26, 10, 26, 4)
    legs.fillStyle(0x6b3f22, 1).fillRoundedRect(-16, -4, 14, 8, 4).fillRoundedRect(2, -4, 14, 8, 4)
    body.fillStyle(this.color, 1).lineStyle(3, INK, 1).fillRoundedRect(-18, -66, 36, 44, 12).strokeRoundedRect(-18, -66, 36, 44, 12)
    body.fillStyle(0xffffff, 0.35).fillRoundedRect(-12, -62, 8, 30, 4)
    body.fillStyle(0xfff3c4, 1).fillCircle(0, -48, 3).fillCircle(0, -38, 3)
    head.setPosition(0, -86)
    head.fillStyle(SKIN, 1).lineStyle(3, INK, 1).fillCircle(0, 0, 19).strokeCircle(0, 0, 19)
    head.fillStyle(0xff9a8a, 0.6).fillCircle(-12, 5, 4).fillCircle(12, 5, 4)
    head.fillStyle(INK, 1).fillCircle(-6, -2, 2.4).fillCircle(6, -2, 2.4)
    head.lineStyle(2, INK, 1).beginPath().arc(0, 3, 6, 0.25, Math.PI - 0.25).strokePath()
    this.drawHat(head, role)
  }

  private drawHat(g: Phaser.GameObjects.Graphics, role: string): void {
    const c = this.color
    g.lineStyle(3, INK, 1)
    switch (role) {
      case 'producer':
        g.fillStyle(0x2d2d3a, 1).fillRoundedRect(-14, -40, 28, 24, 3).strokeRoundedRect(-14, -40, 28, 24, 3)
        g.fillStyle(0x2d2d3a, 1).fillRoundedRect(-22, -19, 44, 7, 3).strokeRoundedRect(-22, -19, 44, 7, 3)
        g.fillStyle(c, 1).fillRect(-14, -26, 28, 6)
        break
      case 'screenwriter':
        g.fillStyle(c, 1).fillEllipse(-2, -19, 40, 16).strokeEllipse(-2, -19, 40, 16)
        g.fillStyle(c, 1).fillCircle(-2, -29, 3.5)
        break
      case 'story_editor':
        g.fillStyle(0xe8e0d4, 1).fillCircle(0, -22, 12).strokeCircle(0, -22, 12)
        g.lineStyle(2.5, INK, 1).strokeCircle(-7, -2, 6.5).strokeCircle(7, -2, 6.5).lineBetween(-1, -2, 1, -2)
        break
      case 'character_designer':
        g.fillStyle(c, 1).fillTriangle(-3, -20, -22, -34, -22, -10).fillTriangle(3, -20, 22, -34, 22, -10)
        g.strokeTriangle(-3, -20, -22, -34, -22, -10).strokeTriangle(3, -20, 22, -34, 22, -10)
        g.fillStyle(0xffd0dc, 1).fillCircle(0, -20, 6).strokeCircle(0, -20, 6)
        break
      case 'set_designer':
        g.fillStyle(c, 1).fillTriangle(-17, -12, 17, -12, 4, -52).strokeTriangle(-17, -12, 17, -12, 4, -52)
        g.fillStyle(0xfff3c4, 1).fillCircle(4, -52, 4)
        break
      case 'director':
        g.fillStyle(c, 1).fillRoundedRect(-18, -30, 36, 18, 8).strokeRoundedRect(-18, -30, 36, 18, 8)
        g.fillStyle(shade(c, -0.2), 1).fillRoundedRect(8, -16, 24, 6, 3).strokeRoundedRect(8, -16, 24, 6, 3)
        break
      case 'animator':
        g.fillStyle(c, 1).fillTriangle(-17, -10, 17, -10, 22, -38).strokeTriangle(-17, -10, 17, -10, 22, -38)
        g.fillStyle(0xffffff, 1).fillCircle(22, -40, 6).strokeCircle(22, -40, 6)
        break
      case 'composer':
        g.fillStyle(c, 1).fillTriangle(-17, -10, 17, -10, -14, -38).strokeTriangle(-17, -10, 17, -10, -14, -38)
        g.fillStyle(0xfff0a0, 1).fillCircle(-15, -40, 6).strokeCircle(-15, -40, 6)
        break
      case 'sound_designer':
        g.lineStyle(5, INK, 1).beginPath().arc(0, -2, 22, Math.PI, 0).strokePath()
        g.fillStyle(c, 1).lineStyle(3, INK, 1).fillRoundedRect(-27, -8, 10, 18, 4).strokeRoundedRect(-27, -8, 10, 18, 4).fillRoundedRect(17, -8, 10, 18, 4).strokeRoundedRect(17, -8, 10, 18, 4)
        break
      case 'qa':
        g.fillStyle(c, 1).fillRoundedRect(-17, -32, 34, 20, 6).strokeRoundedRect(-17, -32, 34, 20, 6)
        g.fillStyle(0x222233, 1).fillRoundedRect(-22, -14, 44, 6, 3).strokeRoundedRect(-22, -14, 44, 6, 3)
        g.fillStyle(0xf0c040, 1).fillCircle(0, -23, 4.5)
        break
      default:
        g.fillStyle(c, 1).fillEllipse(0, -18, 36, 14).strokeEllipse(0, -18, 36, 14)
    }
  }

  private drawRobot(legs: Phaser.GameObjects.Graphics, body: Phaser.GameObjects.Graphics, head: Phaser.GameObjects.Graphics, _role: string): void {
    legs.fillStyle(0x6a6f78, 1).lineStyle(3, INK, 1)
    for (const x of [-13, 13]) {
      legs.fillCircle(x, -9, 10).strokeCircle(x, -9, 10)
      legs.fillStyle(0xcfd6dc, 1).fillCircle(x, -9, 4).fillStyle(0x6a6f78, 1)
    }
    body.fillStyle(this.color, 1).lineStyle(3, INK, 1).fillRoundedRect(-22, -68, 44, 52, 8).strokeRoundedRect(-22, -68, 44, 52, 8)
    body.fillStyle(0xffffff, 0.3).fillRect(-18, -64, 8, 40)
    body.fillStyle(0xfff3d6, 1).fillRoundedRect(-14, -56, 28, 24, 6).strokeRoundedRect(-14, -56, 28, 24, 6)
    head.setPosition(0, -86)
    head.fillStyle(0xcfd6dc, 1).lineStyle(3, INK, 1).fillRoundedRect(-19, -15, 38, 30, 7).strokeRoundedRect(-19, -15, 38, 30, 7)
    head.fillStyle(this.color, 1).fillRect(-19, -15, 38, 7)
    head.fillStyle(0x222222, 1).fillRect(-11, -3, 7, 7).fillRect(4, -3, 7, 7)
    head.lineStyle(2, INK, 1).lineBetween(-8, 9, 8, 9)
    head.lineStyle(3, INK, 1).lineBetween(0, -15, 0, -28)
    head.fillStyle(0xe8504a, 1).fillCircle(0, -30, 5).strokeCircle(0, -30, 5)
  }

  place(x: number, y: number): void {
    this.root.setPosition(x, y + 216)
  }

  private bubbleBox(s: string): void {
    this.bubbleT.setText(s)
    this.bubbleT.setWordWrapWidth(this.bubbleW - 14, true)
    const w = Math.min(this.bubbleW, Math.max(56, this.bubbleT.width + 18))
    const h = this.bubbleT.height + 14
    this.bubbleG.clear()
    this.bubbleG.fillStyle(0x000000, 0.12).fillRoundedRect(-w / 2 + 2, -h + 4, w, h, 10)
    this.bubbleG.fillStyle(0xfffaf0, 1).lineStyle(3, INK, 1).fillRoundedRect(-w / 2, -h, w, h, 10).strokeRoundedRect(-w / 2, -h, w, h, 10)
    this.bubbleG.fillTriangle(-6, -1, 6, -1, 0, 9).lineStyle(3, INK, 1).lineBetween(-6, -1, 0, 9).lineBetween(6, -1, 0, 9)
    this.bubbleG.fillStyle(0xfffaf0, 1).fillRect(-5, -4, 10, 5)
    this.bubbleT.setPosition(0, -h / 2)
  }

  /** `tool` agents show render progress below the desk. */
  update(t: number, a: AgentView, s: ToyState, selected: boolean, progress: { label: string; done: number; total: number } | undefined): void {
    const state = a.state
    const working = state === 'working' || state === 'reviewing'
    const ph = t / 1000 + this.phase
    // body motion by state
    const speed = working ? 9 : state === 'waiting-provider' ? 2.5 : 1.6
    const amp = working ? 3 : state === 'idle' ? 1.2 : 1.8
    this.bob.y = state === 'paused' ? 0 : Math.sin(ph * speed) * amp
    this.bob.x = state === 'error' ? Math.sin(ph * 40) * 2.5 : state === 'waiting-provider' ? Math.sin(ph * 2.5) * 3 : 0
    this.bob.rotation = state === 'idle' ? Math.sin(ph * 1.2) * 0.02 : state === 'waiting-provider' ? Math.sin(ph * 2.5) * 0.05 : 0
    if (working) {
      this.armL.rotation = -0.5 + Math.sin(ph * 9) * 0.5
      this.armR.rotation = 0.5 + Math.sin(ph * 9 + 2) * 0.5
    } else if (state === 'error') {
      this.armL.rotation = -2.4 + Math.sin(ph * 14) * 0.2
      this.armR.rotation = 2.4 - Math.sin(ph * 14) * 0.2
    } else {
      this.armL.rotation = Math.sin(ph * 1.5) * 0.05
      this.armR.rotation = -Math.sin(ph * 1.5) * 0.05
    }
    this.bob.setAlpha(state === 'paused' ? 0.55 : state === 'idle' ? 0.92 : 1)
    if (this.key) this.key.rotation = working ? ph * 6 : state === 'idle' ? ph * 0.5 : 0

    // desk screen and lights
    this.screen.clear()
    this.lights.clear()
    if (this.tool) {
      for (let i = 0; i < 4; i++) {
        const on = working && Math.sin(ph * 6 + i * 1.7) > 0
        this.lights.fillStyle(on ? 0x7cff7c : 0x556655, 1).fillCircle(-30 + i * 14, 4, 3.5)
      }
    } else {
      this.screen.fillStyle(0xf8f2e0, 1).lineStyle(3, INK, 1).fillRoundedRect(-22, -22, 44, 30, 4).strokeRoundedRect(-22, -22, 44, 30, 4)
      this.screen.fillStyle(0xd4cbb8, 1).fillRect(-30, 6, 60, 4)
      for (let i = 0; i < 4; i++) {
        const w = working ? 10 + ((Math.floor(ph * 3) * 7 + i * 13) % 22) : 18 - i * 3
        this.screen.fillStyle(working ? this.color : 0xb8ae98, 1).fillRect(-17, -17 + i * 6, w, 3)
      }
    }

    // state icon
    const err = state === 'error'
    this.iconBg.clear()
    this.iconBg.fillStyle(err ? 0xffd9d4 : state === 'paused' ? 0xe8e4dc : working ? 0xfff0b8 : 0xfffaf0, 1).lineStyle(3, INK, 1)
    this.iconBg.fillCircle(34, -114, 14).strokeCircle(34, -114, 14)
    this.icon.setText(a.kind === 'tool' && working ? '⚙️' : STATE_ICON[state])
    this.icon.setPosition(34, -114 + (state === 'idle' ? Math.sin(ph * 1.5) * 2 : 0))
    this.icon.setRotation(a.kind === 'tool' && working ? ph * 4 : 0)

    // bubble
    const msg = taskText(a, progress)
    if (msg !== this.lastBubble) {
      this.lastBubble = msg
      if (msg) this.bubbleBox(msg)
      this.bubble.setVisible(!!msg)
    }
    this.bubble.y = -146 + (working ? Math.sin(ph * 3) * 1.5 : 0)

    // model badge
    const model = a.resolvedModel
    const local = isLocalModel(model, s.models)
    const label = a.kind === 'tool' ? 'TOOL CREW' : model ? `${local ? 'LOCAL' : 'API'} ${shortModel(model)}` : 'NO MODEL'
    if (label !== this.lastBadge) {
      this.lastBadge = label
      this.badgeT.setText(label)
      const w = this.badgeT.width + 16
      this.badgeG.clear()
      const fill = a.kind === 'tool' ? 0x6b7f8c : !model ? 0x9a8a78 : local ? 0x4f9a4a : 0xe0782c
      this.badgeG.fillStyle(fill, 1).lineStyle(3, INK, 1).fillRoundedRect(-w / 2, 85, w, 20, 10).strokeRoundedRect(-w / 2, 85, w, 20, 10)
      this.badgeT.setPosition(0, 95)
    }

    // progress bar for tool jobs
    this.barG.clear()
    if (progress && progress.total > 0 && (working || state === 'waiting-provider')) {
      const f = Math.min(1, progress.done / progress.total)
      this.barG.fillStyle(0xfffaf0, 1).lineStyle(3, INK, 1).fillRoundedRect(-52, 109, 104, 14, 7).strokeRoundedRect(-52, 109, 104, 14, 7)
      if (f > 0.02) this.barG.fillStyle(0x4fb04a, 1).fillRoundedRect(-49, 112, Math.max(8, 98 * f), 8, 4)
    }
    this.ring.clear()
    if (selected) this.ring.lineStyle(4, 0xe8504a, 1).strokeRoundedRect(-62, -150, 124, 288, 16)
    this.root.setAlpha(1)
  }
}
