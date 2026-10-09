import { describe, expect, test } from 'claude-code/testing'

import Dash, { dialCells } from '../hooks/dash.tsx'
import type { DashProps } from '../hooks/dash.tsx'

// A surface in memory for the dash module: elements build plain data, timers
// fire when the test ticks them, and `setState` lands at once or, when
// `isLazy`, only when the test lands it (a surface that batches its updates).
type Node = { type: string; props: Record<string, unknown> & { children?: unknown[] } }

function surfaceOf(columns: number, isLazy = false) {
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
    columns,
    rows: 2,
    every: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return () => undefined
    },
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, land: () => (state = pending), state: () => state as Record<string, number> }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

/** The two lines the module drew, each as its runs. */
const linesOf = (n: unknown): Node[][] => ((n as Node).props.children as Node[]).map(line => (line.props.children as Node[][]).flat())

const P: DashProps = { speed: 0, speedMax: 100, fuel: null, temp: null, odo: null, engine: false, fuelLow: false, heat: false, working: false, agents: 0, idleSec: 0 }

describe('dialCells', () => {
  test('the needle sits left at 0 and right at full; the lit arc takes the tint', async () => {
    const low = dialCells(0, () => '#fff')
    const high = dialCells(1, f => (f > 0.5 ? '#hi' : '#lo'))
    expect(low[1][1]?.color).toBe('#ff5a4f')
    expect(low[1][5]?.color).toBe('#4b5563')
    expect(high[1][5]?.color).toBe('#ff5a4f')
    expect(high[0].map(r => r.color)).toContain('#hi')
    expect(high[1].map(r => r.color)).toContain('#lo')
    // Each cell is a braille glyph or a blank.
    expect(high[0].every(r => r.text === ' ' || /[⠀-⣿]/.test(r.text))).toBe(true)
  })

  test('a reading that is not a number reads as 0', async () => {
    expect(dialCells(Number.NaN, () => '#fff')).toEqual(dialCells(0, () => '#fff'))
  })
})

