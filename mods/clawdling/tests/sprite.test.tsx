import { describe, expect, test } from 'claude-code/testing'
import type { ClientSurface } from 'claude-code'

import { cleanName, needFor, nextUnlock, quipFor, QUIPS } from '../hooks/clawd.ts'
import Crab from '../hooks/crab.tsx'
import { PALETTE, PERIOD, STAGE_W, crabFrame, frameRuns, frameSvg } from '../hooks/sprite.ts'
import type { Acc, Frame, Mood } from '../hooks/sprite.ts'

const NONE: Acc = { hat: false, glasses: false, scarf: false, crown: false }
const ALL: Acc = { hat: true, glasses: true, scarf: true, crown: true }
const MOODS: Mood[] = ['idle', 'working', 'thinking', 'sad', 'hot', 'sleepy', 'dance', 'love']

/** The eye row of a frame as a string, `.` for empty. */
const eyes = (fr: Frame) => fr.px[0]!.map(k => k ?? '.').join('')

describe('the mind', () => {
  test('names, quips and the level ladder', () => {
    expect(cleanName(42)).toBe('Pinchy')
    expect(cleanName('   ')).toBe('Pinchy')
    expect(cleanName('  Sir   Clawsalot ')).toBe('Sir Clawsalot')
    expect(cleanName('x'.repeat(40))).toHaveLength(24)
    expect(needFor(0)).toBe(100)
    expect(nextUnlock(12)).toBeUndefined()
    expect(nextUnlock(4)?.key).toBe('glasses')
    expect(quipFor('sleepy', -4)).toBe(QUIPS.sleepy[1])
    expect(quipFor('idle', 7.9)).toBe(QUIPS.idle[2])
  })
})

