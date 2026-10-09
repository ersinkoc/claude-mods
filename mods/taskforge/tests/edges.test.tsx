import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-taskforge',
  props: { title: 'KOZMOS · Taskforge', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }
const SPAWN = { tool_use_id: 'tu1', prompt: 'look', description: 'Look around', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }

function basics(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

/** The tool results a session gives: TaskCreate answers with the id it minted. */
function tools(on: On): void {
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(e.description), subject: 'From result' } } }
    return { result: {} }
  })
}

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed', activeForm?: string) => ({ content, status, activeForm }) as { content: string; status: 'pending'; activeForm: string }

// A clock by hand: each `now` call takes the next entry of `script` (true
// throws) and answers `now` once it is empty; each `every` tick waits for
// the test to release it.
function handClock(on: On) {
  const st = { now: 1000, script: [] as boolean[], ticks: [] as (() => void)[] }
  on('clock.now', () => {
    if (st.script.shift() === true) throw new Error('clock gone')
    return { value: st.now }
  })
  on('clock.every', async () => {
    await new Promise<void>(r => st.ticks.push(r))
    return { value: undefined }
  })
  return st
}

const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout
const flush = () => new Promise<void>(r => later(r, 20))

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

describe('pane and command', () => {
  test('/taskforge opens and closes the pane', async ($, on) => {
    let isOpen = false
    const calls: string[] = []
    mock.clock(on)
    basics(on)
    on('ui.panes', () => ({ value: isOpen ? [{ id: 'kz-taskforge', title: 'KOZMOS · Taskforge', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      isOpen = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      isOpen = false
      return { value: undefined }
    })
    await $.session.start(START)
    expect((await $.command.run({ command: 'taskforge', args: '', ...RUN })).text).toBe('Taskforge open.')
    expect((await $.command.run({ command: 'taskforge', args: '', ...RUN })).text).toBe('Taskforge closed.')
    expect(calls).toEqual(['open kz-taskforge KOZMOS · Taskforge', 'close kz-taskforge'])
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const opened: string[] = []
    mock.clock(on)
    basics(on)
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true as const } }
    })
    await $.session.start(START)
    expect(opened).toEqual(['kz-taskforge'])
  })

  test('before the session starts the pane draws an empty board from the clock', async ($, on) => {
    mock.clock(on, { now: 5000 })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(0) })
    const all = await texts(term)
    expect(all).toContain('⚒ 0/0 done')
    expect(all).not.toContain('since')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(0) })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('no tasks yet')
    expect((await desk.findAll({ type: 'Svg' }))[1]?.props.alt).toBe('pending: none; in progress: none; done: none')
    await desk.unmount()
  })
})

describe('cards', () => {
  test('agents own their cards by type, description or id', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    on('agent.spawn', ($, e) => (e.prompt === 'no' ? { deny: 'not now' } : { model: 'm', agentId: e.prompt }))
    await $.session.start(START)
    await $.agent.spawn({ ...SPAWN, prompt: 'a1', subagentType: 'Explore' })
    await $.agent.spawn({ ...SPAWN, prompt: 'a2', subagentType: '' })
    await $.agent.spawn({ ...SPAWN, prompt: 'no', subagentType: 'Plan' })
    await $.agent.spawn({ ...SPAWN, prompt: '', subagentType: 'Plan' })
    await $.tool.call({ tool: 'TodoWrite', agentId: 'a1', todos: [todo('Scan', 'pending')] } as never)
    await $.tool.call({ tool: 'TodoWrite', agentId: 'a2', todos: [todo('Map', 'pending')] } as never)
    await $.tool.call({ tool: 'TodoWrite', agentId: 'zz9876543', todos: [todo('Sort', 'pending')] } as never)
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    const all = await texts(term)
    expect(all).toContain('Explore · 0s')
    expect(all).toContain('Look around · 0s')
    expect(all).toContain('agent zz9876 · 0s')
    expect(all).not.toContain('Plan')
    await term.unmount()
  })

  test('a spawn that fails beneath fails as it did; a tool call outlives a broken clock', async ($, on) => {
    const clock = handClock(on)
    basics(on)
    on('agent.spawn', () => {
      throw new Error('spawn failed')
    })
    let calls = 0
    on('tool.call', () => ({ result: { ok: ++calls } }))
    await $.session.start(START)
    await expect($.agent.spawn({ ...SPAWN, subagentType: 'Explore' })).rejects.toThrow(/agent\.spawn/)
    // The hook's clock read fails after the call ran: its catch passes the call on.
    clock.script = [true]
    expect((await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'pending')] })).result).toEqual({ ok: 1 })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    expect(await texts(term)).toContain('No tasks yet')
    await term.unmount()
  })

  test('failed and denied calls leave the board; todos without a form; a rewritten list drops rows', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    let answer: Record<string, unknown> = { result: {} }
    on('tool.call', () => answer as never)
    await $.session.start(START)
    answer = { result: 'no', isError: true }
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Bad', 'pending')] })
    answer = { deny: 'no' }
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Denied', 'pending')] }).catch(() => undefined)
    answer = { result: {} }
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Keep', 'in_progress'), todo('Drop', 'pending')] })
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Keep', 'in_progress')] })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    const all = await texts(term)
    expect(all).toContain('⚒ 0/1 done')
    expect(all).not.toContain('Bad')
    expect(all).not.toContain('Denied')
    expect(all).not.toContain('Drop')
    expect(all).not.toContain('↳')
    await term.unmount()
  })

  test('tasks take their subject from the call, the result or the id; updates keep what they lack', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    let id: string | undefined = 't1'
    on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: id === undefined ? {} : { id, subject: id === 't2' ? 'From result' : undefined } } } : { result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Own subject', description: 'with notes', activeForm: 'Owning' })
    id = 't2'
    await $.tool.call({ tool: 'TaskCreate', subject: '', description: '' })
    id = 't3'
    await $.tool.call({ tool: 'TaskCreate', subject: '', description: '' })
    id = undefined
    await $.tool.call({ tool: 'TaskCreate', subject: 'Lost', description: '' })
    // An update with no fields keeps the card's own; one for an unknown task makes one.
    await $.tool.call({ tool: 'TaskUpdate', taskId: 't1', agentId: 'sub7777777' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 't1', status: 'in_progress' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 't9' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 't3', owner: 'lead', subject: 'Named', description: 'notes', activeForm: 'Naming', status: 'completed' })
    const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(44) })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs[0]?.props.alt).toBe('1 of 4 tasks done (25%)')
    expect(svgs[1]?.props.alt).toBe('pending: From result, #t9; in progress: Own subject; done: Named')
    const board = String(svgs[1]?.props.source)
    expect(board).toContain('↳ Owning')
    expect(board).toContain('agent sub777 · 0s · #t1')
    expect(board).toContain('lead · 0s · #t3')
    await desk.unmount()
  })

  test('deleting an unknown task changes nothing; an empty todo draws an empty card', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('', 'pending')] })
    const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(44) })
    const before = String((await desk.findAll({ type: 'Svg' }))[1]?.props.source)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'nope', status: 'deleted' })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(String(svgs[1]?.props.source)).toBe(before)
    expect(svgs[0]?.props.alt).toBe('0 of 1 tasks done (0%)')
    await desk.unmount()
  })

  test('two writes at once: the later publish has the picture', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    await Promise.all([
      $.tool.call({ tool: 'TodoWrite', todos: [todo('One', 'pending')] }),
      $.tool.call({ tool: 'TodoWrite', agentId: 'b', todos: [todo('Two', 'pending')] } as never),
    ])
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    expect(await texts(term)).toContain('⚒ 0/2 done')
    await term.unmount()
  })
})

