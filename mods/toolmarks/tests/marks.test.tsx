import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KZ } from '../hooks/lib/kz.ts'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

/** What the tool beneath answers for the next call, after `ms` on the clock. */
type Plan = { ms: number; answer: Record<string, unknown> }
const OK = { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }

function world(on: On, opts: { store?: Record<string, unknown> | false; tools?: boolean } = {}): { clock: MockClock; plan: Plan[] } {
  const clock = mock.clock(on, { now: 5_000 })
  const plan: Plan[] = []
  if (opts.store !== false) mock.store(on, opts.store ?? {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (opts.tools !== false) {
    on('tool.call', async () => {
      const p = plan.shift() ?? { ms: 0, answer: OK }
      if (p.ms) await clock.sleep(p.ms)
      return p.answer as never
    })
  }
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine row</Text>
  })
  return { clock, plan }
}

/** Runs one call that takes `ms` and answers `answer`. */
async function call($: Engine, w: { clock: MockClock; plan: Plan[] }, input: Record<string, unknown>, ms: number, answer: Record<string, unknown> = OK): Promise<unknown> {
  w.plan.push({ ms, answer })
  const pending = $.tool.call(input as never)
  await w.clock.advance(ms)
  const r = await pending
  await w.clock.settle()
  return r
}

const ROW = { isRunning: false, isErrored: false, isInterrupted: false, input: {} }
const row = (id: string, tool: string, extra: Record<string, unknown> = {}) => ({
  component: 'ToolUse' as const,
  requestId: id,
  props: { ...ROW, tool_use_id: id, tool, ...extra } as never,
})

/** The badge text drawn beside a terminal row, or undefined when the row is the engine's alone. */
async function badge($: Engine, id: string, tool: string, extra: Record<string, unknown> = {}): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row(id, tool, extra) })
  const parts = await ui.findAll({ type: 'Text', text: /./ })
  await ui.unmount()
  // The engine's row, then the badge line, then its parts.
  return parts.find(p => p.text !== 'engine row')?.text
}

const toolmarks = async ($: Engine, args: string): Promise<string> => String((await $.command.run({ command: 'toolmarks', args, ...RUN })).text)

