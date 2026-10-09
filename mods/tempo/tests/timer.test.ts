import { describe, expect, test } from 'claude-code/testing'

import { isTimer, phaseLabel, progressOf, pruneDays, parseStart, startTimer } from '../hooks/timer.ts'

const MIN = 60_000

describe('timer edges', () => {
  test('a timer started with no lengths runs 25 and 5', async () => {
    expect(startTimer(0)).toEqual({ phase: 'work', startedAt: 0, endsAt: 25 * MIN, workMin: 25, breakMin: 5, round: 1 })
  })

  test('a phase with no length reads as done', async () => {
    expect(progressOf({ ...startTimer(0), endsAt: 0 }, 0)).toBe(1)
  })

  test('the day tally keeps the latest days and reads a missing count as 0', async () => {
    const days: Record<string, number> = { '2026-10-07': 1, '2026-10-08': null as unknown as number, '2026-10-09': 3 }
    expect(pruneDays(days, 2)).toEqual({ '2026-10-08': 0, '2026-10-09': 3 })
  })

  test('the labels of the three phases', async () => {
    expect(['work', 'break', 'long'].map(p => phaseLabel(p as 'work'))).toEqual(['Focus', 'Break', 'Long break'])
  })

  test('a break out of range is refused; w= and b= are short for work= and break=', async () => {
    expect(parseStart(['25', '90'])).toEqual({ error: 'Break length must be 1–60 minutes.' })
    expect(parseStart(['b=10', 'w=45'])).toEqual({ workMin: 45, breakMin: 10 })
  })

  test('isTimer checks every field', async () => {
    const t = startTimer(0)
    expect(isTimer(t)).toBe(true)
    expect(isTimer({ ...t, phase: 'long' })).toBe(true)
    expect(isTimer({ ...t, phase: 'break' })).toBe(true)
    expect(isTimer(null)).toBe(false)
    expect(isTimer('timer')).toBe(false)
    expect(isTimer({ ...t, phase: 'nap' })).toBe(false)
    for (const k of ['startedAt', 'endsAt', 'workMin', 'breakMin', 'round'] as const) expect(isTimer({ ...t, [k]: String(t[k]) })).toBe(false)
  })
})
