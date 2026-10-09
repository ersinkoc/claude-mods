import { describe, expect, test } from 'claude-code/testing'

import Bar from '../hooks/bar.tsx'
import type { BarProps } from '../hooks/bar.tsx'

// A surface in memory for the bar module: elements build plain data, timers
// fire when the test ticks them, and `setState` lands at once or, when
// `isLazy`, only on the next tick (as a surface that batches its updates).
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
    for (let i = 0; i < n; i++) {
      if (pending !== undefined) state = pending
      pending = undefined
      for (const fn of timers) fn()
    }
  }
  return { surface: surface as never, tick, timers, land: () => ((state = pending), (pending = undefined)) }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

const colorsOf = (n: Node): string[] => ((n.props.children?.[0] as Node).props.children as Node[]).map(c => String(c.props.color))

const base: BarProps = { marks: 'dap', done: 1, total: 3, activeText: 'Doing', activeMs: 5000, allDone: false }

describe('bar module', () => {
  test('draws done, running and waiting segments with the count and the clock', async () => {
    const s = surfaceOf(80)
    const out = Bar(base, s.surface) as unknown as Node
    expect(textOf(out)).toBe('██████ ██████ ░░░░░░  1/3 · ▶ Doing · 0:05')
    expect(colorsOf(out)[0]).toBe('#4ade80')
    expect(s.timers).toHaveLength(1)
  })

  test('the clock ticks locally and restarts from a new figure', async () => {
    const s = surfaceOf(80)
    Bar(base, s.surface)
    s.tick(25)
    expect(textOf(Bar(base, s.surface))).toContain('Doing · 0:06')
    // The hooks publish a new figure: the count starts over from it.
    Bar({ ...base, activeMs: 3_600_000 }, s.surface)
    s.tick(1)
    expect(textOf(Bar({ ...base, activeMs: 3_600_000 }, s.surface))).toContain('Doing · 1:00:00')
  })

  test('the sweep highlights one cell of the running segment', async () => {
    const s = surfaceOf(80)
    Bar({ ...base, marks: 'a' }, s.surface)
    s.tick(3)
    const colors = colorsOf(Bar({ ...base, marks: 'a' }, s.surface) as unknown as Node)
    expect(colors).toContain('#ede9fe')
  })

  test('all done rolls a bright wave across the bar', async () => {
    const s = surfaceOf(0)
    const props = { ...base, marks: 'ddd', done: 3, allDone: true, activeText: '', activeMs: -1 }
    const first = Bar(props, s.surface) as unknown as Node
    expect(textOf(first)).toContain('✓ 3/3 quest complete')
    // At t=0 the wave sits on the first cells: they glow paler than the rest.
    expect(colorsOf(first)[0]).not.toBe('#4ade80')
    s.tick(200)
    expect(colorsOf(Bar(props, s.surface) as unknown as Node)).toContain('#4ade80')
  })

  test('idle bar waits for the next task; a running quest without a clock shows none', async () => {
    const s = surfaceOf(80)
    expect(textOf(Bar({ ...base, activeText: '', activeMs: -1 }, s.surface))).toContain('· waiting for the next task')
    expect(textOf(Bar({ ...base, activeMs: -1 }, s.surface))).toMatch(/▶ Doing$/)
  })

  test('many quests pack into single cells without gaps', async () => {
    const s = surfaceOf(20)
    const out = Bar({ ...base, marks: 'p'.repeat(30) }, s.surface) as unknown as Node
    expect(textOf(out).startsWith('░'.repeat(30) + ' 1/3')).toBe(true)
  })

  test('a surface that lands state late still draws, and its first tick waits', async () => {
    const s = surfaceOf(80, true)
    expect(textOf(Bar(base, s.surface))).toContain('Doing · 0:05')
    // The timer fires before the first state landed: nothing to advance yet.
    for (const fn of s.timers) fn()
    s.land()
    s.tick(1)
    expect(textOf(Bar(base, s.surface))).toContain('Doing · 0:05')
  })
})
