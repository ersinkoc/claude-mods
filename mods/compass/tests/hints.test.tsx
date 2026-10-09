import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const T0 = Date.parse('2026-10-09T10:00:00Z')
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const PORCELAIN_ONE = ['# branch.head main', '1 .M N... 100644 100644 100644 a a src/a.ts'].join('\n')

type World = {
  five?: { percentUsed: number; resetsAt?: string }
  ctx: number
  agents: ('running' | 'pending' | 'completed')[]
  git: 'ok' | 'fail' | 'throw'
  porcelain: string
  cwd: string
  usageThrows: boolean
  agentsThrow: boolean
  storeThrows: boolean
  runs: { argv: readonly string[]; cwd?: string }[]
  seen: RenderPropsOf['PromptHint'][]
}

/** Answers every noun compass calls, from a world the test changes as it goes. */
function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { ctx: 10, agents: [], git: 'ok', porcelain: PORCELAIN_ONE, cwd: '/work', usageThrows: false, agentsThrow: false, storeThrows: false, runs: [], seen: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: w.cwd }))
  const kept = new Map(Object.entries(store))
  on('store.get', (_$, e) => {
    if (w.storeThrows) throw new Error('store down')
    return { value: kept.get(e.key) }
  })
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => {
    if (w.usageThrows) throw new Error('usage down')
    return {
      value: {
        startedAt: T0,
        context: { tokens: w.ctx * 10_000, window: 1_000_000, percent: w.ctx },
        rateLimits: w.five ? [{ kind: 'seven_day' as const, percentUsed: 5 }, { kind: 'five_hour' as const, ...w.five }] : [],
      },
    }
  })
  on('agent.list', () => {
    if (w.agentsThrow) throw new Error('agents down')
    return { value: w.agents.map((status, i) => ({ id: `a${i}`, description: 'task', type: 'Explore', status })) }
  })
  on('process.run', ($, e) => {
    w.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    if (w.git === 'throw') throw new Error('no git')
    return { value: { exitCode: w.git === 'ok' ? 0 : 128, stdout: w.git === 'ok' ? w.porcelain : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    w.seen.push(e.props)
    const { Text } = $.ui.resolve(e)
    return <Text key="hint">{e.props.hint}{e.props.tail ? ` ${e.props.tail}` : ''}</Text>
  })
  return w
}

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

async function show($: Engine, w: World, surface: 'terminal' | 'desktop', props: Partial<RenderPropsOf['PromptHint']> = {}) {
  const ui = await $.ui.mount({ plugin: 'compass', surface, component: 'PromptHint', props: { ...HINT, ...props } })
  const p = w.seen[w.seen.length - 1]
  await ui.unmount()
  if (!p) throw new Error('PromptHint was not drawn')
  return p
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const run = ($: Engine, args: string) => $.command.run({ command: 'compass', args, ...RUN })

describe('hints', () => {
  test('the five-hour hint without a reset time, and the engine line when nothing applies', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.five = { percentUsed: 95.4 }
    await start($)
    expect((await show($, w, 'terminal')).tail).toBe('· 5h 95% used')
    // A tail the engine already carries is kept, the hint after it.
    expect((await show($, w, 'terminal', { tail: 'pill' })).tail).toBe('pill · 5h 95% used')
    // An empty engine line is replaced by the hint alone on the desktop.
    expect((await show($, w, 'desktop', { hint: '' })).hint).toBe('5h 95% used')
  })

  test('nothing to flag leaves the line to the engine', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.five = { percentUsed: 20, resetsAt: '2026-10-09T12:00:00Z' }
    await start($)
    const p = await show($, w, 'terminal')
    expect(p.tail).toBeUndefined()
    expect(p.hint).toBe('? for shortcuts')
    const { text } = await run($, 'on')
    expect(text).toBe('Compass on. Nothing to flag right now.')
  })

  test('one agent, pending ones counted, singular wording', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.agents = ['pending', 'completed']
    await start($)
    expect((await show($, w, 'terminal')).tail).toBe('· ◈ 1 agent working')
    w.agents = ['running', 'pending', 'completed']
    await clock.advance(2000)
    expect((await show($, w, 'desktop')).hint).toBe('◈ 2 agents working · ? for shortcuts')
  })

  test('a failing usage or agent read keeps the last reading', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.ctx = 88.6
    w.agents = ['running']
    await start($)
    expect((await show($, w, 'terminal')).tail).toBe('· ctx 89% — /compact soon')
    w.usageThrows = true
    w.agentsThrow = true
    w.ctx = 10
    await clock.advance(2000)
    expect((await show($, w, 'terminal')).tail).toBe('· ctx 89% — /compact soon')
    w.usageThrows = false
    await clock.advance(2000)
    expect((await show($, w, 'terminal')).tail).toBe('· ◈ 1 agent working')
  })

  test('one changed file after an edit, hidden while working; git polled every fifth tick', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.cwd = ''
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    // No edit yet: no git process at all.
    await clock.advance(4000)
    expect(w.runs).toHaveLength(0)
    await $.tool.call({ tool: 'Write', file_path: '/work/a.ts', content: 'x' })
    await clock.advance(2000)
    expect(w.runs).toHaveLength(1)
    // An empty cwd runs git without one.
    expect(w.runs[0]?.cwd).toBeUndefined()
    expect((await show($, w, 'terminal')).tail).toBe('· ✎ 1 file changed — commit?')
    expect((await show($, w, 'terminal', { isWorking: true })).tail).toBeUndefined()
    // A second edit does not reset the tick: the next probe is five ticks on.
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'x', new_string: 'y' })
    await clock.advance(8000)
    expect(w.runs).toHaveLength(1)
    await clock.advance(2000)
    expect(w.runs).toHaveLength(2)
  })

  test('git failing or throwing clears the commit hint', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/a.ipynb', new_source: 'x' })
    await clock.advance(2000)
    expect(w.runs[0]?.cwd).toBe('/work')
    expect((await show($, w, 'terminal')).tail).toBe('· ✎ 1 file changed — commit?')
    w.git = 'fail'
    await clock.advance(10_000)
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
    w.git = 'ok'
    await clock.advance(10_000)
    expect((await show($, w, 'terminal')).tail).toBe('· ✎ 1 file changed — commit?')
    w.git = 'throw'
    await clock.advance(10_000)
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
  })

  test('denied, errored and non-edit tool calls do not count as edits', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    on('tool.call', ($, e) => {
      if (e.tool === 'Write') return { result: 'nope', isError: true, tool_use_id: e.tool_use_id ?? 'x' }
      if (e.tool === 'Edit') return { deny: 'no', tool_use_id: e.tool_use_id ?? 'x' }
      return { result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }
    })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/work/a.ts', content: 'x' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.advance(12_000)
    expect(w.runs).toHaveLength(0)
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
  })

  // A managed plugin beneath compass whose Agent tool runs an Edit of its own:
  // the inner call re-enters compass's hook, whose catch passes it through.
  const nested = {
    name: 'nested',
    tier: 'append' as const,
    register(on: On) {
      on('tool.call', async ($, e, next) => {
        if (e.tool === 'Agent') await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'x', new_string: 'y' })
        return next(e)
      })
    },
  }
  test('a tool call raised beneath its own hook passes through the catch, uncounted', { plugins: [nested] }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    const tools: string[] = []
    on('tool.call', ($, e) => {
      tools.push(String(e.tool))
      return { result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }
    })
    await start($)
    const r = await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p' })
    expect(r.result).toEqual({ ok: true })
    expect(tools).toEqual(['Edit', 'Agent'])
    await clock.advance(12_000)
    expect(w.runs).toHaveLength(2)
  })
})

