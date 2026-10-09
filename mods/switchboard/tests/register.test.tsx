import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { Board, p95Of, splitMcp, statusOf } from '../hooks/board.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-switchboard',
  props: { title: 'KOZMOS · Switchboard', isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

/** Calls an MCP tool and lets `ms` pass while it runs. */
async function call($: Engine, clock: MockClock, tool: `mcp__${string}__${string}`, ms: number): Promise<void> {
  const p = $.tool.call({ tool, q: 'x' })
  await clock.advance(ms)
  await p
}

describe('board', () => {
  test('names, percentiles, lamps', async () => {
    expect(splitMcp('mcp__github__search_code')).toEqual({ server: 'github', tool: 'search_code' })
    expect(splitMcp('mcp__claude_ai_Gmail__create_draft')).toEqual({ server: 'claude_ai_Gmail', tool: 'create_draft' })
    expect(splitMcp('Bash')).toBeNull()
    expect(p95Of([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 1000])).toBe(190)
    expect(p95Of([])).toBeNull()
    expect(statusOf([true, true, false], 1000, 0, 2000)).toBe('erroring')
    expect(statusOf([false, false, true], 1000, 0, 2000)).toBe('erroring')
    expect(statusOf([true, false, true, true, true], 1000, 0, 2000)).toBe('healthy')
    expect(statusOf([true], 1000, 1, 2000)).toBe('busy')
    expect(statusOf([true], 0, 0, 10 * 60_000)).toBe('idle')
    expect(statusOf([], null, 0, 0)).toBe('idle')

    const b = new Board()
    b.list(['mcp__a__one', 'mcp__a__two', 'mcp__b__x', 'Read'])
    b.start('mcp__a__one')
    b.finish('mcp__a__one', 100, 40, false)
    const s = b.snapshot(200)
    expect(s.servers.map(v => [v.name, v.toolCount, v.calls, v.status])).toEqual([['a', 2, 1, 'healthy'], ['b', 1, 0, 'idle']])
  })
})

describe('register', () => {
  test('the pane lists servers with their calls, errors and latency on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.toast', () => ({ value: undefined }))
    on('tool.list', () => ({
      value: [
        { name: 'Read', description: 'read', mcp: false },
        { name: 'mcp__github__search_code', description: 'search', mcp: true },
        { name: 'mcp__github__get_issue', description: 'issue', mcp: true },
        { name: 'mcp__sentry__list_events', description: 'events', mcp: true },
        { name: 'mcp__notion__search', description: 'search', mcp: true },
      ],
    }))
    on('mcp.connect', () => ({ value: { isConnected: false as const, reason: 'unlisted' as const, message: 'not listed' } }))
    on('tool.call', { tool: /^mcp__/ }, async ($, e) => {
      await clock.sleep(100)
      if (String(e.tool).startsWith('mcp__sentry')) return { isError: true as const, result: undefined, text: 'connection refused' }
      return { result: { content: [] } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await call($, clock, 'mcp__github__search_code', 100)
    await call($, clock, 'mcp__github__search_code', 100)
    await call($, clock, 'mcp__github__get_issue', 100)
    await call($, clock, 'mcp__sentry__list_events', 100)

    const list = await $.command.run({ command: 'switchboard', args: 'list', ...CMD })
    expect(list.text).toMatch(/3 servers · 4 calls · 1 errors/)
    expect(list.text).toMatch(/sentry\s+erroring/)
    expect(list.text).toMatch(/notion\s+idle\s+1 tools · 0 calls/)
    expect(list.text).toMatch(/github\s+healthy\s+2 tools · 3 calls · 0 err · avg 100ms · p95 100ms/)

    const open = await $.command.run({ command: 'switchboard', args: '', ...CMD })
    expect(open.text).toMatch(/open/)

    const term = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /SWITCHBOARD/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /github/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /connection refused/ })).toBeDefined()
    await term.press({ key: 'exp-github' })
    expect(await term.find({ type: 'Text', text: /search_code/ })).toBeDefined()
    await term.press({ key: 're-sentry' })
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    // The patch bay, three server cards and github's open tool table.
    expect(svgs.length).toBe(5)
    expect(await desk.find({ key: 're-sentry' })).toBeDefined()
    await desk.unmount()
  })

  test('with no MCP servers the pane says so', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.list', () => ({ value: [{ name: 'Read', description: 'read', mcp: false }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'switchboard', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /No MCP servers/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'switchboard', surface: 'desktop', ...PANE })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
  })
})
