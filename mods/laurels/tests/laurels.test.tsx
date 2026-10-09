import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { BADGES } from '../hooks/badges.ts'

// Friday 9 October 2026, 14:00 local: no time-of-day or weekend badge.
const T0 = new Date(2026, 9, 9, 14, 0).getTime()
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 110 } }
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const PANE_PROPS = { title: 'KOZMOS · Laurels', isFocused: false, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0, model: 'claude-haiku-5' }

type World = {
  clock: MockClock
  toasts: string[]
  kept: Map<string, unknown>
  storeFails: boolean
  /** Keys of laurels' state whose writes are refused. */
  denied: Set<string>
  usage: { startedAt: number; percent?: number; cost?: number } | 'fail'
  agents: AgentStatus[] | 'fail'
  /** Commands (or tools) that fail when run. */
  failing: Set<string>
  isOpen: boolean
}

/** The engine beneath laurels. */
function world(on: On, stored: Record<string, unknown> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }), toasts: [], kept: new Map(Object.entries(stored)), storeFails: false, denied: new Set(),
    usage: { startedAt: T0, percent: 10, cost: 0.5 }, agents: [], failing: new Set(), isOpen: false,
  }
  on('store.get', ($, e) => {
    if (w.storeFails) throw new Error('store down')
    return { value: w.kept.get(e.key) }
  })
  on('store.set', ($, e) => {
    if (w.storeFails) throw new Error('store down')
    w.kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('state.set', ($, e, next) => (w.denied.has(e.key) ? { deny: 'state down' } : next(e)))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    const u = w.usage
    if (u === 'fail') throw new Error('usage down')
    return { value: { startedAt: u.startedAt, context: { tokens: 1, window: 1_000_000, percent: u.percent }, rateLimits: [], ...(u.cost !== undefined ? { cost: { usd: u.cost } } : {}) } } as never
  })
  on('agent.list', () => {
    const a = w.agents
    if (a === 'fail') throw new Error('list down')
    return { value: a.map((status, i) => ({ id: `a${i}`, description: 'd', type: 'Explore', status })) }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: e.messageCount === 0 ? null : e.messageCount === 2 ? { ...USAGE, model: '' } : USAGE }
  })
  on('tool.call', ($, e) => {
    const key = String((e as { command?: string }).command ?? e.tool)
    if (w.failing.has(key) || w.failing.has(String(e.tool))) return { isError: true as const, result: 'failed' }
    return { result: 'ok' }
  })
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5', agentId: e.description === 'none' ? undefined : `ag-${e.tool_use_id}` }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'kz-laurels', title: 'KOZMOS · Laurels', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', () => {
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    w.isOpen = false
    return { value: undefined }
  })
  return w
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
const laurels = async ($: Engine, args: string) => (await $.command.run({ command: 'laurels', args, ...RUN })).text
const tool = (name: string, input: Record<string, unknown> = {}) => ({ tool: name, ...input }) as never
const unlockedNames = (w: World) => w.toasts.filter(t => t.startsWith('🏆 ')).map(t => t.slice('🏆 '.length, t.indexOf(' unlocked')))
const turn = async ($: Engine, w: World, ms: number, reason: 'answer' | 'aborted' = 'answer', id = 't1') => {
  await $.turn.start({ text: 'go', turnId: id })
  await w.clock.advance(ms)
  await $.turn.complete({ answer: 'ok', durationMs: ms, isAborted: reason === 'aborted', turnId: id, reason })
}
/** The terminal gallery's lines, by badge name. */
const gallery = async ($: Engine, bodyColumns = 60) => {
  const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'Pane', requestId: 'kz-laurels', props: { ...PANE_PROPS, bodyColumns } })
  // A badge's line is the Text that truncates; its parts are Texts inside it.
  const texts = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate-end').map(t => t.text)
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return { texts, all, line: (name: string) => texts.find(t => t.startsWith(`${name} `)) }
}

