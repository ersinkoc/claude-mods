import { describe, expect, mock, test } from 'claude-code/testing'

const PROPS = { title: 'KOZMOS · Hivemind', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const PANE = { component: 'Pane' as const, requestId: 'kz-hivemind', props: PROPS }
const USAGE = { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, model: 'claude-haiku-5' }

describe('register', () => {
  test('the hive grows a subagent under main and shows its stats on both surfaces', async ($, on) => {
    mock.clock(on)
    let roster: { id: string; description: string; type: string; status: 'running' | 'completed'; parentId?: string }[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('agent.list', () => ({ value: roster }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'a1' }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
    })
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'map the repo', turnId: 't1' })
    await $.agent.spawn({
      tool_use_id: 'tu1', prompt: 'find the tests', description: 'Find the tests', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
    roster = [{ id: 'a1', description: 'Find the tests', type: 'Explore', status: 'running' }]
    const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5', effort: 'low', messageCount: 1, agentId: 'a1' })
    for await (const _chunk of step) { /* drain */ }
    await step.result
    await $.tool.call({ tool: 'Bash', command: 'ls tests', description: 'List the tests' })

    const term = await $.ui.mount({ plugin: 'hivemind', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /◆ main/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Haiku 5/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /List the tests/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1 running/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'hivemind', surface: 'desktop', ...PANE })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()

    // The subagent finishes: the node turns done and the fold button appears.
    roster = [{ id: 'a1', description: 'Find the tests', type: 'Explore', status: 'completed' }]
    await $.turn.complete({ answer: 'found 12', durationMs: 4000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
    const after = await $.ui.mount({ plugin: 'hivemind', surface: 'terminal', ...PANE })
    expect(await after.find({ type: 'Text', text: /✓ 1/ })).toBeDefined()
    await after.press({ key: 'hm-done' })
    expect(await after.find({ type: 'Text', text: /Find the tests/ })).toBeUndefined()
    await after.unmount()
  })

  test('an empty session still draws', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('agent.list', () => ({ value: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const m = await $.ui.mount({ plugin: 'hivemind', surface, ...PANE })
      expect(await m.find({ type: surface === 'terminal' ? 'Text' : 'Svg' })).toBeDefined()
      await m.unmount()
    }
  })
})
