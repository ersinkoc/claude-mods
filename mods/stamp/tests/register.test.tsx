import { describe, expect, mock, test } from 'claude-code/testing'

describe('register', () => {
  test('a finished turn draws a receipt on its TurnDuration line, and /stamp off hands it back', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, {})
    let calls = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => {
      calls++
      const late = calls > 1
      return {
        value: {
          startedAt: 0,
          context: { tokens: late ? 580_000 : 540_000, window: 1_000_000, percent: late ? 58 : 54 },
          rateLimits: [],
          cost: { usd: late ? 1.31 : 1.0 },
        },
      }
    })
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="engine">engine line</Text>
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await $.turn.complete({
      turnId: 't1', answer: 'done', durationMs: 42_000, isAborted: false, reason: 'answer',
      usage: { input_tokens: 1100, cache_creation_input_tokens: 2000, cache_read_input_tokens: 90_000, output_tokens: 8200, model: 'claude-opus-5-5' },
    })
    await clock.settle()

    const LINE = { component: 'TurnDuration' as const, props: { word: 'Baked', durationMs: 42_300 } }
    const term = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', ...LINE })
    expect(await term.find({ type: 'Text', text: '3 tools' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /↑3\.1k ↓8\.2k tok/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /\$0\.31/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /ctx 58% \(\+4%\)/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'stamp', surface: 'desktop', ...LINE })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()

    // A line of another length matches no receipt: the engine's own is kept.
    const other = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', component: 'TurnDuration', props: { word: 'Brewed', durationMs: 5_000 } })
    expect(await other.find({ type: 'Text', text: /tools/ })).toBeUndefined()
    expect(await other.find({ type: 'Text', text: 'engine line' })).toBeDefined()
    await other.unmount()

    const { text } = await $.command.run({ command: 'stamp', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('off')
    const off = await $.ui.mount({ plugin: 'stamp', surface: 'terminal', ...LINE })
    expect(await off.find({ type: 'Text', text: /tools/ })).toBeUndefined()
    await off.unmount()
  })
})
