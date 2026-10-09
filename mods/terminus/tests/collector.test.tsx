import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-terminus',
  props: { title: 'KOZMOS · Terminus', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const OK = { result: { stdout: 'out', stderr: '', interrupted: false } }

/** A full Agent spawn as the engine raises it. */
const spawnOf = (description: string, subagentType: string) => ({
  tool_use_id: `tu-${description}`, prompt: 'p', description, subagentType,
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

function engine(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

describe('before the session (a hot reload)', () => {
  test('carries on from the snapshot the last module published', async ($, on) => {
    mock.clock(on, { now: 1000 })
    let seeded = false
    on('state.get', ($, e, next) => {
      if (seeded || e.key !== 'snap') return next(e)
      seeded = true
      return { value: { value: { runs: [], total: 7, failures: 2, slow: 0, totalMs: 5000 }, version: 1 } }
    })
    on('tool.call', () => OK)
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    const { text } = await $.command.run({ command: 'terminus', args: 'list', ...RUN })
    expect(text).toStartWith('Terminus: 8 shell commands, 2 failed, 5.0s in the shell.')
  })

  test('nothing kept: starts empty, the pane draws an empty snapshot', async ($, on) => {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const ui = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /0 cmds/ })).toBeDefined()
    await ui.unmount()
    const { text } = await $.command.run({ command: 'terminus', args: ' list ', ...RUN })
    expect(text).toBe('Terminus: 0 shell commands, 0 failed, 0ms in the shell.')
  })
})

describe('the pane toggle', () => {
  test('autoOpen opens the pane at start; the command closes an open one', { options: { autoOpen: true } }, async ($, on) => {
    engine(on)
    const opened: string[] = []
    let closed = ''
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.panes', () => ({ value: [{ id: 'kz-terminus', title: 'KOZMOS · Terminus', isShown: true, isFocused: false, isPlaced: true }] }))
    on('ui.close', ($, e) => {
      closed = e.id
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual(['kz-terminus'])
    expect((await $.command.run({ command: 'terminus', args: '', ...RUN })).text).toBe('Terminus closed.')
    expect(closed).toBe('kz-terminus')
  })

  test('a pane that cannot open does not stop the session', { options: { autoOpen: true } }, async ($, on) => {
    engine(on)
    const started = await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(started.cwd).toBe('/w')
  })
})

describe('who ran it', () => {
  test('spawned agents by description or type; the roster; an id when nobody knows', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engine(on)
    on('agent.spawn', ($, e) => {
      if (e.description === 'refuse') return { deny: 'no agents' }
      if (e.description === 'hollow') return { model: 'haiku' }
      return { model: 'haiku', agentId: e.description === '' ? 'ag-typed' : 'ag-named' }
    })
    let listed = 0
    on('agent.list', () => {
      listed++
      return { value: [{ id: 'ag-roster', description: '', type: 'Explore', status: 'running' as const }] }
    })
    on('tool.call', () => OK)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.agent.spawn(spawnOf('Fix the build', 'general-purpose'))
    await $.agent.spawn(spawnOf('', 'Plan'))
    await expect($.agent.spawn(spawnOf('refuse', 'x'))).resolves.toMatchObject({ deny: 'no agents' })
    await $.agent.spawn(spawnOf('hollow', 'x'))

    await $.tool.call({ tool: 'Bash', command: 'a', agentId: 'ag-named' } as never)
    await $.tool.call({ tool: 'Bash', command: 'b', agentId: 'ag-typed' } as never)
    expect(listed).toBe(0)
    await $.tool.call({ tool: 'Bash', command: 'c', agentId: 'ag-roster' } as never)
    await $.tool.call({ tool: 'Bash', command: 'd', agentId: 'ag-roster' } as never)
    expect(listed).toBe(1)
    await $.tool.call({ tool: 'Bash', command: 'e', agentId: 'ag-stranger-1' } as never)

    const ui = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /◈ Fix the build/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◈ Plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◈ Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◈ agent ag-str/ })).toBeDefined()
    await ui.unmount()
  })

  test('an unreadable roster falls back to the id; a failing spawn chain is handed on', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engine(on)
    on('tool.call', () => OK)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem', agentId: 'xyz123456' } as never)
    const desk = await $.ui.mount({ plugin: 'terminus', surface: 'desktop', ...PANE })
    expect(String((await desk.findAll({ type: 'Svg' }))[1]?.props.alt)).toBe('ok PowerShell: Get-ChildItem, 0ms, by agent xyz123')
    await desk.unmount()
    // Nothing answers agent.spawn beneath: the hook's catch hands the error on.
    await expect($.agent.spawn(spawnOf('d', 't'))).rejects.toThrow()
  })
})

