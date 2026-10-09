import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KZ } from '../hooks/lib/kz.ts'
import { THRIFT_NOTE, comparison, topLimit } from '../hooks/register.tsx'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const NOW = Date.parse('2030-01-01T00:00:00Z')

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type World = { limits: { now: Limit[]; fails: boolean }; seen: (readonly string[] | undefined)[]; toasts: string[] }

/**
 * Beneath thrift: limits read `limits.now` (or fail), prompts land in `seen`,
 * toasts in `toasts`; a store unless `store` is false; the clock is the test's.
 */
function world(on: On, opts: { store?: Record<string, unknown> | false; plain?: boolean } = {}): World {
  const w: World = { limits: { now: [], fails: false }, seen: [], toasts: [] }
  if (opts.store !== false) mock.store(on, opts.store ?? {})
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', ($, e, next) => (w.limits.fails ? next(e) : { value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: w.limits.now } }))
  if (!opts.plain) {
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('prompt.submit', ($, e) => {
      w.seen.push(e.context)
      return { text: e.text, context: e.context }
    })
  }
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return w
}

/** A world on the mocked clock. */
function mocked(on: On, opts: { store?: Record<string, unknown> | false; plain?: boolean } = {}): World & { clock: MockClock } {
  const clock = mock.clock(on, { now: NOW })
  return { ...world(on, opts), clock }
}

const thrift = async ($: Engine, args = ''): Promise<string> => String((await $.command.run({ command: 'thrift', args, ...CMD })).text)
const prompt = ($: Engine, text: string, context?: string[]) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...(context ? { context } : {}) } as never)
const mount = ($: Engine, surface: 'terminal' | 'desktop', props: Partial<typeof BAND.props> = {}) =>
  $.ui.mount({ plugin: 'thrift', surface, ...BAND, props: { ...BAND.props, ...props } })

/** A turn with model requests that cost what `steps` say (output tokens, and the usage's model). */
async function runTurn($: Engine, on: On, id: string, opts: { agentId?: string; completeId?: string } = {}): Promise<void> {
  await $.turn.start({ text: 'go', turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const c of stream) void c
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: opts.completeId ?? id, reason: 'answer', ...(opts.agentId ? { agentId: opts.agentId } : {}) })
}

/** turn.step answers: each call takes the next entry (output tokens, the usage's model; null for no usage). */
function steps(on: On, plan: ({ output: number; model: string } | null)[]): void {
  on('turn.step', async function* ($, e) {
    const p = plan.shift() ?? null
    yield { kind: 'text' as const, index: 0, text: 'ok' }
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const,
      usage: p ? { input_tokens: 0, output_tokens: p.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: p.model } : null,
    }
  })
}

describe('pure parts', () => {
  test('topLimit: a reset still ahead counts, a bad date counts, a lower window loses', async () => {
    const top = topLimit([
      { kind: 'five_hour', percentUsed: 50, resetsAt: '2030-01-01T01:00:00Z' },
      { kind: 'seven_day', percentUsed: 30, resetsAt: 'soon' },
    ], NOW)
    expect(top?.kind).toBe('five_hour')
    expect(topLimit([{ kind: 'seven_day', percentUsed: 30, resetsAt: 'soon' }], NOW)?.percentUsed).toBe(30)
    expect(topLimit([], NOW)).toBeNull()
  })

  test('comparison: more, less, or nothing when normal turns were free', async () => {
    expect(comparison({ thrift: { turns: 1, cost: 1.5 }, normal: { turns: 1, cost: 1 } })).toBe('thrift turns cost 50% more on average')
    expect(comparison({ thrift: { turns: 1, cost: 1 }, normal: { turns: 1, cost: 1 } })).toBe('thrift turns cost 0% less on average')
    expect(comparison({ thrift: { turns: 1, cost: 1 }, normal: { turns: 2, cost: 0 } })).toBeUndefined()
    expect(comparison({ thrift: { turns: 1, cost: 1 }, normal: { turns: 0, cost: 0 } })).toBeUndefined()
  })
})

