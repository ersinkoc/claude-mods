import { describe, expect, mock, test } from 'claude-code/testing'
import type { ClientSurface, Elements, On, RenderElement } from 'claude-code'

import { DOT_MS, FADE, ekgAlt, ekgSvg, sampleTrace, traceColor, traceFrame } from '../hooks/ekg.ts'
import Trace from '../hooks/trace.tsx'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const BAND = (maxRows: number, bodyColumns = 90) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})

function base(on: On, opts: { usage?: boolean } = {}): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (opts.usage !== false) on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 300_000, window: 1_000_000, percent: 30 }, rateLimits: [] } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command === 'false') return { isError: true as const, result: undefined, text: 'exit 1' }
    if (e.tool === 'Write') return { deny: 'not here' }
    return { result: 'ok' }
  })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
}

/** All text in an element tree, in order. */
function textOf(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (n && typeof n === 'object' && 'children' in n) return textOf((n as { children: unknown }).children)
  return ''
}
/** Every element of a tree with its props, depth first. */
function nodes(n: unknown, out: { type: string; props: Record<string, unknown>; children: unknown }[] = []) {
  if (Array.isArray(n)) for (const c of n) nodes(c, out)
  else if (n && typeof n === 'object' && 'type' in n) {
    const el = n as { type: string; props: Record<string, unknown>; children: unknown }
    out.push(el)
    nodes(el.children, out)
  }
  return out
}

describe('ekg drawing', () => {
  test('the trace color runs from an empty to a full context; no reading counts as empty', () => {
    expect(traceColor(null)).toBe(traceColor(0))
    expect(traceColor(100)).not.toBe(traceColor(0))
  })

  test('beats outside the window, or whose shape falls off an edge, leave no mark there', () => {
    const now = 100_000
    const far = sampleTrace([{ at: now - 200 * DOT_MS, k: 't', c: '#fff' }, { at: now + 20 * DOT_MS, k: 's', c: '#fff' }], now, 20)
    expect(far.amp.every(a => a === 0)).toBe(true)
    expect(far.col.every(c => c === undefined)).toBe(true)
    // A spike at the very left: its dip (offset -1) is off screen, the spike is on it.
    const edge = sampleTrace([{ at: now - 19 * DOT_MS, k: 't', c: '#abc' }], now, 20)
    expect(edge.amp[0]).toBe(1)
    expect(edge.col[1]).toBe('#abc')
    // Where two beats meet the stronger wins: a request's blip under a tool's spike leaves the spike.
    const both = sampleTrace([{ at: now, k: 't', c: '#111' }, { at: now, k: 's', c: '#222' }], now, 20)
    expect(both.amp[19]).toBe(1)
    expect(both.col[19]).toBe('#111')
    // A failure is red whatever its color.
    expect(sampleTrace([{ at: now, k: 'f', c: '#abc' }], now, 20).col[19]).toBe('#f87171')
  })

  test('frames of one, two and three rows; the pen is bold; an idle line breathes toward the fade', () => {
    const beats = [{ at: 9800, k: 't' as const, c: '#4ade80' }, { at: 9000, k: 'f' as const, c: '#fff' }, { at: 8000, k: 's' as const, c: '#22d3ee' }]
    for (const rows of [1, 2, 3]) {
      const f = traceFrame(beats, 10_000, 12, rows, null)
      expect(f).toHaveLength(rows)
      for (const row of f) {
        expect(row.map(s => s.s).join('')).toHaveLength(12)
        expect(row[row.length - 1]?.b).toBe(true)
        expect(row.slice(0, -1).every(s => s.b === undefined)).toBe(true)
      }
    }
    const lit = traceFrame([], 10_000, 4, 2, 0, 0)
    const dim = traceFrame([], 10_000, 4, 2, 0, 1)
    // Fully breathed out, every cell is the fade color.
    expect(dim.flat().every(s => s.c === FADE)).toBe(true)
    expect(lit.flat().some(s => s.c !== FADE)).toBe(true)
  })

  test('the desktop screen: a red failure overlay, an idle breath, no reading, a quiet heart', () => {
    const busy = ekgSvg({ beats: [{ at: 9000, k: 'f', c: '#facc15' }, { at: 9500, k: 't', c: '#facc15' }, { at: 1, k: 't', c: '#000' }], now: 70_000, bpm: 0, rpm: 0, ctx: null, isWorking: false }, 600, 58)
    expect(busy).toContain('stroke="#f87171" class="hlbeat"')
    expect(busy).toContain('ctx —')
    expect(busy).toContain('fill="#9ca3af" class="hlheart"')
    // The beat older than the 64 s span is not drawn.
    expect(busy).not.toContain('stroke="#000"')
    const idle = ekgSvg({ beats: [], now: 70_000, bpm: 3, rpm: 2, ctx: 91.6, isWorking: true }, 600, 74)
    expect(idle).toContain('hltrace hlbreath')
    expect(idle).toContain('ctx 92%')
    expect(idle).toContain('2 req/m')
    expect(ekgAlt({ beats: [], now: 0, bpm: 3, rpm: 2, ctx: null, isWorking: false })).toBe('Session heartline: 3 tool calls and 2 model requests in the last minute; context unknown.')
    expect(ekgAlt({ beats: [], now: 0, bpm: 0, rpm: 1, ctx: 41.2, isWorking: true })).toBe('Session heartline: 0 tool calls and 1 model requests in the last minute; context 41%; working.')
  })
})