describe('the store', () => {
  test('earned badges and the lifetime come back; unknown or broken entries are dropped', async ($, on) => {
    const w = world(on, {
      unlocked: { 'first-light': T0 - 86_400_000, nope: 5, hydra: 'yesterday' },
      life: { turns: 3, tools: 40, tasksDone: 2, days: ['2026-10-08'] },
      hidden: true,
    })
    await start($)
    expect(await laurels($, '')).toBe(`Laurels: 1/${BADGES.length} unlocked.`)
    const g = await gallery($)
    expect(g.line('Regular')).toContain('3/100')
    expect(g.line('Taskmaster')).toContain('2/10')
    expect(g.line('Devotee')).toContain('1/7')
    expect(w.toasts).toEqual([])
  })

  test('a store that is not an object is ignored', async ($, on) => {
    world(on, { unlocked: 'all of them', life: 7 })
    await start($)
    expect(await laurels($, '')).toBe(`Laurels: 0/${BADGES.length} unlocked.`)
  })

  test('a store that fails starts fresh and keeps the session going', async ($, on) => {
    const w = world(on, { unlocked: { 'first-light': 1 } })
    w.storeFails = true
    await start($)
    await turn($, w, 30_000)
    expect(unlockedNames(w)).toEqual(['First Light'])
    expect(await laurels($, '')).toBe(`Laurels: 1/${BADGES.length} unlocked.`)
  })
})

