import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput, TurnCompleteReason } from 'claude-code'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 110, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-epilogue',
  props: { title: 'KOZMOS · Epilogue', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 110 } }
const SPAWN = { tool_use_id: 'tu', prompt: 'look', description: 'Explore', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }

/** The session beneath epilogue: no cost reading unless given, tools that work unless named. */
function world(on: On, opts: { cost?: () => number; failing?: string[] } = {}): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    const usd = opts.cost?.()
    return { value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], ...(usd === undefined ? {} : { cost: { usd } }) } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', ($, e) => (opts.failing?.includes(String(e.tool)) ? { deny: 'no' } : { result: 'ok' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
}

/** A turn's end after 65 s; a refusal carries its (empty) explanation. */
function done(turnId: string, reason: TurnCompleteReason, answer = '', agentId?: string): TurnCompleteInput {
  const base = { answer, durationMs: 65_000, isAborted: reason === 'aborted', turnId, ...(agentId ? { agentId } : {}) }
  return reason === 'refusal' ? { ...base, reason, refusal: { category: null, explanation: null } } : { ...base, reason }
}

/** Every Text the drawing shows, as one string per element. */
async function texts(ui: Pick<Mounted, 'findAll'>): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

async function card(ui: Pick<Mounted, 'findAll'>): Promise<{ source: string; alt: string }[]> {
  return (await ui.findAll({ type: 'Svg' })).map(s => ({ source: String(s.props.source), alt: String(s.props.alt) }))
}

/** One turn: start, the tools named, an end. */
async function turn($: Engine, id: string, prompt: string, tools: [string, Record<string, unknown>][], end: TurnCompleteInput): Promise<void> {
  await $.turn.start({ text: prompt, turnId: id })
  for (const [tool, input] of tools) await $.tool.call({ tool, ...input } as never)
  await $.turn.complete(end)
}