describe('time', () => {
  test('time in the column ticks while a card runs, and stops when none does', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'in_progress', 'Building')] })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    await clock.advance(3000)
    expect(await texts(term)).toContain('since 3s')
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'completed', 'Building')] })
    await clock.advance(60_000)
    // No card runs: no ticks, the board keeps the time it was published at.
    expect(await texts(term)).toContain('since 3s')
    await term.unmount()
  })

  test('a restart cancels the running ticker; a tick whose publish fails is dropped', async ($, on) => {
    const clock = handClock(on)
    basics(on)
    tools(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'in_progress', 'Building')] })
    await flush()
    expect(clock.ticks).toHaveLength(1)
    clock.script = [true]
    clock.ticks.shift()?.()
    await flush()
    expect(clock.script).toHaveLength(0)
    await $.session.start(START)
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    expect(await texts(term)).toContain('No tasks yet')
    await term.unmount()
  })
})

describe('layouts', () => {
  const many = (n: number, status: 'pending' | 'in_progress' | 'completed', prefix: string) => Array.from({ length: n }, (_, i) => todo(`${prefix} ${i + 1}`, status, `${prefix}ing ${i + 1}`))

  test('wide terminal: done keeps the last eight, an empty column shows a dash', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [...many(10, 'completed', 'Done'), ...many(1, 'in_progress', 'Run')] })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(90) })
    const all = await texts(term)
    expect(all).toContain('+2 earlier')
    expect(all).toContain('  —')
    expect(all).toContain('Runing 1')
    expect(all).not.toContain('Done 1\n')
    await term.unmount()
  })

  test('narrow terminal: done keeps the last six', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: many(9, 'completed', 'Done') })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(44) })
    const all = await texts(term)
    expect(all).toContain('+3 earlier')
    expect(all).toContain('⚒ 9/9 done')
    expect(all).not.toContain('IN PROGRESS')
    await term.unmount()
  })

  test('desktop: ten done at most, long subjects wrap to three lines, a long word stands alone', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    tools(on)
    await $.session.start(START)
    const long = 'Refactor the parser so that every token carries its source span and the error messages can point at the exact column where the input stopped making sense to anyone reading it'
    const word = 'x'.repeat(90)
    await $.tool.call({ tool: 'TodoWrite', todos: [...many(12, 'completed', 'Done'), todo(long, 'in_progress'), todo(word, 'pending')] })
    for (const cols of [50, 120]) {
      const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(cols) })
      const board = String((await desk.findAll({ type: 'Svg' }))[1]?.props.source)
      expect(board).toContain('+2 earlier')
      expect(board).toContain('Refactor the parser')
      expect(board).toContain('class="ants"')
      expect(board).not.toContain('↳')
      await desk.unmount()
    }
  })
})