describe('the command', () => {
  test('hide, show, and the gallery toggle', async ($, on) => {
    const w = world(on)
    await start($)
    expect(await laurels($, ' HIDE ')).toBe('Laurels celebrations hidden (toasts still show).')
    expect(w.kept.get('hidden')).toBe(true)
    expect(await laurels($, 'show')).toBe('Laurels celebrations shown.')
    expect(w.kept.get('hidden')).toBe(false)
    expect(await laurels($, '')).toBe(`Laurels: 0/${BADGES.length} unlocked.`)
    expect(w.isOpen).toBe(true)
    expect(await laurels($, '')).toBe('Laurels closed.')
    expect(w.isOpen).toBe(false)
  })

  test('hidden with a store that fails is hidden for the session', async ($, on) => {
    const w = world(on)
    await start($)
    w.storeFails = true
    expect(await laurels($, 'hide')).toBe('Laurels celebrations hidden (toasts still show).')
    w.storeFails = false
    await turn($, w, 30_000)
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('readings', () => {
  test('the poll reads cost, session length and running agents', async ($, on) => {
    const w = world(on)
    w.usage = { startedAt: T0 - 2 * 3600_000, percent: 10, cost: 11 }
    w.agents = ['running', 'pending', 'waiting', 'running', 'running', 'completed']
    await start($)
    await w.clock.advance(5000)
    expect(unlockedNames(w)).toEqual(['Hydra', 'Marathon', 'Big Spender'])
  })

  test('a poll without cost, percent or start time, or one that fails, keeps the last figures', async ($, on) => {
    const w = world(on)
    w.usage = { startedAt: 0 }
    w.agents = 'fail'
    await start($)
    await w.clock.advance(5000)
    w.usage = 'fail'
    await w.clock.advance(5000)
    const g = await gallery($)
    expect(g.line('Big Spender')).toContain('$0.00/$10')
    expect(g.line('Marathon')).toContain('0h00/2h')
    expect(g.line('Hydra')).toContain('0/5')
    expect(w.toasts).toEqual([])
  })

  test('measures: cost moves the spender, context over 90% makes a surfer at the next turn', async ($, on) => {
    const w = world(on)
    w.usage = { startedAt: T0, percent: undefined, cost: undefined }
    await start($)
    await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 95 }, rateLimits: [], cost: { usd: 12 }, changed: ['cost', 'context'] } as never)
    expect(unlockedNames(w)).toEqual(['Big Spender'])
    // A measure without cost or percent, about the rate limits, changes nothing.
    await $.session.measure({ context: { tokens: 1, window: 1_000_000 }, rateLimits: [], changed: ['rateLimits'] } as never)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(unlockedNames(w)).toEqual(['Big Spender', 'Context Surfer'])
  })

  test('steps add tokens; the main loop counts cache, a subagent does not; no usage, nothing', async ($, on) => {
    const w = world(on)
    await start($)
    // Outside a turn: tokens only.
    for await (const _c of $.turn.step({ turnId: 't0', index: 0, model: 'claude-haiku-5', messageCount: 1 })) { /* drain */ }
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const _c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5', messageCount: 1 })) { /* drain */ }
    for await (const _c of $.turn.step({ turnId: 't1', index: 1, model: 'claude-haiku-5', messageCount: 1, agentId: 'a1' })) { /* drain */ }
    for await (const _c of $.turn.step({ turnId: 't1', index: 2, model: 'claude-haiku-5', messageCount: 0 })) { /* drain */ }
    // Usage that names no model is priced by the step's.
    for await (const _c of $.turn.step({ turnId: 't1', index: 3, model: 'claude-haiku-5', messageCount: 2 })) { /* drain */ }
    await w.clock.advance(20_000)
    await $.turn.complete({ answer: 'ok', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })
    // 21k of input, 20k from cache: over 90%, a Cache Wizard.
    expect(unlockedNames(w)).toEqual(['First Light', 'Cache Wizard'])
    const g = await gallery($)
    expect(g.line('Token Tsunami')).toContain('9%')
  })
})

describe('tools', () => {
  test('reads, searches, web, MCP servers and file kinds are counted', async ($, on) => {
    const w = world(on)
    w.failing.add('mcp__broken__x')
    await start($)
    for (let i = 0; i < 3; i++) await $.tool.call(tool('Read', { file_path: `/w/${i}.ts` }))
    await $.tool.call(tool('Grep', { pattern: 'x' }))
    await $.tool.call(tool('Glob', { pattern: '*' }))
    await $.tool.call(tool('WebFetch', { url: 'https://a', prompt: 'p' }))
    await $.tool.call(tool('WebSearch', { query: 'q' }))
    await $.tool.call(tool('mcp__github__get', {}))
    await $.tool.call(tool('mcp__github__list', {}))
    await $.tool.call(tool('mcp__slack__post', {}))
    await $.tool.call(tool('mcp__broken__x', {}))
    for (const p of ['a.ts', 'b.md', 'c.ts', 'Makefile', 'd.py', 'e.go', 'f.rs']) await $.tool.call(tool('Write', { file_path: `/w/${p}`, content: '' }))
    const g = await gallery($)
    expect(g.line('Archaeologist')).toContain('3/50')
    expect(g.line('Needle Finder')).toContain('2/25')
    expect(g.line('Web Crawler')).toContain('2/10')
    expect(g.line('Switchboard')).toContain('2/3')
    expect(unlockedNames(w)).toEqual(['Polyglot'])
  })

  test('a notebook edit, by tool or by extension, writes lab notes', async ($, on) => {
    const w = world(on)
    await start($)
    await $.tool.call(tool('NotebookEdit', { notebook_path: '/w/a.ipynb', new_source: 'x' }))
    expect(unlockedNames(w)).toEqual(['Lab Notes'])
  })

  test('an edit of a notebook path by Edit counts too; a failed one does not', async ($, on) => {
    const w = world(on)
    w.failing.add('MultiEdit')
    await start($)
    await $.tool.call(tool('MultiEdit', { file_path: '/w/a.ipynb', edits: [] }))
    expect(unlockedNames(w)).toEqual([])
    await $.tool.call(tool('Edit', { file_path: '/w/a.ipynb', old_string: 'a', new_string: 'b' }))
    expect(unlockedNames(w)).toEqual(['Lab Notes'])
  })

  test('ten files in one turn raise an Architect; the same file twice counts once', async ($, on) => {
    const w = world(on)
    await start($)
    // Outside a turn files are not counted toward one.
    await $.tool.call(tool('Write', { file_path: '/w/out.ts', content: '' }))
    await $.tool.call(tool('Edit', { file_path: '', old_string: 'a', new_string: 'b' }))
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 10; i++) await $.tool.call(tool('Edit', { file_path: `/w/f${i % 9}.ts`, old_string: 'a', new_string: 'b' }))
    expect(unlockedNames(w)).toEqual([])
    await $.tool.call(tool('Write', { file_path: '/w/last.ts', content: '' }))
    expect(unlockedNames(w)).toEqual(['Architect'])
  })

  test('shell: red then green squashes a bug; commits, pushes and passing tests', async ($, on) => {
    const w = world(on)
    w.failing.add('npm run lint')
    await start($)
    await $.tool.call(tool('Bash', { command: 'npm run lint' }))
    await $.tool.call(tool('Bash', { command: '   ' }))
    await $.tool.call(tool('Bash', {}))
    w.failing.clear()
    await $.tool.call(tool('PowerShell', { command: 'npm   run lint' }))
    await $.tool.call(tool('Bash', { command: 'git commit -m x' }))
    await $.tool.call(tool('Bash', { command: 'git push' }))
    await $.tool.call(tool('Bash', { command: 'npm test' }))
    expect(unlockedNames(w)).toEqual(['Bug Squasher', 'Committed', 'Shipwright', 'Test Pilot'])
  })

  test('todos and tasks finished count toward the Taskmaster', async ($, on) => {
    const w = world(on)
    await start($)
    await $.tool.call(tool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { status: 'completed' }, {}] }))
    await $.tool.call(tool('TodoWrite', { todos: 'not a list' }))
    await $.tool.call(tool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }] }))
    await $.tool.call(tool('TaskUpdate', { taskId: '1', status: 'completed' }))
    await $.tool.call(tool('TaskUpdate', { taskId: '2', status: 'in_progress' }))
    w.failing.add('TaskUpdate')
    w.failing.add('TodoWrite')
    await $.tool.call(tool('TaskUpdate', { taskId: '3', status: 'completed' }))
    await $.tool.call(tool('TodoWrite', { todos: [{ content: 'z', status: 'completed' }] }))
    expect((await gallery($)).line('Taskmaster')).toContain('4/10')
  })
})

