import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const PANE_ID = 'kz-switchboard'
const pane = (bodyColumns = 56) => ({
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: { title: 'KOZMOS · Switchboard', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = 1_000_000

/**
 * The session beneath: a tool list the test holds, MCP calls that take 100 ms
 * and fail for tools whose name says `fail`, toasts recorded.
 */
function world(on: On, clock: MockClock, names: () => string[]) {
  const toasts: string[] = []
  let lists = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.list', () => {
    lists++
    return { value: names().map(name => ({ name, description: name, mcp: name.startsWith('mcp__') })) }
  })
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    // Nothing answers this one beneath: the call throws.
    if (String(e.tool).includes('throw')) return next(e)
    await clock.sleep(100)
    if (String(e.tool).includes('fail')) return { isError: true as const, result: undefined, text: 'it broke' }
    if (String(e.tool).includes('deny')) return { deny: 'not allowed' }
    return { result: { content: [] } }
  })
  return { toasts, lists: () => lists }
}

/** An MCP tool's call: the session's own tool list types `$.tool.call`, so a test server's tools are cast. */
const mcpCall = (tool: string) => ({ tool }) as never

async function call($: Engine, clock: MockClock, tool: `mcp__${string}`, ms = 100): Promise<void> {
  const p = $.tool.call(mcpCall(tool))
  await clock.advance(ms)
  await p
}

const run = async ($: Engine, args: string) => (await $.command.run({ command: 'switchboard', args, ...CMD })).text

describe('commands', () => {
  test('/switchboard closes the pane when it is open', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => [])
    let isOpen = true
    on('ui.panes', () => ({ value: isOpen ? [{ id: PANE_ID, title: 'Switchboard', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.close', () => {
      isOpen = false
      return { value: undefined }
    })
    await $.session.start(START)
    expect(await run($, '')).toBe('Switchboard closed.')
    expect(isOpen).toBe(false)
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => [])
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start(START)
    await clock.settle()
    expect(opened).toEqual([PANE_ID])
  })

  test('/switchboard list with no MCP servers says so; a busy server shows its lamp', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    let names: string[] = ['Read']
    world(on, clock, () => names)
    await $.session.start(START)
    expect(await run($, 'LIST')).toBe('Switchboard: no MCP servers in this session.')

    names = ['mcp__slow__wait']
    const p = $.tool.call(mcpCall('mcp__slow__wait'))
    await clock.settle()
    expect(await run($, ' list')).toMatch(/◉ slow\s+busy\s+1 tools · 0 calls/)
    await clock.advance(100)
    await p
    expect(await run($, 'list')).toMatch(/● slow\s+healthy\s+1 tools · 1 calls · 0 err · avg 100ms/)
  })
})

describe('the clock', () => {
  test('ages republish every 5 s; the tool list is read again every 30 s', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on, clock, () => ['mcp__a__x'])
    await $.session.start(START)
    expect(w.lists()).toBe(1)
    await clock.advance(25_000)
    expect(w.lists()).toBe(1)
    await clock.advance(5000)
    expect(w.lists()).toBe(2)
  })

  test('a tool list that cannot be read keeps what the board knew', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.list', () => ({ deny: 'no list' }))
    await $.session.start(START)
    expect(await run($, 'list')).toBe('Switchboard: no MCP servers in this session.')
  })
})

describe('calls', () => {
  test('a call that throws beneath is booked as an error with its message', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.list', () => ({ value: [] }))
    await $.session.start(START)
    await expect($.tool.call(mcpCall('mcp__ghost__boo'))).rejects.toThrow()
    await clock.settle()
    const text = await run($, 'list')
    expect(text).toMatch(/✖ ghost\s+erroring\s+0 tools · 1 calls · 1 err/)
    // The refusal's message is the server's last error.
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane(120) })
    expect(await ui.find({ type: 'Text', text: /✖ .*no implementation for tool\.call/ })).toBeDefined()
    await ui.unmount()
  })

  test('denied and failed calls both count as errors', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => ['mcp__gate__deny_me', 'mcp__gate__fail_me'])
    await $.session.start(START)
    await call($, clock, 'mcp__gate__deny_me')
    await call($, clock, 'mcp__gate__fail_me')
    expect(await run($, 'list')).toMatch(/gate\s+erroring\s+2 tools · 2 calls · 2 err/)
  })

  test('a refused state write never breaks a call or the timer, and is written once it can be', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => ['mcp__a__x'])
    let isFrozen = false
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'frozen' } : next(e)))
    await $.session.start(START)
    isFrozen = true
    const ok = $.tool.call(mcpCall('mcp__a__x'))
    await clock.advance(100)
    expect(await ok).toEqual({ result: { content: [] } })
    await expect($.tool.call(mcpCall('mcp__a__throw'))).rejects.toThrow()
    // Thirty seconds: five republishes and one read of the list, each refused.
    await clock.advance(30_000)
    isFrozen = false
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: /^1 srv · 2 calls · 1 err$/ })).toBeUndefined()
    await ui.unmount()
    // The next tick writes what was refused.
    await clock.advance(5000)
    const after = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane() })
    expect(await after.find({ type: 'Text', text: /^1 srv · 2 calls · 1 err$/ })).toBeDefined()
    await after.unmount()
  })
})