describe('draft and turns', () => {
  test('a draft left idle three minutes after a turn is flagged; a turn resets it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: 'done' }))
    await start($)
    await clock.advance(2 * 60_000)
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBeUndefined()
    await clock.advance(60_000)
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBe('· ⏎ draft waiting 3m — enter sends it')
    // Not a draft, or working: nothing.
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
    expect((await show($, w, 'terminal', { isDraft: true, isWorking: true })).tail).toBeUndefined()
    // A subagent's turn ending does not count as activity.
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1', reason: 'answer' })
    await clock.settle()
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBe('· ⏎ draft waiting 3m — enter sends it')
    // The main loop's turn ending does.
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBeUndefined()
    await clock.advance(4 * 60_000)
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBe('· ⏎ draft waiting 4m — enter sends it')
    await $.turn.start({ text: 'go', turnId: 't2' })
    await clock.settle()
    expect((await show($, w, 'terminal', { isDraft: true })).tail).toBeUndefined()
  })

  test('a turn nothing answers beneath fails through the catch unchanged', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    await expect($.turn.start({ text: 'go', turnId: 't1' })).rejects.toThrow(/no implementation for turn.start/)
    await expect($.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).rejects.toThrow(/no implementation for turn.complete/)
  })
})

describe('/compass', () => {
  test('toggles with no argument, persists, and reports the hint now', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on, { isOn: false })
    w.ctx = 90
    await start($)
    // Stored off: the line is the engine's.
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
    expect((await run($, '')).text).toBe('Compass on. Now: ctx 90% — /compact soon')
    expect((await show($, w, 'terminal')).tail).toBe('· ctx 90% — /compact soon')
    expect((await run($, '  ')).text).toBe('Compass off: the hint line is the engine’s.')
    expect((await run($, ' ON ')).text).toContain('Compass on.')
    expect((await run($, 'off')).text).toContain('off')
  })

  test('a store that cannot be read leaves compass on', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on, { isOn: false })
    w.storeThrows = true
    w.ctx = 81
    await start($)
    expect((await show($, w, 'terminal')).tail).toBe('· ctx 81% — /compact soon')
  })
})

describe('failures', () => {
  test('a tool call nothing answers beneath fails through the catch unchanged', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    await expect($.tool.call({ tool: 'Read', file_path: '/work/a.ts' })).rejects.toThrow(/no implementation for tool.call/)
  })

  test('a failing clock never escapes the start, the timer or the turn hooks, and compass recovers', async ($, on) => {
    // A hand-run clock: `now` fails from its second read on until healed; each
    // period of `every` waits for the test to tick it.
    let reads = 0
    let isBroken = true
    const ticks: (() => void)[] = []
    on('clock.now', () => {
      if (++reads > 1 && isBroken) throw new Error('clock down')
      return { value: T0 }
    })
    on('clock.every', () => new Promise<{ value: undefined }>(resolve => ticks.push(() => resolve({ value: undefined }))))
    const tick = async () => {
      const due = ticks.splice(0)
      for (const f of due) f()
      await new Promise<void>(r => (globalThis as unknown as { setTimeout(f: () => void, ms: number): void }).setTimeout(r, 20))
    }
    const w = world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: 'done' }))
    w.ctx = 92
    await start($)
    // The start's own sample failed to publish: nothing yet.
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
    await tick()
    expect((await show($, w, 'terminal')).tail).toBeUndefined()
    expect((await $.turn.start({ text: 'go', turnId: 't1' })).turnId).toBe('t1')
    expect((await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).text).toBe('done')
    isBroken = false
    await tick()
    expect((await show($, w, 'terminal')).tail).toBe('· ctx 92% — /compact soon')
  })
})