describe('turns', () => {
  test('a clean session of twenty tools; a haiku; a subagent turn or a stray end changes nothing', async ($, on) => {
    const w = world(on)
    await start($)
    // An end with no turn started.
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 'tx', reason: 'answer' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 20; i++) await $.tool.call(tool('Read', { file_path: `/w/${i}` }))
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    expect(unlockedNames(w)).toEqual([])
    await w.clock.advance(30_000)
    await $.turn.complete({ answer: 'x', durationMs: 30_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(unlockedNames(w)).toEqual(['First Light', 'Clean Slate'])
    await turn($, w, 2000, 'answer', 't2')
    expect(unlockedNames(w)).toEqual(['First Light', 'Clean Slate', 'Haiku'])
    // The same day twice is one day.
    expect((await gallery($)).line('Devotee')).toContain('1/7')
  })

  test('twenty tools with a failure is no clean slate', async ($, on) => {
    const w = world(on)
    w.failing.add('Grep')
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 20; i++) await $.tool.call(tool(i ? 'Read' : 'Grep', { file_path: `/w/${i}` }))
    await w.clock.advance(30_000)
    await $.turn.complete({ answer: 'x', durationMs: 30_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(unlockedNames(w)).toEqual(['First Light'])
  })

  test('spawned agents count; one that did not start does not', async ($, on) => {
    const w = world(on)
    w.agents = ['running', 'running', 'running', 'running', 'running']
    await start($)
    await $.agent.spawn({ tool_use_id: 'x', prompt: 'p', description: 'none', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false })
    expect(unlockedNames(w)).toEqual([])
    for (let i = 0; i < 10; i++) await $.agent.spawn({ tool_use_id: `t${i}`, prompt: 'p', description: 'd', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false })
    expect(unlockedNames(w)).toEqual(['Hydra', 'Delegator'])
  })
})

describe('the celebration band', () => {
  test('one unlock: the band on both surfaces until it ends; then nothing', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, 30_000)
    const term = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 0 } })
    expect((await term.find({ type: 'Client' }))?.props.width).toBe(77)
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const pic = await desk.find({ type: 'Svg' })
    expect(String(pic?.props.alt)).toBe('Achievement unlocked: First Light. Finished your very first turn.')
    expect(String(pic?.props.source)).toContain('>ACHIEVEMENT UNLOCKED<')
    await desk.unmount()
    // A survey takes the band.
    const survey = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
    await w.clock.advance(6000)
    const after = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await after.find({ type: 'Svg' })).toBeUndefined()
    await after.unmount()
  })

  test('several unlocks queue: each gets six seconds, the band counts the rest', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call(tool('Bash', { command: 'git commit -m x' }))
    // While Committed shows, two more arrive.
    await $.tool.call(tool('Bash', { command: 'git push && npm test' }))
    const shown = async () => {
      const ui = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
      const pic = await ui.find({ type: 'Svg' })
      await ui.unmount()
      return pic ? String(pic.props.source) : ''
    }
    expect(await shown()).toContain('ACHIEVEMENT UNLOCKED · +2 MORE')
    await w.clock.advance(6000)
    expect(await shown()).toContain('ACHIEVEMENT UNLOCKED · +1 MORE')
    await w.clock.advance(6000)
    expect(await shown()).toContain('>ACHIEVEMENT UNLOCKED<')
    await w.clock.advance(6000)
    expect(await shown()).toBe('')
  })

  test('unlocks arriving together while the first band is still being drawn wait their turn', async ($, on) => {
    const w = world(on)
    await start($)
    await Promise.all([
      $.tool.call(tool('Bash', { command: 'git commit -m x' })),
      $.tool.call(tool('Bash', { command: 'git push' })),
    ])
    expect(unlockedNames(w)).toEqual(['Committed', 'Shipwright'])
    await w.clock.advance(12_000)
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('✕ hides the band', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, 30_000)
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'laurels-hide' })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    expect(w.kept.get('hidden')).toBe(true)
  })
})

