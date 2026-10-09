import type { SetLayout } from '../../shared/episode'

export type XY = [number, number]
export type TargetSpec = string | [number, number]

export interface ResolvedTarget {
  /** The thing itself: the mark, the prop centre or the character's position. */
  pos: XY
  /** Where to stand to be "at" it: the mark itself, in front of a prop, or just short of a character. */
  approach: XY
  kind: 'point' | 'mark' | 'prop' | 'character' | 'unknown'
}

export interface TargetContext {
  set: SetLayout
  /** Ids of the characters in the shot. */
  characters?: readonly string[]
  /** Where a character is at the time of the action. */
  characterPos?: (id: string) => XY | undefined
}

/** Rough footprint radius (toy units, at scale 1) used to stand in front of a prop. */
export const PROP_RADIUS: Record<string, number> = {
  house: 1.2, shop: 1.3, station: 1.8, clock_tower: 0.9, tree_lollipop: 0.6, tree_pine: 0.6, bush: 0.6, fence: 0.5, road: 0,
  lamp_post: 0.3, bench: 0.7, pond: 1.5, hill: 2.6, well: 0.7, flower_patch: 0.6, mailbox: 0.3, signpost: 0.3, bridge: 1,
  cloud: 0, rock: 0.5, gate: 0.6, market_stall: 0.9
}

/**
 * Resolves a mark name, prop id, character id or [x, y] to ground positions.
 * Lookup order follows the contract: mark, prop, character. `from` is the mover's position (used to stop short of a character).
 */
export function resolveTarget(target: TargetSpec, ctx: TargetContext, from?: XY): ResolvedTarget {
  if (Array.isArray(target)) {
    const p: XY = [Number(target[0]) || 0, Number(target[1]) || 0]
    return { pos: p, approach: p, kind: 'point' }
  }
  const mark = ctx.set.marks[target]
  if (mark) {
    const p: XY = [mark[0], mark[1]]
    return { pos: p, approach: p, kind: 'mark' }
  }
  const prop = ctx.set.props.find((p) => p.id === target)
  if (prop) {
    const pos: XY = [prop.pos[0], prop.pos[1]]
    const rot = (prop.rot * Math.PI) / 180
    const front: XY = [Math.sin(rot), -Math.cos(rot)]
    const r = (PROP_RADIUS[prop.kind] ?? 0.8) * prop.scale + 0.45
    return { pos, approach: [pos[0] + front[0] * r, pos[1] + front[1] * r], kind: 'prop' }
  }
  const cp = ctx.characters?.includes(target) || ctx.characterPos?.(target) ? ctx.characterPos?.(target) : undefined
  if (cp) {
    const pos: XY = [cp[0], cp[1]]
    let dx = 0
    let dy = 1
    if (from) {
      dx = pos[0] - from[0]
      dy = pos[1] - from[1]
      const len = Math.hypot(dx, dy)
      if (len > 1e-6) {
        dx /= len
        dy /= len
      } else {
        dx = 0
        dy = 1
      }
    }
    return { pos, approach: [pos[0] - dx * 0.9, pos[1] - dy * 0.9], kind: 'character' }
  }
  const c = ctx.set.marks.center ?? [0, 0]
  return { pos: [c[0], c[1]], approach: [c[0], c[1]], kind: 'unknown' }
}
