import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'


const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

/** A session whose context reads `fill.percent`; compaction drops it to 12%. */
function world(on: On): { fill: { percent: number }; toasts: string[]; compactions: number[]; clock: MockClock } {
  const fill = { percent: 40 }
  const toasts: string[] = []
  const compactions: number[] = []
  const clock = mock.clock(on, { now: 9_000_000 })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: fill.percent * 10_000, window: 1_000_000, percent: fill.percent }, rateLimits: [] } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', () => {
    compactions.push(fill.percent)
    const before = fill.percent * 10_000
    fill.percent = 12
    return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensBefore: before, tokensAfter: 120_000 }
  })
  return { fill, toasts, compactions, clock }
}

async function measure($: Engine, percent: number): Promise<void> {
  await $.session.measure({ context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed: ['context'] })
}

describe('register', () => {
  test('a toast at warnAt, the band at actAt on terminal and desktop, and Compact now', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    // Nothing at 40%.
    let term = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
    await term.unmount()

    w.fill.percent = 77
    await measure($, 77)
    expect(w.toasts.some(t => /context at 77%/.test(t))).toBe(true)
    await measure($, 79)
    expect(w.toasts.filter(t => /context at/.test(t)).length).toBe(1)

    w.fill.percent = 89
    await measure($, 89)
    term = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /⚓ ctx 89% — compact before the next big task/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: '≈' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'ballast', surface: 'desktop', ...BAND })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.press({ key: 'ballast-compact' })
    expect(w.compactions).toEqual([89])
    expect(w.toasts.filter(t => /compacted: 890k → 120k tokens/.test(t)).length).toBe(1)
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
  })

  test('Compact now during a turn is queued until the turn completes', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'big task', turnId: 't1' })
    w.fill.percent = 91
    await measure($, 91)
    const r = await $.command.run({ command: 'ballast', args: 'now', ...CMD })
    expect(r.text).toMatch(/Queued/)
    expect(w.compactions).toEqual([])
    const term = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /queued/ })).toBeDefined()
    await term.unmount()
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(400)
    expect(w.compactions).toEqual([91])
  })

  test('Not now rests the band until the fill grows, and /ballast hides it', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    w.fill.percent = 90
    await measure($, 90)
    const term = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', ...BAND })
    await term.press({ key: 'ballast-snooze' })
    expect(await term.find({ type: 'Text', text: /ctx 90%/ })).toBeUndefined()
    await term.unmount()
    await measure($, 95)
    const again = await $.ui.mount({ plugin: 'ballast', surface: 'terminal', ...BAND })
    expect(await again.find({ type: 'Text', text: /ctx 95%/ })).toBeDefined()
    await again.unmount()
    const r = await $.command.run({ command: 'ballast', args: '', ...CMD })
    expect(r.text).toMatch(/hidden/)
    const hidden = await $.ui.mount({ plugin: 'ballast', surface: 'desktop', ...BAND })
    expect(await hidden.find({ type: 'Svg' })).toBeUndefined()
    await hidden.unmount()
  })

  test('autoCompact compacts between turns at actAt', { options: { autoCompact: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    w.fill.percent = 90
    await measure($, 90)
    await w.clock.advance(400)
    expect(w.compactions).toEqual([90])
  })

  test('a /compact of the person shows its before → after too', async ($, on) => {
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    w.fill.percent = 80
    await measure($, 80)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    await w.clock.advance(10)
    expect(w.toasts.some(t => /compacted: 800k → 120k tokens/.test(t))).toBe(true)
  })
})
