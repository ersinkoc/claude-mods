import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { addDays } from '../hooks/calc.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-mosaic',
  props: { title: 'KOZMOS · Mosaic', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const END = { reason: 'other' as const, sessionId: 's1', resume: { id: 's1' } }
const DONE = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }

// Friday 2026-10-09, 13:00 local.
const T0 = new Date(2026, 9, 9, 13, 0, 0).getTime()
const TODAY = '2026-10-09'
const DAY = 86_400_000
const zero = { s: 0, t: 0, c: 0, k: 0, u: 0, m: 0 }

type Usage = { startedAt: number; cost?: number }

/** The session beneath the plugin: start, command, usage (read through `u`; undefined refuses it). */
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

/** A store in memory the test reads back; keys in `refuseGet` / `refuseSet` are refused. */
function memStore(on: On, init: Record<string, unknown> = {}) {
  const st = { data: new Map<string, unknown>(Object.entries(init)), refuseGet: new Set<string>(), refuseSet: new Set<string>(), sets: [] as string[] }
  on('store.get', ($, e) => (st.refuseGet.has(e.key) ? { deny: 'locked' } : { value: st.data.get(e.key) }))
  on('store.set', ($, e) => {
    if (st.refuseSet.has(e.key)) return { deny: 'locked' }
    st.sets.push(e.key)
    st.data.set(e.key, e.value)
    return { value: undefined }
  })
  return st
}

const daysOf = (st: { data: Map<string, unknown> }) => st.data.get('days') as Record<string, typeof zero> | undefined

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

describe('command and options', () => {
  test('/mosaic opens the pane and books what is pending, then closes it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => ({ startedAt: T0 }))
    let isOpen = false
    const calls: string[] = []
    on('ui.panes', () => ({
      value: [
        { id: 'kz-other', title: 'Other', isShown: true, isFocused: false, isPlaced: true },
        ...(isOpen ? [{ id: 'kz-mosaic', title: 'KOZMOS · Mosaic', isShown: true, isFocused: false, isPlaced: true }] : []),
      ],
    }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      isOpen = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      isOpen = false
      return { value: undefined }
    })
    on('tool.call', () => ({ result: 'ok' }))

    await $.session.start(START)
    expect(store.data.get('sessions')).toEqual([String(T0)])
    expect(daysOf(store)).toEqual({ [TODAY]: { ...zero, s: 1 } })

    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    expect((await $.command.run({ command: 'mosaic', args: '', ...RUN })).text).toBe('Mosaic open.')
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, c: 1, m: 1 })

    // The same minute is active once; closing writes nothing.
    await $.tool.call({ tool: 'Read', file_path: '/work/b.ts' })
    expect((await $.command.run({ command: 'mosaic', args: '', ...RUN })).text).toBe('Mosaic closed.')
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, c: 1, m: 1 })
    expect(calls).toEqual(['open kz-mosaic KOZMOS · Mosaic', 'close kz-mosaic'])

    // The 10 s flush books the rest.
    await clock.advance(10_000)
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, c: 2, m: 1 })
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => ({ startedAt: T0 }))
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(`${e.id} ${e.title}`)
      return { value: { isPlaced: true as const } }
    })
    await $.session.start(START)
    expect(opened).toEqual(['kz-mosaic KOZMOS · Mosaic'])
  })

  test('the stored metric comes back; an unknown or unreadable one leaves turns', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on, { metric: 'bogus', sessions: [String(T0)] })
    world(on, () => ({ startedAt: T0 }))
    const header = async () => {
      const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
      const t = (await ui.find({ type: 'Text', text: /◆ MOSAIC · / }))?.text
      await ui.unmount()
      return t
    }
    await $.session.start(START)
    expect(await header()).toBe('◆ MOSAIC · turns')
    store.data.set('metric', 3)
    await $.session.start(START)
    expect(await header()).toBe('◆ MOSAIC · turns')
    store.data.set('metric', 'tools')
    store.refuseGet.add('metric')
    await $.session.start(START)
    expect(await header()).toBe('◆ MOSAIC · turns')
    store.refuseGet.clear()
    await $.session.start(START)
    expect(await header()).toBe('◆ MOSAIC · tools')
  })

  test('the metric buttons switch the calendar and remember the choice', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on, { sessions: [String(T0)] })
    world(on, () => ({ startedAt: T0 }))
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => [b.props.label, b.props.hotkey])).toEqual([['turns', '1'], ['tools', '2'], ['tokens', '3'], ['$', '4']])
    expect((await ui.find({ type: 'Button', key: 'm-turns' }))?.props.variant).toBe('primary')
    expect((await ui.find({ type: 'Button', key: 'm-tools' }))?.props.variant).toBe('secondary')
    for (const [key, label, stored] of [['m-tools', 'tools', 'tools'], ['m-tokens', 'tokens', 'tokens'], ['m-usd', '$', 'usd']] as const) {
      await $.ui.press({ plugin: 'mosaic', key, surface: 'terminal' })
      expect(await ui.find({ type: 'Text', text: `◆ MOSAIC · ${label}` })).toBeDefined()
      expect((await ui.find({ type: 'Button', key }))?.props.variant).toBe('primary')
      expect((await ui.find({ type: 'Button', key }))?.props.dimColor).toBe(false)
      expect(store.data.get('metric')).toBe(stored)
    }
    // A store that refuses the write still switches the calendar.
    store.refuseSet.add('metric')
    await $.ui.press({ plugin: 'mosaic', key: 'm-turns', surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '◆ MOSAIC · turns' })).toBeDefined()
    expect(store.data.get('metric')).toBe('usd')
    await ui.unmount()
  })
})