describe('the terminal scene', () => {
  type P = Parameters<typeof Trace>[0]
  type S = { t: number; sig: number; at: number }
  /** A surface for the scene, with the terminal's own elements and timers run by hand. */
  async function surfaceFor($: { ui: { mount: (t: never) => Promise<{ unmount: () => Promise<void> }> } }, on: On, columns: number) {
    let els: Elements['terminal'] | undefined
    on('ui.render', ($, e) => {
      els = $.ui.resolve(e) as Elements['terminal']
      return <els.Box key="x" />
    })
    const m = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...BAND(20), props: { ...BAND(20).props, hasSurvey: true } } as never)
    await m.unmount()
    const timers: (() => void)[] = []
    const surface = {
      elements: els,
      state: undefined as S | undefined,
      setState(next: S) { surface.state = next },
      columns,
      rows: 3,
      every(ms: number, fn: () => void) { timers.push(fn); return () => undefined },
      onPointer: () => () => undefined,
    }
    return { surface: surface as unknown as ClientSurface<S> & { state: S | undefined }, tick: () => { for (const f of timers) f() } }
  }

  test('the first frame starts the clock; frames count on until the props clock moves', async ($, on) => {
    const { surface, tick } = await surfaceFor($ as never, on, 40)
    const props: P = { beats: [{ at: 9_900, k: 't', c: '#4ade80' }], now: 10_000, bpm: 90, rpm: 4, ctx: 72, width: 40, rows: 3 }
    const first = Trace(props, surface) as RenderElement
    expect(surface.state).toEqual({ t: 0, sig: 10_000, at: 0 })
    expect(textOf(first)).toContain('90')
    expect(textOf(first)).toContain('ctx 72%')
    expect(textOf(first)).toContain('4 req/m')
    // The trace column is the surface width less the readout.
    expect(nodes(first).find(n => n.type === 'Box' && n.props.width === 28)).toBeDefined()
    tick()
    tick()
    expect(surface.state?.t).toBe(2)
    Trace(props, surface)
    expect(surface.state).toEqual({ t: 2, sig: 10_000, at: 0 })
    // New props clock: the frame it arrived on is kept.
    Trace({ ...props, now: 11_000 }, surface)
    expect(surface.state).toEqual({ t: 2, sig: 11_000, at: 2 })
    // Lub-dub: somewhere in a beat period the heart is full and bold.
    const hearts = new Set<string>()
    for (let i = 0; i < 20; i++) {
      tick()
      hearts.add(textOf(nodes(Trace({ ...props, now: 11_000 }, surface)).find(n => n.props.color !== undefined && /♥|♡/.test(textOf(n)))))
    }
    expect([...hearts].sort()).toEqual([' ♡ ', ' ♥ '])
  })

  test('a quiet scene: no reading, a resting heart, two rows, the props width when the surface reports none', async ($, on) => {
    const { surface } = await surfaceFor($ as never, on, 0)
    const out = Trace({ beats: [], now: 50_000, bpm: 0, rpm: 0, ctx: null, width: 30, rows: 1 }, surface) as RenderElement
    const all = nodes(out)
    expect(textOf(out)).toContain('ctx —')
    expect(textOf(out)).toContain(' ♡ ')
    expect(textOf(out)).not.toContain('req/m')
    expect(all.find(n => textOf(n) === '—')?.props.color).toBe(FADE)
    // The trace column: 30 - 12 cells, two braille rows (one asked, two at least).
    const trace = all.find(n => n.type === 'Box' && n.props.width === 18)
    expect(trace?.children).toHaveLength(2)
  })
})

