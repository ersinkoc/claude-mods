import type { On, TurnStepChunk } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const band = (o: { maxRows?: number; bodyColumns?: number; hasSurvey?: boolean } = {}) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: o.hasSurvey ?? false, isWorking: true, maxRows: o.maxRows ?? 20, bodyColumns: o.bodyColumns ?? 96, scroll: { offset: 0, bodyRows: 19 }, view: {} },
})
type SpinMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'
const spinner = (mode: SpinMode) => ({ component: 'Spinner' as const, requestId: 'main', props: { word: 'Pondering', message: null, suffix: '…', mode } })
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = 3_000_000

/** The engine beneath: session, command, turns, a step whose chunks the test sets, the neighbours drawn. */
function world(on: On, chunks: () => TurnStepChunk[], toolUses = 0): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    for (const c of chunks()) yield c
    const uses = Array.from({ length: toolUses }, () => ({ name: 'Read', input: {} }))
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: uses, stopReason: 'end_turn' as const, usage: null }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="spin">{e.props.word}</Text>
  })
}

const THINK: TurnStepChunk = { kind: 'thinking', index: 0, text: 'hmm' } as TurnStepChunk
const TEXT: TurnStepChunk = { kind: 'text', index: 1, text: 'ok' }

/** Starts a main-loop step and reads its first chunk, leaving the rest pending. */
async function think($: Engine, effort?: 'low' | 'max' | number) {
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }) })
  await s.next()
  return s
}

async function svgOf($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: 'aurora', surface: 'desktop', ...band() })
  const src = (await ui.find({ type: 'Svg' }))?.props.source
  await ui.unmount()
  return src === undefined ? undefined : String(src)
}

describe('hiding', () => {
  test('the band remembers being hidden; the command and the ✕ flip it', async ($, on) => {
    mock.clock(on, { now: T0 })
    const writes: unknown[] = []
    on('store.get', () => ({ value: true }))
    on('store.set', ($, e) => {
      writes.push(e.value)
      return { value: undefined }
    })
    world(on, () => [THINK, TEXT])
    await $.session.start(START)
    await think($, 'max')
    expect(await svgOf($)).toBeUndefined()

    expect((await $.command.run({ command: 'aurora', args: '', ...RUN }))?.text).toBe('Aurora shown.')
    const ui = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Client', key: 'aurora' })).toBeDefined()
    await ui.press({ key: 'aurora-hide' })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'aurora', args: '', ...RUN }))?.text).toBe('Aurora shown.')
    expect((await $.command.run({ command: 'aurora', args: '', ...RUN }))?.text).toBe('Aurora hidden.')
    expect(writes).toEqual([false, true, false, true])
  })

  test('a store that refuses leaves the band shown and the toggle working for the session', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('store.get', () => ({ deny: 'none' }))
    on('store.set', () => ({ deny: 'read-only' }))
    world(on, () => [THINK])
    await $.session.start(START)
    await think($)
    expect(await svgOf($)).toContain('thinking')
    expect((await $.command.run({ command: 'aurora', args: '', ...RUN }))?.text).toBe('Aurora hidden.')
    expect(await svgOf($)).toBeUndefined()
  })
})

describe('the spinner as a second source', () => {
  test('the timer adopts the spinner mode while working, and ignores it when idle', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })

    let spin = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...spinner('thinking') })
    expect(await spin.find({ type: 'Text', text: 'Pondering' })).toBeDefined()
    await spin.redraw(spinner('thinking').props)
    await spin.unmount()
    await clock.advance(500)
    expect(await svgOf($)).toContain('>thinking<')
    // Nothing new from the spinner: the timer only republishes.
    await clock.advance(500)
    expect(await svgOf($)).toContain('>thinking<')

    spin = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...spinner('responding') })
    await spin.unmount()
    await clock.advance(500)
    expect(await svgOf($)).toContain('>responding<')

    // A subagent finishing leaves the main loop as it is.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'ag1' })
    expect(await svgOf($)).toContain('>responding<')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await svgOf($)).toBeUndefined()
    // Already idle: a second end changes nothing.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    spin = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...spinner('thinking') })
    await spin.unmount()
    spin = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...spinner('tool-use') })
    await spin.unmount()
    await clock.advance(500)
    expect(await svgOf($)).toBeUndefined()
  })
})

