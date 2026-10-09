import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { BbBar, BbTurn, BlackboxSnap } from '../types'
import { recorderSvg } from './svg.ts'
import { addBar, addTick, axisSpan, MAIN, paint } from './timeline.ts'

const snapAtom = atom({ plugin: 'blackbox', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'blackbox', key: 'isHidden' } as const, false)

/** Lanes the terminal shows: an axis row plus three keeps the band at four rows. */
const TERMINAL_LANES = 3
const BLIT_MS = 125

// ---------------------------------------------------------------------------
// The live recording. Module variables start over on a reload.

let turn: BbTurn | null = null
let isLive = false
let isHiddenNow = false
const names = new Map<string, string>()
let lastSpan = 0
let lastPublishAt = 0
let blitTimer: Timer | undefined
let syncTimer: Timer | undefined
/** Where the terminal band last drew the Raster, so the timer can repaint it. */
let mounted: { requestId: string; columns: number; rows: number; lanes: number } | undefined

function copyTurn(t: BbTurn): BbTurn {
  return { ...t, lanes: [...t.lanes], labels: { ...t.labels }, bars: t.bars.map(b => ({ ...b })), ticks: t.ticks.map(k => ({ ...k })) }
}

async function publish($: EngineInterface): Promise<void> {
  if (!turn) return
  const now = await $.clock.now()
  lastPublishAt = now
  lastSpan = axisSpan((turn.endedAt ?? now) - turn.startedAt, isLive)
  const snap: BlackboxSnap = { turn: copyTurn(turn), isLive, now }
  await update($, snapAtom, () => snap)
}

function laneOf(agentId: string | undefined): string {
  if (agentId === undefined) return MAIN
  if (turn && !turn.labels[agentId] && names.has(agentId)) turn.labels[agentId] = names.get(agentId) ?? ''
  return agentId
}

/** Between events: repaint the terminal Raster so the cursor and running bars move. */
async function frame($: EngineInterface): Promise<void> {
  if (!turn || !isLive || !mounted || isHiddenNow) return
  const now = await $.clock.now()
  const f = paint(turn, now, mounted.columns, mounted.lanes, true)
  if (f.rows !== mounted.rows || f.columns !== mounted.columns) return
  try {
    await $.ui.blit({ requestId: mounted.requestId, key: 'blackbox-rec', cells: f.cells })
  } catch {
    mounted = undefined
  }
}

/** Once a second: names for new lanes, and a fresh snapshot when the axis rescales. */
async function sync($: EngineInterface): Promise<void> {
  if (!turn || !isLive) return
  const now = await $.clock.now()
  const unnamed = turn.lanes.filter(l => l !== MAIN && !turn?.labels[l])
  if (unnamed.length) {
    try {
      for (const a of await $.agent.list()) if (a.description) names.set(a.id, a.description)
      for (const l of unnamed) laneOf(l)
    } catch {
      // Unnamed lanes keep their short id.
    }
  }
  const span = axisSpan(now - turn.startedAt, true)
  if (span !== lastSpan || now - lastPublishAt >= 5000 || unnamed.length) await publish($)
}

function stopTimers(): void {
  blitTimer?.cancel()
  syncTimer?.cancel()
  blitTimer = syncTimer = undefined
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  isHiddenNow = isHidden
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session only.
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  try {
    const v = await $.store.get('isHidden')
    if (typeof v === 'boolean') {
      isHiddenNow = v
      await update($, hiddenAtom, () => v)
    }
  } catch {
    // Nothing stored.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    turn = null
    isLive = false
    mounted = undefined
    stopTimers()
    await $.command.register({ name: 'blackbox', description: 'KOZMOS: show or hide the Blackbox flight recorder above the prompt', immediate: true })
    await loadHidden($)
    return started
  })

  on('command.run', { command: 'blackbox' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Blackbox hidden. /blackbox brings it back.' : 'Blackbox shown: it records each turn as it runs.' }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    turn = { turnId: e.turnId, startedAt: now, endedAt: null, lanes: [MAIN], labels: {}, bars: [], ticks: [] }
    isLive = true
    stopTimers()
    blitTimer = $.clock.every(BLIT_MS, () => void frame($).catch(() => undefined))
    syncTimer = $.clock.every(1000, () => void sync($).catch(() => undefined))
    await publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && turn && isLive) {
      turn.endedAt = await $.clock.now()
      isLive = false
      stopTimers()
      await publish($)
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) names.set(spawned.agentId, e.description || e.subagentType)
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (turn && isLive) {
      addTick(turn, laneOf(e.agentId), await $.clock.now())
      void publish($).catch(() => undefined)
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!turn || !isLive) return next(e)
    const recording = turn
    const bar: BbBar = { lane: laneOf(e.agentId), tool: String(e.tool), s: await $.clock.now(), e: null, isError: false }
    addBar(recording, bar)
    void publish($).catch(() => undefined)
    const ran = await next(e)
    bar.e = await $.clock.now()
    bar.isError = ran.isError === true || ran.deny !== undefined
    if (turn === recording) void publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap) return drawn
    const cols = Math.max(24, (e.props.bodyColumns || 80) - 3)

    if (e.surface === 'terminal') {
      const { Box, Button, Raster } = $.ui.resolve(e)
      const now = snap.isLive ? Math.max(snap.now, await $.clock.now()) : snap.now
      // Fewer lanes when the band is short, so the whole band keeps its room.
      const lanes = e.props.maxRows >= 10 ? TERMINAL_LANES : e.props.maxRows >= 6 ? 2 : 1
      const f = paint(snap.turn, now, cols, lanes, snap.isLive)
      // A module variable, not state: the blit timer's address for this Raster.
      mounted = { requestId: e.requestId, columns: f.columns, rows: f.rows, lanes }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="blackbox" flexDirection="row">
            <Raster key="blackbox-rec" columns={f.columns} rows={f.rows} cells={f.cells} />
            <Button key="blackbox-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    if ('Svg' in ui) {
      const { Box, Button, Svg } = ui
      const pic = recorderSvg(snap, cols * 8 - 8)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="blackbox" flexDirection="row">
            <Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
            <Button key="blackbox-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }
    return drawn
  })
}

