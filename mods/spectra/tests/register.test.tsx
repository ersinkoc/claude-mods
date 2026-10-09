import { describe, expect, mock, test } from 'claude-code/testing'

import { growthSlope, ranked, recentRun, thresholdOf, toCategories, toGrid, turnsUntil } from '../hooks/calc.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-spectra',
  props: { title: 'KOZMOS · Spectra', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)

type Kind = 'used' | 'free' | 'buffer' | 'deferred'
const cat = (name: string, tokens: number, kind: Kind) => ({ name, tokens, kind, color: 'x', isDeferred: kind === 'deferred' })

function breakdown(messages: number) {
  const window = 200_000
  const categories = [
    cat('System prompt', 6_000, 'used'),
    cat('System tools', 14_000, 'used'),
    cat('Messages', messages, 'used'),
    cat('Free space', window - 20_000 - messages - 33_000, 'free'),
    cat('Autocompact buffer', 33_000, 'buffer'),
  ]
  // A 10×10 grid: one square per 2k tokens, in category order.
  const squares: { color: string; isFilled: boolean; categoryName: string; tokens: number; percentage: number; squareFullness: number }[] = []
  for (const c of categories) {
    const n = Math.round(c.tokens / 2000)
    for (let i = 0; i < n && squares.length < 100; i++) squares.push({ color: 'x', isFilled: c.kind !== 'free', categoryName: c.name, tokens: c.tokens, percentage: (c.tokens / window) * 100, squareFullness: 1 })
  }
  while (squares.length < 100) squares.push({ color: 'x', isFilled: false, categoryName: 'Free space', tokens: 0, percentage: 0, squareFullness: 0 })
  const total = 20_000 + messages
  return {
    categories, totalTokens: total, maxTokens: window, rawMaxTokens: window, autocompactSource: 'model-default' as const,
    percentage: Math.round((total / window) * 100), gridRows: Array.from({ length: 10 }, (_, r) => squares.slice(r * 10, r * 10 + 10)),
    model: 'claude-opus-5-5', memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true, autoCompactThreshold: 167_000, apiUsage: null,
  }
}

describe('calc', () => {
  test('growth slope uses the run since the last compaction', () => {
    expect(recentRun([10, 20, 30, 5, 15, 25])).toEqual([5, 15, 25])
    expect(growthSlope([10, 20, 30, 5, 15, 25])).toBe(10)
    expect(growthSlope([40])).toBeUndefined()
    expect(growthSlope([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toBe(1)
  })

  test('turns until the threshold, and the assumed threshold', () => {
    expect(turnsUntil(100_000, 160_000, 20_000)).toBe(3)
    expect(turnsUntil(100_000, 160_000, 7_000)).toBe(9)
    expect(turnsUntil(100_000, 160_000, 0)).toBeUndefined()
    expect(turnsUntil(170_000, 160_000, 10)).toBe(0)
    expect(thresholdOf(167_000, 200_000)).toEqual({ tokens: 167_000, source: 'engine' })
    expect(thresholdOf(undefined, 200_000)).toEqual({ tokens: 190_000, source: 'assumed' })
  })

  test('categories are colored, ranked and mapped onto the grid', () => {
    const cats = toCategories([cat('Free space', 100, 'free'), cat('Messages', 50, 'used'), cat('System prompt', 80, 'used')], 1000)
    expect(ranked(cats).map(c => c.name)).toEqual(['System prompt', 'Messages', 'Free space'])
    expect(cats[1]?.pct).toBe(5)
    expect(toGrid([[{ categoryName: 'Messages', squareFullness: 0.5, isFilled: true }, { categoryName: '??', squareFullness: 1, isFilled: false }]], cats)).toEqual([[[1, 0.5], [-1, 0]]])
  })
})

describe('register', () => {
  test('breakdown grid, legend, growth and forecast on both surfaces', async ($, on) => {
    mock.clock(on, { now: T0 })
    let messages = 10_000
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', ($, e) => {
      const total = 20_000 + messages
      return {
        value: {
          startedAt: T0, rateLimits: [],
          context: { tokens: total, window: 200_000, percent: (total / 200_000) * 100, ...(e.breakdown ? { breakdown: breakdown(messages) } : {}) },
        },
      }
    })
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const m of [20_000, 40_000, 60_000]) {
      messages = m
      await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: `t${m}`, reason: 'answer' })
    }
    // A subagent's turn adds no point.
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'spectra', surface, ...PANE })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /\+20k\/turn/ })).toBeDefined()
        // 80k now, compacts at 167k: 87k at 20k a turn is 5 turns.
        expect(await ui.find({ type: 'Text', text: /auto-compact in ~5 turns/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /compacts at 167k/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(3)
        expect(String(svgs[0]?.props.source)).toContain('<title>Messages')
        expect(String(svgs[2]?.props.source)).toContain('auto-compact in ~5 turns')
      }
      await ui.unmount()
    }
  })

  test('no breakdown yet: a quiet pane', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: T0, rateLimits: [], context: { window: 200_000 } } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'spectra', surface, ...PANE })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /forecast after two turns/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /assumed 95% of window/ })).toBeDefined()
      } else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})
