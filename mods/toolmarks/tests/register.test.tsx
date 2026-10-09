import { describe, expect, mock, test } from 'claude-code/testing'

describe('register', () => {
  test('finished tool rows carry duration, exit status and an error mark beside the engine row', async ($, on) => {
    const clock = mock.clock(on, { now: 5_000 })
    mock.store(on, {})
    const ids: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', async ($, e) => {
      const id = e.tool_use_id ?? `id${ids.length}`
      ids.push(id)
      await clock.sleep(e.tool === 'Bash' && e.command === 'npm test' ? 1200 : 400)
      if (e.tool === 'Bash' && e.command === 'false') {
        return { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'Exit code 2\nboom', tool_use_id: id }
      }
      return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok', tool_use_id: id }
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="engine">engine row</Text>
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ok = $.tool.call({ tool: 'Bash', command: 'npm test' })
    await clock.advance(1200)
    await ok
    const bad = $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.advance(400)
    await bad
    await clock.settle()
    const [okId = '', badId = ''] = ids

    const row = (id: string, command: string, isErrored: boolean) => ({
      component: 'ToolUse' as const,
      requestId: id,
      props: { tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored, isInterrupted: false, output: { stdout: '', stderr: '', interrupted: false } },
    })

    const term = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row(okId, 'npm test', false) })
    expect(await term.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /exit 0/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1\.2s/ })).toBeDefined()
    await term.unmount()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'toolmarks', surface, ...row(badId, 'false', true) })
      expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /✖ exit 2/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }

    // A running row, or one whose shape is not a tool row's, is the engine's alone.
    const live = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row(okId, 'npm test', false), props: { ...row(okId, 'npm test', false).props, isRunning: true } })
    expect(await live.find({ type: 'Text', text: /exit/ })).toBeUndefined()
    await live.unmount()

    const group = await $.ui.mount({
      plugin: 'toolmarks', surface: 'terminal', component: 'ToolGroup',
      props: {
        isActive: false, isExpanded: false,
        calls: [
          { tool_use_id: okId, tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false },
          { tool_use_id: badId, tool: 'Bash', input: {}, isRunning: false, isErrored: true, isInterrupted: false },
        ],
      },
    })
    expect(await group.find({ type: 'Text', text: /Σ 1\.6s/ })).toBeDefined()
    expect(await group.find({ type: 'Text', text: /1 failed/ })).toBeDefined()
    await group.unmount()

    await $.command.run({ command: 'toolmarks', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    const off = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row(okId, 'npm test', false) })
    expect(await off.find({ type: 'Text', text: /exit/ })).toBeUndefined()
    await off.unmount()
  })
})