describe('epilogue turns', () => {
  test('an interrupted turn with no tools and no cost reading', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'hi', [], done('t1', 'aborted'))
    const term = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    const shown = await texts(term)
    expect(shown).toContain('◆ 1:05 · $0 · 0 tok · no tools ⏹ interrupted')
    // One row only: no files, agents or one-liner.
    expect(shown.some(t => t.startsWith('  '))).toBe(false)
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...BAND })
    const [c] = await card(desk)
    expect(c?.source).toContain('EPILOGUE')
    expect(c?.source).toContain('no tools')
    expect(c?.source).toContain('⏹ interrupted')
    expect(c?.source).toContain('height="54"')
    expect(c?.alt).toBe('Turn recap: 1:05; 0 tokens, $0; no tools')
    await desk.unmount()
  })

  test('agents, files and failures; an error ending; the pane lists both turns', async ($, on) => {
    mock.clock(on, { now: new Date(2026, 9, 9, 14, 5).getTime() })
    mock.store(on)
    world(on, { failing: ['Bash', 'ExitPlanMode'] })
    let spawns = 0
    on('agent.spawn', () => (++spawns === 3 ? { deny: 'busy' } : { model: 'claude-haiku-5', agentId: `ag${spawns}` }))
    on('turn.step', async function* ($, e) {
      // The usage names no model: the request's own prices it.
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: '' } }
    })
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // Spawned before any turn: not counted.
    await $.agent.spawn(SPAWN)
    await turn($, 't1', '', [['Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }]], done('t1', 'refusal'))
    await $.turn.start({ text: 'ship it', turnId: 't2' })
    for await (const c of $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-5', messageCount: 1 })) void c
    await $.agent.spawn(SPAWN)
    await $.agent.spawn(SPAWN)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'ExitPlanMode' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/w/b.ts', content: '' })
    // An agent's end is not the turn's.
    await $.turn.complete(done('t2', 'answer', 'ok', 'ag1'))
    await $.turn.complete(done('t2', 'error'))

    const term = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    const shown = await texts(term)
    // Haiku 5: 1000 input tokens at $0.10 per million.
    expect(shown).toContain('◆ 1:05 · ~<$0.01 · 1.0k tok ·  ✎ 1   $ 1   • 1  ✖ 2 failed ⚠ ended on an error')
    expect(shown).toContain('  ✎ b.ts · ◈ 1 agent')
    await term.unmount()

    expect((await $.command.run({ command: 'epilogue', args: '', ...RUN })).text).toBe('Epilogue open.')
    const pane = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 0 } })
    const lines = await texts(pane)
    expect(lines).toContain('#2 14:05 · “ship it”')
    expect(lines).toContain('#1 14:05 · (continuation)')
    expect(lines).toContain('✎ b.ts · ◈ 1 agent · ✖ Bash npm test, ExitPlanMode')
    expect(lines).toContain('1:05 · $0 · 0 tok ·  ✎ 1  ⊘ refused')
    await pane.unmount()
    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...PANE })
    const cards = await card(desk)
    expect(cards).toHaveLength(2)
    expect(cards[0]?.source).toContain('#2 · 14:05')
    expect(cards[0]?.source).toContain('✖ 2 failed')
    expect(cards[0]?.source).toContain('⚠ ended on an error')
    expect(cards[0]?.source).toContain('› ship it')
    expect(cards[0]?.alt).toBe('Turn recap: 1:05; 1.0k tokens, ~<$0.01; tools Edit 1, Shell 1, Other 1; files b.ts; 1 subagents; 2 failed')
    // The first turn had no prompt and no one-liner: two lines.
    expect(cards[1]?.source).toContain('⊘ refused')
    expect(cards[1]?.source).toContain('height="54"')
    await desk.unmount()
  })

  test('a turn of every family overflows a narrow card; many agents', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    on('agent.spawn', ($, e) => ({ model: 'm', agentId: e.tool_use_id }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'all of it', turnId: 't1' })
    for (const id of ['x', 'y']) await $.agent.spawn({ ...SPAWN, tool_use_id: id })
    for (const [tool, input] of [
      ['Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }],
      ['Bash', { command: 'ls' }],
      ['Read', { file_path: '/w/a.ts' }],
      ['Agent', { description: 'x', prompt: 'x' }],
      ['WebSearch', { query: 'x' }],
      ['TodoWrite', { todos: [] }],
      ['mcp__gh__issue', {}],
      ['ExitPlanMode', {}],
    ] as const) await $.tool.call({ tool, ...input } as never)
    await $.turn.complete(done('t1', 'answer'))
    const term = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await texts(term)).toContain('  ✎ a.ts · ◈ 2 agents')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 1 } })
    const [c] = await card(desk)
    // The chips that fit, and no room left for the files and agents.
    expect(c?.source).toContain('✎ Edit 1')
    expect(c?.source).not.toContain('Other 1')
    expect(c?.source).not.toContain('◈ 2 agents')
    expect(c?.alt).toContain('2 subagents')
    await desk.unmount()
    const wide = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 200 } })
    expect((await card(wide))[0]?.source).toContain('◈ 2 agents   ✎ a.ts')
    await wide.unmount()
  })

  test('the band waits for the turn to end, gives way to a survey, and hides', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { hidden: false })
    world(on, { cost: () => 2 })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'go', [], done('t1', 'answer'))
    for (const props of [{ ...BAND.props, isWorking: true }, { ...BAND.props, hasSurvey: true }]) {
      const ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND, props })
      expect(await ui.find({ key: 'epilogue' })).toBeUndefined()
      await ui.unmount()
    }
    let ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    expect(await texts(ui)).toContain('◆ 1:05 · $0 (session +$0.00) · 0 tok · no tools ')
    await ui.press({ key: 'epilogue-hide' })
    expect(await ui.find({ key: 'epilogue' })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'epilogue', args: ' SHOW ', ...RUN })).text).toBe('Epilogue band shown after each turn.')
    ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'epilogue' })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'epilogue', args: 'hide', ...RUN })).text).toBe('Epilogue band hidden; /epilogue still lists recaps.')
    ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'epilogue' })).toBeUndefined()
    await ui.unmount()
  })

  test('a band hidden last session stays hidden; the store may refuse', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('store.get', () => ({ value: true }))
    on('store.set', () => ({ deny: 'read-only' }))
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'go', [], done('t1', 'answer'))
    const ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'epilogue' })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'epilogue', args: 'show', ...RUN })).text).toBe('Epilogue band shown after each turn.')
  })

  test('a store that cannot be read shows the band', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('store.get', () => ({ deny: 'no store' }))
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'go', [], done('t1', 'answer'))
    const ui = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'epilogue' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the epilogue pane', () => {
  test('empty until a turn ends; /epilogue closes it when open', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    world(on)
    const closed: string[] = []
    on('ui.panes', () => ({ value: [{ id: 'kz-epilogue', title: 'KOZMOS · Epilogue', isShown: true, isFocused: false, isPlaced: true }] }))
    on('ui.close', ($, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'epilogue', surface, ...PANE })
      expect(await texts(pane)).toEqual(['◆ Epilogue', 'No turns yet: a recap lands here after each one.'])
      await pane.unmount()
    }
    expect((await $.command.run({ command: 'epilogue', args: '', ...RUN })).text).toBe('Epilogue closed.')
    expect(closed).toEqual(['kz-epilogue'])
  })
})

