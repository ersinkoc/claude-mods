import { describe, expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-gearbox',
  props: { title: 'KOZMOS · Gearbox', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

describe('register', () => {
  test('tool calls become a sorted table, a chart and the slowest list', async ($, on) => {
    const clock = mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', async ($, e) => {
      if (e.tool === 'Bash') {
        await clock.advance(e.command === 'npm run build' ? 12_000 : 400)
        if (e.command === 'npm test') return { isError: true as const, result: 'exit 1' }
        return { result: { stdout: '', stderr: '', interrupted: false } }
      }
      await clock.advance(30)
      return { result: { type: 'text', file: { filePath: '/w/a.ts', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Read', file_path: `/w/src/file${i}.ts` })
    await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the bundle' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    await $.tool.call({ tool: 'Grep', pattern: 'TODO' })

    for (const cols of [70, 40]) {
      const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(cols) })
      expect(await term.find({ type: 'Text', text: /⚙ 9/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /50%/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /SLOWEST/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /Build the bundle/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /12s/ })).toBeDefined()
      await term.unmount()
      const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(cols) })
      expect((await desk.findAll({ type: 'Svg' })).length).toBe(3)
      await desk.unmount()
    }

    // The sort button cycles: time, calls, errors.
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(70) })
    expect((await term.find({ key: 'gb-sort' }))?.props.label).toMatch(/sort: total time/)
    await term.press({ key: 'gb-sort' })
    expect((await term.find({ key: 'gb-sort' }))?.props.label).toMatch(/sort: calls/)
    const rows = await term.findAll({ type: 'Text', text: /^. (Read|Bash|Grep)/ })
    expect(rows[0]?.text ?? '').toMatch(/Read/)
    await term.press({ key: 'gb-sort' })
    expect((await term.find({ key: 'gb-sort' }))?.props.label).toMatch(/sort: errors/)
    await term.unmount()
  })

  test('no calls yet still draws', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(44) })
    expect(await term.find({ type: 'Text', text: /no tool calls yet/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(44) })
    expect((await desk.findAll({ type: 'Svg' })).length).toBe(2)
    await desk.unmount()
  })
})
