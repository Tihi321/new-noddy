import { Brief, castSchema, Music, Outline, Review, Script, setsSchema, Sfx, ShotActions, Shots } from '../../../src/shared/episode'
import type { PuppetSpec, SetLayout } from '../../../src/shared/episode'

/**
 * A small, valid, hand-written episode package: two puppets, two sets, 15 shots of 20 s (300 s), a script with 5 lines,
 * actions for every shot, music and sound. Every part passes its schema and the QA validator without issues.
 * Used by the QA, advance and mock end-to-end tests.
 */

export const TOCK: PuppetSpec = {
  id: 'tock',
  name: 'Tock',
  body: 'peg',
  material: 'wood',
  height: 1,
  colors: { skin: '#f2c9a0', torso: '#d33b2c', legs: '#2a4fa8', hat: '#dd2222', accent: '#ffd400' },
  hat: 'pompom',
  accessories: ['scarf'],
  eyes: 'dot',
  nose: 'round',
  ears: 'none',
  vehicle: { kind: 'van', color: '#ffd400', accent: '#d33b2c' },
  voice: { pitch: 1.2, speed: 1.1, timbre: 'bright' }
}

export const BOBBIN: PuppetSpec = {
  id: 'bobbin',
  name: 'Bobbin',
  body: 'teddy',
  material: 'felt',
  height: 0.9,
  colors: { skin: '#c98b5a', torso: '#4aa3a0', legs: '#4aa3a0', hat: '#ffffff', accent: '#ffd400' },
  hat: 'none',
  accessories: ['apron'],
  eyes: 'button',
  nose: 'button',
  ears: 'round',
  vehicle: null,
  voice: { pitch: 1.4, speed: 1, timbre: 'warm' }
}

export const TOWN_SQUARE: SetLayout = {
  id: 'town_square',
  name: 'Town Square',
  size: [12, 8],
  ground: 'cobble',
  backdrop: 'sky_day',
  lighting: 'day',
  props: [
    { kind: 'house', pos: [-3, 2], rot: 0, scale: 1, color: '#e8b04a', accent: '#c0392b', variant: 0, id: 'tocks_house' },
    { kind: 'shop', pos: [3, 2], rot: 0, scale: 1, variant: 1, id: 'shop' },
    { kind: 'tree_lollipop', pos: [-5, 3], rot: 0, scale: 1, variant: 0 }
  ],
  marks: { center: [0, 0], left: [-4, 0], right: [4, 0], shop_door: [3, 1.4] }
}

export const POND: SetLayout = {
  id: 'pond',
  name: 'The Pond',
  size: [12, 8],
  ground: 'grass',
  backdrop: 'sky_day',
  lighting: 'day',
  props: [{ kind: 'pond', pos: [0, 2], rot: 0, scale: 1.5, variant: 0, id: 'the_pond' }],
  marks: { center: [0, 0], left: [-4, 0], right: [4, 0], pond_edge: [0, 0.8] }
}

export const SHOT_COUNT = 15
export const SHOT_SECONDS = 20

export interface Story {
  brief: Brief
  outline: Outline
  script: Script
  cast: PuppetSpec[]
  sets: SetLayout[]
  shots: Shots
  actions: Record<string, ShotActions>
  music: Music
  sfx: Sfx
  review: Review
}

