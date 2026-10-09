import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { chipLine, letterY, rainFrame, rainSvg, wordOf } from '../hooks/rain.ts'
import type { Tool } from '../hooks/rain.ts'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 20, bodyColumns: 96, scroll: { offset: 0, bodyRows: 19 }, view: {} },
})

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

/** The session beneath glyphfall, and an engine band for it to draw under. */
function world(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

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

  test('a quiet session publishes an empty rain once and draws nothing', async ($, on) => {
    const clock = mock.clock(on, { now: 2_000_000 })
    mock.store(on)
    world(on)
    const sets: unknown[] = []
    on('state.set', { plugin: 'glyphfall', key: 'snap' } as const, ($, e, next) => {
      sets.push(e.value)
      return next(e)
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(3000)
    expect(sets).toEqual([{ now: 2_001_000, tools: [] }])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'glyphfall', surface, ...BAND(true) })
      expect(await ui.find({ key: 'glyphfall-hide' })).toBeUndefined()
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a band hidden last session stays hidden until /glyphfall; a short band is lower', async ($, on) => {
    mock.clock(on, { now: 2_000_000 })
    mock.store(on, { hidden: true })
    world(on)
    on('tool.call', () => ({ deny: 'not now' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    // An empty tool_use_id: glyphfall numbers the call itself; the deny marks it failed.
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /', tool_use_id: '' })
    let ui = await $.ui.mount({ plugin: 'glyphfall', surface: 'terminal', ...BAND(true) })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'glyphfall', args: '', ...RUN })).text).toBe('Glyphfall shown.')
    const short = { ...BAND(true), props: { ...BAND(true).props, maxRows: 6, bodyColumns: 0 } }
    ui = await $.ui.mount({ plugin: 'glyphfall', surface: 'terminal', ...short })
    const client = await ui.find({ type: 'Client' })
    expect(client?.props.height).toBe(3)
    expect(client?.props.width).toBe(78)
    const props = client?.props.props as { tools: { id: string; isError: boolean; detail: string }[]; rows: number; width: number }
    expect(props.tools).toMatchObject([{ id: 'kz-1', isError: true, detail: 'rm -rf /' }])
    expect(props.rows).toBe(3)
    await ui.unmount()
    const desk = await $.ui.mount({ plugin: 'glyphfall', surface: 'desktop', ...short })
    const pic = await desk.find({ type: 'Svg' })
    expect(pic?.props.height).toBe(76)
    expect(String(pic?.props.alt)).toBe('Tool rain. Latest tools: Bash rm -rf / (failed).')
    await desk.unmount()
    expect((await $.command.run({ command: 'glyphfall', args: '', ...RUN })).text).toBe('Glyphfall hidden.')
  })

  test('a survey takes the band', async ($, on) => {
    mock.clock(on, { now: 2_000_000 })
    mock.store(on)
    world(on)
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    const ui = await $.ui.mount({ plugin: 'glyphfall', surface: 'desktop', ...BAND(true), props: { ...BAND(true).props, hasSurvey: true } })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('a store and a state that refuse writes leave the session working', async ($, on) => {
    const clock = mock.clock(on, { now: 2_000_000 })
    world(on)
    on('store.get', () => ({ deny: 'no store' }))
    on('store.set', () => ({ deny: 'no store' }))
    on('state.set', { plugin: 'glyphfall', key: 'snap' } as const, () => ({ deny: 'frozen' }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })).toEqual({ result: 'ok' })
    await clock.advance(2000)
    expect((await $.command.run({ command: 'glyphfall', args: '', ...RUN })).text).toBe('Glyphfall hidden.')
    const ui = await $.ui.mount({ plugin: 'glyphfall', surface: 'terminal', ...BAND(true) })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })

  test('a tool that fails below fails as it would without glyphfall', async ($, on) => {
    mock.clock(on, { now: 2_000_000 })
    mock.store(on)
    world(on)
    on('tool.call', () => {
      throw new Error('no tools')
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await expect($.tool.call({ tool: 'Read', file_path: '/work/a.ts' })).rejects.toThrow()
  })
})
