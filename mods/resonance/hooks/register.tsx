import type { EngineInterface, Register } from 'claude-code'

import { SOUNDS, canPlay, crossings, describeProfile, gainOf, isAllowed, profileOf } from './logic.ts'
import type { Profile, Sound } from './logic.ts'
import { limitLabel } from './lib/kz.ts'

// Session memory: rebuilt on every session.start (and after a hot reload).
let profile: Profile = 'subtle'
let gain = 0.7
let isMuted = false
let mainTurns = 0
let lastPlayed: Partial<Record<Sound, number>> = {}
let limitSeen: Record<string, number> = {}

/** Plays one of the mod's own clips when the profile, mute and throttle allow it. */
async function sound($: EngineInterface, s: Sound, force = false): Promise<void> {
  if (!force && (isMuted || !isAllowed(profile, s))) return
  const now = await $.clock.now()
  if (!force && !canPlay(s, lastPlayed[s], now)) return
  lastPlayed[s] = now
  try {
    await $.audio.play({ asset: `sounds/${s}.wav` }, { gain })
  } catch {
    // No player on this surface (a Windows or Linux terminal): stay quiet.
  }
}

async function setMuted($: EngineInterface, value: boolean): Promise<void> {
  isMuted = value
  try {
    await $.store.set('muted', value)
  } catch {
    // Kept for this session only.
  }
}

async function demo($: EngineInterface): Promise<void> {
  for (const s of SOUNDS) {
    await sound($, s, true)
    await $.clock.sleep(s === 'gong' ? 1800 : 700)
  }
}

async function onLimits($: EngineInterface, limits: readonly { kind: string; percentUsed: number }[]): Promise<void> {
  const { alerts, seen } = crossings(limitSeen, limits)
  limitSeen = seen
  if (alerts.length === 0) return
  await sound($, 'alarm')
  const a = alerts[alerts.length - 1]
  if (a && !isMuted && profile !== 'silent') $.ui.toast(`🔔 ${limitLabel(a.kind)} limit past ${a.threshold}% (${Math.round(a.percent)}%)`)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    profile = profileOf(options.profile)
    gain = gainOf(options.volume)
    mainTurns = 0
    lastPlayed = {}
    limitSeen = {}
    try {
      isMuted = (await $.store.get('muted')) === true
    } catch {
      isMuted = false
    }
    await $.command.register({ name: 'resonance', description: 'KOZMOS: mute or unmute the soundscape (play <sound>, demo, status)', argumentHint: '[play <sound> | demo | status]', immediate: true })
    return started
  })

  on('command.run', { command: 'resonance' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === 'play') {
      const s = SOUNDS.find(x => x === arg)
      if (!s) return { text: `Sounds: ${SOUNDS.join(', ')}` }
      void sound($, s, true)
      return { text: `♪ ${s}` }
    }
    if (verb === 'demo') {
      void demo($).catch(() => undefined)
      return { text: `♪ ${SOUNDS.join(' · ')}` }
    }
    if (verb === 'status') {
      return { text: `Resonance ${isMuted ? 'muted 🔇' : 'on 🔊'} · ${describeProfile(profile)} · volume ${Math.round(gain * 100)}` }
    }
    await setMuted($, !isMuted)
    return { text: isMuted ? 'Resonance muted 🔇' : `Resonance on 🔊 (${describeProfile(profile)})` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.isError === true || ran.deny !== undefined
    void sound($, failed ? 'bonk' : 'tick')
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      if (!e.isAborted) void sound($, 'bell')
      return done
    }
    mainTurns++
    if (e.isAborted || e.reason === 'error') return done
    if (mainTurns === 1) void sound($, 'chime')
    else if (e.durationMs > 20_000) void sound($, 'gong')
    return done
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('rateLimits')) await onLimits($, e.rateLimits)
    return measured
  }).catch(($, e, next) => next(e))
}
