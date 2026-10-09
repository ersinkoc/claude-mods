import { describe, expect, test } from 'claude-code/testing'

import type { BbBar, BbTurn } from '../types'
import { KZ, mix } from '../hooks/lib/kz.ts'
import { addBar, addTick, axisSpan, axisTicks, fmtAxis, fmtElapsed, laneLabel, levels, MAX_BARS_PER_LANE, paint, pickLanes } from '../hooks/timeline.ts'
import { cellsOf, rowText } from './frame.ts'

const blank = (): BbTurn => ({ turnId: 't', startedAt: 0, endedAt: null, lanes: ['main'], labels: {}, bars: [], ticks: [] })
const bar = (lane: string, tool: string, s: number, e: number | null, isError = false): BbBar => ({ lane, tool, s, e, isError })

describe('axis', () => {
  test('a live turn past four hours rounds up to whole hours', async () => {
    expect(axisSpan(14_400_000, true)).toBe(18_000_000)
    expect(axisSpan(-500, true)).toBe(5000)
    expect(axisSpan(10, false)).toBe(1000)
  })

  test('tick steps fall back to an hour when no label step fits', async () => {
    expect(axisTicks(36_000_000, 1)).toEqual(Array.from({ length: 11 }, (_, i) => i * 3_600_000))
    expect(axisTicks(10_000, 0)).toEqual([0, 10_000])
  })

  test('axis labels and elapsed clocks', async () => {
    expect(fmtAxis(120_000)).toBe('2m')
    expect(fmtAxis(3_900_000)).toBe('1h05')
    expect(fmtElapsed(65_000)).toBe('1:05')
    expect(fmtElapsed(3_725_000)).toBe('1:02:05')
    expect(fmtElapsed(-3000)).toBe('0:00')
  })
})

describe('recording', () => {
  test('a lane keeps its newest bars only, oldest first out', async () => {
    const t = blank()
    for (let i = 0; i <= MAX_BARS_PER_LANE; i++) addBar(t, bar('main', 'Read', i, i + 1))
    addBar(t, bar('a1', 'Read', 0, 1))
    expect(t.bars.filter(b => b.lane === 'main')).toHaveLength(MAX_BARS_PER_LANE)
    expect(t.bars[0]?.s).toBe(1)
    expect(t.lanes).toEqual(['main', 'a1'])
  })

  test('ticks keep the newest six hundred', async () => {
    const t = blank()
    for (let i = 0; i < 605; i++) addTick(t, 'main', i)
    addTick(t, 'main', 605)
    expect(t.ticks).toHaveLength(600)
    expect(t.ticks[0]?.at).toBe(6)
    expect(t.lanes).toEqual(['main'])
  })

  test('lanes rank by their latest bar, a running one counting as now', async () => {
    const t = blank()
    addBar(t, bar('a', 'Read', 100, 200))
    addBar(t, bar('b', 'Read', 50, null))
    addBar(t, bar('c', 'Read', 300, 400))
    addTick(t, 'a', 900)
    addBar(t, bar('main', 'Read', 0, 10))
    expect(pickLanes(t, 3)).toEqual({ lanes: ['main', 'a', 'b'], hidden: 1 })
    expect(pickLanes(t, 0)).toEqual({ lanes: ['main'], hidden: 3 })
  })

  test('a lane is named by its label, else by its short id', async () => {
    const t = blank()
    t.labels.ag1 = 'Explore'
    expect(laneLabel(t, 'main')).toBe('main')
    expect(laneLabel(t, 'ag1')).toBe('Explore')
    expect(laneLabel(t, 'abcdef123')).toBe('agent abcdef')
  })

  test('levels stack overlapping calls, a running one lasting to the end', async () => {
    const a = bar('main', 'Read', 0, 10)
    const b = bar('main', 'Read', 5, null)
    const c = bar('main', 'Read', 30, 40)
    const lv = levels([c, b, a], 20)
    expect(lv.get(a)).toEqual({ level: 0, overlaps: true })
    expect(lv.get(b)).toEqual({ level: 1, overlaps: true })
    expect(lv.get(c)).toEqual({ level: 0, overlaps: false })
  })
})

describe('paint', () => {
  test('a finished turn: a stopped light, dimmed colors, the hidden lanes counted', async () => {
    const t = blank()
    t.endedAt = 10_000
    addBar(t, bar('main', 'Bash', 0, 4000, true))
    for (const lane of ['a', 'b', 'c']) addTick(t, lane, 5000)
    const f = paint(t, 99_000, 60, 2, false)
    const cells = cellsOf(f)
    expect(f.rows).toBe(3)
    expect(rowText(f, 0).startsWith('■ 0:10 +2')).toBe(true)
    expect(rowText(f, 1).startsWith('▸ main')).toBe(true)
    // A failed call is shaded, in red faded toward grey.
    const failed = cells[1]?.find(c => c.ch === '▓')
    expect(failed?.fg).toBe(mix(KZ.red, '#5a5a58', 0.6))
    // No cursor once the turn is over.
    expect(rowText(f, 1)).not.toContain('┃')
  })

  test('overlapping calls split a cell into top and bottom halves', async () => {
    const t = blank()
    // Top: 0-5 s; bottom: 2.5-7.5 s; then a lone call starting where the bottom one ends.
    addBar(t, bar('main', 'Read', 0, 5000))
    addBar(t, bar('main', 'Bash', 2500, 7500))
    addBar(t, bar('main', 'Edit', 7500, 9000))
    const f = paint(t, 9000, 60, 1, true)
    const row = rowText(f, 1)
    expect(row).toContain('▀')
    expect(row).toContain('▄')
    expect(row).toContain('█')
    const cells = cellsOf(f)[1] ?? []
    // Where the lone call starts on the bottom call's last cell, the lone call's color tops it.
    const shared = cells.find(c => c.ch === '▀' && c.fg === KZ.yellow)
    expect(shared).toBeDefined()
    expect(cells.some(c => c.ch === '▄' && c.fg === KZ.green)).toBe(true)
    // Where only the top call runs, its blue fills the upper half alone.
    expect(cells.some(c => c.ch === '▀' && c.fg === KZ.blue)).toBe(true)
  })

  test('a live turn draws the cursor, under an axis label or beside it', async () => {
    const t = blank()
    const atStart = paint(t, 0, 60, 1, true)
    // At 0 s the cursor sits on the "0s" label: the label stays, the lanes get the line.
    expect(rowText(atStart, 0)).toContain('0s')
    expect(rowText(atStart, 1)).toContain('┃')
    expect(rowText(atStart, 0).startsWith('● REC 0:00')).toBe(true)
    const later = paint(t, 2700, 60, 1, true)
    expect(rowText(later, 0)).toContain('▼')
  })
})
