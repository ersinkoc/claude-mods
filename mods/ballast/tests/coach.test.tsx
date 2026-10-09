import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KZ } from '../hooks/lib/kz.ts'
import { compactedText, errorText } from '../hooks/text.ts'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

type Compact = { tokensBefore?: number; tokensAfter?: number } | { skip: string } | 'fail' | 'slow'
type World = {
  fill: { percent: number | undefined; tokens: number | undefined; window: number }
  usageFails: boolean
  /** True: the next writes of ballast's snapshot are refused. */
  stateFails: boolean
  compact: Compact
  /** The reading once a compaction is done. */
  fillAfter: { percent: number | undefined; tokens: number | undefined; window: number }
  compactions: number
  toasts: string[]
  clock: MockClock
}

/** A session beneath ballast: context readings, toasts, turns and compactions. */
function world(on: On, stored: Record<string, unknown> = {}): World {
  const w: World = { fill: { percent: 40, tokens: 400_000, window: 1_000_000 }, usageFails: false, stateFails: false, compact: { tokensBefore: 900_000, tokensAfter: 100_000 }, fillAfter: { percent: 10, tokens: 100_000, window: 1_000_000 }, compactions: 0, toasts: [], clock: mock.clock(on, { now: 9_000_000 }) }
  const kept = new Map(Object.entries(stored))
  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.set', ($, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('state.set', ($, e, next) => (w.stateFails && e.key === 'snap' ? { deny: 'state down' } : next(e)))
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
  on('session.usage', () => {
    if (w.usageFails) throw new Error('usage down')
    return { value: { startedAt: 0, context: { tokens: w.fill.tokens, window: w.fill.window, percent: w.fill.percent }, rateLimits: [] } } as never
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', async () => {
    w.compactions++
    const c = w.compact
    if (c === 'fail') throw new Error('turn running')
    if (c === 'slow') {
      await w.clock.sleep(5000)
      w.fill = { ...w.fillAfter }
      return { messages: MESSAGES, tokensBefore: 900_000, tokensAfter: 100_000 }
    }
    if ('skip' in c) return { skip: c.skip }
    w.fill = { ...w.fillAfter }
    return { messages: MESSAGES, ...c }
  })
  return w
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const ballast = async ($: Engine, args: string) => (await $.command.run({ command: 'ballast', args, ...CMD })).text
const measure = ($: Engine, percent: number, changed: ('context' | 'rateLimits')[] = ['context']) =>
  $.session.measure({ context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed })
const band = async ($: Engine, surface: 'terminal' | 'desktop', props: Partial<typeof BAND_PROPS> = {}) => {
  const ui = await $.ui.mount({ plugin: 'ballast', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, ...props } })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const svg = await ui.find({ type: 'Svg' })
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.key))
  await ui.unmount()
  return { head: texts[0], texts, svg, buttons }
}

describe('words', () => {
  test('the compaction toast, with what is known', () => {
    expect(compactedText(800_000, 100_000)).toBe('⚓ compacted: 800k → 100k tokens (−88%)')
    expect(compactedText(100_000, 200_000)).toBe('⚓ compacted: 100k → 200k tokens (−0%)')
    expect(compactedText(null, 100_000)).toBe('⚓ compacted: now 100k tokens')
    expect(compactedText(0, 100_000)).toBe('⚓ compacted: now 100k tokens')
    expect(compactedText(800_000, null)).toBe('⚓ compacted.')
  })

  test('failures as text', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('plain')).toBe('plain')
  })
})

