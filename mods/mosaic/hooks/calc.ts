// Mosaic math: pure functions, no `$`.
import type { MoDay, MoMetric } from '../types'

export const METRICS: readonly MoMetric[] = ['turns', 'tools', 'tokens', 'usd']
export const WEEKS = 26

export const zeroDay = (): MoDay => ({ s: 0, t: 0, c: 0, k: 0, u: 0, m: 0 })

// ---------------------------------------------------------------------------
// Local calendar days.

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Noon of a day key, so DST shifts never cross midnight. */
export function noonOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)
}

export function addDays(key: string, n: number): string {
  const d = noonOf(key)
  d.setDate(d.getDate() + n)
  return dayKey(d.getTime())
}

/** 0 = Sunday. */
export const weekdayOf = (key: string): number => noonOf(key).getDay()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthOf = (key: string): string => MONTHS[noonOf(key).getMonth()] ?? ''

// ---------------------------------------------------------------------------
// The ledger.

export type Days = Record<string, MoDay>

/** Adds `delta` to day `key` (a new object) and keeps only the last `keep` days. */
export function addTo(days: Days, key: string, delta: Partial<MoDay>, keep = 200): Days {
  const oldest = addDays(key, -(keep - 1))
  const out: Days = {}
  for (const [k, v] of Object.entries(days)) if (k >= oldest) out[k] = { ...zeroDay(), ...v }
  const d = out[key] ?? zeroDay()
  out[key] = {
    s: d.s + (delta.s ?? 0),
    t: d.t + (delta.t ?? 0),
    c: d.c + (delta.c ?? 0),
    k: d.k + (delta.k ?? 0),
    u: d.u + (delta.u ?? 0),
    m: d.m + (delta.m ?? 0),
  }
  return out
}

export const isEmptyDelta = (d: Partial<MoDay>): boolean => !d.s && !d.t && !d.c && !d.k && !d.u && !d.m

export function valueOf(d: MoDay | undefined, metric: MoMetric): number {
  if (!d) return 0
  return metric === 'turns' ? d.t : metric === 'tools' ? d.c : metric === 'tokens' ? d.k : d.u
}

/** A day counts toward a streak when anything happened in it. */
export const isActive = (d: MoDay | undefined): boolean => !!d && (d.t > 0 || d.c > 0 || d.s > 0 || d.m > 0)

/**
 * The calendar: `weeks` columns of 7 days (Sunday first), the last column
 * holding today. Days after today are `null`.
 */
export function calendar(today: string, weeks = WEEKS): (string | null)[][] {
  const lastSunday = addDays(today, -weekdayOf(today))
  const firstSunday = addDays(lastSunday, -(weeks - 1) * 7)
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const key = addDays(firstSunday, w * 7 + d)
      return key > today ? null : key
    }))
}

/** Quartile cut points of the non-zero values: levels 1..4 above zero. */
export function cutPoints(values: readonly number[]): [number, number, number] {
  const nz = values.filter(v => v > 0).sort((a, b) => a - b)
  if (nz.length === 0) return [0, 0, 0]
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 0
  return [q(0.25), q(0.5), q(0.75)]
}

export function levelOf(v: number, cuts: readonly [number, number, number]): number {
  if (v <= 0) return 0
  if (v <= cuts[0]) return 1
  if (v <= cuts[1]) return 2
  if (v <= cuts[2]) return 3
  return 4
}

/** Current streak (ending today, or yesterday while today is still empty) and the longest. */
export function streaks(days: Days, today: string, span = 400): { current: number; longest: number } {
  let longest = 0
  let run = 0
  for (let i = span - 1; i >= 0; i--) {
    const key = addDays(today, -i)
    run = isActive(days[key]) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  let current = 0
  let key = isActive(days[today]) ? today : addDays(today, -1)
  while (isActive(days[key])) {
    current++
    key = addDays(key, -1)
  }
  return { current, longest }
}

export function bestDay(days: Days, metric: MoMetric): { date: string; value: number } | undefined {
  let best: { date: string; value: number } | undefined
  for (const [date, d] of Object.entries(days)) {
    const v = valueOf(d, metric)
    if (v > 0 && (!best || v > best.value)) best = { date, value: v }
  }
  return best
}

export function totals(days: Days, keys: readonly string[]): MoDay {
  const t = zeroDay()
  for (const k of keys) {
    const d = days[k]
    if (!d) continue
    t.s += d.s
    t.t += d.t
    t.c += d.c
    t.k += d.k
    t.u += d.u
    t.m += d.m
  }
  return t
}

/** The minute index a time falls in. */
export const minuteOf = (ms: number): number => Math.floor(ms / 60_000)
