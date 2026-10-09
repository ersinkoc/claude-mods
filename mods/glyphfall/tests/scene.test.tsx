import { describe, expect, test } from 'claude-code/testing'

import Scene from '../hooks/scene.tsx'
import type { Tool } from '../hooks/rain.ts'

// A surface in memory for the scene module: elements build plain data, timers
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
    rows: 4,
    every: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return () => undefined
    },
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, land: () => (state = pending), state: () => state as { t: number; sig: number; at: number } }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

/** The scene's lines: the rain rows, then the chips. */
const linesOf = (n: unknown): string[] => ((n as Node).props.children as unknown[]).flat().map(textOf)

const BASH: Tool = { id: 'tu1', at: 1000, end: null, name: 'Bash', detail: 'npm test', color: '#4ade80', isError: false }

describe('the glyphfall scene', () => {
  test('rain rows over the chip row, at the width the surface measured', async () => {
    const s = surfaceOf(50)
    const lines = linesOf(Scene({ tools: [BASH], now: 3000, width: 30, rows: 4 }, s.surface))
    expect(lines).toHaveLength(4)
    for (const l of lines.slice(0, 3)) expect(l.length).toBe(50)
    expect(lines[1]).toContain('Bash npm test')
    expect(lines[3]).toContain(' Bash ')
    expect(s.state()).toEqual({ t: 0, sig: 3000, at: 0 })
    expect(s.timers).toHaveLength(1)
  })

  test('frames move the clock on between snapshots; a new snapshot resets it', async () => {
    const s = surfaceOf(0)
    const props = { tools: [BASH], now: 3000, width: 30, rows: 1 }
    Scene(props, s.surface)
    s.tick(3)
    expect(s.state().t).toBe(3)
    // Before the surface measured, the props' width; one rain row at least.
    const lines = linesOf(Scene(props, s.surface))
    expect(lines).toHaveLength(2)
    expect(lines[0]?.length).toBe(30)
    Scene({ ...props, now: 4000 }, s.surface)
    expect(s.state()).toEqual({ t: 3, sig: 4000, at: 3 })
    s.tick()
    expect(s.state()).toEqual({ t: 4, sig: 4000, at: 3 })
  })

  test('a surface that batches its state draws frame 0 until it lands', async () => {
    const s = surfaceOf(20, true)
    expect(linesOf(Scene({ tools: [], now: 0, width: 20, rows: 2 }, s.surface))).toHaveLength(2)
    // A frame before the state landed does nothing.
    s.tick()
    expect(s.state()).toBeUndefined()
    s.land()
    s.tick()
    s.land()
    expect(s.state()).toEqual({ t: 1, sig: 0, at: 0 })
  })
})