describe('status and toggling', () => {
  test('/ballast status before any reading, then with one and a last compaction', async ($, on) => {
    const w = world(on)
    w.usageFails = true
    await start($)
    expect(await ballast($, 'status')).toBe('⚓ ballast: context — (0 of 1.0M); warn at 75%, act at 88%, auto-compact off.')
    w.usageFails = false
    w.fill = { percent: 50, tokens: undefined, window: 0 }
    expect(await ballast($, 'status')).toBe('⚓ ballast: context 50% (0 of 1.0M); warn at 75%, act at 88%, auto-compact off.')
    expect(await ballast($, ' COMPACT ')).toBe('⚓ ballast: compacting now; a toast shows before → after.')
    await w.clock.advance(250)
    expect(w.toasts.at(-1)).toBe('⚓ compacted: 900k → 100k tokens (−89%)')
    expect(await ballast($, 'status')).toBe('⚓ ballast: context 10% (100k of 1.0M); warn at 75%, act at 88%, auto-compact off. Last compaction: compacted: 900k → 100k tokens (−89%) (ballast).')
  })

  test('options out of range or not numbers are clamped or replaced', { options: { warnAt: 0, actAt: 0, autoCompact: true } }, async ($, on) => {
    world(on)
    await start($)
    expect(await ballast($, 'status')).toContain('warn at 75%, act at 88%, auto-compact on.')
  })

  test('options above the top are clamped; act never below warn', { options: { warnAt: 150, actAt: 50 } }, async ($, on) => {
    world(on)
    await start($)
    expect(await ballast($, 'status')).toContain('warn at 99%, act at 99%')
  })

  test('the hide toggle persists and a stored flag is read back', async ($, on) => {
    const w = world(on, { isHidden: true })
    w.fill.percent = 95
    await start($)
    expect((await band($, 'desktop')).svg).toBeUndefined()
    expect(await ballast($, '')).toBe('ballast band shown: it appears when the context passes 88%.')
    expect((await band($, 'desktop')).svg).toBeDefined()
    // A survey takes the band.
    expect((await band($, 'desktop', { hasSurvey: true })).svg).toBeUndefined()
  })
})

describe('readings', () => {
  test('readings without a percent, or not about the context, change nothing', async ($, on) => {
    const w = world(on)
    w.fill.percent = undefined
    await start($)
    expect(await ballast($, 'status')).toContain('context —')
    w.fill.percent = Number.NaN
    expect(await ballast($, 'status')).toContain('context —')
    await measure($, 95, ['rateLimits'])
    expect((await band($, 'terminal')).texts).toHaveLength(0)
  })

  test('the warning toast rearms once the fill drops below warnAt', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 76)
    await measure($, 70)
    await measure($, 77)
    expect(w.toasts.filter(t => t.includes('plan a /compact'))).toHaveLength(2)
    // Straight past actAt: no warning toast, the band instead.
    await measure($, 60)
    await measure($, 90)
    expect(w.toasts.filter(t => t.includes('plan a /compact'))).toHaveLength(2)
  })

  test('Not now rests the band until the fill grows four points or drops away', async ($, on) => {
    world(on)
    await start($)
    await measure($, 90)
    const ui = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'ballast-snooze' })
    await ui.unmount()
    await measure($, 93)
    expect((await band($, 'terminal')).texts).toHaveLength(0)
    // Below the snooze point less four, the snooze is forgotten.
    await measure($, 85)
    await measure($, 89)
    expect((await band($, 'terminal')).head).toBe('⚓ ctx 89% — compact before the next big task')
  })
})

