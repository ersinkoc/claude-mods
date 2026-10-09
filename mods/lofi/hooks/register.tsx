import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LofiMood, LofiSnap } from '../types'
import { pxOf } from './lib/kz.ts'
import { MOODS, assetOf, gainOf, isMood, lofiSvg, resolveMood } from './mood.ts'

const snapAtom = atom({ plugin: 'lofi', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'lofi', key: 'isHidden' } as const, false)

/** A loop that ends on its own this soon was not played (no player here). */
const NO_PLAYER_MS = 2500

// The player. One loop at a time; its AbortController stops it.
let isEnabled = false
let moodSetting = 'auto'
let gain = 0.5
let isWorking = false
let player: { stop: AbortController; mood: LofiMood; since: number } | undefined
/** Set when the engine could not play a loop; cleared at the next turn. */
let isMuted = false
let lastKey = ''

async function currentMood($: EngineInterface): Promise<LofiMood> {
  return resolveMood(moodSetting, new Date(await $.clock.now()).getHours())
}

async function publish($: EngineInterface): Promise<void> {
  const fallback = await currentMood($)
  // Read the player once, after the await: a loop may have started meanwhile.
  const p = player
  const snap: LofiSnap = { isPlaying: p !== undefined, mood: p?.mood ?? fallback, isEnabled, since: p?.since ?? 0 }
  const key = JSON.stringify(snap)
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

function stop(): void {
  const p = player
  player = undefined
  p?.stop.abort()
}

/** Plays one loop until it is stopped; `p` is already the current player. */
async function play($: EngineInterface, p: NonNullable<typeof player>): Promise<void> {
  await publish($)
  try {
    await $.audio.play({ asset: assetOf(p.mood) }, { shouldLoop: true, gain, signal: p.stop.signal })
  } catch {
    // The engine could not play it: treated as no player below.
  }
  // The loop ended. If we did not stop it, the engine could not play it.
  if (player === p) {
    player = undefined
    if ((await $.clock.now()) - p.since < NO_PLAYER_MS) isMuted = true
    await publish($)
  }
}

/** Plays while enabled and working, in the mood of the moment; stops otherwise. */
async function reconcile($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const mood = resolveMood(moodSetting, new Date(now).getHours())
  // From here on no await until the player is settled, so two ticks never start two loops.
  const want = isEnabled && isWorking && !isMuted
  if (player && (!want || player.mood !== mood)) stop()
  if (want && !player) {
    player = { stop: new AbortController(), mood, since: now }
    void play($, player).catch(() => undefined)
  }
  await publish($)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function remember($: EngineInterface, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function command($: EngineInterface, args: string): Promise<string> {
  const [verb = '', arg = ''] = args.trim().toLowerCase().split(/\s+/)
  if (verb === 'on' || verb === 'off') {
    isEnabled = verb === 'on'
    isMuted = false
    await remember($, 'enabled', isEnabled)
    $.clock.after(10, () => void reconcile($).catch(() => undefined))
    if (!isEnabled) stop()
    await publish($)
    return isEnabled ? `♪ Lofi on: ${await currentMood($)} plays while Claude works.` : 'Lofi off.'
  }
  if (verb === 'mood') {
    if (arg !== 'auto' && !isMood(arg)) return `Moods: auto, ${MOODS.join(', ')}.`
    moodSetting = arg
    await remember($, 'mood', arg)
    $.clock.after(10, () => void reconcile($).catch(() => undefined))
    return `Lofi mood: ${arg}${arg === 'auto' ? ` (now ${await currentMood($)})` : ''}.`
  }
  if (verb === 'status') {
    const mood = await currentMood($)
    return `Lofi is ${isEnabled ? 'on' : 'off'}; mood ${moodSetting}${moodSetting === 'auto' ? ` (${mood})` : ''}; ${player ? `playing ${player.mood}` : isMuted ? 'no audio player on this surface' : 'silent until Claude works'}.`
  }
  // Bare /lofi: show or hide the band.
  const isHidden = !(await read($, hiddenAtom))
  await setHidden($, isHidden)
  return `${isHidden ? 'Lofi band hidden.' : 'Lofi band shown.'}${isEnabled ? '' : ' Music is off: /lofi on.'}`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    stop()
    isWorking = false
    isMuted = false
    lastKey = ''
    isEnabled = options.enabled === true
    moodSetting = typeof options.mood === 'string' ? options.mood : 'auto'
    gain = gainOf(typeof options.volume === 'number' ? options.volume : 40)
    await $.command.register({ name: 'lofi', description: 'KOZMOS: lo-fi music while Claude works (on, off, mood <m>, status; bare toggles the band)', argumentHint: '[on|off|mood <auto|focus|deep|night|sunny>|status]', immediate: true })
    try {
      const enabled = await $.store.get('enabled')
      if (typeof enabled === 'boolean') isEnabled = enabled
      const mood = await $.store.get('mood')
      if (typeof mood === 'string' && (mood === 'auto' || isMood(mood))) moodSetting = mood
      const hidden = await $.store.get('hidden')
      if (typeof hidden === 'boolean') await update($, hiddenAtom, () => hidden)
    } catch {
      // A fresh store: the userConfig values stand.
    }
    await publish($).catch(() => undefined)
    // The tick catches the hour turning (auto mood) and a loop that needs restarting.
    $.clock.every(1000, () => void reconcile($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'lofi' }, async ($, e) => ({ text: await command($, e.args) }))

  on('turn.start', async ($, e, next) => {
    isWorking = true
    isMuted = false
    // Started from a timer, not from this hook: the loop outlives the hook.
    $.clock.after(10, () => void reconcile($).catch(() => undefined))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      stop()
      void publish($).catch(() => undefined)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || !snap.isPlaying) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const hide = <Button key="lofi-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = Math.min(pxOf(e.props.bodyColumns) - 28, 260)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row" alignItems="center">
            <Svg source={lofiSvg(snap.mood, W, await $.clock.now(), snap.since)} alt={`Lofi playing: ${snap.mood}`} width={W} height={30} />
            {hide}
          </Box>
        </Box>
      )
    }

    if (!('Client' in ui)) return drawn
    const { Client } = ui
    const bands = Math.max(6, Math.min(16, (e.props.bodyColumns || 80) - 24))
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client key="lofi" module="./eq.tsx" width={14 + snap.mood.length + bands} height={1} props={{ mood: snap.mood, bands }} />
          {hide}
        </Box>
      </Box>
    )
  })
}
