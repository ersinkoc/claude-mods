import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const TURN = { answer: 'done', durationMs: 9000, isAborted: false, reason: 'answer' as const }
const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout

/**
 * A clock the test breaks on purpose: `clock.now` throws once `okCalls` runs
 * out; the waits (`after`, `every`, `sleep`) resolve when `advance` passes them.
 */
function brittleClock(on: On, start: number) {
  let now = start
  let okCalls = Infinity
  const waits: { due: number; go: () => void }[] = []
  const hold = (ms: number) => new Promise<void>(go => waits.push({ due: now + ms, go }))
  on('clock.now', () => {
    if (okCalls <= 0) throw new Error('clock down')
    okCalls--
    return { value: now }
  })
  on('clock.sleep', async ($, e) => (await hold(e.ms), { value: undefined }))
  on('clock.after', async ($, e) => (await hold(e.ms), { value: undefined }))
  on('clock.every', async ($, e) => (await hold(e.ms), { value: undefined }))
  return {
    /** Lets `n` more reads of the time through, then breaks it. */
    breakAfter(n: number) { okCalls = n },
    fix() { okCalls = Infinity },
    async advance(ms: number) {
      now += ms
      for (const w of waits.splice(0)) {
        if (w.due <= now) w.go()
        else waits.push(w)
      }
      await new Promise<void>(r => later(r, 20))
    },
  }
}

describe('a failing clock', () => {
  test('never breaks a hook: publishing, ticks, turns and commands swallow it', { options: { enabled: true, mood: 'deep' } }, async ($, on) => {
    const clock = brittleClock(on, 5_000_000)
    mock.store(on, {})
    const played: string[] = []
    on('audio.play', ($, e) => {
      played.push(e.clip.asset ?? '?')
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))

    // session.start's first publish fails; the session still starts.
    clock.breakAfter(0)
    const started = await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(started.cwd).toBe('/w')
    await clock.advance(1000) // the tick's reconcile fails

    // The turn's reconcile reads the time once and starts the loop; the
    // loop's first publish fails, and the music plays all the same.
    const turn = await $.turn.start({ text: 'go', turnId: 't1' })
    expect(turn.turnId).toBe('t1')
    clock.breakAfter(1)
    await clock.advance(10)
    expect(played).toEqual(['sounds/deep.wav'])

    // turn.complete's publish fails, unawaited.
    expect((await $.turn.complete({ ...TURN, turnId: 't1' })).text).toBe('done')

    // /lofi mood with a set mood answers without the clock; its reconcile fails.
    expect((await $.command.run({ command: 'lofi', args: 'mood night', ...RUN })).text).toBe('Lofi mood: night.')
    await clock.advance(10)
    // /lofi on needs the clock to answer: the command fails, its reconcile too.
    await expect($.command.run({ command: 'lofi', args: 'on', ...RUN })).rejects.toThrow()
    await clock.advance(10)

    clock.fix()
    expect((await $.command.run({ command: 'lofi', args: 'status', ...RUN })).text).toBe('Lofi is on; mood night; silent until Claude works.')
  })
})