describe('modes and the store', () => {
  test('a stored mode and a hidden band come back; /thrift show brings the band back', async ($, on) => {
    const w = mocked(on, { store: { mode: 'on', isHidden: true } })
    await $.session.start(START)
    await prompt($, 'x')
    expect(w.seen[0]).toContain(THRIFT_NOTE)
    let ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'thrift' })).toBeUndefined()
    await ui.unmount()
    expect(await thrift($, 'show')).toBe('thrift band shown.')
    ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'thrift' })).toBeDefined()
    await ui.unmount()
  })

  test('stored values of the wrong kind are ignored', async ($, on) => {
    const w = mocked(on, { store: { mode: 'sometimes', isHidden: 'no' } })
    await $.session.start(START)
    await prompt($, 'x')
    expect(w.seen[0]).toBeUndefined()
    expect(await thrift($)).toMatch(/^🪙 KOZMOS thrift · mode off · now off$/m)
  })

  test('with no store, modes and the hide toggle still hold for the session', async ($, on) => {
    const w = mocked(on, { store: false })
    await $.session.start(START)
    expect(await thrift($, ' ON ')).toBe('🪙 thrift on.')
    expect(await thrift($, 'hide')).toBe('thrift band hidden (thrift itself keeps its mode).')
    await prompt($, 'x', ['earlier'])
    expect(w.seen[0]).toEqual(['earlier', THRIFT_NOTE])
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('/thrift auto says whether it is on now; autoAt comes from the options', { options: { autoAt: 50 } }, async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'seven_day', percentUsed: 40 }]
    await $.session.start(START)
    expect(await thrift($, 'auto')).toBe('🪙 thrift auto. It turns on when the 5h or 7d limit passes 50%.')
    // Limits move by measure (or a report, or a turn's end), not by the mode command.
    await $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 60 }], changed: ['rateLimits'] })
    expect(await thrift($, 'auto')).toBe('🪙 thrift auto. It turns on when the 5h or 7d limit passes 50% — and it is on now.')
    expect(w.toasts).toEqual(['🪙 thrift on (auto): 7d at 60%'])
  })

  test('autoAt 0 reads as the default 90', { options: { autoAt: 0 } }, async ($, on) => {
    mocked(on)
    await $.session.start(START)
    expect(await thrift($, 'auto')).toMatch(/passes 90%\.$/)
  })
})

describe('/thrift report', () => {
  test('auto mode, the fullest window with its reset, and both kinds of turn compared', async ($, on) => {
    const w = mocked(on)
    steps(on, [{ output: 50_000, model: '' }, { output: 10_000, model: 'claude-opus-5-5' }])
    w.limits.now = [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2030-01-01T02:00:00Z' }]
    await $.session.start(START)
    await runTurn($, on, 't1')
    await thrift($, 'auto')
    await runTurn($, on, 't2')
    const r = await thrift($)
    expect(r).toMatch(/^🪙 KOZMOS thrift · mode auto \(on at 90%\) · now ON · 5h 95%, resets in 2h00m$/m)
    // The first request's usage names no model: the step's own model prices it.
    expect(r).toMatch(/thrift turns {4}1 · avg \$0\.20/)
    expect(r).toMatch(/normal turns {4}1 · avg \$1\.00/)
    expect(r).toMatch(/ {2}→ thrift turns cost 80% less on average/)
    expect(r).toMatch(/\/thrift on · off · auto · hide · show$/)
  })

  test('a window with no reset time; no turns yet', async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'seven_day', percentUsed: 12 }]
    await $.session.start(START)
    const r = await thrift($, 'stats')
    expect(r).toMatch(/· now off · 7d 12%$/m)
    expect(r).toMatch(/thrift turns {4}0 · avg —/)
    expect(r).toMatch(/\(the comparison appears once both kinds of turn have run\)/)
  })

  test('a failing limits read keeps the last one', async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'five_hour', percentUsed: 33 }]
    await $.session.start(START)
    w.limits.fails = true
    expect(await thrift($)).toMatch(/5h 33%/)
  })
})

describe('turns', () => {
  test('a subagent\'s completion, another turn\'s, a request without usage: none tally', async ($, on) => {
    mocked(on)
    steps(on, [null, { output: 10_000, model: 'claude-opus-5-5' }, { output: 10_000, model: 'claude-opus-5-5' }])
    await $.session.start(START)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'none', reason: 'answer' })
    await runTurn($, on, 't1')
    expect(await thrift($)).toMatch(/normal turns {4}1 · avg \$0\.00/)
    await runTurn($, on, 't2', { agentId: 'a1' })
    await runTurn($, on, 't3', { completeId: 'other' })
    expect(await thrift($)).toMatch(/normal turns {4}1 · avg/)
  })
})

describe('the gating hooks fail open', () => {
  test('a prompt or a measure that fails beneath still fails; a measure without limits changes nothing', async ($, on) => {
    const w = mocked(on, { plain: true })
    await $.session.start(START)
    await thrift($, 'on')
    await expect(prompt($, 'x')).rejects.toThrow()
    await expect($.session.measure({ context: { window: 1 }, rateLimits: [], changed: ['rateLimits'] })).rejects.toThrow()
    expect(w.toasts).toEqual([])
  })

  test('a measure of the context alone leaves the limits as they were', async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'five_hour', percentUsed: 70 }]
    await $.session.start(START)
    await $.session.measure({ context: { window: 1 }, rateLimits: [], changed: ['context'] } as never)
    w.limits.fails = true
    expect(await thrift($)).toMatch(/5h 70%/)
  })
})

