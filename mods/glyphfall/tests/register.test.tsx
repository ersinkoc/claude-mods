import { describe, expect, mock, test } from 'claude-code/testing'

import { chipLine, letterY, rainFrame, rainSvg, wordOf } from '../hooks/rain.ts'
import type { Tool } from '../hooks/rain.ts'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 20, bodyColumns: 96, scroll: { offset: 0, bodyRows: 19 }, view: {} },
})

const tool = (o: Partial<Tool>): Tool => ({ id: 'tu1', at: 0, end: null, name: 'Bash', detail: 'npm test', color: '#4ade80', isError: false, ...o })

describe('rain', () => {
  test('a word drops in, hangs while its tool runs, and falls once it ends', () => {
    const t = tool({})
    expect(letterY(t, 0, -10, 1)).toBe(-Infinity)
    expect(letterY(t, 0, 5000, 1)).toBe(1)
    const done = tool({ end: 3000 })
    expect(letterY(done, 0, 4000, 1)).toBeGreaterThan(1)
  })

  test('the hanging word reads across the middle row', () => {
    const frame = rainFrame([tool({ detail: 'npm test' })], 2000, 60, 3)
    expect(frame).toHaveLength(3)
    expect(frame[1]?.map(s => s.s).join('')).toContain('Bash npm test')
    for (const row of frame) expect(row.map(s => s.s).join('').length).toBe(60)
    expect(wordOf({ name: 'mcp__github__search', detail: '' }, 40)).toBe('github·search')
  })

  test('chips list the newest first and fit the width', () => {
    const line = chipLine([tool({ id: 'a', name: 'Read', detail: 'a.ts', end: 1 }), tool({ id: 'b', name: 'Edit', detail: 'b.ts', end: 2, isError: true })], 3, 40)
    const text = line.map(s => s.s).join('')
    expect(text.indexOf('Edit')).toBeLessThan(text.indexOf('Read'))
    expect(text.length).toBeLessThanOrEqual(40)
  })

  test('the desktop drawing animates columns with CSS', () => {
    const src = rainSvg([tool({ at: 900 })], 1000, 760, 96)
    expect(src).toContain('@keyframes gffall')
    expect(src).toContain('Bash')
  })
})

describe('register', () => {
  test('tool calls rain while working, on both surfaces, and nothing while idle', async ($, on) => {
    mock.clock(on, { now: 2_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: 'ok' }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Grep', pattern: 'heartline', tool_use_id: 'g1' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' })

    const idle = await $.ui.mount({ plugin: 'glyphfall', surface: 'terminal', ...BAND(false) })
    expect(await idle.find({ type: 'Client' })).toBeUndefined()
    await idle.unmount()

    const term = await $.ui.mount({ plugin: 'glyphfall', surface: 'terminal', ...BAND(true) })
    expect(await term.find({ type: 'Client', key: 'glyphfall' })).toBeDefined()
    await term.advance(100)
    expect(await term.find({ type: 'Text', text: /Edit/, in: 'glyphfall' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'glyphfall', surface: 'desktop', ...BAND(true) })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('app.ts')
    await desk.press({ key: 'glyphfall-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
  })
})
