import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { coarseSpan, createTask, fromTodos, isShown, progress, segments, updateTask } from '../hooks/quests.ts'

function engineBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

describe('quests', () => {
  test('todos keep their start time while they stay in progress', async () => {
    const a = fromTodos([], [{ content: 'Write', status: 'in_progress', activeForm: 'Writing' }, { content: 'Test', status: 'pending', activeForm: 'Testing' }], 1000)
    expect(a[0]?.since).toBe(1000)
    const b = fromTodos(a, [{ content: 'Write', status: 'in_progress', activeForm: 'Writing' }, { content: 'Test', status: 'pending', activeForm: 'Testing' }], 5000)
    expect(b[0]?.since).toBe(1000)
    const c = fromTodos(b, [{ content: 'Write', status: 'completed', activeForm: 'Writing' }, { content: 'Test', status: 'in_progress', activeForm: 'Testing' }], 9000)
    expect(c[0]?.since).toBeUndefined()
    expect(c[1]?.since).toBe(9000)
    expect(progress(c)).toMatchObject({ done: 1, total: 2 })
  })

  test('tasks are created, updated and deleted by id', async () => {
    let l = createTask([], '1', 'Build', 'Building')
    l = createTask(l, '2', 'Ship', undefined)
    l = updateTask(l, { taskId: '1', status: 'in_progress' }, 100)
    expect(progress(l).active?.active).toBe('Building')
    l = updateTask(l, { taskId: '1', status: 'completed' }, 200)
    l = updateTask(l, { taskId: '2', status: 'deleted' }, 300)
    expect(l.map(q => q.status)).toEqual(['completed'])
    l = updateTask(l, { taskId: '9', status: 'in_progress', subject: 'Late' }, 400)
    expect(l[1]?.title).toBe('Late')
  })

  test('visibility, labels and segment sizes', async () => {
    const done = [{ id: 'todo:0', title: 'x', active: 'x', status: 'completed' as const }]
    expect(isShown([], null, 0)).toBe(false)
    expect(isShown(done, 0, 60_000)).toBe(true)
    expect(isShown(done, 0, 121_000)).toBe(false)
    expect(coarseSpan(35_000)).toBe('30s')
    expect(coarseSpan(250_000)).toBe('4m')
    expect(segments(7, 40)).toEqual({ width: 4, gap: 1 })
    expect(segments(30, 20)).toEqual({ width: 1, gap: 0 })
  })
})

describe('register', () => {
  test('a todo list shows on both surfaces, finishes, and hides two minutes later', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: 'Deploy' } } } : { result: {} }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'TodoWrite', todos: [
      { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
      { content: 'Run the tests', status: 'in_progress', activeForm: 'Running the tests' },
      { content: 'Fix it', status: 'pending', activeForm: 'Fixing it' },
    ] })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Deploy', description: 'ship it', activeForm: 'Deploying' })
    await clock.advance(1000)

    const term = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    await term.advance(200)
    expect(await term.find({ type: 'Text', text: /Running the tests/, in: 'questline-bar' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1\/4/, in: 'questline-bar' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'questline', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/1 of 4 tasks done; now: Running the tests/)

    await $.tool.call({ tool: 'TodoWrite', todos: [
      { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
      { content: 'Run the tests', status: 'completed', activeForm: 'Running the tests' },
      { content: 'Fix it', status: 'completed', activeForm: 'Fixing it' },
    ] })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/all 4 tasks done/)
    await clock.advance(125_000)
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
  })

  test('✕ hides the band and /questline brings it back', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: {} }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', status: 'pending', activeForm: 'Aing' }] })
    const ui = await $.ui.mount({ plugin: 'questline', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeDefined()
    await ui.press({ key: 'questline-hide' })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await $.command.run({ command: 'questline', args: '', ...RUN })).text).toMatch(/shown/)
    expect(await ui.find({ type: 'Client' })).toBeDefined()
    await ui.unmount()
  })

  test('nothing shows without tasks', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'questline', surface, ...BAND })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await ui.unmount()
    }
  })
})
