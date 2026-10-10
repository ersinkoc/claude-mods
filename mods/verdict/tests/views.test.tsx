import { describe, expect, test } from 'claude-code/testing'

import type { VerdictRun } from '../types'
import Bench from '../hooks/bench.tsx'
import type { BenchProps } from '../hooks/bench.tsx'
import { bandSvg, chipsOf, duration, failureLines, paneCard, runSummary, sparkBars } from '../hooks/view.ts'
import type { Chip } from '../hooks/view.ts'

const run = (o: Partial<VerdictRun>): VerdictRun => ({
  id: 1, at: 0, ms: 0, runner: 'vitest', kind: 'test', ok: true, pass: 0, fail: 0, skip: 0, errors: 0, warnings: 0, failures: [], command: 'x', parsed: true, ...o,
})
const chip = (o: Partial<Chip>): Chip => ({ runner: 'vitest', text: '✓ vitest 3', ok: true, spark: [{ h: 1, ok: true }], failures: [], at: 0, ...o })

describe('view helpers', () => {
  test('chips only for runners seen since the session began', () => {
    const chips = chipsOf([run({ runner: 'old', at: 10 }), run({ runner: 'new', at: 200 })], 100)
    expect(chips.map(c => c.runner)).toEqual(['new'])
  })

  test('spark bars from health', () => {
    expect(sparkBars([{ h: 0, ok: false }, { h: 0.5, ok: true }, { h: 2, ok: true }]).map(b => b.s).join('')).toBe('▁▅█')
  })

  test('the band: no failure line when asked for one row; chips that do not fit are counted', () => {
    const many = Array.from({ length: 8 }, (_, i) => chip({ runner: `r${i}`, text: `✗ runner-number-${i} 12 failed`, ok: false, failures: [`t${i}`] }))
    const one = bandSvg(many, 300, false)
    expect(one.height).toBe(30)
    expect(one.source).not.toContain('↳')
    expect(one.source).toMatch(/>\+\d+</)
    const two = bandSvg(many, 300, true)
    expect(two.height).toBe(54)
    expect(two.source).toContain('↳ r0: t0')
  })

  test('the failure lines name their runner', () => {
    expect(failureLines([chip({ runner: 'jest', failures: ['a', 'b'] })])).toEqual(['jest: a', 'jest: b'])
  })

  test('the pane card: empty, and one, two or three columns', () => {
    const empty = paneCard([], 400)
    expect(empty.height).toBe(56)
    expect(empty.source).toContain('No runs yet')
    const three = [chip({ runner: 'a' }), chip({ runner: 'b', ok: false }), chip({ runner: 'c' })]
    expect(paneCard(three, 600).height).toBe(64)
    expect(paneCard(three, 400).height).toBe(64 * 2 + 8)
    expect(paneCard(three, 300).height).toBe(64 * 3 + 16)
  })

  test('durations', () => {
    expect(duration(420)).toBe('420ms')
    expect(duration(4_200)).toBe('4.2s')
    expect(duration(42_000)).toBe('42s')
    expect(duration(999.5)).toBe('1.0s')
    expect(duration(59_500)).toBe('1m00s')
    expect(duration(3_599_999)).toBe('60m00s')
    expect(duration(125_000)).toBe('2m05s')
  })

  test('a run in words', () => {
    expect(runSummary(run({ pass: 0, parsed: false, ok: true }))).toBe('passed')
    expect(runSummary(run({ pass: 0, parsed: false, ok: false }))).toBe('failed')
    expect(runSummary(run({ pass: 4, fail: 1, skip: 2, errors: 1 }))).toBe('4 passed · 1 failed · 2 skipped · 1 error')
    expect(runSummary(run({ pass: 0, errors: 3 }))).toBe('0 passed · 3 errors')
    expect(runSummary(run({ kind: 'build', ok: true }))).toBe('built')
    expect(runSummary(run({ kind: 'types', ok: true, warnings: 1 }))).toBe('0 errors · 1 warning')
    expect(runSummary(run({ kind: 'lint', ok: true, errors: 2, warnings: 3 }))).toBe('2 errors · 3 warnings')
    expect(runSummary(run({ kind: 'build', ok: false }))).toBe('1 error')
    expect(runSummary(run({ kind: 'build', ok: false, errors: 1 }))).toBe('1 error')
  })
})

