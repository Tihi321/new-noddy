import type { AgentView } from '../store/model'

export const W = 1280
export const H = 720

export interface Slot {
  agentId: string
  x: number
  /** Top of the room, the slot's y reference. */
  y: number
}

export interface RoomBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  slots: Slot[]
}

const ROWS: string[][] = [
  ['writers_room', 'art_dept', 'stage'],
  ['sound_booth', 'workshop', 'render_farm', 'edit_suite']
]
const MARGIN = 14
const GAP = 12
const ROW_Y = [10, 366]
const ROW_H = 344

/** Rooms in two rows. A room is as wide as its crew; agents sit in a line, one desk each. */
export function computeLayout(agents: AgentView[]): RoomBox[] {
  const known = new Set(ROWS.flat())
  const byRoom = new Map<string, AgentView[]>()
  for (const a of agents) {
    const room = known.has(a.room) ? a.room : 'workshop'
    const list = byRoom.get(room) ?? []
    list.push(a)
    byRoom.set(room, list)
  }
  const boxes: RoomBox[] = []
  ROWS.forEach((ids, row) => {
    const counts = ids.map((id) => Math.max(1.6, byRoom.get(id)?.length ?? 0))
    const total = counts.reduce((a, b) => a + b, 0)
    const avail = W - MARGIN * 2 - GAP * (ids.length - 1)
    let x = MARGIN
    ids.forEach((id, i) => {
      const w = (avail * counts[i]!) / total
      const list = byRoom.get(id) ?? []
      const slotW = w / Math.max(1, list.length)
      boxes.push({
        id,
        x,
        y: ROW_Y[row]!,
        w,
        h: ROW_H,
        slots: list.map((a, k) => ({ agentId: a.id, x: x + slotW * (k + 0.5), y: ROW_Y[row]! }))
      })
      x += w + GAP
    })
  })
  return boxes
}
