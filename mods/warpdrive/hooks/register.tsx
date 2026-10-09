import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WarpSnap } from '../types'
import { pxOf } from './lib/kz.ts'
import { RateMeter, SHOW_AFTER, arrivalLine, warpAlt, warpSpeed, warpSvg } from './warp.ts'
import type { WarpView } from './warp.ts'

const snapAtom = atom({ plugin: 'warpdrive', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'warpdrive', key: 'isHidden' } as const, false)

// Live collector; the band draws the snapshot published to $.state.
const meter = new RateMeter()
let pendingTok = 0
let isWorking = false
let turnStartedAt = 0
let turnTokens = 0
let arrival: WarpSnap['arrival']
let seq = 0
let lastKey = ''

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (pendingTok > 0) {
    meter.add(now, pendingTok)
    pendingTok = 0
  }
  const rate = isWorking ? meter.rate(now) : 0
  const visible = isWorking || (arrival !== undefined && now - arrival.at < SHOW_AFTER)
  const snap: WarpSnap = {
    now,
    isWorking,
    rate: Math.round(rate),
    speed: Math.round(warpSpeed(rate) * 100) / 100,
    tokens: Math.round(turnTokens),
    turnStartedAt,
    arrival,
    visible,
  }
  // The clock matters only while the band shows (the HUD counts seconds).
  const key = JSON.stringify({ ...snap, now: visible ? Math.floor(now / 1000) : 0 })
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    meter.reset()
    pendingTok = 0
    isWorking = false
    turnStartedAt = 0
    turnTokens = 0
    arrival = undefined
    lastKey = ''
    await $.command.register({ name: 'warpdrive', description: 'KOZMOS: show or hide the Warpdrive starfield above the prompt', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // A fresh store.
    }
    await publish($).catch(() => undefined)
    $.clock.every(500, () => void publish($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'warpdrive' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Warpdrive hidden.' : 'Warpdrive engaged.' }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    turnStartedAt = await $.clock.now()
    turnTokens = 0
    arrival = undefined
    meter.reset()
    void publish($).catch(() => undefined)
    return next(e)
  })

  // Every model request, main loop or subagent, feeds the engines: the text,
  // thinking and tool arguments as they stream (≈ 4 characters a token), then
  // the request's reported output tokens for whatever did not stream.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let streamed = 0
    for await (const c of stream) {
      const tok = c.kind === 'text' || c.kind === 'thinking' ? c.text.length / 4 : c.kind === 'input' ? c.json.length / 4 : 0
      streamed += tok
      pendingTok += tok
      yield c
    }
    const r = await stream.result
    const out = r.usage?.output_tokens ?? 0
    if (out > streamed) pendingTok += out - streamed
    if (isWorking) turnTokens += Math.max(out, streamed)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && isWorking) {
      isWorking = false
      seq++
      arrival = {
        seq,
        at: await $.clock.now(),
        durationMs: e.durationMs,
        tokens: Math.round(Math.max(turnTokens, e.usage?.output_tokens ?? 0)),
        isAborted: e.isAborted,
      }
      void publish($).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || !snap.visible) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const label = snap.arrival && !snap.isWorking ? arrivalLine(snap.arrival.durationMs, snap.arrival.tokens, snap.arrival.isAborted) : ''
    const view: WarpView = {
      now: snap.now,
      speed: snap.speed,
      rate: snap.rate,
      tokens: snap.tokens,
      elapsedMs: snap.isWorking ? snap.now - snap.turnStartedAt : 0,
      isWorking: snap.isWorking,
      label,
      flashSeq: label ? (snap.arrival?.seq ?? 0) : 0,
    }
    const hide = <Button key="warpdrive-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    const rows = Math.max(2, Math.min(e.props.maxRows >= 12 ? 4 : 3, e.props.maxRows - 2))

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns) - 28
      const H = rows >= 4 ? 84 : 66
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row" alignItems="flex-start">
            <Svg source={warpSvg(view, W, H)} alt={warpAlt(view)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    if (!('Client' in ui)) return drawn
    const { Client } = ui
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client key="warpdrive" module="./field.tsx" width={cols} height={rows} props={{ cols, rows, speed: view.speed, rate: view.rate, tokens: view.tokens, elapsedMs: view.elapsedMs, isWorking: view.isWorking, label, flashSeq: view.flashSeq }} />
          {hide}
        </Box>
      </Box>
    )
  })
}
