import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = (bodyColumns = 100, hasSurvey = false) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey, isWorking: false, maxRows: 8, bodyColumns, scroll: { offset: 0, bodyRows: 8 }, view: {} },
})
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const CTX = { tokens: 1, window: 1_000_000, percent: 10 }
const TURN = { answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' as const }

/** What every session here needs beneath the mod; `usage` answers $.session.usage when given. */
function engine(on: On, usage?: () => unknown): string[] {
  const toasts: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  if (usage) on('session.usage', () => ({ value: usage() as never }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  return toasts
}

const stats = async ($: Engine): Promise<string> => (await $.command.run({ command: 'clawdling', args: 'stats', ...RUN })).text ?? ''

describe('the store', () => {
  test('a stored XP that is not a count starts from zero', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { xp: 'lots' })
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await stats($)).toBe('🦀 Pinchy · Lv 1 · 0/100 XP (0 total) · streak 0 · next: 🎉 party hat at Lv 3')
  })

  test('a negative XP is clamped; a stored hide is honoured', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { xp: -50, hidden: true })
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await stats($)).toContain('(0 total)')
    const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    // Feeding a hidden crab brings it back.
    const fed = await $.command.run({ command: 'clawdling', args: 'Feed', ...RUN })
    expect(fed.text).toMatch(/^🦀 Pinchy: /)
    const back = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
    expect(await back.find({ type: 'Client', key: 'clawdling-crab' })).toBeDefined()
    await back.unmount()
  })

  test('without a store: XP from zero, kept in memory, saved again later', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    let sets = 0
    let failing = true
    on('store.get', () => {
      throw new Error('no store')
    })
    on('store.set', () => {
      sets++
      if (failing) throw new Error('read-only')
      return { value: undefined }
    })
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await clock.advance(1000) // the tick's save fails: still dirty
    await clock.advance(1000) // and tries again
    expect(sets).toBe(2)
    failing = false
    await clock.advance(1000)
    expect(sets).toBe(3)
    await clock.advance(1000) // saved: nothing more to write
    expect(sets).toBe(3)
    // The hide toggle still works for the session.
    expect((await $.command.run({ command: 'clawdling', args: '', ...RUN })).text).toBe('Pinchy went back to the sea. /clawdling brings them back.')
    expect(await stats($)).toContain('1/100 XP (1 total)')
  })
})

describe('growing up', () => {
  test('a level with no unlock toasts plainly; a fully dressed crab says so', { options: { name: '  Big   Red  ' } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { xp: 95 })
    const toasts = engine(on, () => ({ startedAt: 0, context: { tokens: 1, window: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 50 }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...TURN, turnId: 't1' })
    expect(toasts).toEqual(['🦀 Big Red reached Lv 2!'])
    expect(await stats($)).toBe('🦀 Big Red · Lv 2 · 5/200 XP (105 total) · streak 1 · next: 🎉 party hat at Lv 3')
  })

  test('at level 12 it wears everything', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { xp: 7000 })
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await stats($)).toBe('🦀 Pinchy · Lv 12 · 400/1200 XP (7000 total) · streak 0 · wearing 🎉 😎 🧣 👑 · fully dressed')
    const desk = await $.ui.mount({ plugin: 'clawdling', surface: 'desktop', ...BAND() })
    const src = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(src).toContain('🎉😎🧣👑')
    await desk.unmount()
  })

  test('five answered turns in a row start a dance; an error ends the streak', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (let i = 1; i <= 5; i++) {
      await $.turn.start({ text: 'go', turnId: `t${i}` })
      await $.turn.complete({ ...TURN, turnId: `t${i}` })
    }
    await clock.advance(1000)
    const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
    const crab = await ui.find({ type: 'Client', key: 'clawdling-crab' })
    expect(crab?.props.props).toMatchObject({ mood: 'dance', status: 'celebrating · 🔥5 · ctx 10% · next 🎉 Lv 3' })
    await ui.unmount()
    // A subagent's turn changes nothing; an error resets the streak.
    await $.turn.complete({ ...TURN, turnId: 'a1', agentId: 'ag' })
    expect(await stats($)).toContain('streak 5')
    await $.turn.start({ text: 'go', turnId: 't6' })
    await $.turn.complete({ ...TURN, reason: 'error', turnId: 't6' })
    expect(await stats($)).toContain('streak 0')
  })
})

