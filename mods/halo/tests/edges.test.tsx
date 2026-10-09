import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { moodOf } from '../hooks/mood.ts'

function basics(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

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

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 90, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }
const STEP = { turnId: 't1', index: 0, model: 'm', messageCount: 1 }
const DONE = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }

describe('mood edges', () => {
  test('an MCP tool shows its server and name; the spinner words map to labels', async () => {
    const base = { now: 10_000, isWorking: true, isWaiting: false }
    expect(moodOf({ ...base, tool: 'mcp__github__get_issue' }).label).toBe('github·get_issue')
    expect(moodOf({ ...base, phase: 'responding' }).label).toBe('writing')
    expect(moodOf({ ...base, phase: 'tool-input' }).label).toBe('calling a tool')
    expect(moodOf({ ...base, spinner: { mode: 'tool-use', at: 9000 } }).label).toBe('calling a tool')
    expect(moodOf({ ...base, spinner: { mode: 'requesting', at: 9000 } }).label).toBe('requesting')
  })
})

describe('register edges', () => {
  test('the model stream moves the line: thinking, writing, calling a tool', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.step', async function* () {
      yield { kind: 'thinking' as const, index: 0, text: 'hm' }
      yield { kind: 'thinking' as const, index: 0, text: 'more' }
      yield { kind: 'text' as const, index: 1, text: 'ok' }
      yield { kind: 'tool' as const, index: 2, id: 'tu1', name: 'Read' }
      yield { kind: 'input' as const, index: 2, json: '{}' }
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
      return DONE as never
    })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const desk = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND })
    const alt = async () => String((await desk.find({ type: 'Svg' }))?.props.alt)
    const stream = $.turn.step(STEP)
    expect((await stream.next()).value).toMatchObject({ kind: 'thinking' })
    expect(await alt()).toBe('Halo: thinking')
    await stream.next()
    await stream.next()
    expect(await alt()).toBe('Halo: writing')
    await stream.next()
    expect(await alt()).toBe('Halo: calling a tool')
    await stream.next()
    await stream.next()
    expect((await stream.next()).done).toBe(true)
    // The step is over: the next tick of the timer falls back to requesting.
    await clock.advance(400)
    expect(await alt()).toBe('Halo: requesting')
    // A subagent's step and turn leave the main loop's line alone.
    for await (const c of $.turn.step({ ...STEP, agentId: 'ag1' })) void c
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'ag1' })
    expect(await alt()).toBe('Halo: requesting')
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await alt()).toBe('Halo: idle')
    await desk.unmount()
  })

  test('two tools at once: the newest names the line', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    on('tool.call', async () => {
      await clock.sleep(1000)
      return { result: {} }
    })
    await $.session.start(START)
    const desk = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    const a = $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await clock.advance(10)
    const b = $.tool.call({ tool: 'Grep', pattern: 'x' })
    await clock.advance(10)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Halo: Grep')
    // No measured width: 80 columns, 77 cells of 8 px.
    expect((await desk.find({ type: 'Svg' }))?.props.width).toBe(608)
    await clock.advance(1000)
    await Promise.all([a, b])
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Halo: idle')
    await desk.unmount()
  })

  test('a denied call flashes the failure too', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ deny: 'no' }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }).catch(() => undefined)
    const desk = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Halo: tool failed')
    await desk.unmount()
  })

  test('a stored hide is restored; the command toggles; the terminal ✕ hides', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on, { isHidden: true })
    basics(on)
    await $.session.start(START)
    const term = await $.ui.mount({ plugin: 'halo', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    expect((await $.command.run({ command: 'halo', args: '', ...RUN })).text).toBe('Halo shown.')
    expect(await term.find({ type: 'Client' })).toBeDefined()
    await term.press({ key: 'halo-hide' })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    expect((await $.command.run({ command: 'halo', args: '', ...RUN })).text).toBe('Halo shown.')
    expect((await $.command.run({ command: 'halo', args: '', ...RUN })).text).toBe('Halo hidden. /halo brings it back.')
    await term.unmount()
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
    await $.session.start(START)
    expect((await $.command.run({ command: 'halo', args: '', ...RUN })).text).toMatch(/hidden/)
    const desk = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
  })

  test('before the session starts, and under a survey, nothing is drawn', async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    basics(on)
    const early = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND })
    expect(await early.find({ type: 'Svg' })).toBeUndefined()
    await early.unmount()
    await $.session.start(START)
    const survey = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
  })

  test('publishes that fail are dropped: the timer and the stream', async ($, on) => {
    const clock = handClock(on)
    mock.store(on)
    basics(on)
    on('turn.step', async function* () {
      yield { kind: 'thinking' as const, index: 0, text: 'hm' }
      return DONE as never
    })
    await $.session.start(START)
    // The timer's tick finds the clock gone.
    clock.script = [true]
    clock.ticks.shift()?.()
    await flush()
    expect(clock.script).toHaveLength(0)
    // The step's publishes (on start and on its first chunk) find it gone.
    clock.script = [true, true]
    const chunks: string[] = []
    for await (const c of $.turn.step(STEP)) chunks.push(c.kind)
    await flush()
    expect(clock.script).toHaveLength(0)
    expect(chunks).toEqual(['thinking'])
  })

  test('a tool call goes through when the clock fails before or after it', async ($, on) => {
    const clock = handClock(on)
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ result: { ok: 1 } }))
    await $.session.start(START)
    // The closing publish (third clock read) fails: the result stands.
    clock.script = [false, false, true]
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/a' })).result).toEqual({ ok: 1 })
    await flush()
    // The first read fails: the hook's catch passes the call on.
    clock.script = [true]
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/b' })).result).toEqual({ ok: 1 })
  })
})
