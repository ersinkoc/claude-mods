import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { addDays, dayKey } from '../hooks/calc.ts'

const PANE_ID = 'kz-tokenomics'
const PANE = {
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: { title: 'KOZMOS · Tokenomics', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)
const HOUR = 3600_000
const DAY = 86_400_000

const USAGE = { model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Usage = { startedAt: number; cost?: number }

/** The session beneath the plugin: start, command, usage (read through `u`), turns. */
function world(on: On, u: () => Usage | undefined): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    const v = u()
    if (!v) return { deny: 'no usage' }
    return {
      value: {
        startedAt: v.startedAt, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [],
        ...(v.cost === undefined ? {} : { cost: { usd: v.cost } }),
      },
    }
  })
}

/** A store in memory the test can read back. */
function memStore(on: On, init: Record<string, unknown> = {}): Map<string, unknown> {
  const m = new Map<string, unknown>(Object.entries(init))
  on('store.get', ($, e) => ({ value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  return m
}

describe('command', () => {
  test('/tokenomics opens the pane, then closes it', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => ({ startedAt: T0 }))
    let isOpen = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: isOpen ? [{ id: PANE_ID, title: 'Tokenomics', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      isOpen = true
      return { value: { isPlaced: true } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      isOpen = false
      return { value: undefined }
    })
    await $.session.start(START)
    expect((await $.command.run({ command: 'tokenomics', args: '', ...RUN }))?.text).toBe('Tokenomics open.')
    expect((await $.command.run({ command: 'tokenomics', args: '', ...RUN }))?.text).toBe('Tokenomics closed.')
    expect(calls).toEqual([`open ${PANE_ID} KOZMOS · Tokenomics`, `close ${PANE_ID}`])
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => ({ startedAt: T0 }))
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start(START)
    await clock.settle()
    expect(opened).toEqual([PANE_ID])
  })
})

describe('ledger across restarts', () => {
  test('a reload of the same session keeps the ledger; another session starts fresh', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    let startedAt = T0
    world(on, () => ({ startedAt }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
    })
    await $.session.start(START)
    const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of s) void _
    await s.result

    await $.session.start(START)
    let ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 requests/ })).toBeDefined()
    await ui.unmount()

    startedAt = T0 + 1000
    await $.session.start(START)
    ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /no request priced yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 requests/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('daily book', () => {
  test('cost is booked once per growth; seen sessions older than three days are dropped', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    let cost = 2
    world(on, () => ({ startedAt: T0 - HOUR, cost }))
    const store = memStore(on, {
      seen: { old: { usd: 5, at: T0 - 5 * DAY }, recent: { usd: 1, at: T0 - HOUR }, gone: null },
      days: 'not an object',
    })
    await $.session.start(START)
    const today = dayKey(T0)
    expect(store.get('days')).toEqual({ [today]: 2 })
    expect(store.get('seen')).toEqual({ recent: { usd: 1, at: T0 - HOUR }, [String(T0 - HOUR)]: { usd: 2, at: T0 } })

    cost = 2.5
    await clock.advance(3000)
    expect(store.get('days')).toEqual({ [today]: 2.5 })
    // No growth, nothing booked.
    await clock.advance(3000)
    expect(store.get('days')).toEqual({ [today]: 2.5 })
  })

  test('a store that refuses reads and writes leaves the pane at zero', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on, () => ({ startedAt: T0 - HOUR, cost: 3 }))
    on('store.get', () => ({ deny: 'locked' }))
    on('store.set', () => ({ deny: 'locked' }))
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /\$3\.00/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /today \$0\.00/ })).toBeDefined()
    await ui.unmount()
  })

  test('the day rolls over at local midnight', async ($, on) => {
    const eve = new Date(T0)
    eve.setHours(23, 59, 58, 0)
    const clock = mock.clock(on, { now: eve.getTime() })
    world(on, () => ({ startedAt: eve.getTime() - HOUR, cost: 1.25 }))
    memStore(on)
    await $.session.start(START)
    let ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /today \$1\.25/ })).toBeDefined()
    await ui.unmount()

    await clock.advance(3000)
    expect(dayKey(clock.now())).toBe(addDays(dayKey(eve.getTime()), 1))
    ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /today \$0\.00/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /7d \$1\.25 · 14d \$1\.25/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('pace', () => {
  test('the pace is the session average at first, then the burn of the last half hour', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    // $12/h since T0, on a session that started an hour before at no cost.
    world(on, () => ({ startedAt: T0 - HOUR, cost: 0.01 + ((clock.now() - T0) / HOUR) * 12 }))
    await $.session.start(START)
    let ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /<\$0\.01\/h|\$0\.01\/h/ })).toBeDefined()
    await ui.unmount()

    await clock.advance(6 * 60_000)
    ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /\$12\.00\/h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next hour ≈ \$12\.00/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('turns', () => {
  test('subagent turns, steps without usage and a turn end without a start', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    let cost: number | undefined
    world(on, () => ({ startedAt: T0, cost }))
    let withUsage = true
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
        usage: withUsage ? { ...USAGE, model: '' } : null,
      }
    })
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)

    // The usage names no model: the step's own model is booked.
    let s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
    withUsage = false
    s = $.turn.step({ turnId: 't1', index: 1, model: 'claude-sonnet-5', messageCount: 2 })
    for await (const _ of s) void _
    await s.result

    // A subagent's turn ends: the main loop is still idle, nothing counted.
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'ag1' })
    // A main turn ends that never started here: no turn counted, cost unknown kept.
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

    const ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Sonnet 5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 turns · 1 requests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / est\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ idle/ })).toBeDefined()
    await ui.unmount()
  })

  test('a usage reading that fails keeps the last one', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    let usage: Usage | undefined = { startedAt: T0, cost: 0.75 }
    world(on, () => usage)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    usage = undefined
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    const ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /◆ \$0\.75/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 turns/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /last \$0\.00/ })).toBeDefined()
    await ui.unmount()
  })

  test('a session that started before the usage could be read starts a fresh ledger', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => undefined)
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /no request priced yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('turn hooks with nothing beneath fall through their catch', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => ({ startedAt: T0 }))
    await $.session.start(START)
    await expect($.turn.start({ text: 'hi', turnId: 't1' })).rejects.toThrow()
    await expect($.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).rejects.toThrow()
  })
})

describe('state failures', () => {
  test('a state that cannot be read or written never breaks the collector; the refused write lands later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let cost = 1
    world(on, () => ({ startedAt: T0 - HOUR, cost }))
    let isFrozen = true
    on('state.get', ($, e, next) => (isFrozen ? { deny: 'no state' } : next(e)))
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'no state' } : next(e)))
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    cost = 2
    expect((await $.command.run({ command: 'tokenomics', args: '', ...RUN }))?.text).toBe('Tokenomics open.')
    cost = 3
    await clock.advance(3000)
    cost = 4
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: '' })
    // Nothing changes from here, yet the next sample writes what was refused.
    isFrozen = false
    expect((await $.command.run({ command: 'tokenomics', args: '', ...RUN }))?.text).toBe('Tokenomics open.')
    const ui = await $.ui.mount({ plugin: 'tokenomics', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /◆ \$4\.00/ })).toBeDefined()
    await ui.unmount()
  })
})