describe('the one-liner', () => {
  test('an unanswered, a refused and an empty one-liner leave the recap as it was; no answer asks nothing', { options: { aiSummary: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    let asks = 0
    on('model.complete', () => {
      asks++
      if (asks === 1) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      if (asks === 2) return { deny: 'offline' }
      return { value: { isAnswered: true as const, text: '  ""  ', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const id of ['t1', 't2', 't3']) {
      await turn($, id, 'go', [], done(id, 'answer', 'Did the thing.'))
      await clock.settle()
    }
    await turn($, 't4', 'go', [], done('t4', 'answer', '   '))
    await clock.settle()
    expect(asks).toBe(3)
    const pane = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...PANE })
    // Only the prompts are quoted: no one-liner landed.
    expect((await texts(pane)).filter(t => t.startsWith('“') && t !== '“go”')).toEqual([])
    await pane.unmount()
  })

  test('a one-liner that cannot be stored is dropped', { options: { aiSummary: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    on('model.complete', () => ({ value: { isAnswered: true as const, text: 'Did it.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
    on('state.set', { plugin: 'epilogue', key: 'recaps' } as const, ($, e, next) =>
      (JSON.stringify(e.value).includes('"summary"') ? { deny: 'frozen' } : next(e)))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'go', [], done('t1', 'answer', 'Did it.'))
    await clock.settle()
    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...BAND })
    expect((await card(desk))[0]?.alt).toBe('Turn recap: 1:05; 0 tokens, $0; no tools')
    await desk.unmount()
  })

  test('a one-liner shows on both surfaces, in the band and the pane', { options: { aiSummary: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    on('model.complete', () => ({ value: { isAnswered: true as const, text: 'Fixed the parser.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // A turn with nothing to sum up comes first: the one-liner lands on the second only.
    await turn($, 't0', 'look', [], done('t0', 'answer'))
    await $.turn.start({ text: 'fix', turnId: 't1' })
    // A step that reports no usage adds nothing.
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void c
    await $.turn.complete(done('t1', 'answer', 'I fixed the parser.'))
    await clock.settle()
    const band = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await texts(band)).toContain('  “Fixed the parser.”')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...PANE })
    expect(await texts(pane)).toContain('“Fixed the parser.”')
    await pane.unmount()
    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...PANE })
    const [c, first] = await card(desk)
    expect(first?.source).toContain('› look')
    expect(c?.source).toContain('“Fixed the parser.”')
    expect(c?.source).toContain('font-style="italic"')
    expect(c?.alt).toBe('Turn recap: 1:05; 0 tokens, $0; no tools; Fixed the parser.')
    await desk.unmount()
  })
})

describe('epilogue never blocks the session', () => {
  test('steps, tools and spawns outside a turn count for nothing; a turn end with no start makes no recap', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    on('agent.spawn', () => ({ model: 'm', agentId: 'a' }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for await (const c of $.turn.step({ turnId: 't0', index: 0, model: 'm', messageCount: 1 })) void c
    expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: 'ok' })
    expect(await $.agent.spawn(SPAWN)).toEqual({ model: 'm', agentId: 'a' })
    expect(await $.turn.complete(done('t0', 'answer', 'x'))).toEqual({ text: 'x' })
    const pane = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...PANE })
    expect(await texts(pane)).toContain('No turns yet: a recap lands here after each one.')
    await pane.unmount()
  })

  test('state that cannot be written lets prompts and turns through', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    world(on)
    on('state.set', () => ({ deny: 'frozen' }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })).toEqual({ text: 'go' })
    expect(await $.turn.start({ text: 'go', turnId: 't1' })).toEqual({ turnId: 't1' })
    expect(await $.turn.complete(done('t1', 'answer', 'ok'))).toEqual({ text: 'ok' })
  })

  test('a tool or a spawn that fails below fails as it would without epilogue', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.spawn', () => {
      throw new Error('no agents')
    })
    on('tool.call', () => {
      throw new Error('no tools')
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.agent.spawn(SPAWN)).rejects.toThrow()
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).rejects.toThrow()
  })

  test('a session whose cost cannot be read still gets recaps', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ deny: 'no usage' }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await turn($, 't1', 'go', [], done('t1', 'answer'))
    const pane = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...PANE })
    expect(await texts(pane)).toContain('1:05 · $0 · 0 tok · no tools ')
    await pane.unmount()
  })
})
