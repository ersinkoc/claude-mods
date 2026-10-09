import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PANE_PROPS = { title: 'KOZMOS · Launchpad', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const LIST = [
  { name: 'review', description: 'Review the diff', source: 'builtin' as const },
  { name: 'commit', description: '', source: 'plugin' as const, plugin: 'commit' },
  { name: 'docs', description: 'Write docs', source: 'builtin' as const },
]

type World = {
  ran: string[]
  /** What a launched command answers: its text, or a failure. */
  answer: { text?: string } | 'fail'
  fill: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' } | 'fail'
  filled: string[]
  isOpen: boolean
  opened: number
  listFails: boolean
  storeFails: boolean
  sets: Record<string, unknown>
}

/** The world beneath launchpad: a store, the command list, commands, the prompt box and panes. */
function world(on: On, stored: Record<string, unknown> = {}): World {
  const w: World = { ran: [], answer: { text: 'ok' }, fill: { isFilled: true }, filled: [], isOpen: false, opened: 0, listFails: false, storeFails: false, sets: {} }
  const kept = new Map(Object.entries(stored))
  on('store.get', ($, e) => {
    if (w.storeFails) throw new Error('store down')
    return { value: kept.get(e.key) }
  })
  on('store.set', ($, e) => {
    if (w.storeFails) throw new Error('store down')
    kept.set(e.key, e.value)
    w.sets[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => {
    if (w.listFails) throw new Error('list down')
    return { value: LIST }
  })
  on('command.run', ($, e) => {
    w.ran.push(`${e.origin.kind}:${e.command}`)
    if (w.answer === 'fail') throw new Error('command down')
    return w.answer
  })
  on('prompt.fill', ($, e) => {
    if (w.fill === 'fail') throw new Error('fill down')
    w.filled.push(e.text)
    return w.fill
  })
  on('ui.open', () => {
    w.opened++
    w.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'kz-launchpad', title: 'KOZMOS · Launchpad', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  return w
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const pad = async ($: Engine, args: string) => (await $.command.run({ command: 'launchpad', args, ...RUN })).text
const mount = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 52) =>
  $.ui.mount({ plugin: 'launchpad', surface, component: 'Pane', requestId: 'kz-launchpad', props: { ...PANE_PROPS, bodyColumns } })

describe('store', () => {
  test('stored counts, pins and prompts come back', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on, { counts: { review: { n: 4, at: 9_940_000 } }, pinned: ['docs'], saved: ['Explain the build'] })
    await start($)
    expect(await pad($, 'list')).toBe(['Launchpad', 'Pinned:', '  ★ /docs', 'Frequent:', '  ▶ /review ×4', 'Saved:', '  1. Explain the build'].join('\n'))
  })

  test('malformed stored values are ignored', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on, { counts: { review: { n: 4, at: 'then' } }, pinned: 'docs', saved: ['ok', 3] })
    await start($)
    expect(await pad($, 'list')).toContain('(none yet: run some slash commands)')
    expect(await pad($, 'list')).toContain('(none: /launchpad pin <command>)')
    expect(await pad($, 'list')).toContain('(none: /launchpad save <prompt>)')
  })

  test('counts stored as a list are ignored too', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on, { counts: [{ n: 1, at: 1 }], pinned: null, saved: 'x' })
    await start($)
    expect(await pad($, 'list')).toContain('(none yet: run some slash commands)')
  })

  test('a counts entry that is null or a number is ignored', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on, { counts: { review: null, docs: 3 } })
    await start($)
    expect(await pad($, 'list')).toContain('(none yet: run some slash commands)')
  })

  test('counts stored as null are ignored', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on, { counts: null })
    await start($)
    expect(await pad($, 'list')).toContain('(none yet: run some slash commands)')
  })

  test('a store that fails leaves a fresh pad that still works for the session', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    const w = world(on, { counts: { review: { n: 4, at: 1 } } })
    w.storeFails = true
    await start($)
    expect(await pad($, 'save Remember me')).toBe('Saved as prompt 1.')
    expect(await pad($, 'list')).toContain('  1. Remember me')
    expect(w.sets).toEqual({})
  })
})

