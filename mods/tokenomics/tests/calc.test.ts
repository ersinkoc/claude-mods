import { describe, expect, test } from 'claude-code/testing'

import {
  accrue, addUsage, costDelta, emptyLedger, parseDay, ratePerHour, splitOf, weekday,
} from '../hooks/calc.ts'

describe('calc edges', () => {
  test('a request without usage costs nothing and leaves the ledger as it was', () => {
    expect(splitOf('claude-opus-5-5', undefined)).toEqual({
      usd: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })
    const l = emptyLedger()
    expect(addUsage(l, 'claude-opus-5-5', null)).toBe(l)
  })

  test('a request with no model is booked as unknown', () => {
    const l = addUsage(emptyLedger(), '', { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    expect(l.byModel.map(r => r.model)).toEqual(['unknown'])
    expect(l.tokens.input).toBe(10)
  })

  test('no samples give no rate; a zero, negative or broken total adds nothing', () => {
    expect(ratePerHour([], 1000)).toBeUndefined()
    expect(costDelta(undefined, Number.NaN)).toBe(0)
    expect(costDelta(1, 0)).toBe(0)
    expect(costDelta(1, -2)).toBe(0)
  })

  test('a day without spend is not written', () => {
    expect(accrue({ '2026-10-08': 1 }, '2026-10-09', 0)).toEqual({ '2026-10-08': 1 })
  })

  test('a short key falls back to January and the first; a broken key has no weekday', () => {
    const y = parseDay('2026')
    expect([y.getFullYear(), y.getMonth(), y.getDate()]).toEqual([2026, 0, 1])
    const ym = parseDay('2026-05')
    expect([ym.getMonth(), ym.getDate()]).toEqual([4, 1])
    expect(weekday('2026-10-09')).toBe('Fr')
    expect(weekday('not-a-day')).toBe('')
  })
})
