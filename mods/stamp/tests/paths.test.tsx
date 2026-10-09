import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
type Fig = { cost?: number; ctx: number }

/** The engine beneath: usage figures come from `figs` in order, the last one repeating. */
function base(on: On, figs?: Fig[]): void {
  let i = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (figs) {
    on('session.usage', () => {
      const f = figs[Math.min(i++, figs.length - 1)] as Fig
      return { value: { startedAt: 0, context: { tokens: f.ctx * 10_000, window: 1_000_000, percent: f.ctx }, rateLimits: [], ...(f.cost === undefined ? {} : { cost: { usd: f.cost } }) } }
    })
  }
  on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    const usage = e.index === 9 ? null : { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 500, model: 'claude-sonnet-5' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine line</Text>
  })
}

const last = async ($: Engine) => (await $.command.run({ command: 'stamp', args: 'last', ...RUN })).text
const done = (turnId: string, durationMs: number, reason: 'answer' | 'aborted' | 'error' | 'refusal' = 'answer') =>
  ({ turnId, answer: '', durationMs, isAborted: reason === 'aborted', reason }) as TurnCompleteInput

describe('the receipt', () => {
  test('every tool family gets its chip, in order; subagent calls and steps are left out; step usage prices the turn', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    // Cost falls (a reset): the turn is priced from its own tokens.
    base(on, [{ cost: 1.0, ctx: 70 }, { cost: 0.5, ctx: 65 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const tools = ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Read', 'Glob', 'Grep', 'LSP',
      'Agent', 'Task', 'Workflow', 'WebFetch', 'TodoWrite', 'TaskCreate', 'mcp__srv__look', 'Frobnicate']
    for (const tool of tools) await $.tool.call({ tool } as never)
    await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'a1' } as never)
    const steps = [
      { turnId: 't1', index: 9, model: 'claude-haiku-5', messageCount: 1 },
      { turnId: 't1', index: 0, model: 'claude-haiku-5', messageCount: 1 },
      { turnId: 't1', index: 1, model: 'claude-haiku-5', messageCount: 1 },
      { turnId: 't1', index: 2, model: 'claude-haiku-5', messageCount: 1, agentId: 'a1' },
      { turnId: 'other', index: 3, model: 'claude-haiku-5', messageCount: 1 },
    ]
    for (const s of steps) for await (const c of $.turn.step(s as never)) void c
    await $.turn.complete(done('t1', 75_000))
    await clock.settle()
    // Sonnet 5 at 2/10/0.2/2.5 per million: 2000·2 + 4000·10 + 100000·0.2 + 1000·2.5 = 66_500 → $0.07.
    expect(await last($)).toBe('Last turn: ⏱ 1m 15s · 18 tools $2 ✎4 ◉1 ⌕3 ◈3 ◍1 ☑2 ⬡1 •1 · ↑3.0k ↓4.0k tok · $0.07 · ctx 65% (-5%)')

    const term = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 75_400 } })
    expect(await term.find({ type: 'Text', text: '1m 15s' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: ' ◈3' })).toBeDefined()
    // Each segment is its own Text inside the line's: find it by its exact text.
    const seg = async (text: string) => (await term.findAll({ type: 'Text' })).find(x => x.text === text)?.props
    expect(await seg(' · ctx 65% (-5%)')).toMatchObject({ color: '#fb923c' })
    expect(await seg(' · 18 tools')).toMatchObject({ dimColor: true })
    expect(await seg(' $2')).toMatchObject({ color: '#4ade80' })
    expect(await seg('1m 15s')).toMatchObject({ bold: true })
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'stamp', surface: 'desktop', component: 'TurnDuration', props: { word: 'Baked', durationMs: 75_400 }, viewport: { columns: 60, rows: 2 } })
    const svg = await desk.find({ type: 'Svg' })
    const src = String(svg?.props.source)
    expect(src).toContain('<rect')
    expect(src).toContain('◈3')
    expect(svg?.props.width).toBeLessThanOrEqual(472)
    expect(String(svg?.props.alt)).toBe('Baked for ⏱ 1m 15s · 18 tools $2 ✎4 ◉1 ⌕3 ◈3 ◍1 ☑2 ⬡1 •1 · ↑3.0k ↓4.0k tok · $0.07 · ctx 65% (-5%)')
    await desk.unmount()
  })

  test('reasons, an hour-long turn, one tool, a rising cost and a full context', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    base(on, [{ cost: 1, ctx: 79.8 }, { cost: 1.25, ctx: 80.2 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await $.turn.complete({ ...done('t1', 3_725_000, 'aborted'), usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } })
    await clock.settle()
    expect(await last($)).toBe('Last turn: ⏱ 1h 2m · 1 tool ◉1 · ↑10 ↓20 tok · $0.25 · ctx 80% · interrupted')

    const desk = await $.ui.mount({ plugin: 'stamp', surface: 'desktop', component: 'TurnDuration', props: { word: 'Worked', durationMs: 3_725_000 } })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('interrupted')
    await desk.unmount()

    for (const reason of ['error', 'refusal'] as const) {
      await $.turn.start({ text: 'go', turnId: reason })
      await $.turn.complete(done(reason, 30_000, reason))
      await clock.settle()
      expect(await last($)).toBe(`Last turn: ⏱ 30s · $0.00 · ctx 80% · ${reason}`)
    }
    // A context between 60 and 80 % and no change worth a figure.
    await $.turn.start({ text: 'go', turnId: 'mid' })
    await $.turn.complete(done('mid', 2000))
    await clock.settle()
    expect(await last($)).toBe('Last turn: ⏱ 2s · $0.00 · ctx 80%')
  })

  test('without usage figures the receipt keeps to duration and tokens; a cost-free session prices nothing', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await last($)).toBe('Last turn: no turn finished yet')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(done('t1', 5000))
    await clock.settle()
    expect(await last($)).toBe('Last turn: ⏱ 5s')
    const t = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 5000 } })
    expect(await t.find({ type: 'Text', text: '5s' })).toBeDefined()
    expect(await t.find({ type: 'Text', text: 'engine line' })).toBeUndefined()
    await t.unmount()
  })

  test('a turn.complete for a turn it never saw start: no tools, priced by its own usage; the same turn again replaces it', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    base(on, [{ ctx: 10 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // Nothing runs yet: tool calls and steps outside a turn are not counted.
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    for await (const c of $.turn.step({ turnId: 'zz', index: 0, model: 'm', messageCount: 1 })) void c
    const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    await $.turn.complete({ ...done('ghost', 9000), usage })
    await clock.settle()
    expect(await last($)).toBe('Last turn: ⏱ 9s · ↑1.0M ↓0 tok · $4.00 · ctx 10%')
    await $.turn.complete({ ...done('ghost', 12_000), usage: { ...usage, input_tokens: 0 } })
    await clock.settle()
    expect(await last($)).toBe('Last turn: ⏱ 12s · ↑0 ↓0 tok · $0.00 · ctx 10%')
    // The first receipt is gone: a 9 s line keeps the engine's text.
    const t = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 9000 } })
    expect(await t.find({ type: 'Text', text: 'engine line' })).toBeDefined()
    await t.unmount()
    // A subagent's end writes no receipt.
    await $.turn.complete({ ...done('sub', 7000), agentId: 'a1' })
    await clock.settle()
    expect(await last($)).toContain('12s')
  })

  test('the closest receipt wins, the later one on a tie', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, {})
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const [id, ms, tool] of [['a', 10_000, 'Read'], ['b', 11_000, 'Bash'], ['c', 11_000, 'Edit']] as const) {
      await $.turn.start({ text: 'go', turnId: id })
      await $.tool.call({ tool } as never)
      await $.turn.complete(done(id, ms))
      await clock.settle()
    }
    const pick = async (ms: number) => {
      const t = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: ms } })
      const chip = (await t.findAll({ type: 'Text' })).map(x => x.text).find(x => /^ [◉$✎]1$/.test(x))
      await t.unmount()
      return chip
    }
    expect(await pick(10_100)).toBe(' ◉1')
    expect(await pick(11_000)).toBe(' ✎1')
  })
})

