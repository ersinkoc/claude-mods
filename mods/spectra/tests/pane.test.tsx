import { describe, expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { KZ } from '../hooks/lib/kz.ts'

const PANE_ID = 'kz-spectra'
const PROPS = { title: 'KOZMOS · Spectra', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)

type Kind = 'used' | 'free' | 'buffer' | 'deferred'
type Square = { categoryName: string; squareFullness: number; isFilled: boolean; color: string; tokens: number; percentage: number }
const cat = (name: string, tokens: number, kind: Kind) => ({ name, tokens, kind, color: 'x', isDeferred: kind === 'deferred' })
const sq = (categoryName: string, squareFullness: number, isFilled = true): Square =>
  ({ categoryName, squareFullness, isFilled, color: 'x', tokens: 0, percentage: 0 })

type Breakdown = {
  total: number
  raw?: number
  max?: number
  isAuto?: boolean
  threshold?: number
  grid?: Square[][]
  categories?: ReturnType<typeof cat>[]
}

/** A context breakdown as `$.session.usage({ breakdown })` answers it. */
function breakdown(b: Breakdown) {
  return {
    categories: b.categories ?? [cat('System prompt', 6_000, 'used'), cat('Messages', b.total - 6_000, 'used'), cat('Free space', 100_000, 'free'), cat('Autocompact buffer', 33_000, 'buffer'), cat('MCP tools', 3_000, 'deferred')],
    totalTokens: b.total, maxTokens: b.max ?? 200_000, rawMaxTokens: b.raw ?? 200_000, autocompactSource: 'model-default' as const,
    percentage: Math.round((b.total / 200_000) * 100), gridRows: b.grid ?? [],
    model: 'claude-opus-5-5', memoryFiles: [{ path: 'CLAUDE.md', type: 'Project', tokens: 900 }, { path: '~/.claude/CLAUDE.md', type: 'User', tokens: 300 }], mcpTools: [{ name: 'search', serverName: 'web', tokens: 3_000, isLoaded: true }], agents: [], isAutoCompactEnabled: b.isAuto ?? true, autoCompactThreshold: b.threshold ?? 167_000, apiUsage: null,
  }
}

/** What the next `$.session.usage()` answers: a total with or without a breakdown, or a failure. */
type Usage = { startedAt?: number; tokens?: number; percent?: number; breakdown?: Breakdown; fails?: boolean }

/** The clock fails while `isBroken`, and on the reads numbered in `failAt` (1 is the first). */
type World = { usage: Usage; clock: { now: number; isBroken: boolean; reads: number; failAt: number[] }; open: Set<string> }

function world(on: On, usage: Usage = {}, opts: { turnComplete?: boolean } = {}): World {
  const w: World = { usage, clock: { now: T0, isBroken: false, reads: 0, failAt: [] }, open: new Set() }
  on('clock.now', ($, e, next) => {
    const c = w.clock
    c.reads++
    return c.isBroken || c.failAt.includes(c.reads) ? next(e) : { value: c.now }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    w.open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...w.open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.usage', ($, e, next) => {
    const u = w.usage
    if (u.fails) return next(e)
    const b = e.breakdown && u.breakdown ? { breakdown: breakdown(u.breakdown) } : {}
    return { value: { startedAt: u.startedAt ?? T0, rateLimits: [], context: { window: 200_000, tokens: u.tokens, percent: u.percent, ...b } } }
  })
  if (opts.turnComplete !== false) on('turn.complete', () => ({ text: '' }))
  return w
}

const spectra = async ($: Engine): Promise<string> => String((await $.command.run({ command: 'spectra', ...RUN })).text)
const turn = ($: Engine, agentId?: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })
/** Ends main turns at these context sizes (with a breakdown of the same total). */
async function turns($: Engine, w: World, totals: number[], extra: Omit<Breakdown, 'total'> = {}): Promise<void> {
  for (const total of totals) {
    w.usage = { ...w.usage, tokens: total, breakdown: { ...extra, total } }
    await turn($)
  }
}
const mount = ($: Engine, surface: 'terminal' | 'desktop', props: Partial<typeof PROPS> = {}) =>
  $.ui.mount({ plugin: 'spectra', surface, component: 'Pane', requestId: PANE_ID, props: { ...PROPS, ...props } })
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Text' }))
const svgs = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))

