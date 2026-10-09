import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-bridge',
  props: { title: 'KOZMOS · Bridge', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

describe('register', () => {
  test('the bridge pane shows the model, context and limits on every surface', async ($, on) => {
    mock.clock(on)
    mock.env(on, { OS: 'Windows_NT' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 420_000, window: 1_000_000, percent: 42 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2030-01-01T00:00:00Z' }],
        cost: { usd: 3.21 },
      },
    }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.cwd', () => ({ value: '/work' }))
    on('agent.list', () => ({ value: [] }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /42%/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
  })
})
