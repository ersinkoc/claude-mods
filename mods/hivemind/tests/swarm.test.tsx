import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PROPS = { title: 'KOZMOS · Hivemind', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const USAGE = { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, model: 'claude-haiku-5' }
const SPAWN = { prompt: 'p', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }

type Agent = { id: string; description: string; type: string; status: AgentStatus; parentId?: string }
type World = {
  roster: Agent[]
  lists: number
  listFails: boolean
  /** What the engine answers each spawn, by tool_use_id. */
  spawn: Record<string, { agentId?: string; deny?: string }>
  usage: typeof USAGE | null
  isOpen: boolean
  /** True: hivemind's snapshot writes are refused. */
  stateFails: boolean
  clock: MockClock
}

/** The engine beneath hivemind: a roster, spawns, steps, tools, panes. */
function world(on: On, opts: { modelFails?: boolean } = {}): World {
  const w: World = { roster: [], lists: 0, listFails: false, spawn: {}, usage: USAGE, isOpen: false, stateFails: false, clock: mock.clock(on, { now: 1_000_000 }) }
  on('state.set', ($, e, next) => (w.stateFails && e.key === 'snap' ? { deny: 'state down' } : next(e)))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.model', () => {
    if (opts.modelFails) throw new Error('no model')
    return { value: 'claude-opus-5-5' }
  })
  on('agent.list', () => {
    w.lists++
    if (w.listFails) throw new Error('list down')
    return { value: w.roster.map(a => ({ ...a })) }
  })
  on('ui.open', () => {
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'kz-hivemind', title: 'KOZMOS · Hivemind', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.spawn', ($, e) => {
    const r = w.spawn[e.tool_use_id] ?? {}
    return r.deny !== undefined ? { deny: r.deny } : { model: 'claude-haiku-5', agentId: r.agentId }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: w.usage }
  })
  on('tool.call', async ($, e) => {
    const ms = Number((e as { timeout?: number }).timeout ?? 0)
    if (ms) await w.clock.sleep(ms)
    if (e.tool === 'Grep') return { isError: true as const, result: undefined, text: 'bad pattern' }
    return { result: { ok: true } }
  })
  return w
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const spawn = ($: Engine, w: World, id: string, description: string, extra: Partial<typeof SPAWN> & { parentAgentId?: string } = {}) => {
  w.spawn[`tu-${id}`] = { agentId: id }
  return $.agent.spawn({ ...SPAWN, ...extra, tool_use_id: `tu-${id}`, description })
}
const step = async ($: Engine, agentId: string | undefined, model = 'claude-haiku-5', effort?: string) => {
  const s = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}), ...(effort ? { effort: effort as 'low' } : {}) })
  for await (const _c of s) { /* drain */ }
}
const done = ($: Engine, agentId: string | undefined, reason: 'answer' | 'error' = 'answer') =>
  $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason, ...(agentId ? { agentId } : {}) })
const pane = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 52) =>
  $.ui.mount({ plugin: 'hivemind', surface, component: 'Pane', requestId: 'kz-hivemind', props: { ...PROPS, bodyColumns } })
const lines = async ($: Engine, bodyColumns = 52) => {
  const ui = await pane($, 'terminal', bodyColumns)
  const tree = await ui.drawn()
  const texts: string[] = []
  const walk = (el: unknown) => {
    const e = el as { type?: string; props?: { children?: unknown }; children?: unknown[] }
    if (e && e.type === 'Text') {
      texts.push(textOf(e))
      return
    }
    for (const c of e?.children ?? []) walk(c)
  }
  walk(tree)
  await ui.unmount()
  return texts
}
function textOf(el: unknown): string {
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  const e = el as { children?: unknown[] }
  return (e?.children ?? []).map(textOf).join('')
}
const desk = async ($: Engine, bodyColumns = 52) => {
  const ui = await pane($, 'desktop', bodyColumns)
  const svgs = await ui.findAll({ type: 'Svg' })
  const button = await ui.find({ type: 'Button' })
  await ui.unmount()
  return { head: String(svgs[0]?.props.source), headAlt: String(svgs[0]?.props.alt), tree: String(svgs[1]?.props.source), treeAlt: String(svgs[1]?.props.alt), button }
}