describe('opening and refreshing', () => {
  test('/spectra opens (reading the breakdown) and closes the pane', async ($, on) => {
    const w = world(on, { tokens: 20_000 })
    await $.session.start(START)
    w.usage = { tokens: 30_000, breakdown: { total: 30_000 } }
    expect(await spectra($)).toBe('Spectra open.')
    expect(w.open.has(PANE_ID)).toBe(true)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '30k / 200k' })).toBeDefined()
    await ui.unmount()
    expect(await spectra($)).toBe('Spectra closed.')
    expect(w.open.size).toBe(0)
  })

  test('autoOpen opens the pane at the start', { options: { autoOpen: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.open.has(PANE_ID)).toBe(true)
  })

  test('the same session started again keeps its growth series; a new session starts afresh', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [40_000, 50_000])
    await $.session.start(START)
    let ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '+10k/turn' })).toBeDefined()
    await ui.unmount()
    w.usage = { ...w.usage, startedAt: T0 + 1 }
    await $.session.start(START)
    ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Δ —' })).toBeDefined()
    await ui.unmount()
  })

  test('a failing usage read keeps what was there', async ($, on) => {
    const w = world(on, { fails: true })
    await $.session.start(START)
    await turn($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '◆ 0% context' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'the breakdown arrives after the first reply' })).toBeDefined()
    await ui.unmount()
    w.usage = { tokens: 10_000 }
    await turn($)
    w.usage = { fails: true }
    await turn($)
    const later = await mount($, 'terminal')
    expect(await later.find({ type: 'Text', text: '10k / 200k' })).toBeDefined()
    await later.unmount()
  })

  test('subagent turns add no point; a turn with no size, or size 0, adds none either', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.usage = { tokens: 10_000 }
    await turn($, 'a1')
    w.usage = { percent: 3 }
    await turn($)
    w.usage = { tokens: 0, breakdown: { total: 0 } }
    await turn($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: ' · forecast after two turns' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'a point lands at the end of each turn' })).toBeDefined()
    await ui.unmount()
  })

  test('without a size from the context, the breakdown\'s total is the point', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    for (const total of [20_000, 30_000]) {
      w.usage = { breakdown: { total } }
      await turn($)
    }
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '+10k/turn' })).toBeDefined()
    await ui.unmount()
  })

  test('a turn that fails beneath still fails', async ($, on) => {
    world(on, {}, { turnComplete: false })
    await $.session.start(START)
    await expect(turn($)).rejects.toThrow()
  })

  test('a clock that fails while refreshing is shrugged off at the start, on open and after a turn', async ($, on) => {
    const w = world(on, { tokens: 12_000 })
    // The start reads the clock, then its refresh does: fail the refresh.
    w.clock.failAt = [2]
    await $.session.start(START)
    // Nothing was published: the pane draws a blank snapshot.
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '0 / 0' })).toBeDefined()
      else expect((await svgs(ui))[0]).toMatch(/the breakdown arrives after the first reply/)
      await ui.unmount()
    }
    w.clock.isBroken = true
    expect(await spectra($)).toBe('Spectra open.')
    await turn($)
    w.clock.isBroken = false
    await turn($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '12k / 200k' })).toBeDefined()
    await ui.unmount()
  })
})

/** A 2-row grid with every kind of square: used full, partial and empty, free, buffer, unlisted. */
const GRID: Square[][] = [
  [sq('System prompt', 1), sq('Messages', 0.5), sq('Messages', 0, false), sq('Free space', 0, false), sq('Autocompact buffer', 1), sq('??', 1)],
  [sq('Messages', 1), sq('Free space', 0, false), sq('Free space', 0, false), sq('Free space', 0, false), sq('Autocompact buffer', 1), sq('Autocompact buffer', 1)],
]

