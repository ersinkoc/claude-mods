import { describe, expect, test } from 'claude-code/testing'

import Line, { cellColor } from '../hooks/line.tsx'
import type { LineProps } from '../hooks/line.tsx'
import { mix, noise } from '../hooks/lib/kz.ts'

// A surface in memory for the line module: elements build plain data, timers
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
    rows: 1,
    every: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return () => undefined
    },
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, land: () => (state = pending) }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

const partsOf = (n: unknown): Node[] => ((n as Node).props.children as Node[][]).flat()

const OFF = '#4b5563'

describe('cellColor', () => {
  test('idle breathes between the gray and the mood color', async () => {
    const p: LineProps = { mood: 'idle', color: '#60a5fa', label: '' }
    expect(cellColor(p, 0, 80, 0, 0)).toBe(mix(OFF, '#60a5fa', 0.45))
  })

  test('flow streams bands of two shades', async () => {
    const p: LineProps = { mood: 'flow', color: '#a78bfa', label: '' }
    const row = new Set(Array.from({ length: 60 }, (_, x) => cellColor(p, x, 60, 0, 0)))
    expect(row.size).toBeGreaterThan(5)
  })

  test('think sparks where the noise peaks', async () => {
    const p: LineProps = { mood: 'think', color: '#f472b6', label: '' }
    const xs = Array.from({ length: 200 }, (_, x) => x)
    const spark = xs.find(x => noise(x, 0) > 0.9)
    const calm = xs.find(x => noise(x, 0) <= 0.9)
    expect(spark).toBeDefined()
    expect(cellColor(p, spark ?? 0, 200, 0, 0)).toBe(mix('#f472b6', '#fff0fa', 0.7))
    expect(cellColor(p, calm ?? 0, 200, 0, 0)).not.toBe(mix('#f472b6', '#fff0fa', 0.7))
  })

  test('the tool comet has no tail ahead of its head', async () => {
    const p: LineProps = { mood: 'tool', color: '#4ade80', label: '' }
    // Frame 0: the head is at x = 0, every cell to its right is the dim base.
    expect(cellColor(p, 10, 100, 0, 0)).toBe(mix(mix(OFF, '#4ade80', 0.3), mix('#4ade80', '#ffffff', 0.35), 0))
  })

  test('error strobes, then settles', async () => {
    const p: LineProps = { mood: 'error', color: '#f87171', label: '' }
    const on = cellColor(p, 0, 80, 0, 0)
    const off = cellColor(p, 0, 80, 4, 4)
    expect(on).toBe('#f87171')
    expect(off).not.toBe(on)
    expect(cellColor(p, 0, 80, 200, 200)).toBe(cellColor(p, 0, 80, 204, 204))
  })

  test('wait blinks once a second with a soft edge', async () => {
    const p: LineProps = { mood: 'wait', color: '#fbbf24', label: '' }
    expect(cellColor(p, 0, 80, 0, 0)).toBe('#fbbf24')
    expect(cellColor(p, 0, 80, 18, 0)).toBe(mix(OFF, '#fbbf24', 1 - (18 / 30 - 0.55) * 10))
    expect(cellColor(p, 0, 80, 25, 0)).toBe(mix(OFF, '#fbbf24', 0.15))
  })
})

describe('line module', () => {
  test('a labelled line sets the label two cells in', async () => {
    const s = surfaceOf(30)
    const out = Line({ mood: 'tool', color: '#4ade80', label: 'Bash' }, s.surface)
    const text = textOf(out)
    expect(text.startsWith('━━ Bash ━')).toBe(true)
    expect(text).toHaveLength(30)
    expect(partsOf(out).find(n => n.props.key === 'label')?.props.bold).toBe(true)
  })

  test('an unlabelled line is all ━, at least four cells', async () => {
    const s = surfaceOf(0)
    expect(textOf(Line({ mood: 'idle', color: '#60a5fa', label: '' }, s.surface))).toBe('━'.repeat(80))
    expect(textOf(Line({ mood: 'idle', color: '#60a5fa', label: '' }, surfaceOf(2).surface))).toBe('━'.repeat(4))
  })

  test('frames advance, and a new mood restarts its own count', async () => {
    const s = surfaceOf(40)
    Line({ mood: 'error', color: '#f87171', label: '' }, s.surface)
    const first = textOf(Line({ mood: 'error', color: '#f87171', label: '' }, s.surface))
    s.tick(4)
    // Four frames into the error the strobe is in its dim half.
    const dim = partsOf(Line({ mood: 'error', color: '#f87171', label: '' }, s.surface))[0]?.props.color
    expect(dim).not.toBe('#f87171')
    expect(first).toBe('━'.repeat(40))
    // Another mood arrives: the next frame starts its count at zero.
    Line({ mood: 'wait', color: '#fbbf24', label: '' }, s.surface)
    s.tick(1)
    Line({ mood: 'error', color: '#f87171', label: '' }, s.surface)
    s.tick(1)
    expect(partsOf(Line({ mood: 'error', color: '#f87171', label: '' }, s.surface))[0]?.props.color).toBe('#f87171')
  })

  test('a surface that lands state late still draws, and its first tick waits', async () => {
    const s = surfaceOf(10, true)
    expect(textOf(Line({ mood: 'idle', color: '#60a5fa', label: '' }, s.surface))).toBe('━'.repeat(10))
    s.tick(1)
    s.land()
    s.tick(1)
    expect(textOf(Line({ mood: 'idle', color: '#60a5fa', label: '' }, s.surface))).toBe('━'.repeat(10))
  })
})
