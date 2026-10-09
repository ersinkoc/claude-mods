import { describe, expect, test } from 'claude-code/testing'

import type { Weather } from '../types'
import Scene, { frame } from '../hooks/scene.tsx'

// A surface in memory for the scene module: elements build plain data, timers
// fire when the test ticks them, and `setState` lands at once or, when
// `isLazy`, only when the test lands it (a surface that batches its updates).
type Node = { type: string; props: Record<string, unknown> & { children?: unknown[] } }

function surfaceOf(columns: number, rows: number, isLazy = false) {
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
    rows,
    every: (_ms: number, fn: () => void) => {
      timers.push(fn)
      return () => undefined
    },
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of timers) fn()
  }
  return { surface: surface as never, tick, timers, land: () => (state = pending), state: () => state, pending: () => pending }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

const rowsOf = (n: unknown): Node[] => ((n as Node).props.children as Node[][]).flat()

/** Every glyph character a weather shows over frames 0..n-1 at width w. */
function glyphsOver(weather: Weather, w: number, n: number): Set<string> {
  const out = new Set<string>()
  for (let t = 0; t < n; t++) for (const g of frame(weather, w, t).glyphs) if (g) out.add(g.ch)
  return out
}

describe('frame', () => {
  test('clear skies fly birds with both wing strokes', async () => {
    const chars = glyphsOver('clear', 80, 1)
    expect(chars.has('v')).toBe(true)
    expect(chars.has('˅')).toBe(true)
  })

  test('a bird that flies past the right edge leaves the frame until it wraps', async () => {
    const counts = Array.from({ length: 200 }, (_, t) => frame('clear', 10, t).glyphs.filter(Boolean).length)
    expect(counts.includes(1)).toBe(true)
    expect(counts.includes(0)).toBe(true)
  })

  test('rain falls in two strokes, never through a cloud', async () => {
    expect([...glyphsOver('rain', 80, 20)].sort()).toEqual(['│', '╵'])
    for (let t = 0; t < 20; t++) {
      const { px, glyphs } = frame('rain', 80, t)
      glyphs.forEach((g, i) => {
        if (!g) return
        const row = Math.floor(i / 80)
        const x = i % 80
        expect(px[row * 2 * 80 + x] ?? px[(row * 2 + 1) * 80 + x]).toBeUndefined()
      })
    }
  })

  test('a storm strikes now and then, with a flash at its start', async () => {
    const bolts = Array.from({ length: 700 }, (_, t) => frame('storm', 60, t).glyphs.some(g => g?.ch === '╲'))
    expect(bolts.some(Boolean)).toBe(true)
    expect(bolts.every(Boolean)).toBe(false)
    const t = bolts.findIndex(Boolean)
    // The first frames of a strike light the clouds up.
    const lit = (n: number) => frame('storm', 60, n).px.includes('#e5e7eb')
    expect(lit(t - (t % 70))).toBe(true)
    expect(lit(t - (t % 70) + 3)).toBe(false)
  })

  test('fog thickens in places; night twinkles; a rainbow sparkles', async () => {
    expect([...glyphsOver('fog', 80, 1)].sort()).toEqual(['░', '▒'])
    expect([...glyphsOver('night', 200, 60)].sort()).toEqual(['+', '·', '✦'])
    expect(glyphsOver('rainbow', 80, 60).has('✧')).toBe(true)
    // The rainbow paints all six bands.
    expect(new Set(frame('rainbow', 80, 0).px.filter(Boolean)).size).toBeGreaterThan(6)
  })
})

describe('scene module', () => {
  test('three rows of sky in half blocks, then the forecast', async () => {
    const s = surfaceOf(60, 4)
    const out = Scene({ weather: 'rainbow', forecast: '🌈 Rainbow · 0/3 tools failed', tone: '#f472b6' }, s.surface)
    const rows = rowsOf(out)
    expect(rows).toHaveLength(4)
    expect(rows.slice(0, 3).every(r => textOf(r).length === 60)).toBe(true)
    const sky = rows.slice(0, 3).map(textOf).join('')
    for (const ch of ['█', '▀', '▄']) expect(sky).toContain(ch)
    expect(textOf(rows[3])).toBe('🌈 Rainbow · 0/3 tools failed')
    const parts = (rows[3]?.props.children as Node[]).map(p => [p.props.key, textOf(p)])
    expect(parts).toEqual([['h', '🌈 Rainbow'], ['r', ' · 0/3 tools failed']])
  })

  test('a glyph over a full cell keeps the sky behind it', async () => {
    // A sparkle over the rainbow's bands: its cell carries the band as background.
    const s = surfaceOf(80, 4)
    let backed = false
    for (let t = 0; t < 120 && !backed; t++) {
      const out = Scene({ weather: 'rainbow', forecast: '🌈 Rainbow', tone: '#f472b6' }, s.surface)
      for (const r of rowsOf(out).slice(0, 3)) {
        for (const p of r.props.children as Node[]) if (p.props.backgroundColor && textOf(p).includes('✧')) backed = true
      }
      s.tick(1)
    }
    expect(backed).toBe(true)
  })

  test('a short band gets the forecast line alone; one without a dot is all head', async () => {
    const s = surfaceOf(0, 2)
    const rows = rowsOf(Scene({ weather: 'clear', forecast: '☀ Clear', tone: '#f59e0b' }, s.surface))
    expect(rows).toHaveLength(1)
    expect((rows[0]?.props.children as Node[]).map(textOf)).toEqual(['☀ Clear', ''])
  })

  test('frames advance on the timer; a narrow surface still draws ten cells', async () => {
    const s = surfaceOf(4, 4)
    Scene({ weather: 'clear', forecast: '☀ Clear', tone: '#f59e0b' }, s.surface)
    s.tick(3)
    expect(s.state()).toEqual({ t: 3 })
    expect(textOf(rowsOf(Scene({ weather: 'night', forecast: '🌙 Night', tone: '#8b7cf6' }, s.surface))[0])).toHaveLength(10)
  })

  test('a surface that lands state late still draws from frame zero', async () => {
    const s = surfaceOf(30, 4, true)
    const first = Scene({ weather: 'fair', forecast: '🌤 Fair', tone: '#38bdf8' }, s.surface)
    expect(rowsOf(first)).toHaveLength(4)
    // The timer fires before the first state landed: it counts from zero.
    s.tick(1)
    expect(s.pending()).toEqual({ t: 1 })
  })
})