describe('the gallery', () => {
  test('terminal: one column, unlocked first with their dates, counters with bars, flags without', async ($, on) => {
    const w = world(on, { unlocked: { committed: T0 - 3 * 86_400_000, 'first-light': T0 - 86_400_000 } })
    w.usage = { startedAt: T0 - 75 * 60_000, percent: 10, cost: 2.5 }
    await start($)
    await w.clock.advance(5000)
    const g = await gallery($, 0)
    expect(g.texts[0]).toBe('First Light Oct 8 · Finished your very first turn.')
    expect(g.texts[1]).toBe('Committed Oct 6 · A successful git commit.')
    // The closest locked badge leads the rest.
    expect(g.texts[2]).toBe('Marathon ▰▰▰▰▰▰▱▱▱▱ 1h15/2h · Keep one session going for two hours.')
    expect(g.line('Big Spender')).toMatch(/\$2\.50\/\$10/)
    expect(g.line('Night Owl')).toBe('Night Owl · Work between 00:00 and 05:00.')
    expect(g.all).toContain(` 2/${BADGES.length}`)
  })

  test('terminal: two columns from a hundred cells', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'Pane', requestId: 'kz-laurels', props: { ...PANE_PROPS, bodyColumns: 110 } })
    const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('g'))
    expect(rows).toHaveLength(BADGES.length / 2)
    await ui.unmount()
  })

  test('drawn before any session: every badge locked at zero', async ($, on) => {
    mock.clock(on, { now: T0 })
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'Pane', requestId: 'kz-laurels', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /^Hydra ▱+ 0\/5/ })).toBeDefined()
    await ui.unmount()
    const desk = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'Pane', requestId: 'kz-laurels', props: PANE_PROPS })
    expect(String((await desk.findAll({ type: 'Svg' }))[1]?.props.alt)).toContain('Hydra locked 0/5')
    await desk.unmount()
  })

  test('desktop: the header with the latest unlock, medals new and old, locked rings and goals', async ($, on) => {
    const w = world(on, { unlocked: { committed: T0 - 3 * 86_400_000, 'first-light': T0 - 3600_000 } })
    w.usage = { startedAt: T0, percent: 10, cost: 2.5 }
    await start($)
    await w.clock.advance(5000)
    for (let i = 0; i < 3; i++) await $.tool.call(tool('Read', { file_path: `/w/${i}` }))
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'Pane', requestId: 'kz-laurels', props: { ...PANE_PROPS, bodyColumns: 0 } })
    const svgs = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    expect(String(svgs[0]?.props.alt)).toBe(`Laurels: 2 of ${BADGES.length} unlocked`)
    expect(String(svgs[0]?.props.source)).toContain('latest · First Light · Oct 9')
    const rows = svgs.slice(1).map(s => String(s.props.source)).join('')
    const alts = svgs.slice(1).map(s => String(s.props.alt)).join('; ')
    // The new one shines; the old one is still.
    expect((rows.match(/class="lr-shn"/g) ?? []).length).toBe(1)
    expect((rows.match(/class="lr-glow"/g) ?? []).length).toBe(1)
    expect(alts).toContain('First Light unlocked Oct 9')
    expect(alts).toContain('Committed unlocked Oct 6')
    expect(alts).toContain('Big Spender locked $2.50/$10')
    expect(alts).toContain('Token Tsunami locked 0%')
    expect(alts).toContain('Night Owl locked;')
    expect(rows).toContain('stroke-dasharray="')
    expect(rows).toContain('>locked<')
  })

  test('desktop: a narrow header leaves the bar out; narrow cards cut long text short', async ($, on) => {
    const w = world(on)
    await start($)
    void w
    const ui = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', component: 'Pane', requestId: 'kz-laurels', props: { ...PANE_PROPS, bodyColumns: 20 } })
    const svgs = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    expect(String(svgs[0]?.props.source)).not.toContain('url(#lhG)"')
    expect(svgs.slice(1).map(s => String(s.props.source)).join('')).toContain('…')
  })
})

