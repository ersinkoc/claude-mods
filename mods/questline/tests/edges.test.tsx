import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Quest, QuestSnap } from '../types'
import { coarseSpan, createTask, fromTodos, segments, updateTask } from '../hooks/quests.ts'
import { altOf, questSvg } from '../hooks/svg.ts'

function engineBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

function basics(on: On): void {
  engineBand(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout
const flush = () => new Promise<void>(r => later(r, 20))

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }

const q = (id: string, status: Quest['status'], extra: Partial<Quest> = {}): Quest => ({ id, title: id, active: `${id}ing`, status, ...extra })

const snapOf = (items: Quest[], now = 0): QuestSnap => ({
  items,
  done: items.filter(i => i.status === 'completed').length,
  total: items.length,
  allDoneAt: null,
  isVisible: true,
  now,
})

describe('quests edges', () => {
  test('todo rows fall back to step titles and keep a moved row by title', async () => {
    const a = fromTodos([], [{ content: '  ', status: 'weird' }, { content: 7 }], 10)
    expect(a.map(x => [x.title, x.active, x.status])).toEqual([['Step 1', 'Step 1', 'pending'], ['Step 2', 'Step 2', 'pending']])
    // No row matches by title: the row at the same index is the one before.
    const b = fromTodos([q('todo:0', 'in_progress', { title: 'Old', since: 5 })], [{ content: 'New', status: 'in_progress' }], 20)
    expect(b[0]?.since).toBe(20)
    // A row that stays in progress without a recorded start takes now.
    const c = fromTodos([q('todo:0', 'in_progress', { title: 'Keep' })], [{ content: 'Keep', status: 'in_progress' }], 30)
    expect(c[0]?.since).toBe(30)
  })

  test('a task created twice is kept once; updates fill titles and forms', async () => {
    const l = createTask([], '1', 'Build', '  ')
    expect(l[0]?.active).toBe('Build')
    expect(createTask(l, '1', 'Again', undefined)).toEqual(l)
    // An unknown task: the patch's form, then its subject, then the id name the title.
    expect(updateTask([], { taskId: '5', activeForm: 'Shipping' }, 0)[0]).toMatchObject({ title: 'Task #5', active: 'Shipping', status: 'pending' })
    expect(updateTask([], { taskId: '6', subject: 'Ship' }, 0)[0]).toMatchObject({ title: 'Ship', active: 'Ship' })
    expect(updateTask([], { taskId: '7' }, 0)[0]).toMatchObject({ title: 'Task #7', active: 'Task #7' })
    // A new subject renames the running form only when it mirrored the title.
    const mirrored = updateTask(createTask([], '2', 'Lint', undefined), { taskId: '2', subject: 'Lint all' }, 0)
    expect(mirrored[0]).toMatchObject({ title: 'Lint all', active: 'Lint all' })
    const own = updateTask(createTask([], '3', 'Test', 'Testing'), { taskId: '3', subject: 'Test all' }, 0)
    expect(own[0]).toMatchObject({ title: 'Test all', active: 'Testing' })
    // A running task keeps its start; one with none recorded starts now.
    const running = updateTask([q('task:4', 'in_progress', { since: 3 })], { taskId: '4', status: 'in_progress' }, 9)
    expect(running[0]?.since).toBe(3)
    expect(updateTask([q('task:4', 'in_progress')], { taskId: '4', status: 'in_progress' }, 9)[0]?.since).toBe(9)
  })

  test('spans past an hour and empty segment lists', async () => {
    expect(coarseSpan(-5)).toBe('<10s')
    expect(coarseSpan(4_320_000)).toBe('1h12m')
    expect(segments(0, 40)).toEqual({ width: 0, gap: 0 })
  })
})

describe('questSvg', () => {
  test('wide segments carry a check mark, a running one its elapsed caption', async () => {
    const pic = questSvg(snapOf([q('task:1', 'completed'), q('task:2', 'in_progress', { since: 0 })], 75_000), 800)
    expect(pic.width).toBe(800)
    expect(pic.source).toContain('stroke-linecap="round"')
    expect(pic.source).toContain('· 1m')
    expect(pic.alt).toBe('Questline: 1 of 2 tasks done; now: task:2ing')
  })

  test('many quests pack tightly; a run without a start has no caption', async () => {
    const items = Array.from({ length: 30 }, (_, i) => q(`todo:${i}`, i === 0 ? 'in_progress' : i === 1 ? 'completed' : 'pending'))
    const pic = questSvg(snapOf(items), 100)
    expect(pic.width).toBe(260)
    expect(pic.source).not.toContain('stroke-linecap="round"')
    expect(pic.source).not.toContain('·')
    expect(pic.source).toContain('1/30')
  })

  test('nothing running waits for the next task', async () => {
    const pic = questSvg(snapOf([q('todo:0', 'pending')]), 400)
    expect(pic.source).toContain('waiting for the next task')
    expect(altOf(snapOf([q('todo:0', 'pending')]))).toBe('Questline: 0 of 1 tasks done')
  })
})

describe('register edges', () => {
  test('a restart restores the quests from the last snapshot', async ($, on) => {
    const clock = mock.clock(on, { now: 5000 })
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ result: { task: { id: 3 } } }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Port', description: 'd', activeForm: 'Porting' })
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Plan', status: 'in_progress', activeForm: 'Planning' }] })
    await $.session.start(START)
    await clock.advance(1000)
    const desk = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Questline: 0 of 2 tasks done; now: Planning')
    await desk.unmount()
  })

  test('tasks without a subject, numeric updates and unknown tools', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: 8 } } } : { result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TaskCreate', description: 'no subject' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: 8 as never, status: 'in_progress' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await $.tool.call({ tool: 'TodoWrite' } as never)
    await $.tool.call({ tool: 'TaskUpdate' } as never)
    const desk = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Questline: 0 of 1 tasks done; now: Task #8')
    await desk.unmount()
  })

  test('a created task with the subject only in the input, or with no id', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    let id: unknown = 'a1'
    on('tool.call', () => ({ result: { task: { id } } }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TaskCreate', subject: 'From input', description: 'd' } as never)
    id = { bad: true }
    await $.tool.call({ tool: 'TaskCreate', subject: 'Lost', description: 'd' } as never)
    const desk = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Questline: 0 of 1 tasks done')
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
  })

  test('subagent calls, errors and denials leave the list alone', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    let answer: Record<string, unknown> = { result: {} }
    on('tool.call', () => answer as never)
    await $.session.start(START)
    const todos = [{ content: 'A', status: 'pending' as const, activeForm: 'Aing' }]
    await $.tool.call({ tool: 'TodoWrite', todos, agentId: 'sub-1' } as never)
    answer = { result: 'boom', isError: true }
    await $.tool.call({ tool: 'TodoWrite', todos })
    answer = { deny: 'no' }
    await $.tool.call({ tool: 'TodoWrite', todos }).catch(() => undefined)
    const ui = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })

  test('a failing hook lets the call through', async ($, on) => {
    // No clock beneath: the hook throws on $.clock.now and its catch passes the call on.
    mock.store(on)
    on('tool.call', () => ({ result: { ok: true } }))
    const ran = await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', status: 'pending', activeForm: 'Aing' }] })
    expect(ran.result).toEqual({ ok: true })
  })

  test('a stored hide is restored, and the timer republishes', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on, { isHidden: true })
    basics(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', status: 'in_progress', activeForm: 'Aing' }] })
    const ui = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await $.command.run({ command: 'questline', args: '', ...RUN })).text).toMatch(/shown/)
    expect((await $.command.run({ command: 'questline', args: '', ...RUN })).text).toBe('Questline hidden. /questline brings it back.')
    expect((await $.command.run({ command: 'questline', args: '', ...RUN })).text).toMatch(/shown/)
    await clock.advance(30_000)
    expect(await ui.find({ type: 'Text', text: /Aing · 0:30/, in: 'questline-bar' })).toBeDefined()
    await ui.unmount()
  })

  test('a timer tick whose publish fails is dropped', async ($, on) => {
    // A hand-made clock: one tick, released by the test, while now() throws.
    let isBroken = false
    let tick: () => void = () => undefined
    let ticks = 0
    on('clock.now', () => {
      if (isBroken) throw new Error('clock gone')
      return { value: 1000 }
    })
    on('clock.every', async () => {
      await (ticks++ === 0 ? new Promise<void>(r => (tick = r)) : new Promise<void>(() => undefined))
      return { value: undefined }
    })
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    isBroken = true
    tick()
    await flush()
    expect(ticks).toBe(2)
    isBroken = false
    const ui = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })

  test('a store that fails keeps the hide for the session', async ($, on) => {
    mock.clock(on, { now: 1000 })
    basics(on)
    on('store.get', () => {
      throw new Error('no store')
    })
    on('store.set', () => {
      throw new Error('no store')
    })
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', status: 'pending', activeForm: 'Aing' }] })
    expect((await $.command.run({ command: 'questline', args: '', ...RUN })).text).toMatch(/hidden/)
    const ui = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })

  test('the desktop ✕ hides; a survey and a narrow band', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', status: 'pending', activeForm: 'Aing' }] })
    const survey = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
    const narrow = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    // No measured width: 80 columns, 77 cells of 8 px.
    expect((await narrow.find({ type: 'Svg' }))?.props.width).toBe(608)
    await narrow.press({ key: 'questline-hide' })
    expect(await narrow.find({ type: 'Svg' })).toBeUndefined()
    await narrow.unmount()
  })
})
