import { describe, expect, test } from 'claude-code/testing'

import type { TideFile } from '../hooks/tide.ts'
import Waves from '../hooks/waves.tsx'
import type { WavesProps } from '../hooks/waves.tsx'

// A surface in memory for the waves module: elements build plain data, the
// frame timer fires when the test ticks it, and `setState` lands at once or,
// when `isLazy`, only when the test lands it (a surface that batches updates).
type Node = { type: string; props: Record<string, unknown> & { children?: unknown[] } }
type S = { t: number; edits: Record<string, number>; surgeAt: Record<string, number> }

function surfaceOf(columns: number, isLazy = false) {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  let state: S | undefined
  let pending: S | undefined
  const timers: (() => void)[] = []
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    get state() {
      return state
    },
    setState: (s: S) => {
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
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, state: () => state, land: () => (state = pending) }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}
/** The drawn lines: wave rows, then the chip row. */
const linesOf = (n: unknown): string[] => ((n as Node).props.children as unknown[]).flat().map(textOf)

const file = (path: string, added: number, removed: number, edits: number): TideFile => ({ path, name: path.split('/').pop() ?? path, added, removed, edits, at: 0 })
const props = (files: TideFile[], rows = 3, cols = 40): WavesProps => ({ cols, rows, files, newest: files[files.length - 1]?.path ?? '' })

describe('waves', () => {
  test('first draw: starts the frame timer once, draws the waves and the chips at the surface width', async () => {
    const s = surfaceOf(40)
    const p = props([file('/w/a.ts', 12, 3, 1), file('/w/b.ts', 0, 4, 1)])
    const out = linesOf(Waves(p, s.surface))
    expect(s.timers.length).toBe(1)
    expect(out.length).toBe(3)
    expect([...out[0]!].length).toBe(40)
    expect([...out[1]!].length).toBe(40)
    expect(out[2]).toMatch(/^≋ \+12 −7 · 2 files/)
    Waves(p, s.surface)
    expect(s.timers.length).toBe(1)
  })

  test('no files yet: calm water and bare totals', async () => {
    const out = linesOf(Waves(props([], 3, 20), surfaceOf(20).surface))
    expect(out).toEqual([' '.repeat(20), ' '.repeat(20), '≋ +0 −0 · 0 files'])
  })

  test('two rows when the band is short; the props width when the surface has not laid out yet', async () => {
    const s = surfaceOf(0)
    const out = linesOf(Waves(props([file('/w/a.ts', 2, 2, 1)], 2, 24), s.surface))
    expect(out.length).toBe(2)
    expect([...out[0]!].length).toBe(24)
  })

  test('a file edited again, or a new file, surges and then settles', async () => {
    const s = surfaceOf(30)
    const a1 = file('/w/a.ts', 5, 0, 1)
    Waves(props([a1]), s.surface)
    s.tick(10)
    expect(s.state()?.t).toBe(10)
    expect(s.state()?.surgeAt).toEqual({})
    // The plugin's next props: a.ts edited again, and b.ts new.
    Waves(props([{ ...a1, edits: 2, added: 9 }, file('/w/b.ts', 1, 0, 1)]), s.surface)
    s.tick(1)
    expect(s.state()?.surgeAt).toEqual({ '/w/a.ts': 10, '/w/b.ts': 10 })
    expect(s.state()?.edits).toEqual({ '/w/a.ts': 2, '/w/b.ts': 1 })
    const surging = linesOf(Waves(props([{ ...a1, edits: 2, added: 9 }, file('/w/b.ts', 1, 0, 1)]), s.surface))
    s.tick(60)
    const settled = linesOf(Waves(props([{ ...a1, edits: 2, added: 9 }, file('/w/b.ts', 1, 0, 1)]), s.surface))
    expect(surging[2]).toMatch(/b\.ts/)
    expect(settled[2]).toMatch(/b\.ts/)
    expect(s.state()?.surgeAt).toEqual({ '/w/a.ts': 10, '/w/b.ts': 10 })
  })

  test('before its state lands the scene draws from a blank state, and its timer waits', async () => {
    const s = surfaceOf(30, true)
    const out = linesOf(Waves(props([file('/w/a.ts', 3, 1, 1)]), s.surface))
    expect(out[2]).toMatch(/a\.ts/)
    s.tick(3)
    expect(s.state()).toBeUndefined()
    s.land()
    s.tick(1)
    s.land()
    expect(s.state()?.t).toBe(1)
  })
})