describe('the dash module', () => {
  test('a cold start shows the speedometer, the lamps off and the coasting clock', async () => {
    const s = surfaceOf(80)
    const out = Dash({ ...P, idleSec: 75 }, s.surface)
    const [top, bottom] = linesOf(out)
    expect(textOf(top)).toContain('0     ')
    expect(textOf(top)).toContain(' ENG  FUEL  HOT ')
    expect(textOf(bottom)).toContain('tok/s')
    expect(textOf(bottom)).toContain('○ coasting 1:15')
    // Every lamp is off: dimmed gray.
    const eng = top!.find(r => textOf(r).includes('ENG'))
    expect(eng?.props.color).toBe('#6b7280')
    expect(eng?.props.dimColor).toBe(true)
    expect(s.timers).toHaveLength(1)
    // Same-styled runs merge into one Text.
    expect(top!.length).toBeLessThan(15 + 3)
  })

  test('every gauge, the odometer and the lit lamps while one agent drives', async () => {
    const s = surfaceOf(0)
    const props: DashProps = { speed: 1_234_567, speedMax: 100, fuel: 12, temp: 91, odo: 12.34, engine: true, fuelLow: true, heat: true, working: true, agents: 1, idleSec: 0 }
    Dash(props, s.surface)
    // The needles ease toward the reading at every frame.
    s.tick(20)
    expect(s.state().t).toBe(20)
    expect(s.state().sp).toBeGreaterThan(0.9)
    expect(s.state().od).toBeGreaterThan(12)
    const [top, bottom] = linesOf(Dash(props, s.surface))
    const text = textOf(top)
    // The speed is cut to its six cells; fuel and context in percent.
    expect(text).toContain('123456')
    expect(text).toContain('12%')
    expect(text).toContain('91%')
    // A low tank and a hot engine read red.
    expect(top!.find(r => textOf(r).startsWith('12%'))?.props.color).toBe('#f87171')
    expect(top!.find(r => textOf(r).startsWith('91%'))?.props.color).toBe('#f87171')
    // The odometer: dollars on gray wheels, cents on red ones.
    expect(top!.find(r => textOf(r) === '0012')?.props.backgroundColor).toBe('#1f2937')
    expect(top!.find(r => textOf(r) === '34')?.props.backgroundColor).toBe('#9f1239')
    expect(textOf(bottom)).toContain('odometer')
    expect(textOf(bottom)).toContain('◈ 1 on the road')
    // Frame 20: the blinking lamps are dark this half second; ENG stays lit.
    expect(top!.find(r => textOf(r).includes('ENG'))?.props.backgroundColor).toBe('#fb923c')
    expect(top!.find(r => textOf(r).includes('FUEL'))?.props.backgroundColor).toBeUndefined()
    expect(top!.find(r => textOf(r).includes('FUEL'))?.props.color).toBe('#fb923c')
    s.tick(10)
    const lit = linesOf(Dash(props, s.surface))[0]!
    expect(lit.find(r => textOf(r).includes('FUEL'))?.props.backgroundColor).toBe('#fb923c')
    expect(lit.find(r => textOf(r).includes('HOT'))?.props.backgroundColor).toBe('#f87171')
  })

  test('readings that fall back to nothing let the needles settle at rest', async () => {
    const s = surfaceOf(80)
    Dash({ ...P, fuel: 50, temp: 40, odo: 1 }, s.surface)
    expect(s.state()).toEqual({ t: 0, sp: 0, fu: 0.5, te: 0.4, od: 1 })
    Dash({ ...P, working: true, agents: 3 }, s.surface)
    s.tick(200)
    expect(s.state()).toMatchObject({ sp: 0, fu: 0, te: 0, od: 0 })
    expect(textOf(linesOf(Dash({ ...P, working: true, agents: 3 }, s.surface))[1])).toContain('◈ 3 on the road')
    expect(textOf(linesOf(Dash({ ...P, working: true }, s.surface))[1])).toContain('● engine running')
  })

  test('the gauge tints run through their stops', async () => {
    const s = surfaceOf(80)
    // Each gauge's value color is its tint at the needle: low, middle and high.
    const colorOf = (props: DashProps, label: string) => {
      const fresh = surfaceOf(80)
      Dash(props, fresh.surface)
      fresh.tick(400)
      return linesOf(Dash(props, fresh.surface))[0]!.find(r => textOf(r).startsWith(label))?.props.color
    }
    const speeds = new Set([10, 70, 100].map(v => colorOf({ ...P, speed: v }, String(v))))
    expect(speeds.size).toBe(3)
    const fuels = new Set([10, 60, 100].map(v => colorOf({ ...P, fuel: v }, `${v}%`)))
    expect(fuels.size).toBe(3)
    const temps = new Set([20, 60, 95].map(v => colorOf({ ...P, temp: v }, `${v}%`)))
    expect(temps.size).toBe(3)
    expect(s.timers).toHaveLength(0)
  })

  test('a narrow surface drops what does not fit', async () => {
    const s = surfaceOf(20)
    const [top] = linesOf(Dash({ ...P, fuel: 50, temp: 40, odo: 1 }, s.surface))
    expect(textOf(top)).toContain('0     ')
    expect(textOf(top)).not.toContain('50%')
    expect(textOf(top)).not.toContain('ENG')
  })

  test('a surface that batches its state draws from rest until the state lands', async () => {
    const s = surfaceOf(80, true)
    const first = linesOf(Dash({ ...P, speed: 50 }, s.surface))
    expect(textOf(first[0])).toContain('50')
    // A frame before the state landed does nothing.
    s.tick()
    expect(s.state()).toBeUndefined()
    s.land()
    s.tick()
    s.land()
    expect(s.state().t).toBe(1)
  })
})