describe('reconnect', () => {
  test('connected, refused with a reason, or failing: each gets its toast', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on, clock, () => ['mcp__good__fail', 'mcp__auth__fail', 'mcp__gone__fail'])
    on('mcp.connect', ($, e) => {
      if (e.server === 'good') return { value: { isConnected: true as const, server: 'good' } }
      if (e.server === 'auth') return { value: { isConnected: false as const, reason: 'auth' as const, message: 'sign in first' } }
      return { deny: 'unreachable' }
    })
    await $.session.start(START)
    for (const s of ['good', 'auth', 'gone']) await call($, clock, `mcp__${s}__fail`)
    const term = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane() })
    await term.press({ key: 're-good' })
    await term.press({ key: 're-auth' })
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...pane() })
    await desk.press({ key: 're-gone' })
    await desk.unmount()
    expect(w.toasts[0]).toBe('⬡ good: connected')
    expect(w.toasts[1]).toBe('⬡ auth: sign in first')
    expect(w.toasts[2]).toMatch(/^⬡ gone: .*unreachable.* — try \/mcp$/)
  })
})

describe('drawing', () => {
  test('terminal: tools expand and collapse; errors, unlisted tools and the floor width show', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => ['mcp__hub__fail_op', 'mcp__hub__never'])
    await $.session.start(START)
    await call($, clock, 'mcp__hub__fail_op')
    // A call to a tool the list does not offer.
    await call($, clock, 'mcp__hub__hidden')
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane(0) })
    expect(await ui.find({ type: 'Text', text: /^1 srv · 2 calls · 1 err$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fail_op/ })).toBeUndefined()
    await ui.press({ key: 'exp-hub' })
    expect(await ui.find({ type: 'Text', text: /◦ fail_op.* 1✖$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· hidden/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◦ never\s+0×\s+—/ })).toBeDefined()
    // No measured width: 44 columns of rule.
    expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text).toHaveLength(44)
    await ui.press({ key: 'exp-hub' })
    expect(await ui.find({ type: 'Text', text: /fail_op/ })).toBeUndefined()
    await ui.unmount()
  })

  test('terminal: a clean board shows no error count', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => ['mcp__ok__a'])
    await $.session.start(START)
    await call($, clock, 'mcp__ok__a')
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: /^1 srv · 1 calls$/ })).toBeDefined()
    await ui.unmount()
  })

  test('desktop: the tool table shows running, failed, idle and unlisted tools', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, clock, () => ['mcp__hub__fail_op', 'mcp__hub__slow', 'mcp__hub__never'])
    await $.session.start(START)
    await call($, clock, 'mcp__hub__fail_op')
    await call($, clock, 'mcp__hub__hidden')
    const pending = $.tool.call(mcpCall('mcp__hub__slow'))
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...pane() })
    await ui.press({ key: 'exp-hub' })
    const table = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).find(s => s.includes('>TOOL<'))
    expect(table).toBeDefined()
    expect(table).toContain('>1 (1✖)<')
    expect(table).toContain('fill="#22d3ee"')
    expect(table).toContain('class="m" x="28"')
    expect(table).toMatch(/>never<\/text>[^]*?>—<\/text>[^]*?>—<\/text>[^]*?><\/text>/)
    await ui.press({ key: 'exp-hub' })
    expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.source).includes('>TOOL<'))).toBe(false)
    await ui.unmount()
    await clock.advance(100)
    await pending
  })

  test('desktop: cables go quiet after a minute; a nameless tool; more than twelve servers', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const many = Array.from({ length: 13 }, (_, i) => `mcp__s${String(i).padStart(2, '0')}__t`)
    world(on, clock, () => many)
    await $.session.start(START)
    await call($, clock, 'mcp__solo')
    let ui = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...pane(120) })
    let svgs = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
    expect(svgs[0]).toContain('class="flow"')
    expect(svgs[0]).toContain('+2 more')
    const solo = svgs.slice(1).find(s => s.includes('>solo<'))
    expect(solo).toMatch(/ago<\/text>/)
    expect(svgs.some(s => s.includes('never called'))).toBe(true)
    await ui.unmount()

    // The snapshot moves on the half minute: by then the last call is over a minute old.
    await clock.advance(91_000)
    ui = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...pane(120) })
    svgs = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
    expect(svgs[0]).not.toContain('class="flow"')
    expect(svgs[0]).toContain('filter="url(#sbglow)"/>')
    await ui.unmount()
  })
})