describe('the minute timer', () => {
  test('auto turns off by itself once the window resets', async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2030-01-01T00:01:30Z' }]
    await $.session.start(START)
    await thrift($, 'auto')
    await w.clock.advance(60_000)
    expect(w.toasts).toEqual(['🪙 thrift on (auto): 5h at 95%'])
    await w.clock.advance(60_000)
    expect(w.toasts).toEqual(['🪙 thrift on (auto): 5h at 95%', '🪙 thrift off (auto): the window reset'])
  })

  test('a clock that fails on the minute is shrugged off', async ($, on) => {
    const minutes: (() => void)[] = []
    const reads: (() => void)[] = []
    let isBroken = false
    on('clock.now', ($, e, next) => {
      for (const r of reads.splice(0)) r()
      return isBroken ? next(e) : { value: NOW }
    })
    on('clock.every', () => new Promise(res => void minutes.push(() => res({ value: undefined }))))
    world(on)
    await $.session.start(START)
    isBroken = true
    const read = new Promise<void>(res => void reads.push(res))
    minutes.shift()?.()
    await read
    isBroken = false
    expect(await thrift($, 'on')).toBe('🪙 thrift on.')
  })
})

describe('the band', () => {
  test('nothing while off, under a survey, or hidden', async ($, on) => {
    mocked(on)
    await $.session.start(START)
    let ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'thrift' })).toBeUndefined()
    await ui.unmount()
    await thrift($, 'on')
    ui = await mount($, 'terminal', { hasSurvey: true })
    expect(await ui.find({ key: 'thrift' })).toBeUndefined()
    await ui.unmount()
  })

  test('terminal: no limit reading in grey; the comparison only when wide; ✕ hides it', async ($, on) => {
    mocked(on)
    steps(on, [{ output: 50_000, model: 'claude-opus-5-5' }, { output: 10_000, model: 'claude-opus-5-5' }])
    await $.session.start(START)
    await runTurn($, on, 't1')
    await thrift($, 'on')
    await runTurn($, on, 't2')
    const wide = await mount($, 'terminal', { bodyColumns: 0 })
    expect(await wide.find({ type: 'Client', key: 'thrift-coin' })).toBeDefined()
    expect((await wide.find({ type: 'Text', text: /^no limit reading$/ }))?.props.color).toBe(KZ.mist)
    expect(await wide.find({ type: 'Text', text: ' · saving mode' })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: ' · thrift turns cost 80% less on average' })).toBeDefined()
    await wide.unmount()
    const narrow = await mount($, 'terminal', { bodyColumns: 60 })
    expect(await narrow.find({ type: 'Text', text: /cost 80% less/ })).toBeUndefined()
    await narrow.press({ key: 'thrift-hide' })
    expect(await narrow.find({ key: 'thrift' })).toBeUndefined()
    await narrow.unmount()
  })

  test('terminal: in auto, the limit colored by heat and "(auto)"', async ($, on) => {
    const w = mocked(on)
    w.limits.now = [{ kind: 'five_hour', percentUsed: 96 }]
    await $.session.start(START)
    await thrift($, 'auto')
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '5h 96%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · saving mode (auto)' })).toBeDefined()
    await ui.unmount()
  })

  test('desktop: the gauge with the auto mark; the comparison line; ✕ hides it', async ($, on) => {
    const w = mocked(on)
    steps(on, [{ output: 50_000, model: 'claude-opus-5-5' }, { output: 10_000, model: 'claude-opus-5-5' }])
    w.limits.now = [{ kind: 'seven_day', percentUsed: 91 }]
    await $.session.start(START)
    await runTurn($, on, 't1')
    await thrift($, 'auto')
    await runTurn($, on, 't2')
    const ui = await mount($, 'desktop')
    const svg = await ui.find({ type: 'Svg' })
    const src = String(svg?.props.source)
    expect(svg?.props.alt).toBe('thrift on · 7d 91% · saving mode · thrift turns cost 80% less on average')
    expect(src).toMatch(/7d window/)
    expect(src).toMatch(/>91%</)
    expect(src).toMatch(/stroke-dasharray="2 2"/)
    expect(src).toMatch(/saving mode \(auto\)/)
    expect(src).toMatch(/fill="#[0-9a-f]+"[^>]*>thrift turns cost 80% less on average/)
    await ui.press({ key: 'thrift-hide' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('desktop: no reading, no gauge; the turn count, one or many', async ($, on) => {
    mocked(on)
    steps(on, [null, null])
    await $.session.start(START)
    await thrift($, 'on')
    let ui = await mount($, 'desktop')
    let src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toMatch(/· no limit reading · saving mode</)
    expect(src).toMatch(/0 thrift turns so far/)
    expect(src).not.toMatch(/window</)
    await ui.unmount()
    await runTurn($, on, 't1')
    ui = await mount($, 'desktop')
    src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toMatch(/1 thrift turn so far/)
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('thrift on · no limit reading · saving mode')
    await ui.unmount()
  })
})