describe('the roster', () => {
  test('the engine list maps every status, sets parents, and leaves ended loops ended', async ($, on) => {
    const w = world(on)
    w.roster = [
      { id: 'p1', description: 'Pending one', type: 'Explore', status: 'pending' },
      { id: 'i1', description: 'Idle one', type: 'Plan', status: 'idle', parentId: 'p1' },
      { id: 'w1', description: 'Waiting one', type: 'Plan', status: 'waiting' },
      { id: 'c1', description: 'Done one', type: 'Explore', status: 'completed' },
      { id: 'f1', description: 'Failed one', type: 'Explore', status: 'failed' },
      { id: 'k1', description: 'Killed one', type: 'Explore', status: 'killed' },
    ]
    await start($)
    expect((await desk($)).treeAlt).toBe('main waiting; Explore running: Pending one; Plan waiting: Idle one; Plan waiting: Waiting one; Explore done: Done one; Explore failed: Failed one; Explore failed: Killed one')
    // Our own end of a loop wins over a list that still says running.
    w.roster[0] = { ...w.roster[0]!, status: 'running' }
    await done($, 'p1')
    // A loop the list calls completed after we saw it fail turns done.
    w.roster[2] = { ...w.roster[2]!, status: 'completed' }
    await done($, 'w1', 'error')
    await w.clock.settle()
    expect((await desk($)).treeAlt).toContain('Explore done: Pending one; Plan waiting: Idle one; Plan done: Waiting one')
  })

  test('a list that fails changes nothing; a model that fails leaves main without one', async ($, on) => {
    const w = world(on, { modelFails: true })
    w.listFails = true
    await start($)
    expect(await lines($)).toContain('  —')
    expect(w.lists).toBe(1)
  })

  test('the ticker runs while anything runs: history, a sparkline, the roster every third second; then stops', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.lists).toBe(1)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, w, 'a1', 'Find the tests')
    await w.clock.advance(3000)
    expect(w.lists).toBe(2)
    const t = await lines($)
    expect(t.some(l => /^\s*▁*█+$/.test(l))).toBe(true)
    const d = await desk($)
    expect(d.head).toContain('<path d="M120.0,')
    // Everything ends: the ticker stops.
    await done($, 'a1')
    await done($, undefined)
    await w.clock.settle()
    const before = w.lists
    await w.clock.advance(6000)
    expect(w.lists).toBe(before)
  })
})

describe('spawns, steps and turns', () => {
  test('a denied spawn or one with no agent adds nothing', async ($, on) => {
    const w = world(on)
    await start($)
    w.spawn['tu-x'] = { deny: 'no' }
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu-x', description: 'Denied' }).catch(() => undefined)
    w.spawn['tu-y'] = {}
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu-y', description: 'Remote' })
    expect(await lines($)).toContain('  no subagents yet: the swarm grows here as the Agent tool spawns them')
  })

  test('a background spawn under a parent; a model seen first is kept', async ($, on) => {
    const w = world(on)
    await start($)
    await spawn($, w, 'a1', 'Parent task')
    await step($, 'a2', 'claude-sonnet-5', 'high')
    await spawn($, w, 'a2', 'Child task', { background: true, parentAgentId: 'a1', subagentType: 'Plan' })
    const t = await lines($)
    expect(t).toContain('└─ ◐ Explore Parent task')
    expect(t).toContain('   └─ ◐ Plan Child task ⇢bg')
    expect(t).toContain('        Sonnet 5 · high · 1 req · 34k tok · <$0.01 ░░░ 3%')
    const d = await desk($, 140)
    expect(d.tree).toContain('· background')
  })

  test('a teammate that ended wakes on its next step; a waiting one runs again', async ($, on) => {
    const w = world(on)
    w.roster = [{ id: 'tm', description: 'Teammate', type: 'Plan', status: 'idle' }]
    await start($)
    expect((await desk($)).treeAlt).toContain('Plan waiting: Teammate')
    await step($, 'tm')
    expect((await desk($)).treeAlt).toContain('Plan running: Teammate')
    w.roster = [{ id: 'tm', description: 'Teammate', type: 'Plan', status: 'completed' }]
    await done($, 'tm')
    // A spawn for an ended loop keeps it ended.
    await spawn($, w, 'tm', 'Teammate', { subagentType: 'Plan' })
    expect((await desk($)).treeAlt).toContain('Plan done: Teammate')
    await w.clock.advance(5000)
    await step($, 'tm')
    expect((await desk($)).treeAlt).toContain('Plan running: Teammate')
  })

  test('a step with no usage counts nothing; an empty model keeps the last; usage without a model prices by the step', async ($, on) => {
    const w = world(on)
    await start($)
    await spawn($, w, 'a1', 'Task')
    w.usage = null
    await step($, 'a1', '')
    await step($, 'a1')
    expect(await lines($)).toContain('     Haiku 5')
    w.usage = { ...USAGE, model: '' }
    await step($, 'a1', 'claude-opus-5-5')
    expect((await lines($)).some(l => l.includes('Opus 5.5 · 1 req'))).toBe(true)
    // The main loop's steps are its own.
    w.usage = null
    await step($, undefined, 'claude-sonnet-5')
    expect(await lines($)).toContain('  Sonnet 5')
  })
})

