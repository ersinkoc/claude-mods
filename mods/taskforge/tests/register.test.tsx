import { describe, expect, mock, test } from 'claude-code/testing'

const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-taskforge',
  props: { title: 'KOZMOS · Taskforge', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

describe('register', () => {
  test('todos and tasks fall into the three columns on every surface and width', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', ($, e) => {
      if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: e.subject } } }
      if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
      return { result: {} }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
        { content: 'Fix the tokenizer', status: 'in_progress', activeForm: 'Fixing the tokenizer' },
        { content: 'Write the tests', status: 'pending', activeForm: 'Writing the tests' },
      ],
    })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Ship the release', description: 'tag and publish' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', owner: 'releaser' })

    for (const cols of [90, 44]) {
      const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(cols) })
      expect(await term.find({ type: 'Text', text: /1\/4 done/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /IN PROGRESS/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /Fixing the tokenizer/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /Ship the release/ })).toBeDefined()
      expect(await term.find({ type: 'Text', text: /releaser/ })).toBeDefined()
      await term.unmount()

      const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(cols) })
      expect((await desk.findAll({ type: 'Svg' })).length).toBe(2)
      await desk.unmount()
    }

    // A new list replaces the old one: everything done.
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
        { content: 'Fix the tokenizer', status: 'completed', activeForm: 'Fixing the tokenizer' },
      ],
    })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'deleted' })
    const end = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(60) })
    expect(await end.find({ type: 'Text', text: /2\/2 done/ })).toBeDefined()
    expect(await end.find({ type: 'Text', text: /Ship the release/ })).toBeUndefined()
    await end.unmount()
  })

  test('an empty board still draws', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'taskforge', surface: 'terminal', ...pane(40) })
    expect(await term.find({ type: 'Text', text: /No tasks yet/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'taskforge', surface: 'desktop', ...pane(40) })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
  })
})