describe('the terminal pane', () => {
  test('header, grid, ranked rows, growth graph and a near forecast', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [100_000, 130_000, 160_000], { grid: GRID, threshold: 200_000 })
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '◆ 80% context' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5 · 2 memory files · 1 MCP tools' })).toBeDefined()
    const raster = await ui.find({ type: 'Raster' })
    expect(raster?.props.columns).toBe(12)
    expect(raster?.props.rows).toBe(2)
    const rows = (await texts(ui)).map(t => t.text)
    // Used by size, then free, then the buffer; deferred rows are left out.
    const names = ['Messages', 'System prompt', 'Free space', 'Autocompact buffer'].map(n => rows.indexOf(n))
    expect([...names].sort((a, b) => a - b)).toEqual(names)
    expect(rows).not.toContain('MCP tools')
    expect(rows).toContain('· ')
    expect(rows).toContain('░ ')
    expect(rows).toContain('■ ')
    expect(await ui.find({ type: 'Text', text: '+30k/turn' })).toBeDefined()
    const forecast = await ui.find({ type: 'Text', text: /^ · auto-compact in ~2 turns$/ })
    expect(forecast?.props.color).toBe(KZ.red)
    expect(await ui.find({ type: 'Text', text: 'compacts at 200k' })).toBeDefined()
    expect(rows.filter(r => /^[⠀-⣿]+$/.test(r)).length).toBe(2)
    await ui.unmount()
  })

  test('a grid wider than the pane draws one cell per square; no width given reads as 40 columns', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const wide = [Array.from({ length: 30 }, () => sq('Messages', 1))]
    await turns($, w, [50_000], { grid: wide })
    for (const bodyColumns of [44, 0]) {
      const ui = await mount($, 'terminal', { bodyColumns })
      expect((await ui.find({ type: 'Raster' }))?.props.columns).toBe(30)
      await ui.unmount()
    }
  })

  test('a breakdown without a grid; forecasts that are far, middling, now, one turn, not approaching', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const forecast = async (want: string, color: string) => {
      const ui = await mount($, 'terminal')
      const t = (await ui.findAll({ type: 'Text', text: ` · ${want}` })).pop()
      expect(t?.props.color, want).toBe(color)
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      await ui.unmount()
    }
    // Each pair opens with a drop of over 10 %, so the slope is the pair's alone.
    await turns($, w, [100_000, 166_000])
    await forecast('auto-compact in ~1 turn', KZ.red)
    await turns($, w, [100_000, 170_000])
    await forecast('auto-compact now', KZ.red)
    await turns($, w, [100_000, 110_000])
    await forecast('auto-compact in ~6 turns', KZ.amber)
    await turns($, w, [10_000, 11_000])
    await forecast('auto-compact in ~156 turns', KZ.green)
    await turns($, w, [9_000, 8_500])
    await forecast('auto-compact: not approaching', KZ.mist)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '−500/turn' })).toBeDefined()
    await ui.unmount()
  })

  test('auto-compact off: the window is the wall; the raw window falls back to the max, then the context window', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [50_000, 70_000], { isAuto: false, raw: 0, max: 100_000 })
    let ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'auto-compact is off: the window is the wall' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · window full in ~2 turns' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '70k / 100k' })).toBeDefined()
    await ui.unmount()
    await turns($, w, [80_000], { raw: 0, max: 0 })
    ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '80k / 200k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'compacts at 167k' })).toBeDefined()
    await ui.unmount()
  })

  test('without a breakdown: the context numbers, or zeros, and the assumed threshold', async ($, on) => {
    const w = world(on, { tokens: 30_000, percent: 15 })
    await $.session.start(START)
    let ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '◆ 15% context' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'compacts at 190k (assumed 95% of window)' })).toBeDefined()
    await ui.unmount()
    w.usage = {}
    await turn($)
    ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '◆ 0% context' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the desktop cards', () => {
  test('the grid card: squares by kind, tips, and the last used square pulsing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [100_000, 130_000, 160_000], { grid: GRID, threshold: 200_000 })
    const ui = await mount($, 'desktop')
    const [grid, legend, growth] = await svgs(ui)
    expect(grid).toMatch(/fill="url\(#spB\)"><title>Autocompact buffer/)
    expect(grid).toMatch(/<rect class="k"[^>]*><title>Free space/)
    expect(grid).toMatch(/<rect class="k"[^>]*><\/rect>/)
    expect((grid!.match(/class="pulse"/g) ?? []).length).toBe(1)
    expect(grid).toMatch(/class="pulse"><title>Messages/)
    expect(grid).toMatch(/opacity="0.35" ><title>Messages/)
    expect(legend).toMatch(/fill="url\(#spB2\)"/)
    expect(legend).toMatch(/class="k"\/>/)
    expect(growth).toMatch(/\+30k\/turn/)
    expect(growth).toMatch(/class="spdash"/)
    expect(growth).toMatch(/compact 200k</)
    expect(growth).toMatch(/auto-compact in ~2 turns/)
    await ui.unmount()
  })

  test('empty cards before the first reply', async ($, on) => {
    world(on)
    await $.session.start(START)
    const ui = await mount($, 'desktop')
    const all = await ui.findAll({ type: 'Svg' })
    expect(all.map(s => s.props.alt)).toEqual(['Context 0%: 0 of 200k tokens', 'Categories: none yet', 'Context growth: forecast after two turns'])
    const [grid, legend, growth] = all.map(s => String(s.props.source))
    expect(grid).toMatch(/the breakdown arrives after the first reply/)
    expect(legend).toMatch(/no breakdown yet/)
    expect(growth).toMatch(/a point lands at the end of each turn/)
    expect(growth).toMatch(/compact 190k \(assumed\)/)
    await ui.unmount()
  })

  test('a falling series: a minus slope and no projection; auto-compact off reads "window"', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [100_000, 95_000], { isAuto: false })
    const ui = await mount($, 'desktop')
    const growth = (await svgs(ui))[2]!
    expect(growth).toMatch(/−5.0k\/turn/)
    expect(growth).not.toMatch(/class="spdash"/)
    expect(growth).toMatch(/window 200k</)
    expect(growth).toMatch(/window full: not approaching/)
    await ui.unmount()
  })

  test('a single point draws no line; past the threshold there is no projection', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await turns($, w, [100_000])
    let ui = await mount($, 'desktop')
    expect((await svgs(ui))[2]).toMatch(/a point lands at the end of each turn/)
    await ui.unmount()
    await turns($, w, [150_000, 199_000])
    ui = await mount($, 'desktop')
    const growth = (await svgs(ui))[2]!
    expect(growth).toMatch(/auto-compact now/)
    expect(growth).not.toMatch(/class="spdash"/)
    await ui.unmount()
  })
})
