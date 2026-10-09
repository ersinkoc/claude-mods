import type { ToolCallArgs } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { AlmanacSnap } from '../types'

// A call the generated tool types do not list: an MCP server this machine has
// not connected, or a malformed input as a model may send it.
const loose = (input: Record<string, unknown> & { tool: string }) => input as unknown as ToolCallArgs

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-almanac',
  props: { title: 'KOZMOS · Almanac', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = { tool_use_id: 'tu1', prompt: 'look', description: 'Look', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }
const SNAP = { plugin: 'almanac', key: 'snap' } as const
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const print = async ($: { command: { run: (i: { command: string; args: string } & typeof RUN) => Promise<{ text?: string }> } }) =>
  (await $.command.run({ command: 'almanac', args: 'print', ...RUN })).text ?? ''

describe('almanac ledger', () => {
  test('/almanac opens and closes the pane', async ($, on) => {
    let open = false
    const calls: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-almanac', title: 'KOZMOS · Almanac', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      open = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      open = false
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await $.command.run({ command: 'almanac', args: '', ...RUN })).text).toBe('Almanac open.')
    expect((await $.command.run({ command: 'almanac', args: '', ...RUN })).text).toBe('Almanac closed.')
    expect(calls).toEqual(['open kz-almanac KOZMOS · Almanac', 'close kz-almanac'])
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const opened: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true as const } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual(['kz-almanac'])
  })

  test('nothing known: no version, no command list, no tool list', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const text = await print($)
    expect(text).toContain('Almanac — Claude Code ? · 0:00 · 0 tool calls')
    expect(text).toContain('Installed commands: unknown')

    const term = await $.ui.mount({ plugin: 'almanac', surface: 'terminal', ...pane(0) })
    const all = await texts(term)
    expect(all).toContain('v? · 0:00')
    expect(all).toContain('installed commands unknown')
    expect(all).toContain('COMMANDS none yet')
    expect(all).toContain('SKILLS none yet')
    expect(all).toContain('TOOL FAMILIES none yet')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'almanac', surface: 'desktop', ...pane(50) })
    expect((await desk.findAll({ type: 'Svg' }))[0]?.props.alt).toBe('Almanac: Claude Code unknown version, 0 tool calls')
    await desk.unmount()
  })

  test('a busy session ranks commands, clouds skills, counts models and plugin agents', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('command.list', () => ({ value: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'z'].map(name => ({ name, description: name, source: 'plugin' as const })) }))
    on('tool.list', ($, e, next) => next(e))
    on('command.run', () => ({ text: '' }))
    on('tool.call', () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'a1' }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a']) {
      await clock.advance(1_000)
      await $.command.run({ command: c, args: '', ...RUN })
    }
    for (const skill of ['pdf', 'pdf', 'pdf', 'pdf', 'docx', 'xlsx']) await $.tool.call({ tool: 'Skill', skill })
    await $.tool.call(loose({ tool: 'Skill' }))
    await $.tool.call(loose({ tool: 'mcp__plugin_pw_browser__click', ref: 'x' }))
    await $.agent.spawn({ ...SPAWN, subagentType: 'plugin-dev:agent-creator' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5', messageCount: 1 })) void c
    for await (const c of $.turn.step({ turnId: 't1', index: 1, model: 'claude-haiku-5', messageCount: 2 })) void c

    const text = await print($)
    expect(text).toContain('Commands: /a ×2, /b ×1')
    expect(text).toContain('Skills: pdf ×4, docx ×1, xlsx ×1')
    expect(text).toContain('Subagents: Explore ×1, plugin-dev:agent-creator ×1')
    expect(text).toContain('MCP servers: browser ×1')
    expect(text).toContain('Plugins: plugin-dev ×1, pw ×1')
    expect(text).toContain('Models: Haiku 5 ×2')
    expect(text).toContain('Installed commands: 9, never run this session: 1')

    await clock.advance(1_000) // the heartbeat publishes
    const term = await $.ui.mount({ plugin: 'almanac', surface: 'terminal', ...pane(50) })
    const all = await texts(term)
    expect(all).toContain('v2.1.300')
    expect(all).toContain('COMMANDS 8')
    expect(all).toContain('  +2 more') // eight commands, six shown
    expect(all).toContain('pdf·4')
    expect(all).toMatch(/^docx$/m)
    expect(all).toContain('9 commands installed, 1 never run here')
    expect(all).toContain('TOOL FAMILIES 8 calls')
    expect(all).toMatch(/^■ skill 7$/m)
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'almanac', surface: 'desktop', ...pane(70) })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.slice(1).map(s => s.props.alt)).toEqual([
      'Slash commands run', 'Skills invoked', 'Subagent types spawned', 'MCP servers used', 'Models seen', 'Plugins whose tools were called', 'Tool calls by family',
    ])
    expect(svgs[0]?.props.alt).toBe('Almanac: Claude Code 2.1.300, 8 tool calls')
    expect(String(svgs[5]?.props.source)).toContain('Haiku 5')
    await desk.unmount()
  })

  test('the heartbeat publishes what changed, re-reads the catalog, and refreshes the age each minute', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const writes: AlmanacSnap[] = []
    let lists = 0
    on('state.set', SNAP, ($, e, next) => {
      writes.push(e.value as AlmanacSnap)
      return next(e)
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => {
      lists++
      return { value: [{ name: 'review', description: 'r', source: 'builtin' as const }] }
    })
    on('tool.list', () => ({ value: [] }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(writes).toHaveLength(1)
    expect(lists).toBe(1)
    await clock.advance(5_000) // nothing used: nothing published
    expect(writes).toHaveLength(1)
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await clock.advance(1_000)
    expect(writes).toHaveLength(2)
    expect(writes[1]?.tools).toBe(1)
    await clock.advance(24_000) // 30 s: the catalog again, same as before: no write
    expect(lists).toBe(2)
    expect(writes).toHaveLength(2)
    await clock.advance(30_000) // a minute: the age moves
    expect(lists).toBe(3)
    expect(writes).toHaveLength(3)
    expect(writes[2]?.now).toBe(60_000)
  })

  test('a state that refuses writes is shrugged off by the start and the heartbeat', async ($, on) => {
    const clock = mock.clock(on)
    let refused = 0
    on('state.set', SNAP, () => {
      refused++
      return { deny: 'read-only' }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(refused).toBe(1)
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await clock.advance(1_000)
    expect(refused).toBe(2)
    expect(await print($)).toContain('1 tool calls')
  })

  test('calls nothing answers pass their failure on, still counted', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.command.run({ command: 'review', args: '', ...RUN })).rejects.toThrow()
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a' })).rejects.toThrow()
    await expect($.agent.spawn({ ...SPAWN, subagentType: 'Explore' })).rejects.toThrow()
    const text = await print($)
    expect(text).toMatch(/^Commands: \/review ×1$/m)
    expect(text).toContain('Subagents: Explore ×1')
    expect(text).toContain('1 tool calls')
  })

  test('the pane draws before the session started', async ($, on) => {
    mock.clock(on, { now: 90_000 })
    const term = await $.ui.mount({ plugin: 'almanac', surface: 'terminal', ...pane(50) })
    expect(await term.find({ type: 'Text', text: /ALMANAC/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: 'v? · 1:30' })).toBeDefined()
    await term.unmount()
  })
})
