import { describe, expect, mock, test } from 'claude-code/testing'

import { addTool, addUsage, cleanSummary, familyOf, fileList, newTally, toRecap } from '../hooks/recap.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 110, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-epilogue',
  props: { title: 'KOZMOS · Epilogue', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 110 } }
const USAGE = { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0 }

describe('recap', () => {
  test('families, files, usage and the recap', async () => {
    expect(familyOf('Bash')).toBe('shell')
    expect(familyOf('NotebookEdit')).toBe('edit')
    expect(familyOf('mcp__github__list')).toBe('mcp')
    expect(familyOf('TodoWrite')).toBe('tasks')
    const t = newTally('t', 0, 'do the thing', 1)
    addTool(t, 'Edit', { file_path: '/a/b/x.ts' }, false, 'x.ts')
    addTool(t, 'Edit', { file_path: '/a/b/x.ts' }, false, 'x.ts')
    addTool(t, 'Write', { file_path: 'C:\\w\\y.md' }, false, 'y.md')
    addTool(t, 'Bash', { command: 'false' }, true, 'false')
    addUsage(t, 'claude-opus-5-5', USAGE)
    const r = toRecap(t, 5000, 4000, 'answer', 1.5)
    expect(r.tools).toEqual([{ family: 'edit', count: 3 }, { family: 'shell', count: 1 }])
    expect(r.files).toEqual(['x.ts', 'y.md'])
    expect(r.failed).toEqual([{ tool: 'Bash', detail: 'false' }])
    expect(r.tokens).toBe(33_000)
    // opus 5.5: 2000*4 + 1000*20 + 30000*0.2 per million
    expect(Math.abs(r.estUsd - 0.034) < 1e-9).toBe(true)
    expect(r.sessionDeltaUsd).toBe(0.5)
    expect(fileList(['register.tsx', 'kz.ts', 'probe.ts', 'README.md'], 24)).toBe('register.tsx, kz.ts +2')
    expect(cleanSummary('  "Fixed the parser."  ')).toBe('Fixed the parser.')
    expect(cleanSummary('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen')?.endsWith('…')).toBe(true)
    expect(cleanSummary('   ')).toBeUndefined()
  })
})

describe('register', () => {
  test('a turn becomes a band, a pane card and an AI one-liner', { options: { aiSummary: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let cost = 1
    const asked: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [], cost: { usd: cost } } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: 'claude-opus-5-5' } }
    })
    on('tool.call', ($, e) => (e.tool === 'Bash' ? { isError: true as const, result: 'exit 1' } : { result: 'ok' }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('model.complete', ($, e) => {
      asked.push(e.model)
      return { value: { isAnswered: true as const, text: 'Split the parser into two passes and added tests.', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.prompt.submit({ text: 'split the parser', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'split the parser', turnId: 't1' })
    const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 })
    for await (const chunk of step) void chunk
    await step.result
    await $.tool.call({ tool: 'Edit', file_path: '/w/src/parser.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/w/test/parser.test.ts', content: 'x' })
    await $.tool.call({ tool: 'Read', file_path: '/w/README.md' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    cost = 1.07
    await $.turn.complete({ answer: 'I split the parser into a lexer and a parser pass, and added tests.', durationMs: 102_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(asked).toEqual(['claude-haiku-5-5'])

    const term = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /1:42/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /✎ 2/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /parser\.ts/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1 failed/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /session \+\$0\.07/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /two passes/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'epilogue', surface: 'desktop', ...BAND })
    const card = await desk.find({ type: 'Svg' })
    expect(String(card?.props.source)).toContain('Edit 2')
    expect(String(card?.props.alt)).toContain('parser.ts')
    await desk.unmount()

    // The next prompt clears the band.
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    const after = await $.ui.mount({ plugin: 'epilogue', surface: 'terminal', ...BAND })
    expect(await after.find({ type: 'Text', text: /1:42/ })).toBeUndefined()
    await after.unmount()

    const opened = await $.command.run({ command: 'epilogue', args: '', ...RUN })
    expect(opened.text).toBe('Epilogue open.')
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'epilogue', surface, ...PANE })
      if (surface === 'terminal') expect(await pane.find({ type: 'Text', text: /split the parser/ })).toBeDefined()
      else expect(await pane.find({ type: 'Svg' })).toBeDefined()
      await pane.unmount()
    }
  })
})
