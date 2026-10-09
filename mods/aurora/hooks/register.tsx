import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AuroraMode, AuroraSnap } from '../types'
import { pxOf } from './lib/kz.ts'
import { auroraAlt, auroraSvg, isLit, levelOf } from './lights.ts'

const snapAtom = atom({ plugin: 'aurora', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'aurora', key: 'isHidden' } as const, false)

// What the model is doing, from two sources:
//  1. turn.step's stream on the main loop: a `thinking` chunk means thinking,
//     a `text` chunk responding, a `tool`/`input` chunk tool input. This is
//     the primary signal: a non-render event, so it may publish to $.state.
//  2. The Spinner's `mode` prop, READ in a ui.render hook that writes nothing
//     but these module variables (render hooks never write state); the timer
//     below adopts it when it changed, which covers what the stream does not
//     show (e.g. a request waiting before its first chunk).
let mode: AuroraMode = 'idle'
let since = 0
let effort: string | null = null
let level = 0.5
let isWorking = false
let spinnerMode: AuroraMode | null = null
let spinnerSeq = 0
let seenSpinnerSeq = 0
let lastKey = ''

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; the session still honours it.
  }
}

async function setMode($: EngineInterface, next: AuroraMode): Promise<void> {
  if (next === mode) return
  mode = next
  since = await $.clock.now()
  await publish($)
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const snap: AuroraSnap = { now, mode, since, effort, level }
  // While lit the desktop label counts seconds; otherwise nothing moves.
  const key = JSON.stringify({ ...snap, now: isLit(mode) ? Math.floor(now / 1000) : 0 })
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

async function tick($: EngineInterface): Promise<void> {
  if (spinnerSeq !== seenSpinnerSeq) {
    seenSpinnerSeq = spinnerSeq
    if (isWorking && spinnerMode) await setMode($, spinnerMode)
  }
  await publish($)
}

function chunkMode(kind: string): AuroraMode | undefined {
  if (kind === 'thinking') return 'thinking'
  if (kind === 'text') return 'responding'
  if (kind === 'tool' || kind === 'input') return 'tool-input'
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    mode = 'idle'
    since = await $.clock.now()
    isWorking = false
    spinnerMode = null
    seenSpinnerSeq = spinnerSeq
    lastKey = ''
    await $.command.register({ name: 'aurora', description: 'KOZMOS: show or hide the Aurora that glows above the prompt while the model thinks', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // Fresh store.
    }
    $.clock.every(500, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'aurora' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Aurora hidden.' : 'Aurora shown.' }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      await setMode($, 'idle').catch(() => undefined)
    }
    return next(e)
  })

  // The main loop's stream says when the model thinks, writes or calls a tool.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    effort = e.effort === undefined ? effort : String(e.effort)
    level = levelOf(e.effort ?? effort)
    isWorking = true
    await setMode($, 'requesting').catch(() => undefined)
    const stream = next(e)
    for await (const chunk of stream) {
      const m = chunkMode(chunk.kind)
      if (m !== undefined && m !== mode) await setMode($, m).catch(() => undefined)
      yield chunk
    }
    const r = await stream.result
    await setMode($, r.toolUses.length > 0 ? 'tool-use' : 'idle').catch(() => undefined)
    return r
  })

  // Read-only: note the spinner's mode for the timer; never write state here.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.mode !== spinnerMode) {
      spinnerMode = e.props.mode
      spinnerSeq++
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || !isLit(snap.mode)) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const hide = <Button key="aurora-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    const secs = (snap.now - snap.since) / 1000

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns)
      const H = e.props.maxRows >= 10 ? 72 : 56
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row">
            <Svg source={auroraSvg(snap.mode, snap.effort, snap.level, secs, snap.now, W, H)} alt={auroraAlt(snap.mode, snap.effort, secs)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    if (!('Client' in ui)) return drawn
    const { Client } = ui
    const cols = Math.max(30, e.props.bodyColumns || 80)
    const rows = e.props.maxRows >= 10 ? 3 : 2
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client
            key="aurora"
            module="./scene.tsx"
            width={cols - 2}
            height={rows}
            props={{ mode: snap.mode, effort: snap.effort, level: snap.level, now: snap.now, since: snap.since, width: cols - 2, rows }}
          />
          {hide}
        </Box>
      </Box>
    )
  })
}
