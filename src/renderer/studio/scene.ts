import Phaser from 'phaser'
import { handoverAlpha, roomLabel, type AgentView } from '../store/model'
import { toyStore } from '../store/store'
import { H, W, computeLayout, type RoomBox } from './layout'
import { AgentSprite, FONT_DISPLAY, text } from './sprites'

const INK = 0x4a2f1b

const PALETTE: Record<string, { wall: number; floor: number; plank: number }> = {
  writers_room: { wall: 0xf8dc9c, floor: 0xcf9a62, plank: 0xb98350 },
  art_dept: { wall: 0xfbc9d2, floor: 0xd8a56c, plank: 0xc08f58 },
  stage: { wall: 0xcbb8f0, floor: 0xb98a5a, plank: 0xa17548 },
  sound_booth: { wall: 0xbfe6d6, floor: 0xcc9a64, plank: 0xb5854f },
  workshop: { wall: 0xf3c68c, floor: 0xc59158, plank: 0xae7c48 },
  render_farm: { wall: 0xc9dcf6, floor: 0xc4a074, plank: 0xab8861 },
  edit_suite: { wall: 0xeed6b4, floor: 0xc99d68, plank: 0xb28750 }
}

type Gfx = Phaser.GameObjects.Graphics

function decorate(g: Gfx, id: string, x: number, y: number, w: number): void {
  const L = x + 20
  const R = x + w - 20
  g.lineStyle(3, INK, 1)
  switch (id) {
    case 'writers_room': {
      g.fillStyle(0xa86a3c, 1).fillRoundedRect(L, y + 46, 70, 62, 4).strokeRoundedRect(L, y + 46, 70, 62, 4)
      const cols = [0xd9503f, 0x3f72d6, 0xe8b800, 0x74b83c, 0x8c63d4, 0xf0709c]
      cols.forEach((c, i) => g.fillStyle(c, 1).fillRect(L + 5 + i * 10, y + 51, 8, 20).fillRect(L + 5 + i * 10, y + 79, 8, 24))
      g.fillStyle(0xfffaf0, 1).fillCircle(R - 16, y + 70, 20).strokeCircle(R - 16, y + 70, 20)
      g.lineBetween(R - 16, y + 70, R - 16, y + 56).lineBetween(R - 16, y + 70, R - 6, y + 74)
      break
    }
    case 'art_dept': {
      g.fillStyle(0xfffaf0, 1).fillRect(L + 6, y + 48, 48, 40).strokeRect(L + 6, y + 48, 48, 40)
      g.fillStyle(0x7cc4e8, 1).fillRect(L + 10, y + 52, 40, 20).fillStyle(0x7cbf5a, 1).fillRect(L + 10, y + 72, 40, 12)
      g.lineBetween(L + 12, y + 88, L + 2, y + 112).lineBetween(L + 48, y + 88, L + 58, y + 112)
      g.fillStyle(0xe8c890, 1).fillEllipse(R - 24, y + 80, 52, 34).strokeEllipse(R - 24, y + 80, 52, 34)
      ;[0xd9503f, 0x3f72d6, 0xe8b800, 0x74b83c].forEach((c, i) => g.fillStyle(c, 1).fillCircle(R - 40 + i * 12, y + 76 + (i % 2) * 8, 5))
      break
    }
    case 'stage': {
      g.fillStyle(0xd9503f, 1).fillTriangle(x + 8, y + 36, x + 70, y + 36, x + 8, y + 140).strokeTriangle(x + 8, y + 36, x + 70, y + 36, x + 8, y + 140)
      g.fillTriangle(x + w - 8, y + 36, x + w - 70, y + 36, x + w - 8, y + 140).strokeTriangle(x + w - 8, y + 36, x + w - 70, y + 36, x + w - 8, y + 140)
      g.fillStyle(0xfff3a0, 0.5).fillTriangle(x + w / 2, y + 36, x + w / 2 - 80, y + 160, x + w / 2 + 80, y + 160)
      g.fillStyle(0x6a6f78, 1).fillCircle(x + w / 2, y + 40, 9).strokeCircle(x + w / 2, y + 40, 9)
      break
    }
    case 'sound_booth': {
      for (const cx of [L + 24, R - 24]) {
        g.fillStyle(0x6a5a50, 1).fillRoundedRect(cx - 22, y + 50, 44, 58, 6).strokeRoundedRect(cx - 22, y + 50, 44, 58, 6)
        g.fillStyle(0x2d2622, 1).fillCircle(cx, y + 70, 11).fillCircle(cx, y + 94, 7)
      }
      break
    }
    case 'workshop': {
      g.fillStyle(0xd6c09a, 1).fillRoundedRect(L, y + 46, w - 40, 56, 6).strokeRoundedRect(L, y + 46, w - 40, 56, 6)
      const gear = (cx: number, cy: number, r: number, c: number) => {
        g.fillStyle(c, 1).fillCircle(cx, cy, r).strokeCircle(cx, cy, r)
        g.fillStyle(0xfffaf0, 1).fillCircle(cx, cy, r / 3)
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3
          g.fillStyle(c, 1).fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4)
        }
      }
      gear(L + 38, y + 74, 18, 0xe0782c)
      gear(L + 84, y + 80, 12, 0x3f72d6)
      gear(R - 44, y + 72, 16, 0x74b83c)
      break
    }
    case 'render_farm': {
      for (let i = 0; i < 3; i++) {
        g.fillStyle(0x4a4a56, 1).fillCircle(L + 24 + i * 38, y + 94 - (i % 2) * 6, 17).strokeCircle(L + 24 + i * 38, y + 94 - (i % 2) * 6, 17)
        g.fillStyle(0xfffaf0, 1).fillCircle(L + 24 + i * 38, y + 94 - (i % 2) * 6, 5)
      }
      break
    }
    case 'edit_suite': {
      g.fillStyle(0x3a3a46, 1).fillRoundedRect(L, y + 46, 66, 46, 5).strokeRoundedRect(L, y + 46, 66, 46, 5)
      g.fillStyle(0x9fd3f5, 1).fillRect(L + 6, y + 52, 54, 30)
      g.fillStyle(0xffffff, 0.8).fillTriangle(L + 26, y + 58, L + 26, y + 76, L + 42, y + 67)
      g.fillStyle(0x2d2d3a, 1).fillRect(R - 70, y + 62, 70, 26).strokeRect(R - 70, y + 62, 70, 26)
      for (let i = 0; i < 6; i++) g.fillStyle(0xfffaf0, 1).fillRect(R - 66 + i * 11, y + 65, 6, 5).fillRect(R - 66 + i * 11, y + 80, 6, 5)
      break
    }
  }
}

