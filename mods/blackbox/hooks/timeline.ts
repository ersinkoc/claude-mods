// Blackbox's flight recording and how it is laid out: pure, no `$`.
import type { BbBar, BbTurn } from '../types'
import { Canvas, KZ, mix, toolColor } from './lib/kz.ts'

export const MAIN = 'main'
const AXIS_STEPS_S = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 450, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400]
const LABEL_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
export const MAX_BARS_PER_LANE = 160

/** The axis length for a turn `elapsedMs` old: the next round span with a little room left. */
export function axisSpan(elapsedMs: number, isLive: boolean): number {
  if (!isLive) return Math.max(1000, elapsedMs)
  const s = Math.max(0, elapsedMs) / 1000 * 1.05
  const step = AXIS_STEPS_S.find(v => v >= s)
  return (step ?? Math.ceil(s / 3600) * 3600) * 1000
}

/** Tick times (ms) for an axis `spanMs` long, at most `maxLabels` of them. */
export function axisTicks(spanMs: number, maxLabels: number): number[] {
  const span = spanMs / 1000
  const step = LABEL_STEPS_S.find(v => span / v <= Math.max(1, maxLabels)) ?? 3600
  const out: number[] = []
  for (let t = 0; t <= span + 1e-6; t += step) out.push(t * 1000)
  return out
}

