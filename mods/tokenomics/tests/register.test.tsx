import { describe, expect, mock, test } from 'claude-code/testing'

import {
  accrue, addDays, addUsage, averagePerHour, cacheHitRatio, costDelta, emptyLedger, lastDays, ledgerUsd, ratePerHour, splitOf,
} from '../hooks/calc.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-tokenomics',
  props: { title: 'KOZMOS · Tokenomics', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)

describe('calc', () => {
  test('a request splits into its four token types at the model price', () => {
    const s = splitOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })
    expect(s.usd).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
    expect(s.tokens.cacheRead).toBe(1_000_000)
  })

  test('the ledger sums by model, sorted by spend, and by type', () => {
    let l = emptyLedger()
    l = addUsage(l, 'claude-haiku-5', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    l = addUsage(l, 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    l = addUsage(l, 'claude-opus-5-5', { input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    expect(l.byModel.map(r => r.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5'])
    expect(l.byModel[0]?.steps).toBe(2)
    expect(Math.round(ledgerUsd(l) * 100) / 100).toBe(6.1)
    expect(l.steps).toBe(3)
  })

  test('cache hit ratio is cache reads over all input', () => {
    expect(cacheHitRatio({ input: 100, output: 999, cacheRead: 800, cacheWrite: 100 })).toBe(0.8)
    expect(cacheHitRatio({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
  })

  test('burn rate needs five minutes of samples; the average needs one', () => {
    const now = 3_600_000
    expect(ratePerHour([[now - 60_000, 1], [now, 2]], now)).toBeUndefined()
    expect(ratePerHour([[now - 20 * 60_000, 1], [now, 3]], now)).toBe(6)
    expect(averagePerHour(2, 0, 30 * 60_000)).toBe(4)
    expect(averagePerHour(2, 0, 30_000)).toBeUndefined()
  })

  test('cost deltas, day ledger and pruning', () => {
    expect(costDelta(undefined, 1.5)).toBe(1.5)
    expect(costDelta(1.5, 2)).toBe(0.5)
    expect(costDelta(3, 1)).toBe(1)
    const old = addDays('2026-10-09', -61)
    const days = accrue({ [old]: 9, '2026-10-08': 1 }, '2026-10-09', 2)
    expect(days[old]).toBeUndefined()
    expect(days['2026-10-09']).toBe(2)
    const rows = lastDays(days, '2026-10-09', 14)
    expect(rows.length).toBe(14)
    expect(rows[12]).toEqual({ date: '2026-10-08', usd: 1 })
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('register', () => {
  test('the pane shows cost, splits and days on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, { days: { [addDays('2026-10-09', -1)]: 4.5 } })
    let cost = 0.5
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('session.usage', () => ({
      value: { startedAt: T0 - 3600_000, context: { tokens: 1000, window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: cost } },
    }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
        usage: { model: e.model, input_tokens: 2000, output_tokens: 5000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 8000 },
      }
    })
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    await $.turn.start({ text: 'hi', turnId: 't1' })
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of stream) void _
    await stream.result
    const sub = $.turn.step({ turnId: 'a1', index: 0, model: 'claude-haiku-5', messageCount: 1, agentId: 'ag1' })
    for await (const _ of sub) void _
    cost = 1.75
    await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(3000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tokenomics', surface, ...PANE })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /\$1\.75/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /Haiku 5/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /cache read/ })).toBeDefined()
        expect(await ui.find({ type: 'Raster' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /today \$1\.75/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(4)
        expect(String(svgs[0]?.props.source)).toContain('$1.75')
        expect(String(svgs[3]?.props.source)).toContain('$4.50')
      }
      await ui.unmount()
    }
  })

  test('a fresh session with no data still draws', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: [] } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tokenomics', surface, ...PANE })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /no request priced yet/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})
