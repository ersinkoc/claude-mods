import { describe, expect, test } from 'claude-code/testing'

import TempoBand from '../hooks/band.tsx'

// A surface in memory for the band module: elements build plain data, timers
// fire when the test ticks them, and `setState` lands at once or, when
// `isLazy`, only when the test lands it (a surface that batches its updates).
type Node = { type: string; props: Record<string, unknown> & { children?: unknown[] } }
type Props = Parameters<typeof TempoBand>[0]

function surfaceOf(isLazy = false) {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  let state: unknown
  let pending: unknown
  const timers: (() => void)[] = []
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    get state() {
      return state
    },
    setState: (s: unknown) => {
      if (isLazy) pending = s
      else state = s
    },
    columns: 80,
    rows: 1,
    every: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return () => undefined
    },
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, land: () => (state = pending), state: () => state as { f: number; since: number; seen: number } }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

/** The row's Text runs, in order. */
const runsOf = (n: unknown): Node[] => ((n as Node).props.children as Node[])[0]!.props.children!.flat().filter(Boolean) as Node[]

const MIN = 60_000
const WORK: Props = { cols: 60, phase: 'work', remain: 10 * MIN, total: 25 * MIN, round: 2, today: 0, claude: false }

describe('the tempo band module', () => {
  test('a focus round: tomato, label, bar and time, no tally', async () => {
    const s = surfaceOf()
    const out = TempoBand(WORK, s.surface)
    const text = textOf(out)
    expect(text.startsWith('🍅 FOCUS 2 ▕')).toBe(true)
    expect(text.endsWith('▏ 10:00')).toBe(true)
    expect(text).not.toContain('today')
    // 15 of 25 minutes gone: 60% of the bar filled, the edge sizzling, the rest dotted.
    const bar = text.slice(text.indexOf('▕') + 1, text.indexOf('▏'))
    expect(bar.length).toBe(60 - 20)
    expect([...bar].filter(c => c === '█').length).toBe(24)
    expect(bar).toContain('·')
    expect(s.timers).toHaveLength(1)
    expect(runsOf(out).find(r => r.props.color === '#facc15')).toBeUndefined()
  })

  test('the clock counts down between redraws, the colon blinks and the glint sweeps', async () => {
    const s = surfaceOf()
    TempoBand(WORK, s.surface)
    s.tick(5)
    expect(s.state()).toEqual({ f: 5, since: 5, seen: 10 * MIN })
    // Half a second on: 9:59.5 shows as 10 00, the colon off.
    expect(textOf(TempoBand(WORK, s.surface))).toContain('10 00')
    s.tick(5)
    expect(textOf(TempoBand(WORK, s.surface))).toContain('9:59')
    // New props from the hooks module restart the local countdown.
    const next = { ...WORK, remain: 9 * MIN }
    TempoBand(next, s.surface)
    expect(s.state()).toEqual({ f: 10, since: 0, seen: 9 * MIN })
    // The glint: the brightest cell walks along the filled part.
    const colors = new Set<unknown>()
    for (let i = 0; i < 12; i++) {
      s.tick()
      for (const r of runsOf(TempoBand(next, s.surface))) colors.add(r.props.color)
    }
    expect(colors.has('#fbbf24')).toBe(true)
    expect(colors.has('#fb923c')).toBe(true)
  })

  test('the last minute: an alarm clock blinks in and the time turns yellow', async () => {
    const s = surfaceOf()
    const last = { ...WORK, remain: 30_000, today: 3 }
    const first = TempoBand(last, s.surface)
    expect(textOf(first).startsWith('⏰')).toBe(true)
    expect(textOf(first)).toContain(' 🍅×3 today')
    expect(runsOf(first).find(r => textOf(r) === '0:30')?.props.color).toBe('#facc15')
    s.tick(5)
    expect(textOf(TempoBand(last, s.surface)).startsWith('🍅')).toBe(true)
  })

  test('a break: a steaming cup, mint, and Claude still at work', async () => {
    const s = surfaceOf()
    const brk: Props = { cols: 80, phase: 'break', remain: 4 * MIN, total: 5 * MIN, round: 1, today: 1, claude: true }
    const out = TempoBand(brk, s.surface)
    const text = textOf(out)
    expect(text.startsWith('☕   BREAK')).toBe(true)
    expect(text).toContain(' — Claude keeps going.')
    expect(runsOf(out).find(r => textOf(r) === ' BREAK')?.props.color).toBe('#2dd4bf')
    s.tick(4)
    const later = textOf(TempoBand(brk, s.surface))
    expect(later.startsWith('☕° ')).toBe(true)
    expect(later).toContain(' — Claude keeps going..')
    // A long break, done: the bar full, the clock at zero.
    const done = textOf(TempoBand({ ...brk, phase: 'long', remain: 0, claude: false }, s.surface))
    expect(done).toContain('LONG BREAK')
    expect(done).toContain('0:00')
    expect(done).not.toContain('·')
    expect(done).not.toContain('Claude')
  })

  test('a bar barely started: the edge cell more than half lit, and no glint yet', async () => {
    const s = surfaceOf()
    // 30 cells, 2.6 of them filled: two plain solid cells and a dense edge.
    const out = TempoBand({ ...WORK, cols: 30 + 20, remain: 1_370_000, total: 25 * MIN }, s.surface)
    const text = textOf(out)
    const bar = text.slice(text.indexOf('▕') + 1, text.indexOf('▏'))
    expect(bar.startsWith('██▓·')).toBe(true)
    const runs = runsOf(out).filter(r => /[█▓·]/.test(textOf(r)))
    expect(runs.map(r => r.props.color).slice(0, 3)).toEqual(['#f87171', '#ef4444', '#f87171'])
  })

  test('a surface that batches its state draws from the props until it lands', async () => {
    const s = surfaceOf(true)
    expect(textOf(TempoBand(WORK, s.surface))).toContain('10:00')
    // A frame before the state landed counts from zero.
    s.tick()
    s.land()
    expect(s.state()).toEqual({ f: 1, since: 1, seen: 0 })
  })
})