// A surface in memory for the bench module: elements build plain data, the
// frame timer fires when the test ticks it, and `setState` lands at once or,
// when `isLazy`, only when the test applies it.
type Node = { type: string; props: Record<string, unknown> & { children?: unknown } }

function surfaceOf(columns: number, isLazy = false) {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  let state: { t: number } | undefined
  let pending: { t: number } | undefined
  const timers: (() => void)[] = []
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    get state() {
      return state
    },
    setState: (s: { t: number }) => {
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
  const apply = () => {
    state = pending
  }
  return { surface: surface as never, tick, apply, timers, state: () => state }
}

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const node = n as Node | null
  return node ? textOf(node.props.children ?? []) : ''
}

const props = (o: Partial<BenchProps> = {}): BenchProps => ({ cols: 60, rows: 2, chips: [], failures: [], ...o })

describe('bench module', () => {
  test('the first frame starts the clock; chips show with their bars', () => {
    const s = surfaceOf(0)
    const chips = [chip({ text: '✓ vitest 3', spark: [{ h: 0.2, ok: false }, { h: 1, ok: true }] }), chip({ runner: 'tsc', text: '✗ tsc 2 errors', ok: false, spark: [{ h: 1, ok: true }, { h: 0.3, ok: false }] })]
    const out = Bench(props({ chips }), s.surface) as unknown as Node
    expect(s.timers).toHaveLength(1)
    expect(s.state()).toEqual({ t: 0 })
    const text = textOf(out)
    expect(text).toContain('✓ vitest 3 ▂█')
    expect(text).toContain(' · ')
    expect(text).toMatch(/[◉○] tsc 2 errors █▃/)
    s.tick(3)
    expect(s.state()).toEqual({ t: 3 })
  })

  test('the beacon blinks with the pulse', () => {
    const s = surfaceOf(60)
    const chips = [chip({ text: '✗ jest 1 failed', ok: false })]
    Bench(props({ chips }), s.surface)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      s.tick()
      seen.add(textOf(Bench(props({ chips }), s.surface)).slice(0, 1))
    }
    expect(seen.size).toBe(2)
    expect(seen.has('○') && seen.has('◉')).toBe(true)
  })

  test('chips that do not fit are counted', () => {
    const s = surfaceOf(30)
    const chips = Array.from({ length: 4 }, (_, i) => chip({ runner: `r${i}`, text: `✓ runner${i} 100` }))
    expect(textOf(Bench(props({ chips }), s.surface))).toBe('✓ runner0 100 █  +3')
  })

  test('the failing tests type out one after another, with a cursor and a counter', () => {
    const s = surfaceOf(40)
    const failures = ['vitest: a long failing test name that will not fit in forty columns at all', 'jest: b']
    const draw = () => textOf(Bench(props({ chips: [chip({ ok: false, text: '✗ vitest 2 failed' })], failures }), s.surface))
    expect(draw()).toContain('↳ 1/2 vit▌')
    s.tick(30)
    expect(draw()).toContain('…')
    s.tick(45)
    expect(draw()).toMatch(/2\/2 jes▌$/)
    s.tick(2)
    expect(draw()).toMatch(/2\/2 jest: b$/)
    const single = surfaceOf(40)
    expect(textOf(Bench(props({ failures: ['only one'] }), single.surface))).toContain('  ↳ onl')
    expect(textOf(Bench(props({ rows: 1, failures: ['hidden'] }), single.surface))).not.toContain('↳')
  })

  test('a surface that applies state late still counts frames from zero', () => {
    const s = surfaceOf(60, true)
    expect(textOf(Bench(props(), s.surface))).toBe('')
    s.tick()
    s.apply()
    expect(s.state()).toEqual({ t: 1 })
  })
})