describe('tools', () => {
  test('parallel calls: the newest shows while running, the last one stays after; errors are red', async ($, on) => {
    const w = world(on)
    await start($)
    await spawn($, w, 'a1', 'Task')
    const slow = $.tool.call({ tool: 'Bash', command: 'sleep 5', description: 'Slow one', timeout: 5000, agentId: 'a1' } as never)
    const fast = $.tool.call({ tool: 'Bash', command: 'sleep 1', description: 'Fast one', timeout: 1000, agentId: 'a1' } as never)
    await w.clock.settle()
    expect((await lines($)).some(l => l.includes('Bash Fast one · 0:00'))).toBe(true)
    await w.clock.advance(1000)
    await fast
    // The fast one ended, but the slow one is not the node's current tool any more.
    expect((await lines($)).some(l => l.includes('Bash Fast one · 1000ms'))).toBe(true)
    await w.clock.advance(4000)
    await slow
    expect((await lines($)).some(l => l.includes('Bash Slow one · 5000ms'))).toBe(true)
    await $.tool.call({ tool: 'Grep', pattern: 'x(', agentId: 'a1' } as never)
    const d = await desk($)
    expect(d.tree).toContain('#f87171')
    expect(d.tree).toContain('0ms')
  })

  test('a running tool on the desktop pulses with its clock', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const call = $.tool.call({ tool: 'Read', file_path: '/work/a.ts', timeout: 3000 } as never)
    await w.clock.advance(2000)
    const d = await desk($)
    expect(d.tree).toContain('class="pulse"')
    expect(d.tree).toContain('0:02')
    await w.clock.advance(1000)
    await call
  })

  test('a call nothing answers beneath fails through the catch unchanged; so does a spawn', async ($, on) => {
    mock.clock(on, { now: 1 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('agent.list', () => ({ value: [] }))
    await start($)
    await expect($.tool.call({ tool: 'Read', file_path: '/a' })).rejects.toThrow(/no implementation for tool.call/)
    await expect($.agent.spawn({ ...SPAWN, tool_use_id: 't', description: 'd' })).rejects.toThrow(/no implementation for agent.spawn/)
  })
})

describe('failures', () => {
  test('a refused snapshot never escapes the ticker or the end of a subagent', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await spawn($, w, 'a1', 'Task')
    w.stateFails = true
    await w.clock.advance(3000)
    expect(w.lists).toBe(2)
    // The roster read at the subagent's end moves it under a parent: a new picture to write.
    w.roster = [{ id: 'a1', description: 'Task', type: 'Explore', status: 'completed', parentId: 'gone' }]
    expect((await done($, 'a1')).text).toBe('x')
    await w.clock.settle()
    expect(w.lists).toBe(3)
    // Writes back: the picture catches up on the next tick.
    w.stateFails = false
    await w.clock.advance(1000)
    expect((await desk($)).treeAlt).toBe('main running; Explore done: Task')
  })
})

