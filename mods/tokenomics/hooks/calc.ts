// Tokenomics math: pure functions, no `$`. The register module feeds them.
import { priceOf } from './lib/kz.ts'
import type { Usage } from './lib/kz.ts'
import type { TokByType, TokLedger, TokModelRow } from '../types'

export const TYPES = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
export type TypeKey = (typeof TYPES)[number]
export type ByType = TokByType

export const zeroByType = (): ByType => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** One request's tokens and estimated dollars, by token type. */
export function splitOf(model: string, u: Usage | null | undefined): { usd: ByType; tokens: ByType } {
  const tokens: ByType = {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  }
  const [i, o, r, w] = priceOf(model)
  const usd: ByType = {
    input: (tokens.input * i) / 1e6,
    output: (tokens.output * o) / 1e6,
    cacheRead: (tokens.cacheRead * r) / 1e6,
    cacheWrite: (tokens.cacheWrite * w) / 1e6,
  }
  return { usd, tokens }
}

export type ModelRow = TokModelRow

export type Ledger = TokLedger

export const emptyLedger = (): Ledger => ({ byModel: [], usd: zeroByType(), tokens: zeroByType(), steps: 0 })

const sum = (t: ByType): number => t.input + t.output + t.cacheRead + t.cacheWrite

/** Adds one request's usage to the running ledger (a new object). */
export function addUsage(l: Ledger, model: string, u: Usage | null | undefined): Ledger {
  if (!u) return l
  const s = splitOf(model, u)
  const usd = zeroByType()
  const tokens = zeroByType()
  for (const k of TYPES) {
    usd[k] = l.usd[k] + s.usd[k]
    tokens[k] = l.tokens[k] + s.tokens[k]
  }
  const key = model || 'unknown'
  const rows = l.byModel.map(r => ({ ...r }))
  const row = rows.find(r => r.model === key)
  if (row) {
    row.usd += sum(s.usd)
    row.tokens += sum(s.tokens)
    row.steps++
  } else rows.push({ model: key, usd: sum(s.usd), tokens: sum(s.tokens), steps: 1 })
  rows.sort((a, b) => b.usd - a.usd)
  return { byModel: rows, usd, tokens, steps: l.steps + 1 }
}

export const ledgerUsd = (l: Ledger): number => sum(l.usd)

/** Cache reads over everything read as input (uncached + cache read + cache write). */
export function cacheHitRatio(t: ByType): number | undefined {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all > 0 ? t.cacheRead / all : undefined
}

/** Dollars per hour from (time, cumulative usd) samples over the last `windowMs`. */
export function ratePerHour(samples: readonly (readonly [number, number])[], now: number, windowMs = 30 * 60_000, minSpanMs = 5 * 60_000): number | undefined {
  const recent = samples.filter(([t]) => t >= now - windowMs)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last) return undefined
  const span = last[0] - first[0]
  if (span < minSpanMs) return undefined
  return Math.max(0, ((last[1] - first[1]) / span) * 3600_000)
}

/** Session-average dollars per hour, from the start. */
export function averagePerHour(usd: number | undefined, startedAt: number, now: number): number | undefined {
  const span = now - startedAt
  if (usd === undefined || span < 60_000) return undefined
  return usd / (span / 3600_000)
}

/** How much of the cost is new since the last reading; a drop means the counter started over. */
export function costDelta(prev: number | undefined, cur: number): number {
  if (!Number.isFinite(cur) || cur <= 0) return 0
  if (prev === undefined || cur < prev) return cur
  return cur - prev
}

// ---------------------------------------------------------------------------
// Local calendar days.

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function parseDay(key: string): Date {
  // split always yields the year; month and day may be missing.
  const [y, m, d] = key.split('-').map(Number) as [number, number?, number?]
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12)
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key)
  d.setDate(d.getDate() + n)
  return dayKey(d.getTime())
}

export type Days = Record<string, number>

/** Adds `usd` to day `key` and drops days older than `keep` days before it. */
export function accrue(days: Days, key: string, usd: number, keep = 60): Days {
  const out: Days = {}
  const oldest = addDays(key, -(keep - 1))
  for (const [k, v] of Object.entries(days)) if (k >= oldest && Number.isFinite(v)) out[k] = v
  if (usd > 0) out[key] = (out[key] ?? 0) + usd
  return out
}

/** The last `n` days ending today, oldest first, zero-filled. */
export function lastDays(days: Days, today: string, n: number): { date: string; usd: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i - (n - 1))
    return { date, usd: days[date] ?? 0 }
  })
}

export function totalOf(rows: readonly { usd: number }[]): number {
  return rows.reduce((a, r) => a + r.usd, 0)
}

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export function weekday(key: string): string {
  return WD[parseDay(key).getDay()] ?? ''
}
