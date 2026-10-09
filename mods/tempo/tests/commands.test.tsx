import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { startTimer } from '../hooks/timer.ts'
import type { Timer } from '../hooks/timer.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const MIN = 60_000
const T0 = new Date(2026, 9, 9, 10, 0).getTime()

/** The session beneath tempo: the engine's band, toasts and speech recorded. */
function world(on: On) {
  const toasts: string[] = []
  const spoken: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    spoken.push(e.text)
    // The second phrase finds no synthesizer.
    return spoken.length > 1 ? { deny: 'no voice' } : { value: { via: 'system' as const } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  return { toasts, spoken }
}

const run = async ($: { command: { run: (e: { command: string; args: string } & typeof RUN) => Promise<{ text?: string }> } }, args: string) =>
  (await $.command.run({ command: 'tempo', args, ...RUN })).text

/** The desktop row tempo drew, as SVG source, or undefined. */
async function row(ui: Pick<Mounted, 'find'>): Promise<string | undefined> {
  const pic = await ui.find({ type: 'Svg' })
  return pic ? String(pic.props.source) : undefined
}

describe('/tempo', () => {
  test('every verb, with and without a timer', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await run($, '')).toBe('No timer running · 🍅×0 today. Start one with /tempo start [work=25] [break=5].')
    expect(await run($, 'stop')).toBe('No timer is running.')
    expect(await run($, 'skip')).toBe('No timer is running.')
    expect(await run($, 'start 50 later')).toBe('Could not read “later”. Try /tempo start 25 5')
    expect(await run($, 'START 50 10')).toBe('🍅 Focus round 1 · 50 min, then 10 min break. /tempo stop ends it.')
    expect(await run($, '')).toBe('🍅 Focus round 1 · 50:00 left · 50/10 min · 🍅×0 today')
    expect(await run($, 'skip')).toBe('Skipped to break · 10:00.')
    expect(await run($, 'status')).toBe('☕ Break · 10:00 left · 50/10 min · 🍅×0 today')
    expect(await run($, 'skip')).toBe('Skipped to focus · 50:00.')
    expect(await run($, 'hide')).toBe('Tempo band hidden (the timer keeps running).')
    let ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    expect(await row(ui)).toBeUndefined()
    await ui.unmount()
    expect(await run($, 'show')).toBe('Tempo band shown.')
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    expect(await row(ui)).toContain('FOCUS · ROUND 2')
    await ui.unmount()
    expect(await run($, 'stop')).toBe('Timer stopped · 🍅×0 today.')
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    expect(await row(ui)).toBeUndefined()
    await ui.unmount()
  })

  test('a timer stored by the last session carries on; round 4 earns a long break', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const r4: Timer = { ...startTimer(T0 - 20 * MIN, 25, 5), round: 4 }
    mock.store(on, { timer: r4, days: { '2026-10-08': 4 }, hidden: false })
    const { toasts } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await run($, '')).toBe('🍅 Focus round 4 · 5:00 left · 25/5 min · 🍅×0 today')
    await clock.advance(5 * MIN)
    expect(toasts).toEqual(['🍅 Focus round 4 done — long break, 15 min. 🍅×1 today'])
    const ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    const src = await row(ui)
    expect(src).toContain('LONG BREAK')
    expect(src).toContain('of 15 min')
    expect(src).toContain('back to focus at 10:20')
    expect(src).toContain('tp-stm3')
    // Every pip of the cycle is done; one tomato for today.
    expect(src?.match(/r="3.6" fill="#ef4444"/g)).toHaveLength(4)
    expect(src).toContain('×1 today')
    expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe('☕ Long break · 15:00 left · 🍅×1 today')
    await ui.unmount()
  })

  test('the break ends with a toast and, when asked, a voice', { options: { speak: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, { timer: startTimer(T0 - 25 * MIN + 1000, 25, 5) })
    const { toasts, spoken } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(1000)
    await clock.advance(5 * MIN)
    expect(toasts).toEqual([
      '🍅 Focus round 1 done — break, 5 min. 🍅×1 today',
      "☕ Break over — focus round 2, 25 min. Let's go.",
    ])
    // The second phrase found no voice; the timer went on all the same.
    expect(spoken).toEqual(['Focus round done. Take 5 minutes.', 'Break over. Back to focus.'])
    expect(await run($, '')).toBe('🍅 Focus round 2 · 25:00 left · 25/5 min · 🍅×1 today')
  })

  test('a machine asleep through several phases counts each focus round and toasts the last change', async ($, on) => {
    mock.clock(on, { now: T0 })
    // Ended 35 minutes ago: a break, a focus round and a break since.
    mock.store(on, { timer: startTimer(T0 - 60 * MIN, 25, 5), days: { '2026-10-08': 2 } })
    const { toasts } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(toasts).toEqual(["☕ Break over — focus round 3, 25 min. Let's go."])
    expect(await run($, '')).toBe('🍅 Focus round 3 · 25:00 left · 25/5 min · 🍅×2 today')
  })

  test('a store that refuses everything leaves tempo working for the session', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    on('store.get', () => ({ deny: 'no store' }))
    on('store.set', () => ({ deny: 'no store' }))
    on('store.delete', () => ({ deny: 'no store' }))
    const { toasts } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await run($, 'start 1 1')).toContain('Focus round 1 · 1 min')
    await clock.advance(MIN)
    expect(toasts).toEqual(['🍅 Focus round 1 done — break, 1 min. 🍅×1 today'])
    expect(await run($, 'hide')).toContain('hidden')
    expect(await run($, 'stop')).toBe('Timer stopped · 🍅×1 today.')
  })

  test('stored values that are not a timer or a tally are ignored', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on, { timer: { phase: 'nap' }, days: 'many', hidden: 'yes' })
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await run($, '')).toBe('No timer running · 🍅×0 today. Start one with /tempo start [work=25] [break=5].')
  })
})