/** Shots 1 to 8 are in the town square (scenes sc1 and sc2), shots 9 to 15 at the pond (sc3). Every third shot has one line. */
export function buildStory(): Story {
  const cast = castSchema.parse([TOCK, BOBBIN])
  const sets = setsSchema.parse([TOWN_SQUARE, POND])
  const sceneOf = (i: number) => (i <= 5 ? 'sc1' : i <= 8 ? 'sc2' : 'sc3')
  const setOf = (i: number) => (i <= 8 ? 'town_square' : 'pond')
  let b = 0
  let l = 0
  const scenes: Script['scenes'] = [
    { id: 'sc1', setId: 'town_square', summary: 'Morning, and a windy surprise', beats: [] },
    { id: 'sc2', setId: 'town_square', summary: 'Friends gather', beats: [] },
    { id: 'sc3', setId: 'pond', summary: 'Help at the pond', beats: [] }
  ]
  const shotList: Shots['shots'] = []
  const actions: Record<string, ShotActions> = {}
  for (let i = 1; i <= SHOT_COUNT; i++) {
    const scene = scenes.find((s) => s.id === sceneOf(i))!
    b++
    const beatIds = [`b${b}`]
    scene.beats.push({ id: `b${b}`, kind: 'action', text: `Something gentle happens in part ${i}.` })
    const lines: string[] = []
    const speaker = i % 2 === 0 ? 'tock' : 'bobbin'
    if (i % 3 === 0) {
      b++
      l++
      const lineId = `L${String(l).padStart(3, '0')}`
      scene.beats.push({ id: `b${b}`, kind: 'line', character: speaker, lineId, text: 'Oh dear, look!', emotion: 'worried' })
      beatIds.push(`b${b}`)
      lines.push(lineId)
    }
    const id = `shot-${String(i).padStart(2, '0')}`
    shotList.push({
      id,
      sceneId: scene.id,
      setId: setOf(i),
      duration: SHOT_SECONDS,
      framing: i === 1 ? 'establishing' : i % 4 === 0 ? 'close' : 'medium',
      angle: 'eye',
      cameraMove: 'locked',
      subjects: ['tock'],
      cast: ['tock', 'bobbin'],
      startMarks: { tock: 'left', bobbin: [1, 0.5] },
      beats: beatIds,
      lines,
      transitionIn: i === 1 ? 'iris_in' : 'cut',
      transitionOut: i === SHOT_COUNT ? 'iris_out' : 'cut',
      notes: `Shot ${i}.`
    })
    const acts: ShotActions['actions'] = [
      { t: 0, actor: 'tock', action: 'walk_to', target: 'center', dur: 3 },
      { t: 3.5, actor: 'bobbin', action: 'wave', dur: 1 }
    ]
    for (const lineId of lines) acts.push({ t: 6, actor: speaker, action: 'talk', lineId })
    actions[id] = { shotId: id, actions: acts }
  }
  const shots = Shots.parse({ shots: shotList })
  const script = Script.parse({ title: 'Tock and the Windy Day', logline: 'Tock loses his cap and friends help.', moral: 'Friends help each other.', scenes })
  return {
    brief: Brief.parse({
      title: 'Tock and the Windy Day',
      logline: 'Tock loses his cap and friends help.',
      moral: 'Friends help each other.',
      problem: 'The wind blows away the red pompom cap.',
      solution: 'Bobbin and Tock find it together.',
      tone: 'warm and playful',
      cast: ['tock', 'bobbin'],
      guests: [],
      locations: ['town_square', 'pond'],
      newLocations: [],
      lengthSec: 300
    }),
    outline: Outline.parse({
      title: 'Tock and the Windy Day',
      sections: [
        { id: 'o1', name: 'Cold open', setId: 'town_square', summary: 'Morning in Tumbletown.', beats: ['The sun rises.'], approxSec: 60 },
        { id: 'o2', name: 'The problem', setId: 'town_square', summary: 'The cap blows away.', beats: ['The wind takes the cap.'], approxSec: 100 },
        { id: 'o3', name: 'Happy ending', setId: 'pond', summary: 'Found, and everyone laughs.', beats: ['The cap is found.'], approxSec: 140 }
      ]
    }),
    script,
    cast,
    sets,
    shots,
    actions,
    music: Music.parse({
      tempo: 104,
      key: 'C',
      theme: { instrument: 'music_box', melody: [{ p: 'C5', d: 0.5 }, { p: 'E5', d: 0.5 }, { p: 'G5', d: 1 }], bass: [] },
      cues: [0, 5, 10].map((from, k) => ({
        id: `cue${k + 1}`,
        shots: shotList.slice(from, from + 5).map((s) => s.id),
        mood: 'cheerful',
        instrument: 'ukulele',
        tempo: 104,
        melody: [{ p: 'G4', d: 0.5 }, { p: 'r', d: 0.5 }],
        bass: [],
        loop: true,
        gain: 0.5
      }))
    }),
    sfx: Sfx.parse({
      cues: [{ shotId: 'shot-01', t: 1, cue: 'birds', gain: 0.5 }, { shotId: 'shot-03', t: 8, cue: 'wind', gain: 0.6 }],
      voices: { tock: TOCK.voice, bobbin: BOBBIN.voice }
    }),
    review: Review.parse({
      verdict: 'pass',
      summary: 'Clear and kind.',
      scores: { age_fit: 5, clarity_without_words: 4, pacing: 4, length: 5 },
      issues: []
    })
  }
}