describe('counting', () => {
  test('a session already counted is not counted again', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on, { sessions: ['1', String(T0)] })
    world(on, () => ({ startedAt: T0 }))
    await $.session.start(START)
    expect(store.sets).toEqual([])
    expect(store.data.get('sessions')).toEqual(['1', String(T0)])
  })

  test('a session list that is not a list starts over; the list keeps the last 100', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on, { sessions: { odd: true } })
    let startedAt = T0
    world(on, () => ({ startedAt }))
    await $.session.start(START)
    expect(store.data.get('sessions')).toEqual([String(T0)])
    expect(daysOf(store)?.[TODAY]?.s).toBe(1)

    store.data.set('sessions', Array.from({ length: 100 }, (_, i) => `id${i}`))
    startedAt = T0 + 1
    await $.session.start(START)
    const ids = store.data.get('sessions') as string[]
    expect(ids.length).toBe(100)
    expect(ids[0]).toBe('id1')
    expect(ids[99]).toBe(String(T0 + 1))
    expect(daysOf(store)?.[TODAY]?.s).toBe(2)
  })

  test('an unreadable session list or spend mark reads as empty', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => ({ startedAt: T0, cost: 1 }))
    store.refuseGet.add('sessions')
    store.refuseGet.add('seen')
    await $.session.start(START)
    expect(store.data.get('sessions')).toEqual([String(T0)])
    expect(store.data.get('seen')).toEqual({ [String(T0)]: { usd: 1, at: T0 } })
    expect(daysOf(store)).toEqual({ [TODAY]: { ...zero, s: 1, u: 1 } })
  })

  test('no usage: the session is not counted and nothing is written', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => undefined)
    await $.session.start(START)
    expect(store.sets).toEqual([])
    const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /0 sessions/ })).toBeDefined()
    await ui.unmount()
  })

  test('turns, steps, tool calls and minutes land on the day', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => ({ startedAt: T0 }))
    let hasUsage = true
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
        usage: hasUsage ? { model: e.model, input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500 } : null,
      }
    })
    on('tool.call', () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))

    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void c
    hasUsage = false
    for await (const c of $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 2 })) void c
    await $.tool.call({ tool: 'Grep', pattern: 'x' })
    // While working, each flush counts its minute: 13:00 and 13:01.
    await clock.advance(60_000)
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, c: 1, k: 10_000, m: 2 })

    // A subagent's turn is not a turn, and the work goes on.
    expect(await $.turn.complete({ ...DONE, agentId: 'a1' })).toEqual({ text: '' })
    await clock.advance(60_000)
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, c: 1, k: 10_000, m: 3 })

    expect(await $.turn.complete(DONE)).toEqual({ text: '' })
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, t: 1, c: 1, k: 10_000, m: 3 })
    // Idle: the flushes count no more minutes.
    await clock.advance(120_000)
    expect(daysOf(store)?.[TODAY]?.m).toBe(3)
  })

  test('the day rolls over at local midnight', async ($, on) => {
    const eve = new Date(2026, 9, 9, 23, 59, 30).getTime()
    const clock = mock.clock(on, { now: eve })
    const store = memStore(on)
    world(on, () => ({ startedAt: eve }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.advance(60_000)
    await $.tool.call({ tool: 'Read', file_path: '/work/b.ts' })
    await clock.advance(10_000)
    expect(daysOf(store)).toEqual({
      [TODAY]: { ...zero, s: 1, c: 1, m: 1 },
      '2026-10-10': { ...zero, c: 1, m: 1 },
    })
    const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
    const all = await texts(ui)
    expect(all).toContain('▲ 2-day streak')
    expect(all).toContain('0 turns · 1 tools · 0 tok · $0.00 · 1m · 0 sess.')
    await ui.unmount()
  })

  test('the session’s spend is booked by its growth; old marks are dropped', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on, {
      sessions: [String(T0)],
      seen: { old: { usd: 5, at: T0 - 4 * DAY }, recent: { usd: 1, at: T0 - DAY }, [String(T0)]: { usd: 2, at: T0 - 1000 }, gone: null },
    })
    let cost: number | undefined = 2.5
    world(on, () => ({ startedAt: T0, cost }))
    await $.session.start(START)
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, u: 0.5 })
    expect(store.data.get('seen')).toEqual({ recent: { usd: 1, at: T0 - DAY }, [String(T0)]: { usd: 2.5, at: T0 } })

    // A total that fell (a cleared session) is booked whole.
    cost = 1
    await clock.advance(10_000)
    expect(daysOf(store)?.[TODAY]?.u).toBe(1.5)
    // No growth, no cost, a zero cost: nothing booked.
    for (const c of [1, undefined, 0]) {
      cost = c
      await clock.advance(10_000)
    }
    expect(daysOf(store)?.[TODAY]?.u).toBe(1.5)
    expect((store.data.get('seen') as Record<string, { usd: number }>)[String(T0)]?.usd).toBe(1)
  })
})

