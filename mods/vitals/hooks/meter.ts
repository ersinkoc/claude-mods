// vitals' own pure helpers: unix probes the shared kit lacks, history, and
// the chart geometry. No `$` here.

import { Canvas, brailleGraph, heat } from './lib/kz.ts'

/** How many samples a history keeps (2 s apart: four minutes). */
export const HISTORY = 120

export function pushHist(hist: readonly number[], v: number | undefined): number[] {
  return v === undefined || !Number.isFinite(v) ? [...hist] : [...hist, v].slice(-HISTORY)
}

/** Unix: `df -kP /`, the second line. */
export const DF_ROOT = ['df', '-kP', '/'] as const

export function parseDf(out: string): { diskUsed?: number; diskTotal?: number } {
  const line = out.split('\n').filter(Boolean)[1]
  if (!line) return {}
  const f = line.trim().split(/\s+/)
  const total = Number(f[1])
  const used = Number(f[2])
  return Number.isFinite(total) && total > 0 && Number.isFinite(used) ? { diskTotal: total * 1024, diskUsed: used * 1024 } : {}
}

/** Unix: one pid per line. */
export const PS_PIDS = ['ps', '-A', '-o', 'pid='] as const

export function countLines(out: string): number | undefined {
  const n = out.split('\n').filter(l => l.trim()).length
  return n > 0 ? n : undefined
}

export function avg(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Temperature tone: cool under 50 °C, hot from 85 °C. */
export function tempRatio(c: number): number {
  return Math.max(0, Math.min(1, (c - 40) / 45))
}

/**
 * A braille graph as Raster cells, colored like btop: each row by the height
 * it stands for (green low, red high), on the terminal's own background.
 */
export function brailleCanvas(values: readonly number[], cols: number, rows: number, max = 100, tint?: (level: number) => string): Canvas {
  const c = new Canvas(cols, rows)
  const lines = brailleGraph(values, cols, rows, max)
  const tone = tint ?? heat
  lines.forEach((line, r) => {
    const level = (rows - r - 0.5) / rows
    const color = tone(level)
    let x = 0
    for (const ch of line) {
      c.set(x, r, ch, color)
      x++
    }
  })
  return c
}

/**
 * The points of an area chart over a fixed history: the newest sample sits
 * at the right edge and older ones walk left, as a strip chart scrolls.
 */
export function chartPoints(values: readonly number[], x: number, y: number, w: number, h: number, max: number): [number, number][] {
  const step = w / (HISTORY - 1)
  const top = Math.max(1e-9, max)
  const n = values.length
  return values.map((v, i) => [x + w - (n - 1 - i) * step, y + h - Math.max(0, Math.min(1, v / top)) * h])
}

/** Line and area paths through points, with gentle cubic smoothing. */
export function smoothPaths(pts: readonly [number, number][], baseY: number): { line: string; area: string } {
  if (pts.length === 0) return { line: '', area: '' }
  const f = (n: number) => n.toFixed(1)
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    const mx = (x0 + x1) / 2
    d += `C${f(mx)},${f(y0)} ${f(mx)},${f(y1)} ${f(x1)},${f(y1)}`
  }
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return { line: d, area: `${d}L${f(last[0])},${f(baseY)}L${f(first[0])},${f(baseY)}Z` }
}
