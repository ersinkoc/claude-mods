import { describe, expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-gearbox',
  props: { title: 'KOZMOS · Gearbox', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = { tool_use_id: 'tu1', prompt: 'look', description: 'Look', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }
// A subagent's call carries its agentId beside the tool's input.
const inAgent = (agentId: string) => ({ agentId })
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

describe('gearbox', () => {
  test('/gearbox opens the sidebar, then closes it', async ($, on) => {
    let open = false
    const calls: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-gearbox', title: 'KOZMOS · Gearbox', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id}`)
      open = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      open = false
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(calls).toEqual([])
    expect((await $.command.run({ command: 'gearbox', args: '', ...RUN })).text).toBe('Gearbox open.')
    expect((await $.command.run({ command: 'gearbox', args: '', ...RUN })).text).toBe('Gearbox closed.')
    expect(calls).toEqual(['open kz-gearbox', 'close kz-gearbox'])
  })

  test('autoOpen opens the sidebar when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const opened: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      opened.push(`${e.id} ${e.title}`)
      return { value: { isPlaced: true as const } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual(['kz-gearbox KOZMOS · Gearbox'])
  })

  test('subagent calls are split from the main loop and named by their agent type', async ($, on) => {
    const clock = mock.clock(on)
    let spawns = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.spawn', () => {
      spawns++
      if (spawns === 1) return { model: 'claude-haiku-5', agentId: 'a1' }
      if (spawns === 2) return { model: 'claude-haiku-5', agentId: 'a2' }
      if (spawns === 3) return { model: 'claude-haiku-5' }
      return { deny: 'no more agents' }
    })
    on('tool.call', async ($, e) => {
      await clock.advance(e.tool === 'Grep' ? 70_000 : 2_000)
      return { result: 'ok' }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
    await $.agent.spawn({ ...SPAWN, subagentType: '' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Plan' })
    expect(await $.agent.spawn({ ...SPAWN, subagentType: 'Plan' })).toMatchObject({ deny: 'no more agents' })

    await $.tool.call({ tool: 'Grep', pattern: 'needle', ...inAgent('a1') })
    await $.tool.call({ tool: 'Glob', pattern: '*.ts', ...inAgent('a2') })
    await $.tool.call({ tool: 'WebFetch', url: 'https://x.dev', prompt: 'p', ...inAgent('zz') })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })

    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(70) })
    const all = await texts(term)
    expect(all).toContain('1:16') // 76 s of tool time
    expect(all).toMatch(/1:10 Grep needle · Explore/)
    expect(all).toMatch(/2\.0s Glob \*\.ts · agent/)
    expect(all).toMatch(/2\.0s WebFetch x\.dev · agent/)
    expect(all).toMatch(/2\.0s Read a\.ts$/m)
    expect(all).toMatch(/1\/3$/m) // main / sub calls
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(70) })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(String(svgs[1]?.props.source)).toContain('1 in agents')
    expect(String(svgs[2]?.props.source)).toContain('Grep · Explore')
    expect(String(svgs[2]?.props.alt)).toBe('slowest: Grep 1:10, Glob 2.0s, WebFetch 2.0s, Read 2.0s')
    await desk.unmount()
  })

  test('sorting on the desktop: calls, then errors, with the errored share marked', async ($, on) => {
    const clock = mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', async ($, e) => {
      await clock.advance(500)
      if (e.tool === 'Bash') return { isError: true as const, result: 'exit 1' }
      if (e.tool === 'Edit') return { deny: 'not now' }
      return { result: 'ok' }
    })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' })
    await $.tool.call({ tool: 'Bash', command: 'ls', description: '' })
    await $.tool.call({ tool: 'Edit', file_path: '/w/b.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/w/c.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/w/d.ts' })

    const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(60) })
    const chart = async () => String((await desk.findAll({ type: 'Svg' }))[1]?.props.source)
    expect(String((await desk.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('3 · 50%')
    expect(await chart()).toContain('BY TOTAL TIME')
    expect(await chart()).toContain('opacity=".85"') // Bash's errored share
    expect(await chart()).toContain('2 err (100%)')
    await desk.press({ key: 'gb-sort' })
    expect(await chart()).toContain('BY CALLS')
    expect(await chart()).toContain('>3×<')
    await desk.press({ key: 'gb-sort' })
    expect(await chart()).toContain('BY ERRORS')
    expect(await chart()).toContain('>2 err<')
    expect(await chart()).not.toContain('opacity=".85"')
    await desk.press({ key: 'gb-sort' })
    expect(await chart()).toContain('BY TOTAL TIME')
    await desk.unmount()

    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(44) })
    const all = await texts(term)
    expect(all).toMatch(/Bash +2 +100%/)
    expect(all).toMatch(/Edit +1 +100%/)
    expect(all).toMatch(/Read +3 +·/)
    await term.unmount()
  })

  test('a running call shows on both surfaces; calls over hours slide the per-minute window', async ($, on) => {
    const clock = mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', async () => {
      await clock.sleep(1_000)
      return { result: 'ok' }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const running = $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await clock.settle()
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(60) })
    expect(await term.find({ type: 'Text', text: '● 1 running' })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(60) })
    expect(String((await desk.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('class="pulse"')
    await desk.unmount()
    await clock.advance(1_000)
    await running

    // Two hours on, the window keeps the last 120 minutes.
    await clock.advance(3 * 60 * 60_000)
    const late = $.tool.call({ tool: 'Grep', pattern: 'x' })
    await clock.advance(1_000)
    await late
    const after = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(60) })
    const all = await texts(after)
    expect(all).toContain('1/min')
    expect(all).not.toContain('running')
    await after.unmount()
    const desk2 = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(60) })
    expect(String((await desk2.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('peak 1')
    await desk2.unmount()
  })

  test('calls that end at once tie, and sort by name; overlapping calls publish once', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await Promise.all([$.tool.call({ tool: 'Write', file_path: '/w/z.ts', content: '' }), $.tool.call({ tool: 'Glob', pattern: '*' })])
    await $.tool.call({ tool: 'EnterPlanMode' })
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(0) })
    const rows = (await term.findAll({ type: 'Text' })).map(t => t.text).filter(t => /^\S (Glob|Write|EnterPlan\S*) +\d/.test(t))
    expect(rows.map(r => r.split(/\s+/)[1])).toEqual(['EnterPlanMod', 'Glob', 'Write']) // the name is cut to its column
    expect(await term.find({ type: 'Text', text: /⚙ 3/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gearbox', surface: 'desktop', ...pane(60) })
    expect(String((await desk.findAll({ type: 'Svg' }))[2]?.props.source)).toContain('>—<')
    await desk.unmount()
  })

  test('a call nothing answers counts as an error and still passes through', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).rejects.toThrow()
    await expect($.agent.spawn({ ...SPAWN, subagentType: 'Explore' })).rejects.toThrow()
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(60) })
    expect(await term.find({ type: 'Text', text: /✖ 1/ })).toBeDefined()
    await term.unmount()
  })

  test('the pane draws before the session has started', async ($, on) => {
    mock.clock(on)
    const term = await $.ui.mount({ plugin: 'gearbox', surface: 'terminal', ...pane(60) })
    expect(await term.find({ type: 'Text', text: /no tool calls yet/ })).toBeDefined()
    await term.unmount()
  })
})
