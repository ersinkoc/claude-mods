import { describe, expect, test } from 'claude-code/testing'

import { averageRate, forecast, isReset, observe, statusText, verdictText } from '../hooks/calc.ts'

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()
const H = 3600_000
const M = 60_000
const D = 24 * H

describe('calc edges', () => {
  test('nothing recorded is no reset; without both reset times only a drop counts', () => {
    expect(isReset(undefined, 10, iso(T0))).toBe(false)
    const w = { samples: [[T0, 40]] as [number, number][], toasted: [] }
    expect(isReset(w, 41, iso(T0 + H))).toBe(false)
    expect(isReset({ ...w, resetsAt: iso(T0) }, 20, undefined)).toBe(true)
    // An unreadable reset time is no evidence either way.
    expect(isReset({ ...w, resetsAt: 'soon' }, 41, iso(T0 + 9 * H))).toBe(false)
  })

  test('a reading without a reset time keeps the one on record', () => {
    const w = observe(undefined, 'five_hour', 10, iso(T0 + H), T0)
    expect(observe(w, 'five_hour', 12, undefined, T0 + M).resetsAt).toBe(iso(T0 + H))
  })

  test('a window of unknown length keeps a week of samples', () => {
    let w = observe(undefined, 'spend_limit', 10, undefined, T0)
    w = observe(w, 'spend_limit', 20, undefined, T0 + 6 * D)
    expect(w.samples).toHaveLength(2)
    w = observe(w, 'spend_limit', 30, undefined, T0 + 8 * D)
    expect(w.samples).toEqual([[T0 + 6 * D, 20], [T0 + 8 * D, 30]])
  })

  test('no reset time, or one only minutes into the window, gives no average', () => {
    expect(averageRate('five_hour', 40, undefined, T0)).toBeUndefined()
    expect(averageRate('five_hour', 40, iso(T0 + 5 * H - 5 * M), T0)).toBeUndefined()
  })

  test('a forecast without a reset is safe with only the time to 100 %', () => {
    const f = forecast(50, 25, undefined)
    expect(f).toEqual({ verdict: 'safe', etaMs: 2 * H })
    expect(verdictText(f, undefined)).toBe('✓ safe — 100 % in 2h00m')
    expect(verdictText({ verdict: 'safe' }, undefined)).toBe('✓ safe — 100 % in 0s')
  })

  test('every verdict reads as one line', () => {
    expect(verdictText(forecast(100, 5, 90 * M), 90 * M)).toBe('✖ limit reached — resets in 1h30m')
    expect(verdictText(forecast(100, 5, undefined), undefined)).toBe('✖ limit reached')
    expect(verdictText({ verdict: 'dry' }, H)).toBe('⚠ dry in 0s, 0s before reset')
    expect(verdictText(forecast(30, 0, 2 * H), 2 * H)).toBe('✓ safe — idle, resets in 2h00m')
    expect(verdictText(forecast(30, 0, undefined), undefined)).toBe('✓ safe — idle')
    expect(verdictText(forecast(30, undefined, H), H)).toBe('… learning your pace')
  })

  test('no windows, no status line', () => {
    expect(statusText([], k => k)).toBeUndefined()
  })
})