export class StudioScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>()
  private roomLayer?: Phaser.GameObjects.Container
  private layoutKey = ''
  private roomKey = ''
  private roomSeq = 0
  private slotPos = new Map<string, { x: number; y: number }>()
  private lineG!: Gfx
  private labels = new Map<string, Phaser.GameObjects.Text>()
  private lastVersion = -1
  private boxes: RoomBox[] = []

  constructor() {
    super('studio')
  }

  create(): void {
    this.lineG = this.add.graphics().setDepth(50)
    this.sync()
    this.input.setDefaultCursor('default')
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length === 0) toyStore.getState().selectAgent(null)
    })
  }

  private buildRooms(boxes: RoomBox[]): void {
    this.roomLayer?.destroy()
    if (this.roomKey) this.textures.remove(this.roomKey)
    const layer = this.add.container(0, 0).setDepth(0)
    this.roomLayer = layer
    const g = this.make.graphics({}, false)
    const labels: Phaser.GameObjects.Text[] = []
    for (const b of boxes) {
      const pal = PALETTE[b.id] ?? PALETTE.workshop!
      // floor and wall
      g.fillStyle(0x000000, 0.14).fillRoundedRect(b.x + 4, b.y + 6, b.w, b.h, 22)
      g.fillStyle(pal.floor, 1).fillRoundedRect(b.x, b.y, b.w, b.h, 22)
      g.fillStyle(pal.plank, 0.55)
      for (let y = b.y + 156; y < b.y + b.h - 8; y += 24) g.fillRect(b.x + 6, y, b.w - 12, 3)
      g.fillStyle(pal.wall, 1).fillRoundedRect(b.x, b.y, b.w, 158, { tl: 22, tr: 22, bl: 0, br: 0 })
      g.fillStyle(0xffffff, 0.22)
      for (let x = b.x + 24; x < b.x + b.w - 10; x += 36) g.fillRect(x, b.y + 36, 12, 112)
      g.fillStyle(0x8a5a2f, 1).fillRect(b.x, b.y + 150, b.w, 12)
      g.lineStyle(3, INK, 0.6).lineBetween(b.x, b.y + 162, b.x + b.w, b.y + 162)
      decorate(g, b.id, b.x, b.y, b.w)
      g.lineStyle(6, INK, 1).strokeRoundedRect(b.x, b.y, b.w, b.h, 22)
      // rug
      g.fillStyle(0xffffff, 0.12).fillRoundedRect(b.x + 10, b.y + 266, b.w - 20, 62, 20)
      // hanging sign
      const sw = Math.max(150, roomLabel(b.id).length * 13 + 40)
      const sx = b.x + b.w / 2 - sw / 2
      g.lineStyle(3, INK, 1).lineBetween(sx + 20, b.y + 4, sx + 20, b.y + 14).lineBetween(sx + sw - 20, b.y + 4, sx + sw - 20, b.y + 14)
      g.fillStyle(0xe9b872, 1).lineStyle(4, INK, 1).fillRoundedRect(sx, b.y + 10, sw, 30, 10).strokeRoundedRect(sx, b.y + 10, sw, 30, 10)
      g.fillStyle(0xfffaf0, 1).fillCircle(sx + 12, b.y + 25, 2.5).fillCircle(sx + sw - 12, b.y + 25, 2.5)
      labels.push(text(this, b.x + b.w / 2, b.y + 26, roomLabel(b.id), 19, '#4a2f1b', FONT_DISPLAY, false))
    }
    // the rooms never change until the crew does: draw them once into a texture instead of every frame
    this.roomKey = `rooms-${++this.roomSeq}`
    const rt = this.make.renderTexture({ width: W, height: H }, false)
    rt.draw(g, 0, 0)
    rt.saveTexture(this.roomKey)
    g.destroy()
    layer.add([this.add.image(0, 0, this.roomKey).setOrigin(0, 0), ...labels])
  }

  /** Creates, removes and places agent sprites to match the store. */
  private sync(): void {
    const s = toyStore.getState()
    const agents = s.agentOrder.map((id) => s.agents[id]).filter((a): a is AgentView => !!a)
    const boxes = computeLayout(agents)
    const key = boxes.map((b) => `${b.id}:${b.slots.map((sl) => sl.agentId).join(',')}`).join('|')
    if (key !== this.layoutKey) {
      this.layoutKey = key
      this.boxes = boxes
      this.buildRooms(boxes)
      this.slotPos.clear()
      for (const b of boxes) for (const sl of b.slots) this.slotPos.set(sl.agentId, { x: sl.x, y: sl.y })
      for (const [id, sp] of this.sprites) {
        if (!this.slotPos.has(id)) {
          sp.root.destroy()
          this.sprites.delete(id)
        }
      }
      for (const a of agents) {
        const pos = this.slotPos.get(a.id)
        if (!pos) continue
        let sp = this.sprites.get(a.id)
        if (!sp) {
          sp = new AgentSprite(this, a.id, a, (id, pointer) => {
            // Phaser also sees mouse clicks outside the canvas (for example on a dialog); only canvas clicks count
            if (pointer.event?.target === this.game.canvas) toyStore.getState().selectAgent(id)
          })
          sp.root.setDepth(10)
          this.sprites.set(a.id, sp)
        }
        sp.place(pos.x, pos.y)
      }
    }
    this.publish(agents.length)
  }

  /** A small read-only summary for tests and debugging. */
  private publish(agentCount: number): void {
    ;(window as unknown as { __studio?: unknown }).__studio = {
      agents: agentCount,
      sprites: this.sprites.size,
      rooms: this.boxes.map((b) => b.id),
      handovers: toyStore.getState().handovers.length,
      /** Centre of each crew member in game coordinates (1280 x 720). */
      positions: Object.fromEntries([...this.slotPos].map(([id, p]) => [id, { x: p.x, y: p.y + 180 }]))
    }
  }

  update(time: number): void {
    const s = toyStore.getState()
    if (s.version !== this.lastVersion) {
      this.lastVersion = s.version
      this.sync()
    }
    const now = Date.now()
    for (const [id, sp] of this.sprites) {
      const a = s.agents[id]
      if (!a) continue
      let progress: { label: string; done: number; total: number } | undefined
      if (a.episode && a.jobId) {
        const r = s.render[a.episode]
        if (r && r.jobId === a.jobId) {
          const last = r.shots[r.order[r.order.length - 1] ?? '']
          if (last) progress = { label: last.label, done: last.done, total: last.total }
        }
      }
      sp.update(time, a, s, s.selectedAgent === id, progress)
    }
    this.drawHandovers(now, s.handovers, s.agents)
  }

  private drawHandovers(now: number, handovers: ReturnType<typeof toyStore.getState>['handovers'], agents: ReturnType<typeof toyStore.getState>['agents']): void {
    const g = this.lineG
    g.clear()
    const live = new Set<string>()
    for (const h of handovers) {
      const alpha = handoverAlpha(h, now)
      const p0 = this.slotPos.get(h.from)
      const p1 = this.slotPos.get(h.to)
      if (alpha <= 0 || !p0 || !p1 || h.from === h.to) continue
      live.add(h.key)
      const ax = p0.x
      const ay = p0.y + 200
      const bx = p1.x
      const by = p1.y + 200
      const cx = (ax + bx) / 2
      const cy = Math.min(ay, by) - 70 - Math.abs(ax - bx) * 0.08
      const at = (t: number) => ({
        x: (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx,
        y: (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by
      })
      // dashed curve
      g.fillStyle(0xe0782c, 0.85 * alpha)
      for (let i = 0; i <= 24; i += 1) {
        if (i % 2) continue
        const q = at(i / 24)
        g.fillCircle(q.x, q.y, 3)
      }
      const dest = agents[h.to]
      const film = /shot|render|animatic|preview|track|frame/i.test(h.label) || dest?.kind === 'tool'
      const t = h.doneAt !== undefined ? 1 : ((now - h.startedAt) % 1800) / 1800
      const q = at(t)
      g.setAlpha(1)
      if (film) {
        g.fillStyle(0x2d2d3a, alpha).fillRoundedRect(q.x - 14, q.y - 8, 28, 16, 3)
        g.fillStyle(0xfffaf0, alpha)
        for (let i = 0; i < 4; i++) g.fillRect(q.x - 11 + i * 6.5, q.y - 6, 3, 3).fillRect(q.x - 11 + i * 6.5, q.y + 3, 3, 3)
        g.fillStyle(0x9fd3f5, alpha).fillRect(q.x - 11, q.y - 2, 22, 4)
      } else {
        g.fillStyle(0xfffaf0, alpha).lineStyle(2.5, INK, alpha).fillRoundedRect(q.x - 10, q.y - 12, 20, 24, 3).strokeRoundedRect(q.x - 10, q.y - 12, 20, 24, 3)
        g.lineStyle(2, 0x8a7a68, alpha).lineBetween(q.x - 6, q.y - 5, q.x + 6, q.y - 5).lineBetween(q.x - 6, q.y, q.x + 6, q.y).lineBetween(q.x - 6, q.y + 5, q.x + 2, q.y + 5)
      }
      let label = this.labels.get(h.key)
      if (!label) {
        label = text(this, 0, 0, h.label.slice(0, 26), 11, '#4a2f1b').setDepth(51)
        this.labels.set(h.key, label)
      }
      label.setPosition(q.x, q.y - 22).setAlpha(alpha)
    }
    for (const [key, label] of this.labels) {
      if (!live.has(key)) {
        label.destroy()
        this.labels.delete(key)
      }
    }
  }
}

export function createStudioGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: W,
    height: H,
    transparent: true,
    scene: [StudioScene],
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false },
    audio: { noAudio: true },
    banner: false
  })
}