describe('the sprite', () => {
  test('eyes look around when idle, follow the scuttle, and stare when thinking', () => {
    const at = (mood: Mood, f: number) => eyes(crabFrame({ mood, f, acc: NONE }))
    // Idle stands at x 4 (frames 0..11) or 5: pupils in, left, right.
    expect(at('idle', 0).slice(7, 9)).toBe('WP')
    expect(at('idle', 10).slice(7, 9)).toBe('PW')
    expect(at('idle', 0).slice(15, 17)).toBe('PW')
    expect(at('idle', 20).slice(16, 18)).toBe('WP')
    expect(at('thinking', 0)).toContain('WP')
    expect(at('working', 2)).not.toBe(at('working', 14))
    // Sad: one pupil each side, no whites.
    expect(at('sad', 0)).toContain('sP')
    expect(at('sad', 0)).not.toContain('W')
  })

  test('closed eyes: asleep, a blink, and half of each love beat', () => {
    expect(eyes(crabFrame({ mood: 'sleepy', f: 5, acc: ALL }))).toContain('ss')
    expect(eyes(crabFrame({ mood: 'dance', f: 23, acc: NONE }))).toContain('ss')
    expect(eyes(crabFrame({ mood: 'love', f: 2, acc: NONE }))).toContain('ss')
    expect(eyes(crabFrame({ mood: 'love', f: 8, acc: NONE }))).toContain('W')
    // Sunglasses glint in turn, and hide a sad face.
    expect(eyes(crabFrame({ mood: 'sad', f: 0, acc: { ...NONE, glasses: true } }))).toContain('Gg')
    expect(eyes(crabFrame({ mood: 'idle', f: 6, acc: { ...NONE, glasses: true } }))).toContain('Gg')
  })

  test('headwear: the crown twinkles and outranks the hat; the scarf tail swings', () => {
    const crownA = crabFrame({ mood: 'idle', f: 0, acc: ALL })
    const crownB = crabFrame({ mood: 'idle', f: 4, acc: ALL })
    expect(crownA.px[1]!.join('')).toContain('JJ')
    expect(crownB.px[1]!.join('')).toContain('JW')
    expect(crownA.px[0]!.join('')).toContain('Y')
    expect(crownA.px[1]!.join('')).not.toContain('h')
    const hatA = crabFrame({ mood: 'idle', f: 0, acc: { ...NONE, hat: true } })
    const hatB = crabFrame({ mood: 'idle', f: 3, acc: { ...NONE, hat: true } })
    expect(hatA.px[0]!.join('')).toContain('Yh')
    expect(hatB.px[0]!.join('')).toContain('Wh')
    const scarf = (f: number) => crabFrame({ mood: 'sleepy', f, acc: { ...NONE, scarf: true } }).px[7]!.indexOf('T')
    expect(scarf(0)).toBe(4 + 13)
    expect(scarf(4)).toBe(4 + 12)
    expect(eyes(crabFrame({ mood: 'idle', f: 0, acc: NONE }))).not.toContain('Y')
  })

  test('mood effects: bubbles, sweat, fanning, z, sparkles and hearts', () => {
    const think = (f: number) => crabFrame({ mood: 'thinking', f, acc: NONE }).px[1]!.join('')
    const lit = (f: number) => think(f).replace(/[^O]/g, '').length
    expect([lit(0), lit(4), lit(8), lit(12)]).toEqual([0, 1, 2, 3])
    const sad = (f: number) => crabFrame({ mood: 'sad', f, acc: NONE }).px.map(r => r[18])
    expect(sad(0)[0]).toBe('w')
    expect(sad(6)[1]).toBe('w')
    expect(sad(6)[0]).toBeNull()
    const hot = (f: number) => crabFrame({ mood: 'hot', f, acc: NONE }).px[0]!.join('')
    expect(hot(0)).toContain('F')
    expect(hot(2)).not.toContain('Ff')
    const zs = (f: number) => crabFrame({ mood: 'sleepy', f, acc: NONE }).marks.map(m => m.ch).join('')
    expect(zs(0)).toBe('z')
    expect(zs(6)).toBe('zz')
    expect(zs(12)).toBe('zzZ')
    const dance = crabFrame({ mood: 'dance', f: 3, acc: NONE }).marks
    expect(dance.some(m => m.ch === '♪' || m.ch === '♫')).toBe(true)
    expect(dance.some(m => '✦✧⋆✶'.includes(m.ch))).toBe(true)
    expect(crabFrame({ mood: 'dance', f: 6, acc: NONE }).marks.some(m => m.ch === '♫')).toBe(true)
    const hearts = (f: number) => crabFrame({ mood: 'love', f, acc: NONE }).marks.filter(m => m.ch === '♥')
    expect(hearts(0).map(m => m.row)).toEqual([3, 1, 2, 0])
  })

  test('every mood, frame and outfit fits the stage', () => {
    for (const acc of [NONE, ALL, { ...NONE, hat: true, glasses: true }]) {
      for (const mood of MOODS) {
        for (let f = -1; f <= PERIOD; f++) {
          const rows = frameRuns(crabFrame({ mood, f, acc }))
          for (const row of rows) expect(row.reduce((n, r) => n + [...r.text].length, 0)).toBe(STAGE_W)
        }
      }
    }
  })

  test('cells pair pixels: both, the top, the bottom, a mark, none', () => {
    const px = Array.from({ length: 8 }, () => Array.from({ length: STAGE_W }, () => null as string | null))
    px[0]![0] = 'R'; px[1]![0] = 'D'
    px[0]![1] = 'R'
    px[1]![2] = 'k'
    const runs = frameRuns({ px, marks: [{ x: 3, row: 0, ch: 'z', color: '#93c5fd' }] })
    expect(runs[0]!.slice(0, 5)).toEqual([
      { text: '▀', fg: PALETTE.R, bg: PALETTE.D },
      { text: '▀', fg: PALETTE.R },
      { text: '▄', fg: PALETTE.k },
      { text: 'z', fg: '#93c5fd' },
      { text: ' '.repeat(STAGE_W - 4) },
    ])
  })

  test('the svg merges runs by colour; a short or odd frame still draws', () => {
    const svg = frameSvg(crabFrame({ mood: 'sleepy', f: 12, acc: NONE }), 5)
    expect(svg).toContain(`fill="${PALETTE.R}"`)
    expect(svg).toContain('>Z</text>')
    const odd = frameSvg({ px: [['Q', 'Q', null]], marks: [] }, 2)
    expect(odd).toBe('<path fill="#000" d="M0 0h4v2h-4z"/>')
  })
})