describe('the band', () => {
  test('terminal: the head, the waterline with its marks, the buttons', async ($, on) => {
    world(on)
    await start($)
    await measure($, 89)
    const b = await band($, 'terminal', { bodyColumns: 0 })
    expect(b.head).toBe('⚓ ctx 89% — compact before the next big task')
    const line = b.texts.find(t => t.startsWith('▕'))
    // 80 columns: a 56-cell gauge filled to 50 cells, over both marks.
    expect(line).toBe(`▕${'~≈'.repeat(25)}······▏ 890k/1.0M`)
    expect(b.buttons).toEqual(['ballast-compact', 'ballast-snooze', 'ballast-hide'])
  })

  test('desktop: one picture with the numbers, auto-compact named', { options: { autoCompact: true } }, async ($, on) => {
    const w = world(on)
    w.compact = { skip: 'nothing to compact' }
    await start($)
    await measure($, 92)
    await w.clock.advance(400)
    const b = await band($, 'desktop')
    expect(String(b.svg?.props.alt)).toBe('⚓ ctx 92% — compact before the next big task; 920k of 1.0M tokens')
    expect(String(b.svg?.props.source)).toContain('· auto-compact')
    expect(String(b.svg?.props.source)).toContain('ctx 92%')
  })

  test('while compacting: the band says so, with no buttons but ✕; a second ask is turned away', async ($, on) => {
    const w = world(on)
    w.compact = 'slow'
    await start($)
    await measure($, 89)
    expect(await ballast($, 'now')).toBe('⚓ ballast: compacting now; a toast shows before → after.')
    await w.clock.advance(250)
    const b = await band($, 'terminal')
    expect(b.head).toBe('⚓ ctx 89% — compacting…')
    expect(b.buttons).toEqual(['ballast-hide'])
    const desk = await band($, 'desktop')
    expect(desk.buttons).toEqual(['ballast-hide'])
    expect(await ballast($, 'now')).toBe('Already compacting.')
    await w.clock.advance(5000)
    expect(w.toasts.at(-1)).toBe('⚓ compacted: 900k → 100k tokens (−89%)')
    expect(w.compactions).toBe(1)
  })

  test('queued with no reading yet: the band shows an empty gauge', async ($, on) => {
    const w = world(on)
    w.usageFails = true
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(await ballast($, 'now')).toBe('Queued: ballast compacts when this turn ends.')
    expect(w.toasts).toContain('⚓ ballast: compaction queued for the end of this turn')
    const b = await band($, 'terminal')
    expect(b.head).toBe('⚓ ctx 0% — compaction queued for the end of this turn')
    expect(b.texts.find(t => t.startsWith('▕'))).toBe(`▕${'·'.repeat(45)}┊${'·'.repeat(7)}┊${'·'.repeat(6)}▏ 0/1.0M`)
    const marks = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect((await marks.findAll({ type: 'Text', text: /^┊$/ })).map(t => t.props.color)).toEqual([KZ.yellow, KZ.red])
    await marks.unmount()
    expect(b.buttons).toEqual(['ballast-snooze', 'ballast-hide'])
    const desk = await band($, 'desktop')
    expect(String(desk.svg?.props.alt)).toBe('⚓ ctx 0% — compaction queued for the end of this turn; 0 of 1.0M tokens')
  })

  test('✕ hides the band', async ($, on) => {
    world(on)
    await start($)
    await measure($, 95)
    const ui = await $.ui.mount({ plugin: 'ballast', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'ballast-hide' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
    expect(await ballast($, '')).toBe('ballast band shown: it appears when the context passes 88%.')
  })
})

describe('compacting', () => {
  test('a turn ending with nothing queued only takes a reading', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.fill.percent = 60
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(400)
    expect(w.compactions).toBe(0)
    expect(await ballast($, 'status')).toContain('context 60%')
  })

  test('a skipped compaction is said so and nothing is queued', async ($, on) => {
    const w = world(on)
    w.compact = { skip: 'too short' }
    await start($)
    await ballast($, 'now')
    await w.clock.advance(250)
    expect(w.toasts).toEqual(['⚓ ballast: compaction skipped — too short'])
    expect((await band($, 'terminal')).texts).toHaveLength(0)
  })

  test('a compaction that fails is queued for the end of the next turn, then runs', async ($, on) => {
    const w = world(on)
    w.compact = 'fail'
    await start($)
    await ballast($, 'now')
    await w.clock.advance(250)
    expect((await band($, 'terminal')).head).toBe('⚓ ctx 40% — compaction queued for the end of this turn')
    w.compact = {}
    await $.turn.start({ text: 'go', turnId: 't1' })
    // A subagent's turn ending does not run it.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    await w.clock.advance(400)
    expect(w.compactions).toBe(1)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(400)
    expect(w.compactions).toBe(2)
    // The engine gave no numbers: before is the last reading, after the new one.
    expect(w.toasts).toContain('⚓ compacted: 400k → 100k tokens (−75%)')
  })

  test('autoCompact during a turn waits for its end; it re-arms only below actAt', { options: { autoCompact: true } }, async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await measure($, 90)
    await w.clock.advance(400)
    expect(w.compactions).toBe(0)
    expect((await band($, 'terminal')).head).toBe('⚓ ctx 90% — compaction queued for the end of this turn')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(400)
    expect(w.compactions).toBe(1)
    // Still above actAt and not re-armed: no second compaction.
    w.fill = { percent: 91, tokens: 910_000, window: 1_000_000 }
    await measure($, 91)
    await w.clock.advance(120_000)
    expect(w.compactions).toBe(1)
    // Below actAt then back over, but within a minute of the last: wait.
    await measure($, 50)
    await measure($, 93)
    await w.clock.advance(400)
    expect(w.compactions).toBe(2)
  })

  test('autoCompact waits a minute between compactions', { options: { autoCompact: true } }, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 90)
    await w.clock.advance(400)
    expect(w.compactions).toBe(1)
    await measure($, 50)
    await measure($, 90)
    await w.clock.advance(400)
    expect(w.compactions).toBe(1)
  })
})

