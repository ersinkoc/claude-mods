import { describe, expect, mock, test } from 'claude-code/testing'

import { averageRate, crossings, forecast, isReset, measuredRate, observe, statusText, verdictText } from '../hooks/calc.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-hourglass',
  props: { title: 'KOZMOS · Hourglass', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()
const H = 3600_000
const M = 60_000

describe('calc', () => {
  test('burn rate is the slope over the lookback, once it spans 10 minutes', () => {
    expect(measuredRate([[0, 10], [5 * M, 12]], 5 * M, 90 * M)).toBeUndefined()
    expect(measuredRate([[0, 10], [30 * M, 20]], 30 * M, 90 * M)).toBe(20)
    expect(measuredRate([[0, 10], [30 * M, 5]], 30 * M, 90 * M)).toBe(0)
    // Samples older than the lookback do not count.
    expect(measuredRate([[0, 0], [100 * M, 50], [130 * M, 60]], 130 * M, 90 * M)).toBe(20)
  })

  test('the window average runs from the window start', () => {
    // A 5h window resetting in 3h started 2h ago: 40 % in 2h is 20 %/h.
    expect(averageRate('five_hour', 40, iso(T0 + 3 * H), T0)).toBe(20)
    expect(averageRate('spend_limit', 40, iso(T0 + 3 * H), T0)).toBeUndefined()
  })

  test('forecast and verdicts', () => {
    const safe = forecast(50, 20, 1.5 * H)
    expect(safe.verdict).toBe('safe')
    expect(safe.etaMs).toBe(2.5 * H)
    expect(safe.marginMs).toBe(H)
    expect(verdictText(safe, 1.5 * H)).toBe('✓ safe — resets 1h00m before you run dry')
    const dry = forecast(80, 60, 1.5 * H)
    expect(dry.verdict).toBe('dry')
    expect(verdictText(dry, 1.5 * H)).toBe('⚠ dry in 20m, 1h10m before reset')
    expect(forecast(100, 5, H).verdict).toBe('full')
    expect(forecast(30, 0, H).verdict).toBe('idle')
    expect(forecast(30, undefined, H).verdict).toBe('learning')
  })

  test('reset detection, sampling and thresholds', () => {
    let w = observe(undefined, 'five_hour', 40, iso(T0 + H), T0)
    w = observe(w, 'five_hour', 40, iso(T0 + H), T0 + M)
    expect(w.samples.length).toBe(1)
    w = observe(w, 'five_hour', 41, iso(T0 + H), T0 + 2 * M)
    expect(w.samples.length).toBe(2)
    w = { ...w, toasted: [80] }
    expect(isReset(w, 3, iso(T0 + H))).toBe(true)
    expect(isReset(w, 41, iso(T0 + 6 * H))).toBe(true)
    expect(isReset(w, 41, iso(T0 + H + 30_000))).toBe(false)
    const after = observe(w, 'five_hour', 3, iso(T0 + 6 * H), T0 + 3 * M)
    expect(after.samples).toEqual([[T0 + 3 * M, 3]])
    expect(after.toasted).toEqual([])
    expect(crossings([], 96)).toEqual([80, 95])
    expect(crossings([80], 85)).toEqual([])
    expect(statusText([{ kind: 'five_hour', pct: 42.4 }, { kind: 'seven_day', pct: 18 }], k => (k === 'five_hour' ? '5h' : '7d'))).toBe('⏳ 5h 42% · 7d 18%')
  })
})

describe('register', () => {
  test('learns the burn, toasts once at 80 %, keeps the status line', { options: { statusLine: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let five = 40
    let fiveReset = iso(T0 + 2 * H)
    const toasts: string[] = []
    const statuses: (string | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
    on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
    on('session.usage', () => ({
      value: {
        startedAt: T0,
        context: { window: 1_000_000 },
        rateLimits: [
          { kind: 'seven_day', percentUsed: 10, resetsAt: iso(T0 + 4 * 24 * H) },
          { kind: 'five_hour', percentUsed: five, resetsAt: fiveReset },
        ],
      },
    }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    five = 50
    await clock.advance(30 * M)

    const first = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...PANE })
    expect(await first.find({ type: 'Text', text: /✓ safe — resets/ })).toBeDefined()
    expect(await first.find({ type: 'Raster' })).toBeDefined()
    await first.unmount()

    five = 85
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(15_000)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('5h limit at 85%')
    expect(statuses[statuses.length - 1]).toBe('⏳ 5h 85% · 7d 10%')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'hourglass', surface, ...PANE })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /⚠ dry in/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /85%/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(2)
        expect(String(svgs[0]?.props.source)).toContain('5-HOUR WINDOW')
        expect(String(svgs[0]?.props.source)).toContain('hgfall')
      }
      await ui.unmount()
    }

    await clock.advance(60_000)
    expect(toasts.length).toBe(1)

    // A new window: the samples and the toasts start over.
    five = 3
    fiveReset = iso(T0 + 7 * H)
    await clock.advance(15_000)
    five = 96
    await clock.advance(15_000)
    expect(toasts.length).toBe(3)
  })

  test('no subscription: a friendly note', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: [] } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'hourglass', surface, ...PANE })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /No rate-limit windows yet/ })).toBeDefined()
      else expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('No rate-limit windows yet')
      await ui.unmount()
    }
  })
})
