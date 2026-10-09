import { describe, expect, mock, test } from 'claude-code/testing'

import { eqBars, eqLevels, gainOf, lofiSvg, moodForHour, resolveMood } from '../hooks/mood.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const TURN = { answer: 'done', durationMs: 9000, isAborted: false, reason: 'answer' as const }

describe('mood', () => {
  test('auto follows the hour; a set mood wins', () => {
    expect(moodForHour(8)).toBe('sunny')
    expect(moodForHour(14)).toBe('focus')
    expect(moodForHour(20)).toBe('deep')
    expect(moodForHour(2)).toBe('night')
    expect(resolveMood('auto', 23)).toBe('night')
    expect(resolveMood('sunny', 23)).toBe('sunny')
    expect(gainOf(40)).toBe(0.5)
    expect(gainOf(500)).toBe(1.25)
  })

  test('the equalizer has one bar per band, and the svg dances by css', () => {
    const bars = eqBars(eqLevels(12, 40, 78), 'focus')
    expect(bars).toHaveLength(12)
    for (const b of bars) expect('▁▂▃▄▅▆▇█').toContain(b.s)
    const src = lofiSvg('night', 260, 5000, 1000)
    expect(src).toContain('@keyframes eq')
    expect(src).toContain('lofi · night')
  })
})

describe('register', () => {
  test('music is opt-in, loops while Claude works and stops when idle', { options: { mood: 'deep' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const played: { asset: string; loop: boolean }[] = []
    on('audio.play', async ($, e) => {
      played.push({ asset: e.clip.asset ?? '?', loop: e.shouldLoop })
      await clock.sleep(60_000)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(1500)
    expect(played).toHaveLength(0)
    const silent = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND })
    expect(await silent.find({ type: 'Client' })).toBeUndefined()
    await silent.unmount()

    const on1 = await $.command.run({ command: 'lofi', args: 'on', ...RUN })
    expect(on1.text).toContain('deep')
    await clock.advance(100)
    expect(played).toEqual([{ asset: 'sounds/deep.wav', loop: true }])

    const term = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client', key: 'lofi' })).toBeDefined()
    await term.advance(300)
    expect(await term.find({ type: 'Text', text: /deep/, in: 'lofi' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'lofi', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('lofi · deep')
    await desk.press({ key: 'lofi-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
    const shown = await $.command.run({ command: 'lofi', args: '', ...RUN })
    expect(shown.text).toContain('shown')

    // Idle: the loop stops and the band goes.
    await $.turn.complete({ ...TURN, turnId: 't1' })
    await clock.advance(1500)
    const idle = await $.ui.mount({ plugin: 'lofi', surface: 'desktop', ...BAND })
    expect(await idle.find({ type: 'Svg' })).toBeUndefined()
    await idle.unmount()
    expect(played).toHaveLength(1)

    // The next turn plays again.
    await $.turn.start({ text: 'more', turnId: 't2' })
    await clock.advance(100)
    expect(played).toHaveLength(2)
    const status = await $.command.run({ command: 'lofi', args: 'status', ...RUN })
    expect(status.text).toContain('playing deep')
    await $.turn.complete({ ...TURN, turnId: 't2' })
    await clock.advance(61_000)
  })

  test('where no player plays the loop, Lofi goes quiet instead of retrying', { options: { enabled: true, mood: 'sunny' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 2_000_000 })
    mock.store(on, {})
    let plays = 0
    on('audio.play', () => {
      plays++
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(5000)
    expect(plays).toBe(1)
    const status = await $.command.run({ command: 'lofi', args: 'status', ...RUN })
    expect(status.text).toContain('no audio player')
    const term = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })
})
