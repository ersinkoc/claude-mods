import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { addDays, zeroDay } from '../hooks/calc.ts'
import { KZ, hexToInt, mix } from '../hooks/lib/kz.ts'

const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-mosaic',
  props: { title: 'KOZMOS · Mosaic', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
})
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

// Friday 2026-10-09, 13:00 local.
const T0 = new Date(2026, 9, 9, 13, 0, 0).getTime()
const TODAY = '2026-10-09'
const EMPTY = '#30363d'
const shadeOf = (color: string, t: number) => mix('#1f2a24', color, t)

type Found = { text: string; props: Record<string, unknown> }
type Mounted = { find: (q: { type: string; key?: string; text?: string | RegExp }) => Promise<Found | undefined>; findAll: (q: { type: string }) => Promise<Found[]> }

const texts = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const svgs = async (ui: Mounted) => (await ui.findAll({ type: 'Svg' })).map(s => ({ source: String(s.props.source), alt: String(s.props.alt), height: s.props.height }))

/** The cells of a drawn Raster: each cell is three little-endian words, character, foreground, background. */
async function raster(ui: Mounted) {
  const r = await ui.find({ type: 'Raster' })
  const cols = r?.props.columns as number
  const bin = atob(String(r?.props.cells))
  const word = (i: number) => (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0
  const at = (x: number, y: number) => ({ ch: String.fromCodePoint(word((y * cols + x) * 12)), fg: word((y * cols + x) * 12 + 4) })
  return { cols, rows: r?.props.rows, at, row: (y: number) => Array.from({ length: cols }, (_, x) => at(x, y).ch).join('') }
}

/** A session already counted, over a stored history. */
function world(on: On, days: Record<string, unknown>): void {
  mock.store(on, { days, sessions: [String(T0)] })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: T0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
}

describe('pane', () => {
  test('before any session: an empty calendar, no streak, nothing best', async ($, on) => {
    mock.clock(on, { now: T0 })
    const term = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(44) })
    const all = await texts(term)
    expect(all).toContain('◆ MOSAIC · turns')
    expect(all).toContain('no streak')
    expect(all).toContain('streak 0d')
    expect(all).toContain(' · longest 0d · best —')
    expect(all).toContain('Σ 0 turns · 0 tools · 0 tok · $0.00 · 0m · 0 sessions')
    expect(all).toContain('0 turns · 0 tools · 0 tok · $0.00 · 0m · 0 sess.')
    expect((await term.find({ type: 'Text', text: 'no streak' }))?.props.color).toBe(KZ.mist)
    // Today is a diamond in the mist; every other day an empty square.
    const r = await raster(term)
    expect(r.at(27, 6)).toEqual({ ch: '◆', fg: hexToInt(KZ.mist) })
    expect(r.at(27, 5)).toEqual({ ch: '■', fg: hexToInt(EMPTY) })
    expect(r.at(27, 7).ch).toBe(' ')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    const [cal, stats, today] = await svgs(desk)
    expect(cal?.source).not.toContain('day streak')
    expect(cal?.source).not.toContain('class="mo4"')
    expect(cal?.source).toContain('<title>Oct 9 · 0 turns</title>')
    expect(cal?.alt).toBe('Activity calendar of the last 26 weeks by turns')
    expect(stats?.source).toContain('start one today')
    expect(stats?.source).toContain('no data yet')
    expect(stats?.alt).toBe('Current streak 0 days, longest 0 days, best day none')
    expect(today?.source).toContain(`fill="${KZ.mist}" class=""`)
    expect(today?.alt).toBe('Today: 0 turns, 0 tool calls, 0 tokens, $0.00, 0m active, 0 sessions')
    await desk.unmount()
  })

  test('terminal widths: one cell per day when narrow, two when wide; month labels fit or are left out', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on, {})
    await $.session.start(START)
    // No width given reads as 40 columns: one cell a day.
    const narrow = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(0) })
    let r = await raster(narrow)
    expect([r.cols, r.rows]).toEqual([28, 8])
    expect(r.at(27, 6).ch).toBe('◆')
    expect([r.at(0, 2).ch, r.at(0, 4).ch, r.at(0, 6).ch]).toEqual(['M', 'W', 'F'])
    // The first week starts on Sunday April 12. May 3 (week 3) would touch "Apr";
    // Sep 6 is week 21; Oct 4 has no room left at the edge.
    expect(r.row(0)).toBe('  Apr     Jun Jul Aug  Sep  ')
    expect(await narrow.find({ type: 'Text', text: / more · 26 weeks/ })).toBeDefined()
    await narrow.unmount()

    const wide = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(80) })
    r = await raster(wide)
    expect(r.cols).toBe(54)
    expect(r.at(52, 6).ch).toBe('◆')
    expect(r.at(51, 6).ch).toBe(' ')
    expect(r.row(0).trimEnd()).toBe('  Apr   May       Jun     Jul     Aug       Sep')
    await wide.unmount()
  })

  test('shades follow the quartiles; the legend, the streak and the best day', async ($, on) => {
    mock.clock(on, { now: T0 })
    const d = (t: number) => ({ ...zeroDay(), t })
    world(on, { [addDays(TODAY, -1)]: d(8), [addDays(TODAY, -2)]: d(4), [addDays(TODAY, -3)]: d(3), [addDays(TODAY, -4)]: d(2), [addDays(TODAY, -5)]: d(1) })
    await $.session.start(START)

    const term = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(44) })
    const g = KZ.green
    const r = await raster(term)
    // The last column is this week: Sunday Oct 4 down to Thursday Oct 8, then today.
    expect([0, 1, 2, 3, 4].map(y => r.at(27, 1 + y).fg)).toEqual([0.35, 0.35, 0.58, 0.8, 1].map(t => hexToInt(shadeOf(g, t))))
    expect(r.at(27, 6)).toEqual({ ch: '◆', fg: hexToInt(KZ.mist) })
    expect(r.at(26, 7)).toEqual({ ch: '■', fg: hexToInt(EMPTY) })
    const legend = (await term.findAll({ type: 'Text' })).filter(t => t.text === '■').map(t => t.props.color)
    expect(legend).toEqual([EMPTY, shadeOf(g, 0.35), shadeOf(g, 0.58), shadeOf(g, 0.8), shadeOf(g, 1)])
    const all = await texts(term)
    expect(all).toContain('▲ 5-day streak')
    expect((await term.find({ type: 'Text', text: '▲ 5-day streak' }))?.props.color).toBe(KZ.amber)
    expect(all).toContain(' · longest 5d · best Oct 8 (8)')
    expect(all).toContain('Σ 18 turns · 0 tools · 0 tok · $0.00 · 0m · 0 sessions')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    const [cal, stats] = await svgs(desk)
    expect(cal?.source).toContain('▲ 5-day streak')
    expect(cal?.source.match(/class="mo4"/g)?.length).toBe(1)
    for (const op of ['0.32', '0.55', '0.78']) expect(cal?.source).toContain(`fill-opacity="${op}"`)
    expect(cal?.source).toContain('class="motd"')
    expect(cal?.source).toContain('<title>Oct 8 · 8 turns</title>')
    expect(cal?.source).toContain('>less</text>')
    expect(cal?.source).toContain('>more</text>')
    expect(stats?.source).toContain('keep it going')
    expect(stats?.source).toContain('>Oct 8</text>')
    expect(stats?.alt).toBe('Current streak 5 days, longest 5 days, best day Oct 8 with 8')
    await desk.unmount()
  })

  test('big numbers, hours, tokens and dollars on every metric', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on, { [addDays(TODAY, -1)]: { s: 2, t: 12_000, c: 15_000, k: 1_500_000, u: 3, m: 75 } })
    await $.session.start(START)

    const term = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(44) })
    expect(await texts(term)).toContain('Σ 12k turns · 15k tools · 1.5M tok · $3.00 · 1h15m · 2 sessions')
    expect(await texts(term)).toContain('best Oct 8 (12k)')
    for (const [key, best] of [['m-tools', '15k'], ['m-tokens', '1.5M'], ['m-usd', '$3.00']] as const) {
      await $.ui.press({ plugin: 'mosaic', key, surface: 'terminal' })
      expect(await texts(term)).toContain(`best Oct 8 (${best})`)
    }
    expect(await texts(term)).toContain('◆ MOSAIC · $')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    let [cal, stats] = await svgs(desk)
    expect(cal?.source).toContain('ACTIVITY · $')
    expect(cal?.source).toContain('<title>Oct 8 · $3.00 </title>')
    expect(stats?.source).toContain('2 sessions · 1h15m')
    expect(stats?.alt).toBe('Current streak 1 days, longest 1 days, best day Oct 8 with $3.00')
    await $.ui.press({ plugin: 'mosaic', key: 'm-tokens', surface: 'desktop' })
    ;[cal, stats] = await svgs(desk)
    expect(cal?.source).toContain('ACTIVITY · TOKENS')
    expect(cal?.source).toContain('<title>Oct 8 · 1.5M tokens</title>')
    expect(cal?.alt).toBe('Activity calendar of the last 26 weeks by tokens')
    await desk.unmount()
  })

  test('days before the drawn range are left out of the pane', async ($, on) => {
    mock.clock(on, { now: T0 })
    const old: Record<string, unknown> = {}
    for (let i = 190; i < 200; i++) old[addDays(TODAY, -i)] = { ...zeroDay(), t: 1 }
    world(on, old)
    await $.session.start(START)
    const term = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(44) })
    // Ten days in a row, but before the drawn range: no streak is shown from them.
    expect(await texts(term)).toContain(' · longest 0d · best —')
    expect(await texts(term)).toContain('no streak')
    await term.unmount()
  })

  test('a month label with no room after the previous one is left out', async ($, on) => {
    // Friday Oct 23: the calendar starts on Sunday April 26, one week before May.
    mock.clock(on, { now: new Date(2026, 9, 23, 13, 0, 0).getTime() })
    const term = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...pane(80) })
    const row = (await raster(term)).row(0)
    expect(row.slice(0, 17)).toBe('  Apr         Jun')
    expect(row).not.toContain('May')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    const [cal] = await svgs(desk)
    expect(cal?.source).toContain('>Apr</text>')
    expect(cal?.source).not.toContain('>May</text>')
    expect(cal?.source).toContain('>Jun</text>')
    await desk.unmount()
  })

  test('working: the dot on the desktop pulses until the turn ends', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, {})
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(10_000)
    let desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    let today = (await svgs(desk))[2]
    expect(today?.source).toContain(`fill="${KZ.green}" class="pulse"`)
    expect(today?.alt).toBe('Today: 0 turns, 0 tool calls, 0 tokens, $0.00, 1m active, 0 sessions')
    await desk.unmount()
    await $.turn.complete({ answer: '', durationMs: 10_000, isAborted: false, turnId: 't1', reason: 'answer' })
    desk = await $.ui.mount({ plugin: 'mosaic', surface: 'desktop', ...pane(44) })
    today = (await svgs(desk))[2]
    expect(today?.source).toContain(`fill="${KZ.mist}" class=""`)
    expect(today?.alt).toBe('Today: 1 turns, 0 tool calls, 0 tokens, $0.00, 1m active, 0 sessions')
    await desk.unmount()
  })
})
