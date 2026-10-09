import type { ToolCallArgs } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { Tally, cloudSvg, familyOf, mcpParts } from '../hooks/book.ts'

// A call the generated tool types do not list: an MCP server this machine has
// not connected, or a malformed input as a model may send it.
const loose = (input: Record<string, unknown> & { tool: string }) => input as unknown as ToolCallArgs

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-almanac',
  props: { title: 'KOZMOS · Almanac', isFocused: false, bodyColumns: 50, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('book', () => {
  test('tool names tell family, MCP server and plugin', () => {
    expect(familyOf('Bash')).toBe('shell')
    expect(familyOf('mcp__github__get_issue')).toBe('mcp')
    expect(mcpParts('mcp__github__get_issue', new Set())).toEqual({ server: 'github' })
    expect(mcpParts('mcp__plugin_playwright_playwright__browser_click', new Set())).toEqual({ server: 'playwright', plugin: 'playwright' })
    expect(mcpParts('mcp__storyboard__chapter', new Set(['mcp__storyboard__chapter']))).toEqual({ plugin: 'storyboard' })
    expect(mcpParts('Read', new Set())).toEqual({})
  })

  test('a tally ranks and remembers first use', () => {
    const t = new Tally()
    t.add('b', 10)
    t.add('a', 20)
    t.add('a', 30)
    expect(t.entries(5)).toEqual([{ name: 'a', n: 2, first: 15 }, { name: 'b', n: 1, first: 5 }])
  })

  test('the cloud escapes names', () => {
    expect(cloudSvg('Skills', '#fff', [{ name: '<x&y>', n: 1, first: 0 }], 400).source).toContain('&lt;x&amp;y&gt;')
  })
})

describe('register', () => {
  test('tallies a session and draws it on terminal and desktop', async ($, on) => {
    mock.clock(on, { now: 2_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.version', () => ({ value: { version: '2.1.293', base: '2.1.293' } }))
    on('command.list', () => ({ value: [
      { name: 'review', description: 'r', source: 'builtin' as const },
      { name: 'commit', description: 'c', source: 'plugin' as const },
      { name: 'almanac', description: 'a', source: 'plugin' as const },
    ] }))
    on('tool.list', () => ({ value: [{ name: 'mcp__storyboard__chapter', description: 'x', mcp: false }] }))
    on('tool.call', () => ({ result: 'ok' }))
    on('command.run', () => ({ text: '' }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'a1' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'review', args: '', ...RUN })
    await $.tool.call({ tool: 'Skill', skill: 'pdf' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call(loose({ tool: 'mcp__github__get_issue', number: 1 }))
    await $.tool.call({ tool: 'mcp__storyboard__chapter', title: 't', phase: 'plan' })

    await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'look around', description: 'Look around', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false })
    const printed = await $.command.run({ command: 'almanac', args: 'print', ...RUN })
    expect(printed.text).toContain('2.1.293')
    expect(printed.text).toContain('/review ×1')
    expect(printed.text).toContain('pdf ×1')
    expect(printed.text).toContain('github ×1')
    expect(printed.text).toContain('storyboard ×1')
    expect(printed.text).toContain('Installed commands: 3')
    expect(printed.text).toContain('Explore ×1')

    expect((await $.command.run({ command: 'almanac', args: '', ...RUN })).text).toContain('open')
    const term = await $.ui.mount({ plugin: 'almanac', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /ALMANAC/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /\/review/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /github/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'almanac', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.length).toBeGreaterThan(5)
    expect(svgs.some(x => String(x.props.source).includes('v2.1.293'))).toBe(true)
    await desk.unmount()
  })
})
