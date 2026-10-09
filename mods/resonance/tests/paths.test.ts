import { describe, expect, mock, test } from 'claude-code/testing'

import { describeProfile, gainOf } from '../hooks/logic.ts'

const CTX = { tokens: 1000, window: 1_000_000, percent: 0.1 }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const TURN = { answer: 'done', isAborted: false, reason: 'answer' as const }

describe('logic edges', () => {
  test('gain falls back to 70 and silent describes nothing', async () => {
    expect(gainOf('loud')).toBe(0.7)
    expect(gainOf(Number.NaN)).toBe(0.7)
    expect(gainOf(-5)).toBe(0)
    expect(describeProfile('silent')).toBe('silent: nothing plays')
    expect(describeProfile('subtle')).toBe('subtle: chime, bonk, gong, bell, alarm')
  })
})

describe('commands', () => {
  test('play names a clip, lists them otherwise, and plays through a mute', { options: { profile: 'arcade' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 50_000 })
    mock.store(on, { muted: true })
    const played: string[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    const status = await $.command.run({ command: 'resonance', args: 'status', ...RUN })
    expect(status.text).toBe('Resonance muted 🔇 · arcade: tick, chime, bonk, gong, bell, alarm · volume 70')

    expect((await $.command.run({ command: 'resonance', args: 'play', ...RUN })).text).toBe('Sounds: tick, chime, bonk, gong, bell, alarm')
    expect((await $.command.run({ command: 'resonance', args: 'play kazoo', ...RUN })).text).toBe('Sounds: tick, chime, bonk, gong, bell, alarm')
    expect((await $.command.run({ command: 'resonance', args: '  PLAY Gong ', ...RUN })).text).toBe('♪ gong')
    await clock.settle()
    expect(played).toEqual(['sounds/gong.wav'])

    const on2 = await $.command.run({ command: 'resonance', args: '', ...RUN })
    expect(on2.text).toBe('Resonance on 🔊 (arcade: tick, chime, bonk, gong, bell, alarm)')
  })

  test('demo plays every clip in order, the gong given longer to ring', async ($, on) => {
    const clock = mock.clock(on, { now: 10_000 })
    mock.store(on, {})
    const played: [string, number][] = []
    on('audio.play', ($, e) => {
      played.push([e.clip.asset ?? '?', clock.now()])
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })

    const r = await $.command.run({ command: 'resonance', args: 'demo', ...RUN })
    expect(r.text).toBe('♪ tick · chime · bonk · gong · bell · alarm')
    for (let i = 0; i < 12; i++) await clock.advance(500)
    expect(played).toEqual([
      ['sounds/tick.wav', 10_000],
      ['sounds/chime.wav', 10_700],
      ['sounds/bonk.wav', 11_400],
      ['sounds/gong.wav', 12_100],
      ['sounds/bell.wav', 13_900],
      ['sounds/alarm.wav', 14_600],
    ])
  })

  test('with no player and no store the mod stays quiet and keeps the mute for the session', { options: { profile: 'arcade' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    // No `audio.play` beneath: the play throws and is swallowed.
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    await clock.settle()
    expect(ran.result).toBe('ok')

    // No `store.set` beneath: the mute still holds for this session.
    expect((await $.command.run({ command: 'resonance', args: '', ...RUN })).text).toBe('Resonance muted 🔇')
    expect((await $.command.run({ command: 'resonance', args: 'status', ...RUN })).text).toContain('muted 🔇')
  })
})

describe('events', () => {
  test('aborted and failed turns stay silent; denies bonk; subtle has no ticks', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.store(on, {})
    const played: string[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', ($, e) => (e.tool === 'Write' ? { deny: 'no writes' } : { result: 'ok' }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.tool.call({ tool: 'Bash', command: 'ls' }) // subtle: no tick
    await $.tool.call({ tool: 'Write', file_path: '/w/a', content: 'x' })
    await clock.settle()
    expect(played).toEqual(['sounds/bonk.wav'])

    await $.turn.complete({ ...TURN, isAborted: true, durationMs: 60_000, turnId: 'a', agentId: 'agent-1' })
    await $.turn.complete({ ...TURN, isAborted: true, durationMs: 60_000, turnId: 't1' }) // counts as the first turn
    await $.turn.complete({ ...TURN, reason: 'error' as const, durationMs: 60_000, turnId: 't2' })
    await $.turn.complete({ ...TURN, durationMs: 60_000, turnId: 't3' })
    await clock.settle()
    expect(played).toEqual(['sounds/bonk.wav', 'sounds/gong.wav'])
  })

  test('a muted or silent session rings no alarm and shows no toast', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.store(on, { muted: true })
    const played: string[] = []
    const toasts: string[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      return { value: undefined }
    })
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }], changed: ['rateLimits'] })
    await clock.settle()
    expect(played).toEqual([])
    expect(toasts).toEqual([])

    // A move of the context alone is not a rate-limit crossing.
    await $.command.run({ command: 'resonance', args: '', ...RUN }) // unmute
    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'seven_day', percentUsed: 99 }], changed: ['context'] })
    await clock.settle()
    expect(played).toEqual([])

    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'seven_day', percentUsed: 96.4 }], changed: ['rateLimits'] })
    await clock.settle()
    expect(played).toEqual(['sounds/alarm.wav'])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('limit past 95% (96%)')
  })

  test('the silent profile plays nothing and toasts nothing', { options: { profile: 'silent' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.store(on, {})
    const played: string[] = []
    const toasts: string[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      return { value: undefined }
    })
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 85 }], changed: ['rateLimits'] })
    await clock.settle()
    expect(played).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('failures never block', () => {
  test('a failing clock or chain beneath leaves the session running', async ($, on) => {
    // No clock beneath: every play attempt throws before it reaches the player.
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    expect((await $.command.run({ command: 'resonance', args: 'status', ...RUN })).text).toBe('Resonance on 🔊 · subtle: chime, bonk, gong, bell, alarm · volume 70')
    // The demo's first play throws; the command still answers.
    expect((await $.command.run({ command: 'resonance', args: 'demo', ...RUN })).text).toContain('♪ tick')

    // The alarm's play throws inside the hook: the measure falls through to the chain.
    const measured = await $.session.measure({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }], changed: ['rateLimits'] })
    expect(measured.changed).toEqual(['rateLimits'])

    // Nothing answers tool.call or turn.complete beneath: the hooks hand the error on.
    await expect($.tool.call({ tool: 'Bash', command: 'ls' })).rejects.toThrow()
    await expect($.turn.complete({ ...TURN, durationMs: 1, turnId: 't1' })).rejects.toThrow()
  })
})
