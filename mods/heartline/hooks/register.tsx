import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HeartBeat, HeartSnap } from '../types'
import { ekgAlt, ekgSvg } from './ekg.ts'
import { KZ, pxOf, toolColor } from './lib/kz.ts'

const snapAtom = atom({ plugin: 'heartline', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'heartline', key: 'isHidden' } as const, false)

/** The band shows while the session had any activity in this long. */
const SHOW_MS = 10 * 60_000
/** Beats kept: enough for the widest terminal trace. */
const KEEP_MS = 4 * 60_000

// Live collector; the band draws from the snapshot published to $.state.
let beats: HeartBeat[] = []
let ctx: number | null = null
let lastAt = 0
let isWorking = false
let lastKey = ''

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; the session still honours it.
  }
}

async function beat($: EngineInterface, k: HeartBeat['k'], c: string): Promise<void> {
  const at = await $.clock.now()
  beats.push({ at, k, c })
  if (beats.length > 600) beats = beats.slice(-400)
  lastAt = at
  await publish($)
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  beats = beats.filter(b => now - b.at < KEEP_MS)
  const minute = beats.filter(b => now - b.at < 60_000)
  const snap: HeartSnap = {
    now,
    beats: [...beats],
    bpm: minute.filter(b => b.k === 't').length,
    rpm: minute.filter(b => b.k === 's').length,
    ctx,
    lastAt,
    isWorking,
  }
  // The clock only matters while beats are on screen (the desktop scrolls by redraws).
  const isScrolling = beats.some(b => now - b.at < 70_000)
  const key = JSON.stringify({ ...snap, now: isScrolling ? now : 0, show: now - lastAt < SHOW_MS })
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

async function readContext($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    ctx = u.context.percent ?? ctx
  } catch {
    // No reading yet.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    beats = []
    ctx = null
    lastAt = 0
    isWorking = false
    lastKey = ''
    await $.command.register({ name: 'heartline', description: 'KOZMOS: show or hide the Heartline EKG band above the prompt', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // Fresh store.
    }
    await readContext($)
    await publish($).catch(() => undefined)
    $.clock.every(1000, () => void publish($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'heartline' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Heartline hidden.' : 'Heartline shown.' }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    lastAt = await $.clock.now()
    void publish($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      void publish($).catch(() => undefined)
    }
    return next(e)
  })

  // Every model request is a small blip: cyan on the main loop, violet in a subagent.
  on('turn.step', async function* ($, e, next) {
    await beat($, 's', e.agentId === undefined ? KZ.cyan : KZ.violet).catch(() => undefined)
    return yield* next(e)
  })

  // Every tool call is a spike; a failed one adds a red inverted spike.
  on('tool.call', async ($, e, next) => {
    await beat($, 't', toolColor(String(e.tool))).catch(() => undefined)
    const ran = await next(e)
    if (ran.isError === true || ran.deny !== undefined) await beat($, 'f', KZ.red).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.context.percent !== undefined) {
      ctx = e.context.percent
      void publish($).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || snap.lastAt === 0 || snap.now - snap.lastAt >= SHOW_MS) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const hide = (
      <Button key="heartline-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    )

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns)
      const H = e.props.maxRows >= 10 ? 74 : 58
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row">
            <Svg source={ekgSvg(snap, W, H)} alt={ekgAlt(snap)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    if (!('Client' in ui)) return drawn
    const { Client } = ui
    const cols = Math.max(24, e.props.bodyColumns || 60)
    const rows = e.props.maxRows >= 10 ? 3 : 2
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client
            key="heartline"
            module="./trace.tsx"
            width={cols - 2}
            height={rows}
            props={{ beats: snap.beats, now: snap.now, bpm: snap.bpm, rpm: snap.rpm, ctx: snap.ctx, width: cols - 2, rows }}
          />
          {hide}
        </Box>
      </Box>
    )
  })
}
