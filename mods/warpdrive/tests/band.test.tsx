import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepChunk } from 'claude-code'

const BAND = (maxRows: number, bodyColumns = 100, isWorking = true) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const DONE = { answer: 'done', isAborted: false, reason: 'answer' as const }

function engine(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
}

/** A turn.step beneath the plugin: each request streams `chunks[turnId]` and reports `out[turnId]` output tokens (null: no usage). */
function steps(on: On, chunks: Record<string, TurnStepChunk[]>, out: Record<string, number | null>): void {
  on('turn.step', async function* ($, e) {
    for (const c of chunks[e.turnId] ?? []) yield c
    const n = out[e.turnId]
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: n === null || n === undefined ? null : { input_tokens: 1, output_tokens: n, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
    }
  })
}

async function step($: Engine, turnId: string, agentId?: string): Promise<void> {
  for await (const c of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })) void c
}

describe('before and around a session', () => {
  test('nothing published yet: the band draws nothing', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20) })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test('a stored hide holds across sessions; the command toggles it', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { hidden: true })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const hidden = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20) })
    expect(await hidden.find({ type: 'Client' })).toBeUndefined()
    await hidden.unmount()
    expect((await $.command.run({ command: 'warpdrive', args: '', ...RUN })).text).toBe('Warpdrive engaged.')
    expect((await $.command.run({ command: 'warpdrive', args: '', ...RUN })).text).toBe('Warpdrive hidden.')
    expect((await $.command.run({ command: 'warpdrive', args: '', ...RUN })).text).toBe('Warpdrive engaged.')
    const shown = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20) })
    expect(await shown.find({ type: 'Client', key: 'warpdrive' })).toBeDefined()
    await shown.unmount()
  })

  test('a stored value that is not a switch is ignored; without a store the toggle holds for the session', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    engine(on)
    on('store.get', () => ({ value: 'yes' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    // No store.set beneath: the write fails quietly.
    expect((await $.command.run({ command: 'warpdrive', args: '', ...RUN })).text).toBe('Warpdrive hidden.')
    const ui = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20) })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('an unreadable store leaves the band shown', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20) })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the engines', () => {
  test('text, thinking and tool input stream tokens; the usage tops up what did not stream', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on)
    steps(on, {
      a: [{ kind: 'thinking', index: 0, text: 't'.repeat(400) }, { kind: 'input', index: 1, json: 'j'.repeat(400) }, { kind: 'tool', index: 1, id: 'tu', name: 'Read' }],
      b: [{ kind: 'text', index: 0, text: 'x'.repeat(800) }],
      c: [],
    }, { a: 1000, b: 50, c: null })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // A request before any turn feeds the meter but not the turn's count.
    await step($, 'c', 'early-agent')
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step($, 'a') // 200 streamed, 1000 reported
    await step($, 'b') // 200 streamed, 50 reported
    await step($, 'c', 'ag-1') // nothing
    await clock.advance(500)
    const desk = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20) })
    const svg = await desk.find({ type: 'Svg' })
    expect(String(svg?.props.alt)).toMatch(/^Warp \d\.\d: 400 output tokens per second, 1\.2k this turn$/)
    await desk.unmount()

    // A subagent's turn ending is no arrival.
    await $.turn.complete({ ...DONE, durationMs: 1000, turnId: 'a1', agentId: 'ag-1' })
    await clock.advance(500)
    const still = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20) })
    expect(String((await still.find({ type: 'Svg' }))?.props.alt)).toMatch(/^Warp/)
    await still.unmount()

    // The usage the turn reports wins when it is larger.
    await $.turn.complete({ ...DONE, durationMs: 9000, turnId: 't1', usage: { input_tokens: 1, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never)
    await clock.advance(500)
    const landed = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20, 100, false) })
    expect((await landed.find({ type: 'Svg' }))?.props.alt).toBe('⇢ arrived · 9s · 5.0k tok')
    await landed.unmount()

    // A second complete with no turn running changes nothing.
    await $.turn.complete({ ...DONE, durationMs: 1, turnId: 't1' })
  })

  test('an aborted turn drops out of warp', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(3000)
    await $.turn.complete({ ...DONE, isAborted: true, durationMs: 3000, turnId: 't1' })
    await clock.advance(500)
    const ui = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20, 100, false) })
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ label: '⇢ dropped out · 3s · 0 tok', flashSeq: 1, isWorking: false })
    await ui.unmount()
  })

  test('a state that never settles: the publishes give up quietly', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let stale = false
    on('state.get', ($, e, next) => (stale && e.key === 'snap' ? { value: { value: null, version: 1 } } : next(e)))
    on('state.set', ($, e, next) => (stale && e.key === 'snap' ? { value: { isSet: false as const, version: 2 } } : next(e)))
    engine(on)
    stale = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await $.turn.start({ text: 'go', turnId: 't1' })).turnId).toBe('t1')
    await clock.advance(1000) // the tick's publish (a new second on the HUD) fails too
    expect((await $.turn.complete({ ...DONE, durationMs: 10, turnId: 't1' })).text).toBe('done')
    await clock.settle()
  })

  test('a snapshot that could not be written is written on the next tick, even unchanged', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let stale = true
    let writes = 0
    on('state.get', ($, e, next) => (stale && e.key === 'snap' ? { value: { value: null, version: 1 } } : next(e)))
    on('state.set', ($, e, next) => {
      if (e.key !== 'snap') return next(e)
      if (stale) return { value: { isSet: false as const, version: 2 } }
      writes++
      return next(e)
    })
    engine(on)
    // Idle the whole time, so every snapshot is the same one.
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    stale = false
    await clock.advance(500)
    expect(writes).toBe(1)
    await clock.advance(500)
    expect(writes).toBe(1)
  })
})

describe('the band', () => {
  test('rows follow the room; the terminal width follows the body', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(500)
    for (const [maxRows, cols, rows, width] of [[20, 100, 4, 97], [8, 0, 3, 77], [3, 10, 2, 20]] as const) {
      const ui = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(maxRows, cols) })
      const client = await ui.find({ type: 'Client', key: 'warpdrive' })
      expect([client?.props.height, client?.props.width]).toEqual([rows, width])
      await ui.unmount()
    }
    for (const [surface, maxRows, height] of [['desktop', 8, 66], ['vscode', 20, 84], ['mobile', 20, 84]] as const) {
      const ui = await $.ui.mount({ plugin: 'warpdrive', surface, ...BAND(maxRows) })
      expect((await ui.find({ type: 'Svg' }))?.props.height).toBe(height)
      await ui.unmount()
    }
  })
})