describe('failures', () => {
  test('hooks nothing answers beneath fail through their catch unchanged', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await start($)
    await expect($.tool.call({ tool: 'Read', file_path: '/a' })).rejects.toThrow(/no implementation for tool.call/)
    await expect($.turn.start({ text: 'x', turnId: 't' })).rejects.toThrow(/no implementation for turn.start/)
    await expect($.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })).rejects.toThrow(/no implementation for turn.complete/)
    await expect($.agent.spawn({ tool_use_id: 'x', prompt: 'p', description: 'd', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: false, fork: false })).rejects.toThrow(/no implementation for agent.spawn/)
    await expect($.session.measure({ context: { tokens: 1, window: 1, percent: 1 }, rateLimits: [], changed: ['context'] } as never)).rejects.toThrow(/no implementation for session.measure/)
  })

  test('refused progress writes never escape the start or the poll', async ($, on) => {
    const w = world(on)
    w.denied.add('progress')
    await start($)
    w.usage = { startedAt: T0 - 3 * 3600_000, percent: 10, cost: 1 }
    await w.clock.advance(5000)
    expect(w.toasts).toEqual([])
    w.denied.clear()
    await w.clock.advance(5000)
    expect(unlockedNames(w)).toEqual(['Marathon'])
  })

  test('a refused band write never escapes the band timer', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, 30_000)
    w.denied.add('burst')
    await w.clock.advance(6000)
    expect(unlockedNames(w)).toEqual(['First Light'])
  })
})