describe('the terminal crab', () => {
  type S = { f: number; quip: string; typed: number }
  const P = { cols: 80, mood: 'idle' as Mood, name: 'Clacky', level: 3, into: 50, need: 300, quip: 'Hello there', acc: { ...NONE, hat: true }, icons: '🎉', status: 'lounging · next 😎 Lv 5' }
  type El = { type: string; props: Record<string, unknown> & { children?: unknown } }
  const flat = (n: unknown): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return ''
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (Array.isArray(n)) return n.map(flat).join('')
    return flat((n as El).props.children)
  }
  function fake() {
    const timers: (() => void)[] = []
    const tag = (type: string) => (props: Record<string, unknown>) => ({ type, props })
    const surface = {
      elements: { Text: tag('Text'), Box: tag('Box') },
      state: undefined as S | undefined,
      setState(next: S) { surface.state = next },
      columns: 0,
      rows: 0,
      every(ms: number, fn: () => void) { timers.push(fn); return () => undefined },
      onPointer: () => () => undefined,
      onKey: () => () => undefined,
      post: () => undefined,
    }
    return { surface, as: surface as unknown as ClientSurface<S>, timers, tick: (n: number) => { for (let i = 0; i < n; i++) timers.forEach(t => t()) } }
  }

  test('types the quip out two letters a frame, with a blinking caret', () => {
    const f = fake()
    const first = flat(Crab(P, f.as))
    expect(f.timers).toHaveLength(1)
    expect(first).toContain('Clacky Lv 3 🎉')
    expect(first).toContain('“▌”')
    expect(first).toContain('lounging · next 😎 Lv 5')
    f.tick(3)
    expect(f.surface.state).toEqual({ f: 3, quip: 'Hello there', typed: 6 })
    expect(flat(Crab(P, f.as))).toContain('“Hello ”')
    f.tick(1)
    expect(flat(Crab(P, f.as))).toContain('“Hello th▌”')
    f.tick(10)
    expect(flat(Crab(P, f.as))).toContain('“Hello there”')
    expect(f.timers).toHaveLength(1)
  })

  test('a new quip starts typing again; the XP bar fills by the ratio', () => {
    const f = fake()
    Crab(P, f.as)
    f.tick(10)
    const next = flat(Crab({ ...P, quip: 'Bye' }, f.as))
    expect(next).toContain('“▌”')
    expect(f.surface.state).toEqual({ f: 10, quip: 'Bye', typed: 0 })
    // 50/300 of a 24-cell bar.
    expect(next).toContain(`${'▰'.repeat(4)}${'▱'.repeat(20)} 50/300 XP`)
    const full = flat(Crab({ ...P, into: 900, need: 300 }, f.as))
    expect(full).toContain('▰'.repeat(24))
    const none = flat(Crab({ ...P, need: 0, icons: '' }, f.as))
    expect(none).toContain('▱'.repeat(24))
    expect(none).toContain('Clacky Lv 3')
    expect(none).not.toContain('🎉')
  })

  test('a narrow region shows the crab alone; no width means 80 columns', () => {
    const f = fake()
    expect(flat(Crab({ ...P, cols: 40 }, f.as))).not.toContain('Clacky')
    expect(flat(Crab({ ...P, cols: 0 }, f.as))).toContain('Clacky')
  })
})
