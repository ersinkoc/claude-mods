// Spectra math: pure functions, no `$`.
import { KZ, hue } from './lib/kz.ts'
import type { SpCategory } from '../types'

/** Fraction of the window assumed for auto-compact when the engine gives no threshold. */
export const ASSUMED_COMPACT = 0.95

/** A palette color per category, by what it is (kind first, then its name). */
export function categoryColor(name: string, kind: string, index: number): string {
  if (kind === 'free') return '#52525b'
  if (kind === 'buffer') return KZ.amber
  if (kind === 'deferred') return KZ.mist
  const n = name.toLowerCase()
  if (n.includes('system prompt')) return KZ.violet
  if (n.includes('mcp')) return KZ.magenta
  if (n.includes('tool')) return KZ.blue
  if (n.includes('memory')) return KZ.teal
  if (n.includes('agent')) return KZ.cyan
  if (n.includes('skill')) return KZ.lime
  if (n.includes('command')) return KZ.green
  if (n.includes('message')) return KZ.yellow
  return hue(0.13 * index + 0.05)
}

export type RawCategory = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export function toCategories(raw: readonly RawCategory[], window: number): SpCategory[] {
  return raw.map((c, i) => ({
    name: c.name,
    tokens: c.tokens,
    kind: c.kind,
    color: categoryColor(c.name, c.kind, i),
    pct: window > 0 ? (c.tokens / window) * 100 : 0,
  }))
}

/** Used categories by size, then the free space and the buffer; deferred rows last. */
export function ranked(cats: readonly SpCategory[]): SpCategory[] {
  const rank = (k: string) => (k === 'used' ? 0 : k === 'free' ? 1 : k === 'buffer' ? 2 : 3)
  return [...cats].sort((a, b) => rank(a.kind) - rank(b.kind) || b.tokens - a.tokens)
}

/** The breakdown's grid as [category index, fullness] pairs; -1 for a name not listed. */
export function toGrid(rows: readonly (readonly { categoryName: string; squareFullness: number; isFilled: boolean }[])[], cats: readonly SpCategory[]): [number, number][][] {
  return rows.map(r => r.map(sq => [cats.findIndex(c => c.name === sq.categoryName), sq.isFilled ? Math.max(0, Math.min(1, sq.squareFullness)) : 0] as [number, number]))
}

/** The auto-compact threshold: the engine's, else 95 % of the window. */
export function thresholdOf(engine: number | undefined, window: number): { tokens: number; source: 'engine' | 'assumed' } {
  if (engine !== undefined && engine > 0) return { tokens: engine, source: 'engine' }
  return { tokens: Math.round(window * ASSUMED_COMPACT), source: 'assumed' }
}

/**
 * The recent run of the growth series: the points since the last drop (a
 * compaction or a /clear), at most `k + 1` of them.
 */
export function recentRun(series: readonly number[], k = 6): number[] {
  let start = 0
  for (let i = 1; i < series.length; i++) if ((series[i] ?? 0) < (series[i - 1] ?? 0) * 0.9) start = i
  return series.slice(start).slice(-(k + 1))
}

/** Tokens per turn: least-squares slope over the recent run; needs 2 points. */
export function growthSlope(series: readonly number[], k = 6): number | undefined {
  const ys = recentRun(series, k)
  const n = ys.length
  if (n < 2) return undefined
  const mx = (n - 1) / 2
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my)
    den += (x - mx) * (x - mx)
  })
  return den > 0 ? num / den : undefined
}

/** Whole turns until `current` reaches `threshold` at `slope` per turn. */
export function turnsUntil(current: number, threshold: number, slope: number | undefined): number | undefined {
  if (slope === undefined || slope <= 0) return undefined
  if (current >= threshold) return 0
  return Math.ceil((threshold - current) / slope)
}
