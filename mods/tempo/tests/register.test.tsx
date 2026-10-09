import { describe, expect, mock, test } from 'claude-code/testing'

import { catchUp, dayKey, mmss, nextPhase, parseStart, progressOf, startTimer } from '../hooks/timer.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const MIN = 60_000

describe('timer', () => {
  test('phases, long breaks, catch-up and parsing', async () => {
    const t = startTimer(0, 25, 5)
    expect(t.endsAt).toBe(25 * MIN)
    expect(progressOf(t, 12.5 * MIN)).toBe(0.5)
    const b = nextPhase(t, t.endsAt)
    expect(b.phase).toBe('break')
    expect(b.endsAt - b.startedAt).toBe(5 * MIN)
    // Round 4's break is long: three short ones.
    const r4 = nextPhase({ ...t, round: 4 }, 0)
    expect(r4.phase).toBe('long')
    expect(r4.endsAt).toBe(15 * MIN)
    // Asleep through focus, break and part of the next focus.
    const c = catchUp(t, 31 * MIN)
    expect(c.finished).toEqual(['work', 'break'])
    expect(c.timer.phase).toBe('work')
    expect(c.timer.round).toBe(2)
    expect(mmss(4 * MIN + 7000)).toBe('4:07')
    expect(mmss(90 * MIN)).toBe('90:00')
    expect(parseStart([])).toEqual({ workMin: 25, breakMin: 5 })
    expect(parseStart(['50', '10'])).toEqual({ workMin: 50, breakMin: 10 })
    expect(parseStart(['break=3', 'work=40'])).toEqual({ workMin: 40, breakMin: 3 })
    expect('error' in parseStart(['soon'])).toBe(true)
    expect('error' in parseStart(['500'])).toBe(true)
    expect(dayKey(new Date(2026, 9, 9, 23, 59).getTime())).toBe('2026-10-09')
  })
})

describe('register', () => {
  test('start, band on terminal and desktop, phase end toast and tally', async ($, on) => {
    const t0 = new Date(2026, 9, 9, 10, 0).getTime()
    const clock = mock.clock(on, { now: t0 })
    mock.store(on, {})
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    // No timer: nothing of tempo's in the band.
    const idle = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND })
    expect(await idle.find({ type: 'Client' })).toBeUndefined()
    await idle.unmount()

    const started = await $.command.run({ command: 'tempo', args: 'start 25 5', ...RUN })
    expect(started.text).toContain('Focus round 1')

    const term = await $.ui.mount({ plugin: 'tempo', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /FOCUS 1/, in: 'tempo-band' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /25:00/, in: 'tempo-band' })).toBeDefined()
    await term.advance(3000)
    expect(await term.find({ type: 'Text', text: /24[: ]57/, in: 'tempo-band' })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'tempo-hide' })).toBeDefined()
    await term.unmount()

    await clock.advance(25 * MIN + 1000)
    expect(toasts.some(t => /Focus round 1 done/.test(t) && /🍅×1 today/.test(t))).toBe(true)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(1000)

    const desk = await $.ui.mount({ plugin: 'tempo', surface: 'desktop', ...BAND })
    const svgEl = await desk.find({ type: 'Svg' })
    expect(svgEl).toBeDefined()
    expect(String(svgEl?.props.source)).toContain('Claude keeps going')
    expect(String(svgEl?.props.alt)).toContain('Break')
    await desk.press({ key: 'tempo-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    const status = await $.command.run({ command: 'tempo', args: '', ...RUN })
    expect(status.text).toContain('🍅×1 today')
    const stopped = await $.command.run({ command: 'tempo', args: 'stop', ...RUN })
    expect(stopped.text).toContain('stopped')
  })
})
