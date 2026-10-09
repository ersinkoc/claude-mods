import { describe, expect, test } from 'claude-code/testing'

import Scene from '../hooks/scene.tsx'
import type { Agent } from '../hooks/sky.ts'

// A surface in memory for the scene module: elements build plain data, timers
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
    rows: 4,
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
  return { surface: surface as never, tick, timers, state: () => state as { t: number; sig: number; at: number } | undefined }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}
const widthsOf = (n: Node): unknown[] => (n.props.children as Node[]).map(c => c.props.width)

const agent: Agent = {
  id: 'a', desc: 'Map the repo', type: 'Explore', model: 'haiku', order: 0, status: 'run',
  start: 0, end: null, tps: 12, tokens: 0, angle: 0, omega: 1,
}
const props = (now: number) => ({ agents: [agent], now, sunTps: 20, isWorking: true, width: 98, rows: 2 })

describe('scene module', () => {
  test('the first frame starts the clock and lays out field, gutter and legend', () => {
    const s = surfaceOf(0)
    const out = Scene(props(65_000), s.surface) as unknown as Node
    expect(s.timers).toHaveLength(1)
    expect(s.state()).toEqual({ t: 0, sig: 65_000, at: 0 })
    // No measured width: the props' width; rows never under three.
    expect(widthsOf(out)).toEqual([41, 3, 54])
    expect(textOf(out)).toContain('Map the repo')
    expect(textOf(out)).toContain('1:05')
    expect((out.props.children as Node[])[1]?.props.children).toHaveLength(3)
  })

  test('frames advance the local clock until the hooks publish a new now', () => {
    const s = surfaceOf(120)
    Scene(props(0), s.surface)
    s.tick(31)
    expect(s.state()?.t).toBe(31)
    // Same snapshot: time runs on from it, 31 frames of 33 ms.
    const out = Scene(props(0), s.surface) as unknown as Node
    expect(widthsOf(out)).toEqual([50, 3, 67])
    expect(textOf(out)).toContain('Explore · 0:01')
    // A new snapshot: the frame count restarts from it.
    const next = Scene(props(60_000), s.surface) as unknown as Node
    expect(s.state()).toEqual({ t: 31, sig: 60_000, at: 31 })
    expect(textOf(next)).toContain('Explore · 1:00')
    s.tick(1)
    expect(textOf(Scene(props(60_000), s.surface))).toContain('Explore · 1:00')
  })

  test('a timer firing before the first state lands does nothing', () => {
    const s = surfaceOf(80, true)
    Scene(props(0), s.surface)
    expect(s.state()).toBeUndefined()
    const fire = s.timers[0]
    fire?.()
    expect(s.state()).toBeUndefined()
    // The next tick lands it; the frame it asks lands on the one after.
    s.tick(1)
    expect(s.state()).toEqual({ t: 0, sig: 0, at: 0 })
    s.tick(1)
    expect(s.state()).toEqual({ t: 1, sig: 0, at: 0 })
  })
})
