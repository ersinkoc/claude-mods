import { describe, expect, test } from 'claude-code/testing'

import {
  METRICS, addDays, addTo, bestDay, calendar, cutPoints, dayKey, isActive, isEmptyDelta, levelOf, minuteOf, monthOf, noonOf, streaks, totals, valueOf,
  weekdayOf, zeroDay,
} from '../hooks/calc.ts'

// Friday 2026-10-09, midday local.
const T0 = new Date(2026, 9, 9, 13, 0, 0).getTime()
const TODAY = '2026-10-09'
const day = (t: number, c = 0) => ({ ...zeroDay(), t, c })

describe('days', () => {
  test('day keys are local dates; noon keeps DST away from midnight', () => {
    expect(dayKey(T0)).toBe(TODAY)
    expect(dayKey(new Date(2026, 9, 9, 23, 59, 59).getTime())).toBe(TODAY)
    expect(dayKey(new Date(2026, 9, 10, 0, 0, 0).getTime())).toBe('2026-10-10')
    expect(noonOf(TODAY).getTime()).toBe(new Date(2026, 9, 9, 12).getTime())
    // A key without month or day is the first of January.
    expect(noonOf('2026').getTime()).toBe(new Date(2026, 0, 1, 12).getTime())
    expect(addDays(TODAY, 1)).toBe('2026-10-10')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekdayOf(TODAY)).toBe(5)
    expect(monthOf(TODAY)).toBe('Oct')
    expect(monthOf('2026-01-15')).toBe('Jan')
    expect(monthOf('not a day')).toBe('')
    expect(minuteOf(T0 + 59_999) - minuteOf(T0)).toBe(0)
    expect(minuteOf(T0 + 60_000) - minuteOf(T0)).toBe(1)
  })

  test('the calendar is 26 Sunday-first weeks ending with this week', () => {
    const cal = calendar(TODAY)
    expect(cal.length).toBe(26)
    expect(cal[25]?.[0]).toBe('2026-10-04')
    expect(cal[25]?.[5]).toBe(TODAY)
    expect(cal[25]?.[6]).toBeNull()
    expect(cal[0]?.[0]).toBe(addDays('2026-10-04', -175))
    // Every week but the last is full, and each starts on a Sunday.
    expect(cal.slice(0, 25).every(w => w.every(k => k !== null))).toBe(true)
    expect(cal.every(w => weekdayOf(w[0] as string) === 0)).toBe(true)
    // On a Sunday the last column holds today alone.
    expect(calendar('2026-10-04', 2)).toEqual([
      ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
      ['2026-10-04', null, null, null, null, null, null],
    ])
  })
})

describe('ledger', () => {
  test('adds per day, fills old shapes, prunes past the kept span', () => {
    let d = addTo({ [addDays(TODAY, -300)]: day(9), [addDays(TODAY, -1)]: { t: 4 } as never }, TODAY, { t: 2, k: 100 })
    d = addTo(d, TODAY, { t: 1, u: 0.5, s: 1, c: 3, m: 2 })
    expect(d[addDays(TODAY, -300)]).toBeUndefined()
    expect(d[addDays(TODAY, -1)]).toEqual({ s: 0, t: 4, c: 0, k: 0, u: 0, m: 0 })
    expect(d[TODAY]).toEqual({ s: 1, t: 3, c: 3, k: 100, u: 0.5, m: 2 })
    // keep = 2: yesterday stays, the day before goes.
    const short = addTo({ [addDays(TODAY, -2)]: day(1), [addDays(TODAY, -1)]: day(1) }, TODAY, { c: 1 }, 2)
    expect(Object.keys(short).sort()).toEqual([addDays(TODAY, -1), TODAY])
  })

  test('an empty delta is one with nothing in it', () => {
    expect(isEmptyDelta({})).toBe(true)
    expect(isEmptyDelta({ s: 0, t: 0, c: 0, k: 0, u: 0, m: 0 })).toBe(true)
    for (const k of ['s', 't', 'c', 'k', 'u', 'm'] as const) expect(isEmptyDelta({ [k]: 1 })).toBe(false)
  })

  test('each metric reads its own field', () => {
    const d = { s: 1, t: 2, c: 3, k: 4, u: 5, m: 6 }
    expect(METRICS.map(m => valueOf(d, m))).toEqual([2, 3, 4, 5])
    expect(METRICS.map(m => valueOf(undefined, m))).toEqual([0, 0, 0, 0])
  })

  test('a day is active with turns, tools, sessions or minutes; tokens or dollars alone do not count', () => {
    expect(isActive(undefined)).toBe(false)
    expect(isActive(zeroDay())).toBe(false)
    expect(isActive({ ...zeroDay(), k: 9, u: 1 })).toBe(false)
    expect(isActive({ ...zeroDay(), t: 1 })).toBe(true)
    expect(isActive({ ...zeroDay(), c: 1 })).toBe(true)
    expect(isActive({ ...zeroDay(), s: 1 })).toBe(true)
    expect(isActive({ ...zeroDay(), m: 1 })).toBe(true)
  })

  test('levels are quartiles of the non-zero days', () => {
    const cuts = cutPoints([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(cuts).toEqual([3, 5, 7])
    expect([0, 1, 4, 6, 8].map(v => levelOf(v, cuts))).toEqual([0, 1, 2, 3, 4])
    expect(cutPoints([])).toEqual([0, 0, 0])
    expect(cutPoints([0, 0])).toEqual([0, 0, 0])
    expect(cutPoints([7])).toEqual([7, 7, 7])
    expect(levelOf(7, [7, 7, 7])).toBe(1)
    expect(levelOf(-1, [1, 2, 3])).toBe(0)
  })

  test('streaks: today counts, an empty today keeps yesterday’s run', () => {
    const days = { [addDays(TODAY, -1)]: day(1), [addDays(TODAY, -2)]: day(2), [addDays(TODAY, -4)]: day(1), [addDays(TODAY, -5)]: day(1), [addDays(TODAY, -6)]: day(1), [addDays(TODAY, -7)]: day(1) }
    expect(streaks(days, TODAY)).toEqual({ current: 2, longest: 4 })
    expect(streaks({ ...days, [TODAY]: day(1) }, TODAY)).toEqual({ current: 3, longest: 4 })
    expect(streaks({}, TODAY)).toEqual({ current: 0, longest: 0 })
    // Two empty days end the current run.
    expect(streaks({ [addDays(TODAY, -2)]: day(1) }, TODAY)).toEqual({ current: 0, longest: 1 })
    // The longest run only looks back `span` days.
    expect(streaks({ [addDays(TODAY, -3)]: day(1), [addDays(TODAY, -4)]: day(1) }, TODAY, 4).longest).toBe(1)
  })

  test('best day and totals', () => {
    expect(bestDay({ a: day(3), b: day(7), c: day(5), d: day(7) }, 'turns')).toEqual({ date: 'b', value: 7 })
    expect(bestDay({ a: day(0, 4) }, 'turns')).toBeUndefined()
    expect(bestDay({}, 'usd')).toBeUndefined()
    expect(totals({ a: day(3, 1), b: { s: 1, t: 7, c: 2, k: 10, u: 0.25, m: 3 } }, ['a', 'b', 'z'])).toEqual({ s: 1, t: 10, c: 3, k: 10, u: 0.25, m: 3 })
    expect(totals({ a: day(3) }, [])).toEqual(zeroDay())
  })
})
