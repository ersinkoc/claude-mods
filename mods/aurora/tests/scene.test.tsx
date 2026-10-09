import { describe, expect, test } from 'claude-code/testing'

import Scene from '../hooks/scene.tsx'
import type { Mode } from '../hooks/lights.ts'

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
    rows: 3,
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
const columnsOf = (n: Node): Node[] => n.props.children as Node[]

const props = (now: number, o: { mode?: Mode; rows?: number; width?: number } = {}) => ({
  mode: o.mode ?? ('thinking' as Mode), effort: 'high', level: 0.65, now, since: 0, width: o.width ?? 70, rows: o.rows ?? 3,
})

describe('scene module', () => {
  test('the first frame starts the clock; the sky takes all but the label', () => {
    const s = surfaceOf(0)
    const out = Scene(props(12_000), s.surface) as unknown as Node
    expect(s.timers).toHaveLength(1)
    expect(s.state()).toEqual({ t: 0, sig: 12_000, at: 0 })
    const [sky, label] = columnsOf(out)
    // No measured width: the props' width.
    expect([sky?.props.width, label?.props.width]).toEqual([50, 20])
    expect(columnsOf(sky as Node)).toHaveLength(3)
    expect(textOf(label)).toContain('thinking')
    expect(textOf(label)).toContain('high · 12s')
  })

  test('a measured width wins, never under twenty; rows stay between two and three', () => {
    const wide = Scene(props(0, { rows: 9 }), surfaceOf(100).surface) as unknown as Node
    expect(columnsOf(wide)[0]?.props.width).toBe(80)
    expect(columnsOf(columnsOf(wide)[0] as Node)).toHaveLength(3)
    const tiny = Scene(props(0, { rows: 1, width: 4 }), surfaceOf(0).surface) as unknown as Node
    expect(columnsOf(tiny)[0]?.props.width).toBe(0)
    expect(columnsOf(columnsOf(tiny)[0] as Node)).toHaveLength(2)
    expect(columnsOf(columnsOf(tiny)[1] as Node)).toHaveLength(2)
  })

  test('frames advance the local clock until the hooks publish a new now', () => {
    const s = surfaceOf(70)
    Scene(props(0, { mode: 'responding' }), s.surface)
    s.tick(61)
    const out = Scene(props(0, { mode: 'responding' }), s.surface) as unknown as Node
    // 61 frames of 33 ms: two seconds on the label.
    expect(textOf(columnsOf(out)[1])).toContain('high · 2s')
    expect(textOf(columnsOf(out)[1])).toContain('responding')
    Scene(props(30_000, { mode: 'responding' }), s.surface)
    expect(s.state()).toEqual({ t: 61, sig: 30_000, at: 61 })
    s.tick(1)
    expect(textOf(columnsOf(Scene(props(30_000), s.surface) as unknown as Node)[1])).toContain('high · 30s')
  })

  test('a timer firing before the first state lands does nothing', () => {
    const s = surfaceOf(70, true)
    Scene(props(0), s.surface)
    s.timers[0]?.()
    expect(s.state()).toBeUndefined()
    s.tick(1)
    expect(s.state()).toEqual({ t: 0, sig: 0, at: 0 })
    s.tick(1)
    expect(s.state()).toEqual({ t: 1, sig: 0, at: 0 })
  })
})