describe('the command', () => {
  test('save, rm, pin, unpin, forget and help', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    await $.command.run({ command: 'review', args: '', ...RUN })
    expect(await pad($, 'save one')).toBe('Saved as prompt 1.')
    expect(await pad($, 'save two')).toBe('Saved as prompt 2.')
    // Saving a prompt again moves it to the end.
    expect(await pad($, 'save one')).toBe('Saved as prompt 2.')
    expect(w.sets.saved).toEqual(['two', 'one'])
    expect(await pad($, 'rm 5')).toBe('No saved prompt 5.')
    expect(await pad($, 'rm 1')).toBe('Removed prompt 1: two')
    expect(w.sets.saved).toEqual(['one'])
    expect(await pad($, 'pin /docs')).toBe('Pinned /docs.')
    expect(await pad($, 'pin docs')).toBe('Pinned /docs.')
    expect(w.sets.pinned).toEqual(['docs'])
    expect(await pad($, 'unpin docs')).toBe('Unpinned /docs.')
    expect(w.sets.pinned).toEqual([])
    expect(w.sets.counts).toEqual({ review: { n: 1, at: 10_000_000 } })
    expect(await pad($, 'forget')).toBe('Launchpad forgot the command counts (pins and saved prompts stay).')
    expect(w.sets.counts).toEqual({})
    expect(await pad($, 'what')).toContain('Unknown: what.')
  })

  test('toggling opens and closes the pane; autoOpen is off by default', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    expect(w.opened).toBe(0)
    expect(await pad($, '')).toBe('Launchpad open.')
    expect(w.isOpen).toBe(true)
    expect(await pad($, '')).toBe('Launchpad closed.')
    expect(w.isOpen).toBe(false)
  })

  test('autoOpen opens the pane at start', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    await clock.settle()
    expect(w.opened).toBe(1)
  })

  test('a command list that fails keeps every counted command on offer', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    w.listFails = true
    await start($)
    await $.command.run({ command: 'gone', args: '', ...RUN })
    expect(await pad($, 'list')).toContain('  ▶ /gone ×1')
  })
})

describe('learning', () => {
  test('only composer runs of other commands are counted', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    await $.command.run({ command: 'review', args: '', ...RUN })
    await $.command.run({ command: 'review', args: '', origin: { kind: 'sdk' }, presentation: RUN.presentation })
    await pad($, 'list')
    expect(w.sets.counts).toEqual({ review: { n: 1, at: 10_000_000 } })
    expect(w.ran).toEqual(['composer:review', 'sdk:review'])
  })

  test('a run nothing answers beneath fails through the catch unchanged', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({ value: LIST }))
    await start($)
    await expect($.command.run({ command: 'review', args: '', ...RUN })).rejects.toThrow(/no implementation for command.run/)
  })

  test('a clock that fails skips the count but not the run', async ($, on) => {
    let isBroken = false
    on('clock.now', () => {
      if (isBroken) throw new Error('clock down')
      return { value: 10_000_000 }
    })
    const w = world(on)
    await start($)
    isBroken = true
    expect((await $.command.run({ command: 'review', args: '', ...RUN })).text).toBe('ok')
    isBroken = false
    expect(await pad($, 'list')).toContain('(none yet: run some slash commands)')
    expect(w.ran).toEqual(['composer:review'])
  })
})

