import { describe, expect, mock, test } from 'claude-code/testing'

import { crossings, gainOf, isAllowed, profileOf } from '../hooks/logic.ts'
import { RATE, RECIPES, encodeWav, readWavHeader, renderRecipe } from '../tools/synth.ts'

const CTX = { tokens: 1000, window: 1_000_000, percent: 0.1 }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

describe('synth', () => {
  test('every recipe renders a valid 16-bit mono WAV within peak', async () => {
    expect(RECIPES.map(r => r.name)).toEqual(['tick', 'chime', 'bonk', 'gong', 'bell', 'alarm'])
    for (const r of RECIPES) {
      const samples = renderRecipe(r)
      expect(Math.max(...Array.from(samples, Math.abs)) <= 0.8001).toBe(true)
      const bytes = encodeWav(samples)
      const head = readWavHeader(bytes)
      expect(head).toEqual({ riff: 'RIFF', wave: 'WAVE', format: 1, channels: 1, rate: RATE, bits: 16, dataBytes: samples.length * 2 })
      expect(bytes.length).toBe(44 + samples.length * 2)
    }
  })
})

describe('logic', () => {
  test('profiles, gain and limit crossings', async () => {
    expect(profileOf('arcade')).toBe('arcade')
    expect(profileOf('loud')).toBe('subtle')
    expect(isAllowed('subtle', 'tick')).toBe(false)
    expect(isAllowed('arcade', 'tick')).toBe(true)
    expect(isAllowed('silent', 'alarm')).toBe(false)
    expect(gainOf(50)).toBe(0.5)
    expect(gainOf(900)).toBe(1)

    let r = crossings({}, [{ kind: 'five_hour', percentUsed: 79 }])
    expect(r.alerts).toHaveLength(0)
    r = crossings(r.seen, [{ kind: 'five_hour', percentUsed: 81 }])
    expect(r.alerts).toEqual([{ kind: 'five_hour', threshold: 80, percent: 81 }])
    r = crossings(r.seen, [{ kind: 'five_hour', percentUsed: 88 }])
    expect(r.alerts).toHaveLength(0)
    r = crossings(r.seen, [{ kind: 'five_hour', percentUsed: 96 }])
    expect(r.alerts[0]?.threshold).toBe(95)
    r = crossings(r.seen, [{ kind: 'five_hour', percentUsed: 3 }])
    r = crossings(r.seen, [{ kind: 'five_hour', percentUsed: 97 }])
    expect(r.alerts[0]?.threshold).toBe(95)
  })
})

describe('register', () => {
  test('events play the right clips, throttled, and /resonance mutes', { options: { profile: 'arcade', volume: 50 } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const played: string[] = []
    const gains: (number | undefined)[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      gains.push(e.gain)
      return { value: undefined }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'false' ? { isError: true as const, result: 'exit 1' } : { result: 'ok' }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'ls' }) // within 400 ms: throttled
    await clock.advance(500)
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.settle()
    expect(played).toEqual(['sounds/tick.wav', 'sounds/bonk.wav'])
    expect(gains[0]).toBe(0.5)

    const turn = { answer: 'done', isAborted: false, reason: 'answer' as const }
    await $.turn.complete({ ...turn, durationMs: 3000, turnId: 't1' })
    await clock.advance(2000)
    await $.turn.complete({ ...turn, durationMs: 5000, turnId: 't2' }) // short: no gong
    await $.turn.complete({ ...turn, durationMs: 45_000, turnId: 't3' })
    await clock.advance(2000)
    await $.turn.complete({ ...turn, durationMs: 9000, turnId: 'a1', agentId: 'agent-1' })
    await clock.settle()
    expect(played.slice(2)).toEqual(['sounds/chime.wav', 'sounds/gong.wav', 'sounds/bell.wav'])

    await clock.advance(5000)
    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 82 }], changed: ['rateLimits'] })
    await clock.advance(5000)
    await $.session.measure({ context: CTX, rateLimits: [{ kind: 'five_hour', percentUsed: 85 }], changed: ['rateLimits'] })
    await clock.settle()
    expect(played.filter(p => p === 'sounds/alarm.wav')).toHaveLength(1)

    const muted = await $.command.run({ command: 'resonance', args: '', ...RUN })
    expect(muted.text).toContain('muted')
    await clock.advance(5000)
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.settle()
    expect(played.filter(p => p === 'sounds/bonk.wav')).toHaveLength(1)

    const status = await $.command.run({ command: 'resonance', args: 'status', ...RUN })
    expect(status.text).toContain('arcade')
  })
})
