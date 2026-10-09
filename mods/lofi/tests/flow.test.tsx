import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { moodForHour } from '../hooks/mood.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const TURN = { answer: 'done', durationMs: 9000, isAborted: false, reason: 'answer' as const }
const NOW = 3_000_000
const AUTO = moodForHour(new Date(NOW).getHours())

/** The answers every session of these tests needs beneath the mod. */
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

describe('commands', () => {
  test('mood, status, on/off and the band toggle answer in words', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('audio.play', () => ({ value: undefined }))
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = async (args: string) => (await $.command.run({ command: 'lofi', args, ...RUN })).text

    expect(await run('status')).toBe(`Lofi is off; mood auto (${AUTO}); silent until Claude works.`)
    expect(await run('mood')).toBe('Moods: auto, focus, deep, night, sunny.')
    expect(await run('mood disco')).toBe('Moods: auto, focus, deep, night, sunny.')
    expect(await run('mood night')).toBe('Lofi mood: night.')
    expect(await run('status')).toBe('Lofi is off; mood night; silent until Claude works.')
    expect(await run('mood auto')).toBe(`Lofi mood: auto (now ${AUTO}).`)
    expect(await run('')).toBe('Lofi band hidden. Music is off: /lofi on.')
    expect(await run('')).toBe('Lofi band shown. Music is off: /lofi on.')
    expect(await run('ON')).toBe(`♪ Lofi on: ${AUTO} plays while Claude works.`)
    expect(await run('status')).toBe(`Lofi is on; mood auto (${AUTO}); silent until Claude works.`)
    expect(await run('')).toBe('Lofi band hidden.')
    expect(await run('off')).toBe('Lofi off.')
  })

  test('the choices are remembered for the next session', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('audio.play', () => ({ value: undefined }))
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = async (args: string) => (await $.command.run({ command: 'lofi', args, ...RUN })).text
    await run('on')
    await run('mood sunny')
    await run('')

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await run('status')).toBe('Lofi is on; mood sunny; silent until Claude works.')
    // The band stays hidden while it plays.
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
    await $.turn.complete({ ...TURN, turnId: 't1' })
  })

  for (const [stored, status] of [
    [{ enabled: 'yes', mood: 3, hidden: 'no' }, 'Lofi is off; mood night; silent until Claude works.'],
    [{ enabled: false, mood: 'disco' }, 'Lofi is off; mood night; silent until Claude works.'],
    [{ enabled: true, mood: 'auto' }, `Lofi is on; mood auto (${AUTO}); silent until Claude works.`],
    [{ mood: 'deep', hidden: false }, 'Lofi is off; mood deep; silent until Claude works.'],
  ] as const) {
    test(`a stored ${JSON.stringify(stored)} is read only when it is valid`, { options: { mood: 'night' } }, async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on, stored)
      engine(on)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
      expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).toBe(status)
    })
  }

  test('without a store the choices hold for this session only', async ($, on) => {
    mock.clock(on, { now: NOW })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const run = async (args: string) => (await $.command.run({ command: 'lofi', args, ...RUN })).text
    expect(await run('on')).toContain('Lofi on')
    expect(await run('mood deep')).toBe('Lofi mood: deep.')
    expect(await run('')).toBe('Lofi band hidden.')
    expect(await run('status')).toBe('Lofi is on; mood deep; silent until Claude works.')
  })
})

describe('the player', () => {
  test('a mood change mid-turn swaps the loop on the next tick', { options: { enabled: true, mood: 'focus' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {})
    const played: string[] = []
    on('audio.play', async ($, e) => {
      played.push(e.clip.asset ?? '?')
      await clock.sleep(600_000)
      return { value: undefined }
    })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(2100) // two ticks while it plays: nothing changes
    expect(played).toEqual(['sounds/focus.wav'])
    await $.command.run({ command: 'lofi', args: 'mood night', ...RUN })
    await clock.advance(50)
    expect(played).toEqual(['sounds/focus.wav', 'sounds/night.wav'])
    expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).toBe('Lofi is on; mood night; playing night.')
    await $.turn.complete({ ...TURN, turnId: 't1' })
    await clock.advance(10)
  })

  test('a loop that ended on its own after playing a while starts again', { options: { enabled: true, mood: 'deep' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {})
    const played: string[] = []
    on('audio.play', async ($, e) => {
      played.push(e.clip.asset ?? '?')
      await clock.sleep(3000)
      return { value: undefined }
    })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(50)
    expect(played).toHaveLength(1)
    await clock.advance(3200) // it ended past the no-player window: not muted
    expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).not.toContain('no audio player')
    await clock.advance(1000) // the tick restarts it
    expect(played).toEqual(['sounds/deep.wav', 'sounds/deep.wav'])
    await $.turn.complete({ ...TURN, turnId: 't1' })
    await clock.advance(10)
  })

  test('a tick during a slow /lofi off stops the loop before the command does', { options: { enabled: true, mood: 'sunny' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('store.get', () => ({ value: undefined }))
    on('store.set', async () => {
      await clock.sleep(1500)
      return { value: undefined }
    })
    on('audio.play', async () => {
      await clock.sleep(600_000)
      return { value: undefined }
    })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(50)
    const off = $.command.run({ command: 'lofi', args: 'off', ...RUN })
    await clock.advance(1000) // the tick sees music off while the store is still writing
    const status = await $.command.run({ command: 'lofi', args: 'status', ...RUN })
    // The command has not stopped it yet (it is still writing): the tick did.
    expect(status.text).toBe('Lofi is off; mood sunny; silent until Claude works.')
    await clock.advance(1000)
    expect((await off).text).toBe('Lofi off.')
    await $.turn.complete({ ...TURN, turnId: 't1' })
  })

  test('subagent turns keep it playing; session end stops it', { options: { enabled: true, mood: 'focus' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('audio.play', async () => {
      await clock.sleep(600_000)
      return { value: undefined }
    })
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(50)
    await $.turn.complete({ ...TURN, turnId: 'a1', agentId: 'agent-1' })
    await clock.advance(10)
    expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).toContain('playing focus')
    const ended = await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(ended.sessionId).toBe('s1')
    expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).not.toContain('playing')
  })
})

describe('the band', () => {
  test('draws nothing before a session, under a survey, or while silent', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    engine(on)
    const early = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND })
    expect(await early.find({ type: 'Client' })).toBeUndefined()
    expect(await early.find({ key: 'engine' })).toBeDefined()
    await early.unmount()
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const survey = await $.ui.mount({ plugin: 'lofi', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
  })

  test('the terminal band sizes its equalizer to the body; Svg on desktop, VS Code and mobile', { options: { enabled: true, mood: 'night' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('audio.play', async () => {
      await clock.sleep(600_000)
      return { value: undefined }
    })
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(50)

    for (const [cols, bands] of [[100, 16], [26, 6], [0, 16]] as const) {
      const term = await $.ui.mount({ plugin: 'lofi', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: cols } })
      const client = await term.find({ type: 'Client', key: 'lofi' })
      expect(client?.props.width).toBe(14 + 'night'.length + bands)
      expect(client?.props.props).toEqual({ mood: 'night', bands })
      await term.unmount()
    }
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'lofi', surface, ...BAND })
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.alt).toBe('Lofi playing: night')
      expect(svg?.props.width).toBe(260)
      await ui.unmount()
    }
    await $.turn.complete({ ...TURN, turnId: 't1' })
    await clock.advance(10)
  })
})