describe('drawing', () => {
  test('an empty pad tells how to fill each section, on both surfaces', async ($, on) => {
    mock.clock(on, { now: 10_000_000 })
    world(on)
    await start($)
    const term = await mount($, 'terminal', 0)
    expect((await term.find({ type: 'Text', text: /runs learned/ }))?.text).toContain('0 runs learned · 0 saved')
    expect(await term.find({ type: 'Text', text: /press ☆ on a command, or \/launchpad pin <cmd>/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /run a few slash commands; they land here/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /\/launchpad save <prompt text>/ })).toBeDefined()
    expect(await term.find({ type: 'Button' })).toBeUndefined()
    expect(await term.find({ type: 'Text', text: /^↳/ })).toBeUndefined()
    await term.unmount()
    const desk = await mount($, 'desktop')
    const alts = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
    expect(alts).toEqual(['Launchpad: 0 runs learned, 0 saved prompts', 'Pinned', 'Frequent', 'Saved prompts'])
    const sources = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('')
    expect(sources).toContain('star a command to keep it here')
    expect(sources).toContain('run a few slash commands')
    expect(sources).toContain('/launchpad save &lt;text&gt;')
    await desk.unmount()
  })

  test('terminal: run, pin and unpin commands, fill and remove prompts', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    await $.command.run({ command: 'review', args: '', ...RUN })
    await clock.advance(120_000)
    await pad($, 'pin docs')
    await pad($, 'save Explain the build')
    const term = await mount($, 'terminal')
    expect((await term.find({ type: 'Text', text: /runs learned/ }))?.text).toContain('1 runs learned · 1 saved')
    expect((await term.find({ type: 'Text', text: /^✎ SAVED/ }))?.text).toContain('press to fill the prompt box')
    expect((await term.find({ key: 'run-docs' }))?.props.label).toBe('▶ /docs'.padEnd(12))
    expect((await term.find({ type: 'Text', text: /×1 · 2m ago/ }))).toBeDefined()
    expect((await term.find({ type: 'Text', text: /×0 · never run/ }))).toBeDefined()

    // A command that answers no text, or an empty one, reads as done.
    w.answer = {}
    await term.press({ key: 'run-review' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toBe('↳ /review: done')
    w.answer = { text: '' }
    await term.press({ key: 'run-docs' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toBe('↳ /docs: done')
    w.answer = 'fail'
    await term.press({ key: 'run-docs' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toMatch(/^↳ \/docs: .*no implementation for command.run/)
    expect(w.ran.filter(r => r === 'plugin:docs')).toHaveLength(2)

    // ☆ pins a frequent command, ★ unpins it.
    await term.press({ key: 'pin-review' })
    expect(await term.find({ key: 'unpin-review' })).toBeDefined()
    await term.press({ key: 'unpin-review' })
    expect(await term.find({ key: 'pin-review' })).toBeDefined()

    // A hook's own refusal carries no cause.
    w.fill = { isFilled: false }
    await term.press({ key: 'fill-0' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toBe('↳ prompt: the prompt box did not take it')
    w.fill = 'fail'
    await term.press({ key: 'fill-0' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toMatch(/^↳ prompt: .*no implementation for prompt.fill/)
    w.fill = { isFilled: true }
    await term.press({ key: 'fill-0' })
    expect((await term.find({ type: 'Text', text: /^↳/ }))?.text).toBe('↳ prompt: in the prompt box')
    expect(w.filled).toEqual(['Explain the build', 'Explain the build'])

    await term.press({ key: 'rm-0' })
    expect(await term.find({ key: 'fill-0' })).toBeUndefined()
    expect(w.sets.saved).toEqual([])
    await term.unmount()
  })

  test('desktop: cards with their buttons for commands and prompts', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000_000 })
    const w = world(on)
    await start($)
    await $.command.run({ command: 'review', args: '', ...RUN })
    await $.command.run({ command: 'commit', args: '', ...RUN })
    await clock.advance(60_000)
    await pad($, 'pin docs')
    await pad($, 'save Explain the build')
    const desk = await mount($, 'desktop')
    const alts = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
    expect(alts).toContain('Launchpad: 2 runs learned, 1 saved prompts')
    expect(alts).toContain('/docs: Write docs')
    expect(alts).toContain('/review: Review the diff, run 1 times')
    expect(alts).toContain('/commit: 1m ago, run 1 times')
    expect(alts).toContain('Saved prompt 1: Explain the build')
    const sources = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('')
    expect(sources).toContain('learned from what you run')
    expect(sources).toContain('click to fill the prompt box')
    expect((await desk.find({ key: 'run-docs' }))?.props.variant).toBe('primary')
    expect((await desk.find({ key: 'run-review' }))?.props.variant).toBeUndefined()

    await desk.press({ key: 'run-commit' })
    expect(w.ran).toContain('plugin:commit')
    expect((await desk.find({ type: 'Text', text: /^↳/ }))?.text).toBe('↳ /commit: ok')
    await desk.press({ key: 'pin-commit' })
    expect(await desk.find({ key: 'unpin-commit' })).toBeDefined()
    await desk.press({ key: 'unpin-docs' })
    expect(await desk.find({ key: 'run-docs' })).toBeUndefined()
    await desk.press({ key: 'fill-0' })
    expect(w.filled).toEqual(['Explain the build'])
    await desk.press({ key: 'rm-0' })
    expect(await desk.find({ key: 'fill-0' })).toBeUndefined()
    await desk.unmount()
  })
})