describe('recording runs', () => {
  test('odd inputs: no command, a blank description, no id, a huge command; other tools are passed by', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engine(on)
    on('tool.call', () => OK)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 42, description: '   ', tool_use_id: '' } as never)
    await $.tool.call({ tool: 'Bash', command: 'x'.repeat(2500), description: 'Huge' })
    await $.tool.call({ tool: 'Glob', pattern: '*.ts' })
    const { text } = await $.command.run({ command: 'terminus', args: 'list', ...RUN })
    expect(text).toContain('2 shell commands')
    const ui = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE })
    const huge = await ui.find({ type: 'Text', text: /^x+…$/ })
    expect(huge?.text).toHaveLength(2001)
    expect(await ui.find({ type: 'Text', text: /Huge/ })).toBeDefined()
    await ui.unmount()
  })

  test('without a clock the hook steps aside and the call still runs', async ($, on) => {
    engine(on)
    on('tool.call', () => OK)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.result).toEqual(OK.result)
  })

  test('a state that never settles: the publishes give up quietly', async ($, on) => {
    mock.clock(on, { now: 1000 })
    let stale = false
    on('state.get', ($, e, next) => (stale ? { value: { value: null, version: 1 } } : next(e)))
    on('state.set', ($, e, next) => (stale ? { value: { isSet: false as const, version: 2 } } : next(e)))
    engine(on)
    on('tool.call', () => OK)
    stale = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.result).toEqual(OK.result)
    stale = false
    expect((await $.command.run({ command: 'terminus', args: 'list', ...RUN })).text).toContain('1 shell commands')
  })
})

describe('the pane', () => {
  test('a running command pulses; notes, more than 60 runs and an empty filter', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    engine(on)
    on('tool.call', async ($, e) => {
      const cmd = (e as unknown as { command: string }).command
      if (cmd === 'npm run dev') await clock.sleep(60_000)
      if (cmd === 'grep x') return { result: { stdout: '', stderr: '', interrupted: false, returnCodeInterpretation: 'No matches found' } }
      return OK
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 61; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` })
    await $.tool.call({ tool: 'Bash', command: 'grep x' })
    const dev = $.tool.call({ tool: 'Bash', command: 'npm run dev' })
    await clock.settle()

    const term = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 0 } })
    expect(await term.find({ type: 'Text', text: /63 cmds/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /3 older runs not shown/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /└ No matches found/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /└ running…/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /chars of output kept/ })).toBeDefined()
    const spark = await term.find({ type: 'Text', text: /^time / })
    expect(spark?.text).toHaveLength('time '.length + 38)
    await term.press({ key: 'f-failed' })
    expect(await term.find({ type: 'Text', text: /Nothing matches this filter/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'terminus', surface: 'desktop', ...PANE })
    expect(await desk.find({ type: 'Text', text: /Nothing matches this filter/ })).toBeDefined()
    await desk.press({ key: 'f-all' })
    expect(await desk.find({ type: 'Text', text: /3 older runs not shown/ })).toBeDefined()
    expect(String((await desk.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('1 running')
    await desk.unmount()

    await clock.advance(60_000)
    await dev
  })

  test('copy and re-run quietly do nothing where the surface cannot', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engine(on)
    on('tool.call', () => OK)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'one' })
    const ui = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE })
    await ui.press({ key: 'cp-one' })
    await ui.press({ key: 'rp-one' })
    expect(await ui.find({ type: 'Button', key: 'cp-one' })).toBeDefined()
    await ui.unmount()
  })
})