describe('/stamp', () => {
  test('toggles with no argument, takes on and off, and starts off when stored so', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on, { isOn: false })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = async (args: string) => (await $.command.run({ command: 'stamp', args, ...RUN })).text
    expect(await run('')).toBe('Stamp on: each finished turn closes with a receipt.')
    expect(await run('')).toBe('Stamp off: the engine draws its own closing line.')
    expect(await run(' On ')).toBe('Stamp on: each finished turn closes with a receipt.')
    expect(await run('off')).toBe('Stamp off: the engine draws its own closing line.')
  })

  test('with no store the stamp is on', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(done('t1', 4000))
    await clock.settle()
    const t = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 4000 } })
    expect(await t.find({ type: 'Text', text: '4s' })).toBeDefined()
    await t.unmount()
  })
})

describe('failures', () => {
  test('with no clock the turn hooks pass through and no receipt is written', async ($, on) => {
    mock.store(on, {})
    base(on, [{ ctx: 1 }])
    expect(await $.turn.start({ text: 'go', turnId: 't1' })).toMatchObject({ turnId: 't1' })
    expect(await $.turn.complete(done('t1', 4000))).toMatchObject({ text: '' })
    expect(await last($)).toBe('Last turn: no turn finished yet')
  })

  test('a failure beneath reaches the caller through every gating hook', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on, {})
    const failed: string[] = []
    const attempt = async (name: string, p: Promise<unknown>) => { try { await p } catch (err) { failed.push(`${name}: ${String(err).includes('no implementation')}`) } }
    await attempt('turn.start', $.turn.start({ text: 'go', turnId: 't1' }))
    await attempt('tool.call', $.tool.call({ tool: 'Bash', command: 'ls' }))
    await attempt('turn.complete', $.turn.complete(done('t1', 1000)))
    expect(failed).toEqual(['turn.start: true', 'tool.call: true', 'turn.complete: true'])
  })
})