describe('senses', () => {
  test('usage and measures: the 5-hour window, an unknown fill keeps the last one', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 95 }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const mood = async () => {
      const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
      const p = (await ui.find({ type: 'Client' }))?.props.props as { mood: string; status: string }
      await ui.unmount()
      return p
    }
    expect(await mood()).toMatchObject({ mood: 'sleepy', status: 'drowsy · ctx 10% · 5h 95% · next 🎉 Lv 3' })
    await $.session.measure({ context: { tokens: 1, window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }], changed: ['rateLimits'] })
    expect(await mood()).toMatchObject({ mood: 'idle', status: 'lounging · ctx 10% · 5h 20% · next 🎉 Lv 3' })
    await $.session.measure({ context: { tokens: 1, window: 1, percent: 0 }, rateLimits: [], changed: ['context'] })
    expect(await mood()).toMatchObject({ status: 'lounging · 5h 20% · next 🎉 Lv 3' })
    await clock.advance(11_000) // the usage poll reads 95% again; the next tick shows it
    expect(await mood()).toMatchObject({ mood: 'sleepy' })
  })

  test('an unreadable usage keeps the senses at rest', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(10_000)
    const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ mood: 'idle', status: 'lounging · next 🎉 Lv 3' })
    await ui.unmount()
  })

  test('tools: a subagent tool earns XP without scuttling; a denial stings', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    on('tool.call', ($, e) => (e.tool === 'Write' ? { deny: 'no' } : { result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a', agentId: 'ag' } as never)
    expect(await stats($)).toContain('(1 total)')
    await $.tool.call({ tool: 'Write', file_path: '/w/a', content: 'x' })
    await clock.advance(1000)
    expect(await stats($)).toContain('(1 total)')
    const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'desktop', ...BAND() })
    expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('is ouch')
    await ui.unmount()
  })
})

describe('failures never block', () => {
  test('a state that never settles: every publish gives up and the events still pass', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let stale = false
    on('state.get', ($, e, next) => (stale && e.key === 'snap' ? { value: { value: null, version: 1 } } : next(e)))
    on('state.set', ($, e, next) => (stale && e.key === 'snap' ? { value: { isSet: false as const, version: 2 } } : next(e)))
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    on('tool.call', ($, e) => (e.tool === 'Write' ? { deny: 'no' } : { result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    stale = true
    expect((await $.turn.start({ text: 'go', turnId: 't1' })).turnId).toBe('t1')
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/a' })).result).toBe('ok')
    expect((await $.tool.call({ tool: 'Write', file_path: '/w/a', content: 'x' })).deny).toBe('no')
    await clock.advance(9000) // the sting wears off: a tick publishes the change, and gives up too
    expect((await $.session.measure({ context: CTX, rateLimits: [], changed: ['context'] })).changed).toEqual(['context'])
    expect((await $.turn.complete({ ...TURN, turnId: 't1' })).text).toBe('ok')
    await clock.settle()
    expect(await stats($)).toContain('(11 total)')
  })

  test('a failing chain beneath is handed on', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a' })).rejects.toThrow()
    await expect($.turn.start({ text: 'go', turnId: 't1' })).rejects.toThrow()
    await expect($.turn.complete({ ...TURN, turnId: 't1' })).rejects.toThrow()
    await expect($.session.measure({ context: CTX, rateLimits: [], changed: ['context'] })).rejects.toThrow()
  })
})

describe('the band', () => {
  test('nothing before a session, under a survey, or hidden', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    const early = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND() })
    expect(await early.find({ type: 'Client' })).toBeUndefined()
    await early.unmount()
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const survey = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND(100, true) })
    expect(await survey.find({ type: 'Client' })).toBeUndefined()
    expect(await survey.find({ key: 'engine-band' })).toBeDefined()
    await survey.unmount()
  })

  test('sizes: the terminal crab follows the body; the card drops its status line when narrow', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    engine(on, () => ({ startedAt: 0, context: CTX, rateLimits: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const [cols, width] of [[0, 77], [20, 37], [120, 117]] as const) {
      const ui = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND(cols) })
      expect((await ui.find({ type: 'Client' }))?.props.width).toBe(width)
      await ui.unmount()
    }
    for (const [surface, cols, hasStatus] of [['desktop', 120, true], ['vscode', 40, false], ['mobile', 40, false]] as const) {
      const ui = await $.ui.mount({ plugin: 'clawdling', surface, ...BAND(cols) })
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(src.includes('lounging')).toBe(hasStatus)
      await ui.unmount()
    }
  })
})
