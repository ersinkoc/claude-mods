import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-chronicle',
  props: { title: 'KOZMOS · Chronicle', isFocused: false, bodyColumns: 50, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const measure = (ctx: number, fiveHour: number, usd: number) => ({
  context: { tokens: ctx * 10_000, window: 1_000_000, percent: ctx },
  rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour }],
  cost: { usd },
  changed: ['context' as const, 'rateLimits' as const, 'cost' as const],
})

describe('register', () => {
  test('a session becomes a filtered timeline on both surfaces', async ($, on) => {
    mock.clock(on)
    let usd = 1
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd } } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'a1' }))
    on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensBefore: 640_000, tokensAfter: 90_000 }))
    on('tool.call', ($, e) => {
      if (e.tool === 'Bash' && e.command.startsWith('git commit')) {
        return { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: 'abc1234def', kind: 'committed' as const, branch: 'main' } } } }
      }
      if (e.tool === 'Bash' && e.command.startsWith('npm')) return { isError: true as const, result: 'exit 1' }
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.session.measure(measure(10, 20, 1))
    await $.prompt.submit({ text: 'Fix the flaky parser test and commit it', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'Fix the flaky parser test and commit it', turnId: 't1' })
    await $.agent.spawn({
      tool_use_id: 'tu1', prompt: 'look', description: 'Find the flaky test', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
    await $.turn.complete({ answer: 'found', durationMs: 9000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "Fix the flaky parser test"', description: 'Commit' })
    await $.session.measure(measure(55, 82, 1.4))
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'long talk', toolUses: [] }] })
    usd = 1.5
    await $.turn.complete({ answer: 'done', durationMs: 65_000, isAborted: false, turnId: 't1', reason: 'answer' })

    const term = await $.ui.mount({ plugin: 'chronicle', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /Fix the flaky parser test and commit it/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /commit abc1234 on main/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Explore finished/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Bash failed/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /5h limit past 80%/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /context past 50%/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /compacted · auto/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /turn · 1:05/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /\+\$0\.50/ })).toBeDefined()
    expect(await term.find({ type: 'Raster' })).toBeDefined()

    await term.press({ key: 'f-git' })
    expect(await term.find({ type: 'Text', text: /commit abc1234/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Explore finished/ })).toBeUndefined()
    await term.press({ key: 'f-errors' })
    expect(await term.find({ type: 'Text', text: /Bash failed/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /commit abc1234/ })).toBeUndefined()
    await term.press({ key: 'f-all' })
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'chronicle', surface: 'desktop', ...PANE })
    expect((await desk.findAll({ type: 'Svg' })).length).toBe(2)
    await desk.unmount()
  })

  test('a fresh session draws its first event', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const m = await $.ui.mount({ plugin: 'chronicle', surface, ...PANE })
      expect(await m.find({ type: surface === 'terminal' ? 'Text' : 'Svg' })).toBeDefined()
      await m.unmount()
    }
  })
})