describe('the tempo band', () => {
  test('the desktop row at three widths, in the last minute, with tomatoes for today', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, { timer: startTimer(T0 - 24 * MIN, 25, 5), days: { '2026-10-09': 7 } })
    world(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await clock.advance(30_000)
    // Roomy: track, end time, pips with the current one pulsing, six tomatoes and the count.
    let ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    let src = await row(ui)
    expect(src).toContain('class="tp-hot"')
    expect(src).toContain('FOCUS · ROUND 1')
    expect(src).toContain('of 25 min')
    expect(src).toContain('break at 10:01')
    expect(src).toContain('class="pulse"/>')
    expect(src?.match(/r="4" fill="#ef4444"/g)).toHaveLength(6)
    expect(src).toContain('×7 today')
    expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe('🍅 Focus round 1 · 0:30 left · 🍅×7 today')
    await ui.unmount()
    // Medium: the track, no pips.
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 40 } })
    src = await row(ui)
    expect(src).toContain('break at')
    expect(src).not.toContain('cycle')
    await ui.unmount()
    // Narrow: neither.
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 1 } })
    src = await row(ui)
    expect(src).not.toContain('break at')
    expect(src).toContain('0:30')
    await ui.unmount()
  })

  test('the terminal band: the Client gets the phase and the time; a survey hides it; ✕ too', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, { timer: startTimer(T0, 25, 5), days: { '2026-10-09': 2 } })
    world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.settle()
    let ui = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    const band = await ui.find({ type: 'Client' })
    expect(band?.props.width).toBe(77)
    expect(band?.props.props).toEqual({ cols: 77, phase: 'work', remain: 25 * MIN, total: 25 * MIN, round: 1, today: 2, claude: true })
    await ui.press({ key: 'tempo-hide' })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    expect(await run($, 'show')).toBe('Tempo band shown.')
    // An agent finishing is not Claude finishing.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ claude: true })
    await ui.unmount()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ claude: false })
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    await ui.unmount()
  })

  test('a break while Claude works says so on the desktop', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const brk: Timer = { phase: 'break', startedAt: T0, endsAt: T0 + 5 * MIN, workMin: 25, breakMin: 5, round: 2 }
    mock.store(on, { timer: brk })
    world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    const src = await row(ui)
    expect(src).toContain('>BREAK<')
    expect(src).toContain('of 5 min')
    expect(src).toContain('tp-dots')
    expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toBe('☕ Break · 5:00 left · 🍅×0 today — Claude keeps going ☕')
    await ui.unmount()
  })
})

describe('tempo never blocks the session', () => {
  test('a snapshot that cannot be written leaves the band empty and the turn going', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, { timer: startTimer(T0, 25, 5) })
    world(on)
    on('state.set', { plugin: 'tempo', key: 'snap' } as const, () => ({ deny: 'frozen' }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(1000)
    expect(await $.turn.start({ text: 'go', turnId: 't1' })).toEqual({ turnId: 't1' })
    await clock.settle()
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: 'ok' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })

  test('a turn that fails below fails as it would without tempo', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on)
    on('turn.start', () => {
      throw new Error('no model')
    })
    on('turn.complete', () => {
      throw new Error('no transcript')
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.turn.start({ text: 'go', turnId: 't1' })).rejects.toThrow()
    await expect($.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).rejects.toThrow()
  })
})