describe('refusals', () => {
  test('a refused spend mark books nothing; the spend is booked once when the store takes it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on, { sessions: [String(T0)] })
    world(on, () => ({ startedAt: T0, cost: 1 }))
    store.refuseSet.add('seen')
    await $.session.start(START)
    expect(daysOf(store)).toBeUndefined()
    store.refuseSet.clear()
    await clock.advance(10_000)
    await clock.advance(10_000)
    expect(daysOf(store)?.[TODAY]?.u).toBe(1)
  })

  test('a refused day write keeps the counts, drawn meanwhile, until the store takes them', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => ({ startedAt: T0 }))
    on('tool.call', () => ({ result: 'ok' }))
    store.refuseSet.add('days')
    await $.session.start(START)
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.advance(10_000)
    expect(daysOf(store)).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: '0 turns · 1 tools · 0 tok · $0.00 · 1m · 1 sess.' })).toBeDefined()
    await ui.unmount()
    store.refuseSet.clear()
    await clock.advance(10_000)
    expect(daysOf(store)).toEqual({ [TODAY]: { ...zero, s: 1, c: 1, m: 1 } })
  })

  test('an unreadable history is never written over', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const yesterday = addDays(TODAY, -1)
    const store = memStore(on, { days: { [yesterday]: { ...zero, t: 5 } } })
    world(on, () => ({ startedAt: T0 }))
    store.refuseGet.add('days')
    await $.session.start(START)
    expect(store.sets).toEqual(['sessions'])
    expect(daysOf(store)).toEqual({ [yesterday]: { ...zero, t: 5 } })
    store.refuseGet.clear()
    await clock.advance(10_000)
    expect(daysOf(store)).toEqual({ [yesterday]: { ...zero, t: 5 }, [TODAY]: { ...zero, s: 1 } })
  })

  test('a state that refuses writes never breaks the counting; the refused picture lands later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const store = memStore(on)
    world(on, () => ({ startedAt: T0 }))
    let isFrozen = true
    on('state.get', ($, e, next) => (isFrozen ? { deny: 'no state' } : next(e)))
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'no state' } : next(e)))
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true as const } }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.start(START)
    await clock.advance(10_000)
    expect((await $.command.run({ command: 'mosaic', args: '', ...RUN })).text).toBe('Mosaic open.')
    expect(await $.turn.complete(DONE)).toEqual({ text: '' })
    expect(await $.session.end(END)).toEqual({ sessionId: 's1' })
    expect(daysOf(store)?.[TODAY]).toEqual({ ...zero, s: 1, t: 1, m: 1 })
    // Nothing changes from here, yet the next flush draws what was refused.
    isFrozen = false
    await clock.advance(10_000)
    const ui = await $.ui.mount({ plugin: 'mosaic', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: '1 turns · 0 tools · 0 tok · $0.00 · 1m · 1 sess.' })).toBeDefined()
    await ui.unmount()
  })

  test('observers with nothing beneath fall through their catch', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => ({ startedAt: T0 }))
    await $.session.start(START)
    await expect($.turn.start({ text: 'hi', turnId: 't1' })).rejects.toThrow()
    await expect($.tool.call({ tool: 'Read', file_path: '/work/a.ts' })).rejects.toThrow()
    await expect($.turn.complete(DONE)).rejects.toThrow()
    await expect($.session.end(END)).rejects.toThrow()
  })
})

describe('flushes', () => {
  test('a flush asked for while one runs waits for it, so neither writes over the other', async ($, on) => {
    mock.clock(on, { now: T0 })
    const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout
    const tick = () => new Promise<void>(r => later(r, 20))
    const data = new Map<string, unknown>()
    let gate: Promise<void> | undefined
    let open = () => {}
    let reads = 0
    on('store.get', async ($, e) => {
      if (e.key === 'days') {
        reads++
        if (gate) await gate
      }
      return { value: data.get(e.key) }
    })
    on('store.set', ($, e) => {
      data.set(e.key, e.value)
      return { value: undefined }
    })
    world(on, () => ({ startedAt: T0 }))
    on('tool.call', () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.start(START)
    reads = 0

    // The end of the turn starts a flush that waits on the store...
    gate = new Promise<void>(r => (open = r))
    const ended = $.turn.complete(DONE)
    await tick()
    expect(reads).toBe(1)
    // ...a tool call lands meanwhile, and the session end asks for a flush of its own.
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    const closed = $.session.end(END)
    await tick()
    expect(reads).toBe(1)
    gate = undefined
    open()
    await ended
    await closed
    // The second flush ran after the first, from what the first had written.
    expect(reads).toBe(2)
    expect((data.get('days') as Record<string, typeof zero>)[TODAY]).toEqual({ ...zero, s: 1, t: 1, c: 1, m: 1 })
  })
})
