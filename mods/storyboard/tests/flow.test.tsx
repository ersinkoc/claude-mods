import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const band = (o: { maxRows?: number; bodyColumns?: number } = {}) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: o.maxRows ?? 12, bodyColumns: o.bodyColumns ?? 100, scroll: { offset: 0, bodyRows: 11 }, view: {} },
})
const PANE_ID = 'kz-storyboard'
const pane = (bodyColumns = 48) => ({
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: { title: 'KOZMOS · Storyboard', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const COMPOSE = (tools: string[]) => ({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal' as const], tools, outputStyle: null, traits: [] })
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const TOOL = 'mcp__storyboard__chapter'
const T0 = 1_000_000

/** The engine beneath the plugin: session, command and tool registration, the band's neighbours. */
function world(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__storyboard__${e.name}` } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

describe('commands', () => {
  test('/storyboard list prints the log, singular and plural, steps and notes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    await $.session.start(START)
    expect((await $.command.run({ command: 'storyboard', args: 'print', ...RUN })).text)
      .toBe('Storyboard: no chapters yet. Claude marks them on multi-step tasks.')
    await clock.advance(65_000)
    await $.tool.call({ tool: TOOL, title: 'Read the code', phase: 'explore' })
    expect((await $.command.run({ command: 'storyboard', args: ' LIST ', ...RUN })).text)
      .toBe('Storyboard — 1 chapter\n  1:05  explore Read the code')
    await $.tool.call({ tool: TOOL, title: 'Write it', phase: 'build', step: 2, steps: 3, note: 'the hard part' })
    expect((await $.command.run({ command: 'storyboard', args: 'list', ...RUN })).text)
      .toBe('Storyboard — 2 chapters\n  1:05  explore Read the code\n  1:05  build   Write it (2/3) — the hard part')
  })

  test('/storyboard log opens the history pane, then closes it', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    let isOpen = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: isOpen ? [{ id: PANE_ID, title: 'Storyboard', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id}`)
      isOpen = true
      return { value: { isPlaced: true } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      isOpen = false
      return { value: undefined }
    })
    await $.session.start(START)
    expect((await $.command.run({ command: 'storyboard', args: 'log', ...RUN })).text).toBe('Storyboard log open.')
    expect((await $.command.run({ command: 'storyboard', args: 'log', ...RUN })).text).toBe('Storyboard log closed.')
    expect(calls).toEqual([`open ${PANE_ID}`, `close ${PANE_ID}`])
  })

  test('the band remembers being hidden; /storyboard flips it, a read-only store only for the session', async ($, on) => {
    mock.clock(on, { now: T0 })
    const writes: unknown[] = []
    on('store.get', () => ({ value: true }))
    on('store.set', ($, e) => {
      writes.push(e.value)
      return { deny: 'read-only' }
    })
    world(on)
    await $.session.start(START)
    await $.tool.call({ tool: TOOL, title: 'Plan it', phase: 'plan' })
    let ui = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Text', text: /Plan it/ })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'storyboard', args: '', ...RUN })).text).toBe('Storyboard band shown.')
    ui = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Text', text: /Plan it/ })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'storyboard', args: '', ...RUN })).text).toBe('Storyboard band hidden.')
    expect(writes).toEqual([false, true])
  })

  test('autoOpen opens the history pane on start; a refused tool leaves the session running', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    on('store.get', () => ({ deny: 'no store' }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.register', () => ({ deny: 'no tools here' }))
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    expect(await $.session.start(START)).toEqual({ cwd: '/work' })
    await clock.settle()
    expect(opened).toEqual([PANE_ID])
  })
})

describe('the tool and the prompt', () => {
  test('a chapter that cannot be stored is answered, not thrown', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('state.set', () => ({ deny: 'frozen' }))
    const r = await $.tool.call({ tool: TOOL, title: 'Ship it', phase: 'ship' })
    expect(r.result).toBe('not noted: the storyboard is unavailable')
  })

  test('the nudge is added once, even when the tool list is empty', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    let sections = [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }]
    on('prompt.compose', () => ({ sections }))
    await $.session.start(START)
    const all = await $.prompt.compose(COMPOSE([]))
    expect(all.sections.map(s => s.id)).toEqual(['intro', 'storyboard:nudge'])
    sections = all.sections as typeof sections
    const again = await $.prompt.compose(COMPOSE([TOOL]))
    expect(again.sections.map(s => s.id)).toEqual(['intro', 'storyboard:nudge'])
  })

  test('nudge off leaves the prompt alone', { options: { nudge: false } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
    await $.session.start(START)
    const composed = await $.prompt.compose(COMPOSE([TOOL]))
    expect(composed.sections.map(s => s.id)).toEqual(['intro'])
  })

  test('a compose with nothing beneath falls through its catch', async ($, on) => {
    mock.clock(on, { now: T0 })
    await expect($.prompt.compose(COMPOSE([TOOL]))).rejects.toThrow()
  })
})

describe('drawing', () => {
  test('a short band with no measured width: no step, no note row', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    await $.session.start(START)
    await $.tool.call({ tool: TOOL, title: 'Look first', phase: 'explore', note: 'not shown when short' })
    const ui = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...band({ maxRows: 6, bodyColumns: 0 }) })
    expect(await ui.find({ type: 'Text', text: /^⌕ Look first$/ })).toBeDefined()
    // No measured width: 80 columns, room for the full labels.
    expect(await ui.find({ type: 'Text', text: /^◉ EXPLORE$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not shown when short/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a counted step without a total shows its number and no meter', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    await $.session.start(START)
    await $.tool.call({ tool: TOOL, title: 'Fix', phase: 'build', step: 4 })
    const ui = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Text', text: /^⚒ Fix  step 4$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the history pane, empty and then with timed chapters, on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'storyboard', surface, ...pane(0) })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /No chapters yet: Claude marks them/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /—$/ })).toBeUndefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.map(s => s.props.alt)).toEqual(['No chapters yet'])
      }
      await ui.unmount()
    }

    await $.tool.call({ tool: TOOL, title: 'Read', phase: 'explore' })
    await clock.advance(90_000)
    await $.tool.call({ tool: TOOL, title: 'Build', phase: 'build', step: 1, steps: 2, note: 'first half' })
    await clock.advance(30_000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'storyboard', surface, ...pane() })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /· 2 chapters/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ 1:30$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ 0:30$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ —$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /◉ build/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /● explore/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ 1\/2$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /↳ first half/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        const build = 'Chapter: Build; phase build, 1/2; first half'
        expect(svgs.map(s => s.props.alt)).toEqual([build, 'Time per phase', build, 'Chapter: Read; phase explore'])
        expect(svgs.map(s => s.props.height)).toEqual([78, 54, 50, 36])
      }
      await ui.unmount()
    }
  })
})