describe('badges on the terminal', () => {
  test('durations: milliseconds, tenths of a second, seconds, minutes; slow ones in amber', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'r1' }, 12)
    await call($, w, { tool: 'Grep', pattern: 'x', tool_use_id: 'r2' }, 4000)
    await call($, w, { tool: 'Glob', pattern: 'x', tool_use_id: 'r3' }, 14_400)
    await call($, w, { tool: 'Read', file_path: '/b', tool_use_id: 'r4' }, 125_000)
    expect(await badge($, 'r1', 'Read')).toBe('◉ 12ms')
    expect(await badge($, 'r2', 'Grep')).toBe('⌕ 4.0s')
    expect(await badge($, 'r3', 'Glob')).toBe('⌕ 14s')
    expect(await badge($, 'r4', 'Read')).toBe('◉ 2m05s')
    const ui = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row('r2', 'Grep') })
    expect((await ui.find({ type: 'Text', text: /^4\.0s$/ }))?.props.color).toBe(KZ.amber)
    await ui.unmount()
    const quick = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', ...row('r1', 'Read') })
    expect((await quick.find({ type: 'Text', text: /^12ms$/ }))?.props.dimColor).toBe(true)
    await quick.unmount()
  })

  test('shells: exit 0, the exit code of a failure, or "failed" when it names none', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'PowerShell', command: 'ls', tool_use_id: 'p1' }, 3200)
    await call($, w, { tool: 'Bash', command: 'false', tool_use_id: 'b1' }, 50, { result: { stdout: '', stderr: '', interrupted: false }, isError: true, text: 'Exit status: 127' })
    await call($, w, { tool: 'Bash', command: 'x', tool_use_id: 'b2' }, 50, { result: { stdout: '', stderr: '', interrupted: false }, isError: true })
    await call($, w, { tool: 'Bash', command: 'y', tool_use_id: 'b3' }, 50, { result: { stdout: '', stderr: '', interrupted: false }, isError: true, text: 'segfault' })
    expect(await badge($, 'p1', 'PowerShell')).toBe('$ exit 0 · 3.2s')
    expect(await badge($, 'b1', 'Bash', { isErrored: true })).toBe('✖ exit 127 · 50ms')
    expect(await badge($, 'b2', 'Bash', { isErrored: true })).toBe('✖ failed · 50ms')
    expect(await badge($, 'b3', 'Bash')).toBe('✖ failed · 50ms')
  })

  test('interrupted, in the background, refused; a failed non-shell tool', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Bash', command: 'sleep 9', tool_use_id: 'i1' }, 900, { result: { stdout: '', stderr: '', interrupted: true } })
    await call($, w, { tool: 'Bash', command: 'npm run dev', tool_use_id: 'g1', run_in_background: true }, 20, { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg7' } })
    await call($, w, { tool: 'Bash', command: 'rm -rf /', tool_use_id: 'd1' }, 0, { deny: 'no' })
    await call($, w, { tool: 'WebFetch', url: 'https://x', prompt: 'p', tool_use_id: 'f1' }, 300, { result: 'nope', isError: true })
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'n1' }, 7, { result: undefined })
    expect(await badge($, 'i1', 'Bash')).toBe('⊘ 900ms')
    expect(await badge($, 'g1', 'Bash')).toBe('↗ bg · 20ms')
    expect(await badge($, 'd1', 'Bash')).toBe('✖ denied')
    expect(await badge($, 'f1', 'WebFetch')).toBe('✖ failed · 300ms')
    expect(await badge($, 'n1', 'Read')).toBe('◉ 7ms')
    // The row itself may say it was interrupted.
    expect(await badge($, 'n1', 'Read', { isInterrupted: true })).toBe('⊘ 7ms')
  })

  test('rows that stay the engine\'s: running, of another shape, another tool, unknown, or with no id', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'r1' }, 5)
    await call($, w, { tool: 'Read', file_path: '/b', tool_use_id: '' }, 5)
    expect(await badge($, 'r1', 'Read', { isRunning: true })).toBeUndefined()
    expect(await badge($, 'r1', 'Read', { isErrored: 'no' })).toBeUndefined()
    expect(await badge($, 'r1', 7 as never)).toBeUndefined()
    expect(await badge($, 'r1', 'Grep')).toBeUndefined()
    expect(await badge($, 'zz', 'Read')).toBeUndefined()
    // No id on the props: the instance's requestId names the call.
    const ui = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', component: 'ToolUse', requestId: 'r1', props: { ...ROW, tool: 'Read' } as never })
    expect(await ui.find({ type: 'Text', text: /^5ms$/ })).toBeDefined()
    await ui.unmount()
    const none = await $.ui.mount({ plugin: 'toolmarks', surface: 'terminal', component: 'ToolUse', requestId: '', props: { ...ROW, tool: 'Read' } as never })
    expect(await none.find({ type: 'Text', text: /ms/ })).toBeUndefined()
    expect(await none.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    await none.unmount()
  })
})

describe('badges on the desktop', () => {
  test('only slow or failed rows get the pill', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'fast' }, 30)
    await call($, w, { tool: 'Bash', command: 'make', tool_use_id: 'slow' }, 5000)
    await call($, w, { tool: 'Read', file_path: '/x', tool_use_id: 'bad' }, 30, { result: 'gone', isError: true })
    const pill = async (id: string, tool: string, extra: Record<string, unknown> = {}) => {
      const ui = await $.ui.mount({ plugin: 'toolmarks', surface: 'desktop', ...row(id, tool, extra) })
      const svg = await ui.find({ type: 'Svg' })
      expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
      await ui.unmount()
      return svg
    }
    expect(await pill('fast', 'Read')).toBeUndefined()
    const slow = await pill('slow', 'Bash')
    expect(slow?.props.alt).toBe('$ exit 0 · 5.0s')
    expect(String(slow?.props.source)).toMatch(new RegExp(`fill="${KZ.green}" opacity=".14"`))
    expect(String(slow?.props.source)).toMatch(/class="s"[^>]*>exit 0 · </)
    expect((await pill('bad', 'Read'))?.props.alt).toBe('✖ failed · 30ms')
    expect((await pill('fast', 'Read', { isErrored: true }))?.props.alt).toBe('✖ failed · 30ms')
  })
})