describe('the stream', () => {
  test('chunks set the mode; a step with tool uses ends in tool-use; the effort carries over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let chunks: TurnStepChunk[] = [
      THINK,
      { kind: 'thinking', index: 0, text: 'more' } as TurnStepChunk,
      { kind: 'stop', stopReason: 'tool_use', usage: null },
      { kind: 'tool', index: 2, id: 'tu0', name: 'Read' },
      { kind: 'input', index: 2, json: '{}' },
    ]
    world(on, () => chunks, 1)
    await $.session.start(START)

    const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort: 'max' })
    await s.next()
    await s.next()
    expect(await svgOf($)).toContain('max · 0s')
    await clock.advance(2000)
    expect(await svgOf($)).toContain('max · 2s')
    for await (const _ of s) void _
    await s.result
    // Tool input then tool use: nothing lit.
    expect(await svgOf($)).toBeUndefined()

    // A step that names no effort keeps the last one.
    chunks = [TEXT]
    const r = $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 })
    await r.next()
    expect(await svgOf($)).toContain('max · 0s')
    for await (const _ of r) void _

    // A numeric budget reads as its number.
    chunks = [THINK]
    await think($, 20_000)
    expect(await svgOf($)).toContain('20000 · 0s')
  })

  test('a subagent step passes through without touching the band', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [THINK])
    await $.session.start(START)
    const s = $.turn.step({ turnId: 'a1', index: 0, model: 'claude-haiku-5', messageCount: 1, agentId: 'ag1', effort: 'low' })
    expect((await s.next()).value).toMatchObject({ kind: 'thinking' })
    expect(await svgOf($)).toBeUndefined()
    for await (const _ of s) void _
  })
})

describe('drawing', () => {
  test('the band sizes to the rows and columns it gets, and steps aside for a survey', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [THINK])
    await $.session.start(START)
    await think($, 'low')

    const term = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...band({ maxRows: 6, bodyColumns: 0 }) })
    expect((await term.find({ type: 'Client' }))?.props).toMatchObject({ width: 78, height: 2 })
    await term.unmount()
    const narrow = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...band({ bodyColumns: 20 }) })
    expect((await narrow.find({ type: 'Client' }))?.props).toMatchObject({ width: 28, height: 3 })
    await narrow.unmount()
    let desk = await $.ui.mount({ plugin: 'aurora', surface: 'desktop', ...band({ maxRows: 6 }) })
    expect((await desk.find({ type: 'Svg' }))?.props.height).toBe(56)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Aurora: the model is thinking at low effort, 0 seconds.')
    await desk.unmount()
    desk = await $.ui.mount({ plugin: 'aurora', surface: 'desktop', ...band({ hasSurvey: true }) })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    expect(await desk.find({ key: 'engine' })).toBeDefined()
    await desk.unmount()
  })

  test('a refused write lands on the next tick, even with nothing changed', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [THINK])
    let isFrozen = false
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'frozen' } : next(e)))
    await $.session.start(START)
    isFrozen = true
    await think($)
    expect(await svgOf($)).toBeUndefined()
    isFrozen = false
    // Half a second on, still the same second on the label: the same snapshot.
    await clock.advance(500)
    expect(await svgOf($)).toContain('>thinking<')
  })

  test('a state that refuses writes never breaks the stream, the turn or the timer', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [THINK, TEXT], 1)
    on('state.set', () => ({ deny: 'frozen' }))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    const seen: string[] = []
    let n = await s.next()
    for (; !n.done; n = await s.next()) seen.push(n.value.kind)
    expect(seen).toEqual(['thinking', 'text'])
    // What beneath returned comes through whole.
    expect(n.value.toolUses).toHaveLength(1)
    const spin = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...spinner('thinking') })
    await spin.unmount()
    await clock.advance(500)
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: '' })
  })
})
