import { describe, expect, mock, test } from 'claude-code/testing'

import { addDays, addTo, bestDay, calendar, cutPoints, dayKey, levelOf, streaks, totals, zeroDay } from '../hooks/calc.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-mosaic',
  props: { title: 'KOZMOS · Mosaic', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

// Friday 2026-10-09, midday local.
const T0 = new Date(2026, 9, 9, 13, 0, 0).getTime()
const TODAY = '2026-10-09'
const day = (t: number, c = 0) => ({ ...zeroDay(), t, c })

describe('calc', () => {
  test('streaks: today counts, an empty today keeps yesterday’s run', () => {
    const days = { [addDays(TODAY, -1)]: day(1), [addDays(TODAY, -2)]: day(2), [addDays(TODAY, -4)]: day(1), [addDays(TODAY, -5)]: day(1), [addDays(TODAY, -6)]: day(1), [addDays(TODAY, -7)]: day(1) }
    expect(streaks(days, TODAY)).toEqual({ current: 2, longest: 4 })
    expect(streaks({ ...days, [TODAY]: day(1) }, TODAY)).toEqual({ current: 3, longest: 4 })
    expect(streaks({}, TODAY)).toEqual({ current: 0, longest: 0 })
  })

  test('the calendar is 26 Sunday-first weeks ending with this week', () => {
    const cal = calendar(TODAY)
    expect(cal.length).toBe(26)
    expect(cal[25]?.[0]).toBe('2026-10-04')
    expect(cal[25]?.[5]).toBe(TODAY)
    expect(cal[25]?.[6]).toBeNull()
    expect(cal[0]?.[0]).toBe(addDays('2026-10-04', -175))
  })

  test('levels are quartiles of the non-zero days', () => {
    const cuts = cutPoints([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(cuts).toEqual([3, 5, 7])
    expect([0, 1, 4, 6, 8].map(v => levelOf(v, cuts))).toEqual([0, 1, 2, 3, 4])
  })

  test('ledger adds and prunes, best day and totals', () => {
    let d = addTo({ [addDays(TODAY, -300)]: day(9) }, TODAY, { t: 2, k: 100 })
    d = addTo(d, TODAY, { t: 1, u: 0.5 })
    expect(d[addDays(TODAY, -300)]).toBeUndefined()
    expect(d[TODAY]).toEqual({ s: 0, t: 3, c: 0, k: 100, u: 0.5, m: 0 })
    expect(bestDay({ a: day(3), b: day(7), c: day(5) }, 'turns')).toEqual({ date: 'b', value: 7 })
    expect(totals({ a: day(3, 1), b: day(7, 2) }, ['a', 'b', 'z']).c).toBe(3)
    expect(dayKey(T0)).toBe(TODAY)
  })
})

describe('register', () => {
  test('counts the day, draws the calendar, switches the metric', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, {
      days: { [addDays(TODAY, -1)]: { s: 1, t: 5, c: 40, k: 9e5, u: 2, m: 30 }, [addDays(TODAY, -2)]: { s: 1, t: 30, c: 9, k: 1e5, u: 1, m: 20 } },
    })
    let cost = 0.4
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: cost } } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
        usage: { model: e.model, input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8500, cache_creation_input_tokens: 0 },
      }
    })
    on('tool.call', () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of stream) void _
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    cost = 1.4
    await clock.advance(90_000)
    await $.turn.complete({ answer: '', durationMs: 90_000, isAborted: false, turnId: 't1', reason: 'answer' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mosaic', surface, ...PANE })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /3-day streak/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /1 turns · 2 tools · 10k tok · \$1\.40/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /1 sess/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /best Oct 7 \(30\)/ })).toBeDefined()
        await $.ui.press({ plugin: 'mosaic', key: 'm-tools', surface })
        expect(await ui.find({ type: 'Text', text: /MOSAIC · tools/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /best Oct 8 \(40\)/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(3)
        expect(String(svgs[0]?.props.source)).toContain('ACTIVITY · TOOLS')
        expect(String(svgs[0]?.props.source)).toContain('<title>Oct 8 · 40 tools</title>')
        expect(await ui.find({ type: 'Button', key: 'm-usd' })).toBeDefined()
      }
      await ui.unmount()
    }
  })

  test('an empty history still draws', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: [] } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mosaic', surface, ...PANE })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /1-day streak/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})