describe('the band', () => {
  test('turns, steps, failures and denials beat; the desktop says when it works; a subagent end keeps it working', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (const agentId of [undefined, 'a1']) {
      for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })) void c
    }
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await clock.settle()
    const svgOf = async (maxRows = 20) => {
      const ui = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(maxRows) })
      const svg = await ui.find({ type: 'Svg' })
      await ui.unmount()
      return svg
    }
    let svg = await svgOf()
    expect(svg?.props.alt).toBe('Session heartline: 3 tool calls and 2 model requests in the last minute; context 30%; working.')
    expect(svg?.props.height).toBe(74)
    expect(String(svg?.props.source)).toContain('stroke="#f87171" class="hlbeat"')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    await clock.settle()
    expect((await svgOf())?.props.alt).toContain('; working.')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    svg = await svgOf(6)
    expect(svg?.props.alt).toBe('Session heartline: 3 tool calls and 2 model requests in the last minute; context 30%.')
    expect(svg?.props.height).toBe(58)
  })

  test('the context follows session.measure, ignoring a measure without a percent', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await $.session.measure({ context: { tokens: 640_000, window: 1_000_000, percent: 64 }, rateLimits: [], changed: ['context'] })
    await $.session.measure({ context: { tokens: 640_000, window: 1_000_000, percent: 64 }, rateLimits: [], changed: ['context'] })
    await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['rateLimits'] } as never)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('context 64%')
    await ui.unmount()
  })

  test('the terminal band: a narrow body, two rows when space is short, and the scene props', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Grep', pattern: 'x' })
    await clock.settle()
    const short = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...BAND(6, 0) })
    const client = await short.find({ type: 'Client', key: 'heartline' })
    expect(client?.props).toMatchObject({ width: 58, height: 2 })
    expect(client?.props.props).toMatchObject({ bpm: 1, rpm: 0, ctx: 30, width: 58, rows: 2 })
    await short.unmount()
    const tiny = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...BAND(20, 10) })
    expect((await tiny.find({ type: 'Client', key: 'heartline' }))?.props).toMatchObject({ width: 22, height: 3 })
    await tiny.unmount()
  })

  test('ten quiet minutes put the band away; a full buffer keeps its newest beats', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 601; i++) await $.tool.call({ tool: 'Glob', pattern: '*' })
    await clock.settle()
    const full = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    // 601 calls, trimmed to the newest 400.
    expect((await full.find({ type: 'Svg' }))?.props.alt).toContain('400 tool calls')
    await full.unmount()
    await clock.advance(10 * 60_000)
    const gone = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    expect(await gone.find({ type: 'Svg' })).toBeUndefined()
    await gone.unmount()
  })
})

describe('hiding and failures', () => {
  test('a stored hide holds; /heartline shows and hides again', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { hidden: true })
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    const mount = async () => {
      const ui = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
      const svg = await ui.find({ type: 'Svg' })
      await ui.unmount()
      return svg
    }
    expect(await mount()).toBeUndefined()
    expect((await $.command.run({ command: 'heartline', args: '', ...RUN })).text).toBe('Heartline shown.')
    expect(await mount()).toBeDefined()
    expect((await $.command.run({ command: 'heartline', args: '', ...RUN })).text).toBe('Heartline hidden.')
    expect(await mount()).toBeUndefined()
  })

  test('with no store and no usage the band still toggles for the session', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on, { usage: false })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    expect((await $.command.run({ command: 'heartline', args: '', ...RUN })).text).toBe('Heartline hidden.')
    expect((await $.command.run({ command: 'heartline', args: '', ...RUN })).text).toBe('Heartline shown.')
    const ui = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('context unknown')
    await ui.unmount()
  })

  test('before the session starts the band adds nothing; with no clock every hook passes its event on', async ($, on) => {
    mock.store(on, {})
    base(on)
    const early = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    expect(await early.find({ type: 'Svg' })).toBeUndefined()
    await early.unmount()
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) void c
    expect((await $.tool.call({ tool: 'Read', file_path: '/a' })).result).toBe('ok')
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toMatchObject({ text: '' })
    expect(await $.session.measure({ context: { tokens: 1, window: 10, percent: 10 }, rateLimits: [], changed: ['context'] })).toMatchObject({ changed: ['context'] })
  })

  test('a failure beneath tool.call reaches the caller', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let err = ''
    try { await $.tool.call({ tool: 'Read', file_path: '/a' }) } catch (e) { err = String(e) }
    expect(err).toContain('no implementation for tool.call')
  })
})