export function fmtAxis(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? `${m}m${String(r).padStart(2, '0')}` : `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Which lanes fit: the main loop first, then the agents busiest lately; the rest are counted. */
export function pickLanes(turn: BbTurn, maxLanes: number): { lanes: string[]; hidden: number } {
  const agents = turn.lanes.filter(l => l !== MAIN)
  const room = Math.max(0, maxLanes - 1)
  if (agents.length <= room) return { lanes: [MAIN, ...agents], hidden: 0 }
  const lastActivity = (lane: string): number => {
    let at = 0
    for (const b of turn.bars) if (b.lane === lane) at = Math.max(at, b.e ?? Number.MAX_SAFE_INTEGER, b.s)
    for (const t of turn.ticks) if (t.lane === lane) at = Math.max(at, t.at)
    return at
  }
  const chosen = [...agents].sort((a, b) => lastActivity(b) - lastActivity(a)).slice(0, room)
  return { lanes: [MAIN, ...agents.filter(a => chosen.includes(a))], hidden: agents.length - chosen.length }
}

export function laneLabel(turn: BbTurn, lane: string): string {
  if (lane === MAIN) return 'main'
  return turn.labels[lane] || `agent ${lane.slice(0, 6)}`
}

/** Adds a bar, keeping each lane's newest `MAX_BARS_PER_LANE`. */
export function addBar(turn: BbTurn, bar: BbBar): void {
  if (!turn.lanes.includes(bar.lane)) turn.lanes.push(bar.lane)
  turn.bars.push(bar)
  const mine = turn.bars.filter(b => b.lane === bar.lane)
  if (mine.length > MAX_BARS_PER_LANE) {
    const drop = mine[0]
    turn.bars = turn.bars.filter(b => b !== drop)
  }
}

export function addTick(turn: BbTurn, lane: string, at: number): void {
  if (!turn.lanes.includes(lane)) turn.lanes.push(lane)
  turn.ticks.push({ lane, at })
  if (turn.ticks.length > 600) turn.ticks = turn.ticks.slice(-600)
}

/**
 * Parallel calls in one lane: each bar gets level 0 (top) or 1 (bottom), and
 * `overlaps` says whether it shares time with another, so both surfaces can
 * stack them as two half-height bars instead of painting one over the other.
 */
export function levels(bars: readonly BbBar[], end: number): Map<BbBar, { level: 0 | 1; overlaps: boolean }> {
  const out = new Map<BbBar, { level: 0 | 1; overlaps: boolean }>()
  const sorted = [...bars].sort((a, b) => a.s - b.s)
  const busyUntil: [number, number] = [-Infinity, -Infinity]
  for (const b of sorted) {
    const level: 0 | 1 = b.s >= busyUntil[0] ? 0 : 1
    const until = b.e ?? end
    busyUntil[level] = Math.max(busyUntil[level], until)
    out.set(b, { level, overlaps: false })
  }
  for (const [a, m] of out) {
    for (const b of sorted) {
      if (a === b) continue
      if (a.s < (b.e ?? end) && b.s < (a.e ?? end)) {
        m.overlaps = true
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The terminal picture: one Raster, a label column and the strip.

const TRACK = '#3a3a38'
const AXIS = '#6b6b67'
const CURSOR = '#ff4fa3'

export type Frame = { cells: string; columns: number; rows: number }

const dimmed = (c: string, isLive: boolean): string => (isLive ? c : mix(c, '#5a5a58', 0.6))

/**
 * Paints the recording at `now`: an axis row, then one row per lane. While
 * live the strip runs to the next round span and a pink cursor marks now.
 */
export function paint(turn: BbTurn, now: number, cols: number, maxLanes: number, isLive: boolean): Frame {
  const { lanes, hidden } = pickLanes(turn, maxLanes)
  const rows = 1 + lanes.length
  const c = new Canvas(cols, rows)
  const labelW = Math.max(8, Math.min(16, Math.floor(cols / 6)))
  const stripX = labelW + 1
  const stripW = Math.max(4, c.cols - stripX)
  const end = turn.endedAt ?? now
  const elapsed = Math.max(0, end - turn.startedAt)
  const span = axisSpan(elapsed, isLive)
  const xOf = (t: number): number => stripX + Math.min(stripW - 1, Math.max(0, Math.floor(((t - turn.startedAt) / span) * stripW)))

  // Header: the recorder's light, the clock, the hidden-lane count.
  const head = isLive ? `● REC ${fmtElapsed(elapsed)}` : `■ ${fmtElapsed(elapsed)}`
  c.text(0, 0, head.slice(0, labelW), isLive ? KZ.red : AXIS)
  if (hidden > 0) c.text(Math.min(labelW - 3, head.length + 1), 0, `+${hidden}`, KZ.violet)
  for (let x = stripX; x < stripX + stripW; x++) c.set(x, 0, '─', TRACK)
  const labelled = new Set<number>()
  for (const t of axisTicks(span, Math.max(1, Math.floor(stripW / 9)))) {
    const x = stripX + Math.min(stripW - 1, Math.round((t / span) * (stripW - 1)))
    c.set(x, 0, '┬', AXIS)
    const label = fmtAxis(t)
    // Pulled left at the end of the strip, so it always fits.
    const lx = Math.min(stripX + stripW - label.length, x + 1)
    c.text(lx, 0, label, AXIS)
    for (let i = 0; i < label.length; i++) labelled.add(lx + i)
  }

  lanes.forEach((lane, i) => {
    const y = i + 1
    const label = laneLabel(turn, lane)
    const glyph = lane === MAIN ? '▸ ' : '◈ '
    const text = (glyph + label).slice(0, labelW)
    c.text(0, y, text.padEnd(labelW, ' '), dimmed(lane === MAIN ? KZ.cyan : KZ.violet, isLive))
    c.set(labelW, y, '│', TRACK)
    for (let x = stripX; x < stripX + stripW; x++) c.set(x, y, '·', TRACK)
    for (const t of turn.ticks) if (t.lane === lane) c.set(xOf(t.at), y, '╎', dimmed(KZ.violet, isLive))
    const mine = turn.bars.filter(b => b.lane === lane)
    const lv = levels(mine, end)
    const topC = new Map<number, string>()
    const botC = new Map<number, string>()
    const solo = new Map<number, { color: string; isError: boolean }>()
    for (const b of mine) {
      const x0 = xOf(b.s)
      const x1 = Math.max(x0, xOf(b.e ?? end))
      const color = dimmed(b.isError ? KZ.red : toolColor(b.tool), isLive)
      const m = lv.get(b)
      for (let x = x0; x <= x1; x++) {
        if (!m?.overlaps) solo.set(x, { color, isError: b.isError })
        else (m.level === 0 ? topC : botC).set(x, color)
      }
    }
    for (const [x, v] of solo) if (!topC.has(x) && !botC.has(x)) c.set(x, y, v.isError ? '▓' : '█', v.color)
    for (const x of new Set([...topC.keys(), ...botC.keys()])) {
      const t = topC.get(x) ?? solo.get(x)?.color
      const b = botC.get(x)
      if (t && b) c.set(x, y, '▀', t, b)
      else if (t) c.set(x, y, '▀', t)
      // The cell is a key of one of the maps: no top means a bottom.
      else c.set(x, y, '▄', b)
    }
  })

  if (isLive) {
    const x = xOf(now)
    if (!labelled.has(x)) c.set(x, 0, '▼', CURSOR)
    for (let y = 1; y < rows; y++) c.set(x, y, '┃', CURSOR)
  }
  return { cells: c.encode(), columns: c.cols, rows: c.rows }
}