describe('compactions of others', () => {
  test('auto and manual compactions toast before → after; precompute, subagents and skips do not', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 80)
    // No numbers from the engine: before is the last reading, after the next.
    w.compact = {}
    await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    await w.clock.settle()
    expect(w.toasts.at(-1)).toBe('⚓ compacted: 800k → 100k tokens (−88%)')
    w.compact = { tokensBefore: 500_000, tokensAfter: 50_000 }
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await w.clock.settle()
    expect(w.toasts.at(-1)).toBe('⚓ compacted: 500k → 50k tokens (−90%)')
    expect(await ballast($, 'status')).toContain('Last compaction: compacted: 500k → 50k tokens (−90%) (you).')
    const count = w.toasts.length
    await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
    await $.session.compact({ trigger: 'manual', messages: MESSAGES, agentId: 'a1' })
    w.compact = { skip: 'empty' }
    await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    await w.clock.settle()
    expect(w.toasts).toHaveLength(count)
  })

  test('with no tokens known at all, the toast says only that it compacted', async ($, on) => {
    const w = world(on)
    w.fill = { percent: 30, tokens: undefined, window: 1_000_000 }
    await start($)
    w.compact = {}
    w.fillAfter = { percent: 10, tokens: undefined, window: 1_000_000 }
    await $.session.compact({ trigger: 'auto', messages: MESSAGES })
    await w.clock.settle()
    expect(w.toasts.at(-1)).toBe('⚓ compacted.')
  })
})

describe('failures', () => {
  test('a measure or compaction nothing answers beneath fails through the catch unchanged', async ($, on) => {
    mock.clock(on, { now: 1 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1_000_000, percent: 40 }, rateLimits: [] } }))
    await start($)
    await expect(measure($, 50)).rejects.toThrow(/no implementation for session.measure/)
    await expect($.session.compact({ trigger: 'manual', messages: MESSAGES })).rejects.toThrow(/no implementation for session.compact/)
  })

  // A refused snapshot write rejects the work that changed it; none of it escapes.
  test('an automatic compaction whose snapshot is refused is dropped', { options: { autoCompact: true } }, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 90)
    w.stateFails = true
    await w.clock.advance(400)
    expect(w.compactions).toBe(0)
  })

  test('Compact now whose snapshot is refused is dropped', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 90)
    const ui = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    w.stateFails = true
    await ui.press({ key: 'ballast-compact' })
    await ui.unmount()
    expect(w.compactions).toBe(0)
  })

  test('Not now whose snapshot is refused still rests the band', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, 90)
    const ui = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    w.stateFails = true
    await ui.press({ key: 'ballast-snooze' })
    await ui.unmount()
    // The snooze itself stands: the band rests until 94%.
    w.stateFails = false
    await measure($, 91)
    expect((await band($, 'terminal')).texts).toHaveLength(0)
    await measure($, 94)
    expect((await band($, 'terminal')).head).toBe('⚓ ctx 94% — compact before the next big task')
  })

  test('/ballast now whose snapshot is refused is dropped', async ($, on) => {
    const w = world(on)
    await start($)
    w.stateFails = true
    await ballast($, 'now')
    await w.clock.advance(250)
    expect(w.compactions).toBe(0)
    // The refusal does not leave ballast stuck "compacting": the next ask runs.
    w.stateFails = false
    await ballast($, 'now')
    await w.clock.advance(250)
    expect(w.compactions).toBe(1)
  })

  test('the end of a turn whose snapshot is refused is dropped', async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    w.stateFails = true
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(400)
    expect(w.compactions).toBe(0)
  })

  test('another compaction whose snapshot is refused shows no toast', async ($, on) => {
    const w = world(on)
    await start($)
    w.stateFails = true
    w.compact = { tokensBefore: 500_000 }
    const r = await $.session.compact({ trigger: 'manual', messages: MESSAGES })
    expect('tokensBefore' in r && r.tokensBefore).toBe(500_000)
    await w.clock.settle()
    expect(w.toasts).toEqual([])
  })
})