describe('the pane', () => {
  test('/hivemind opens and closes it; autoOpen is off by default', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.isOpen).toBe(false)
    expect((await $.command.run({ command: 'hivemind', args: '', ...RUN })).text).toBe('Hivemind open.')
    expect((await $.command.run({ command: 'hivemind', args: '', ...RUN })).text).toBe('Hivemind closed.')
  })

  test('autoOpen opens it at start', { options: { autoOpen: true } }, async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.settle()
    expect(w.isOpen).toBe(true)
  })

  test('drawn before any session: an empty tree', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const ui = await pane($, 'terminal', 0)
    expect(await ui.find({ type: 'Text', text: /no subagents yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('terminal: the tree with its branches, statuses and the fold of finished loops', async ($, on) => {
    const w = world(on)
    w.roster = [
      { id: 'd1', description: 'Done parent', type: 'Explore', status: 'completed' },
      { id: 'r1', description: 'Running child', type: '', status: 'running', parentId: 'd1' },
      { id: 'd2', description: 'Done child', type: 'Plan', status: 'completed', parentId: 'd1' },
      { id: 'f1', description: 'Failed one', type: 'Explore', status: 'failed' },
      { id: 'i1', description: '', type: 'Plan', status: 'idle' },
    ]
    await start($)
    const t = await lines($, 0)
    expect(t.slice(0, 2)).toEqual(['◐ 1 running  ✓ 2 done  ✖ 1 failed', 'Σ agents $0.00 · 0 tok · 0 req'])
    // 44 columns when the pane has not measured.
    expect(t[2]).toBe('─'.repeat(43))
    expect(t.slice(6)).toEqual([
      '├─ ✓ Explore Done parent', ' 0:00', '│    —',
      '│  ├─ ◐ agent Running child', ' 0:00', '│  │    —',
      '│  └─ ✓ Plan Done child', ' 0:00', '│       —',
      '├─ ✖ Explore Failed one', ' 0:00', '│    —',
      '└─ ⏸ Plan', ' 0:00', '     —',
    ])
    const ui = await pane($, 'terminal')
    expect((await ui.find({ key: 'hm-done' }))?.props.label).toBe('▾ hide finished (3)')
    await ui.press({ key: 'hm-done' })
    expect((await ui.find({ key: 'hm-done' }))?.props.label).toBe('▸ show finished (2)')
    // The done parent stays for its running child; its done child and the failed one fold away.
    expect(await ui.find({ type: 'Text', text: /Done parent/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Done child/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Failed one/ })).toBeUndefined()
    await ui.unmount()
  })

  test('an agent listed under the root\'s own id is not walked into', async ($, on) => {
    const w = world(on)
    w.roster = [{ id: 'main', description: 'Impostor', type: 'Explore', status: 'running' }]
    await start($)
    expect((await desk($)).treeAlt).toBe('main waiting')
  })

  test('desktop: tiles two to a row when narrow, every status mark, a running branch flows', async ($, on) => {
    const w = world(on)
    w.roster = [
      { id: 'r1', description: 'Running', type: 'Explore', status: 'running' },
      { id: 'r2', description: 'Nested', type: 'Explore', status: 'running', parentId: 'r1' },
      { id: 'd1', description: 'Done', type: 'Explore', status: 'completed' },
      { id: 'f1', description: 'Failed', type: 'Explore', status: 'failed' },
      { id: 'i1', description: 'Idle', type: '', status: 'idle' },
    ]
    await start($)
    await step($, 'r1')
    const wide = await desk($)
    expect(wide.headAlt).toBe('2 agents running, 1 done, 1 failed; agents spent about <$0.01 over 34k tokens')
    expect(wide.head).toContain('class="pulse"')
    expect(wide.tree).toContain('class="ln flow"')
    expect(wide.tree).toContain('l2 2.2 4-4.4')
    expect(wide.tree).toContain('l5 5M')
    expect(wide.tree).toContain('v5M')
    expect(wide.tree).toContain('>agent<')
    expect(wide.tree).toMatch(/>\d+%</)
    expect(wide.button).toBeDefined()
    const narrow = await desk($, 20)
    // Four tiles in two rows of two: the strip starts below the second row.
    expect(narrow.head).toContain('y="124"')
  })
})