describe('folded groups', () => {
  const group = (calls: unknown, extra: Record<string, unknown> = {}) => ({
    plugin: 'toolmarks', component: 'ToolGroup' as const,
    props: { isActive: false, isExpanded: false, calls, ...extra } as never,
  })
  const call0 = (id: string | undefined, isErrored = false) => ({ ...(id === undefined ? {} : { tool_use_id: id }), tool: 'Read', input: {}, isRunning: false, isErrored, isInterrupted: false })

  test('the total of the known calls and the count of failures', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'a' }, 400)
    await call($, w, { tool: 'Read', file_path: '/b', tool_use_id: 'b' }, 700)
    const both = await $.ui.mount({ ...group([call0('a'), call0('b', true), call0(undefined), call0(''), call0('ghost')]), surface: 'terminal' })
    expect(await both.find({ type: 'Text', text: 'Σ 1.1s' })).toBeDefined()
    expect(await both.find({ type: 'Text', text: ' ✖ 1 failed' })).toBeDefined()
    await both.unmount()
    const known = await $.ui.mount({ ...group([call0('a')]), surface: 'terminal' })
    expect(await known.find({ type: 'Text', text: 'Σ 400ms' })).toBeDefined()
    expect(await known.find({ type: 'Text', text: /failed/ })).toBeUndefined()
    await known.unmount()
    const failed = await $.ui.mount({ ...group([call0('ghost', true)]), surface: 'terminal' })
    expect(await failed.find({ type: 'Text', text: '✖ 1 failed' })).toBeDefined()
    expect(await failed.find({ type: 'Text', text: /Σ/ })).toBeUndefined()
    await failed.unmount()
  })

  test('groups left to the engine: nothing known, open, active, odd shapes, the desktop, or marks off', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'a' }, 400)
    const plain = async (g: ReturnType<typeof group>, surface: 'terminal' | 'desktop' = 'terminal') => {
      const ui = await $.ui.mount({ ...g, surface })
      const own = await ui.find({ type: 'Text', text: /Σ|failed/ })
      await ui.unmount()
      return own
    }
    expect(await plain(group([call0('ghost')]))).toBeUndefined()
    expect(await plain(group([call0('a')], { isExpanded: true }))).toBeUndefined()
    expect(await plain(group([call0('a')], { isActive: true }))).toBeUndefined()
    expect(await plain(group('a'))).toBeUndefined()
    expect(await plain(group([call0('a')]), 'desktop')).toBeUndefined()
    await toolmarks($, 'off')
    expect(await plain(group([call0('a')]))).toBeUndefined()
  })
})

describe('/toolmarks and the store', () => {
  test('on, off and a bare toggle, remembered in the store', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'a' }, 5)
    expect(await toolmarks($, 'OFF')).toBe('Toolmarks off.')
    expect(await badge($, 'a', 'Read')).toBeUndefined()
    expect(await toolmarks($, '')).toBe('Toolmarks on: finished tool rows carry their duration and status.')
    expect(await badge($, 'a', 'Read')).toBe('◉ 5ms')
    expect(await toolmarks($, '')).toBe('Toolmarks off.')
    expect(await toolmarks($, 'on')).toMatch(/^Toolmarks on/)
  })

  test('a stored "off" starts off', async ($, on) => {
    const w = world(on, { store: { isOn: false } })
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'a' }, 5)
    expect(await badge($, 'a', 'Read')).toBeUndefined()
  })

  test('with no store, marks start on', async ($, on) => {
    const w = world(on, { store: false })
    await $.session.start(START)
    await call($, w, { tool: 'Read', file_path: '/a', tool_use_id: 'a' }, 5)
    expect(await badge($, 'a', 'Read')).toBe('◉ 5ms')
  })

  test('a call that fails beneath still fails', async ($, on) => {
    world(on, { tools: false })
    await $.session.start(START)
    await expect($.tool.call({ tool: 'Read', file_path: '/a', tool_use_id: 'a' } as never)).rejects.toThrow()
  })
})
