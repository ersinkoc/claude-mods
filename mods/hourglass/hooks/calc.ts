// Hourglass math: pure functions, no `$`.
import { fmtSpan, windowMs } from './lib/kz.ts'
import type { HgVerdict } from '../types'

/** What the store keeps per window, across sessions. */
export type WinMemory = {
  resetsAt?: string
  /** [time ms, percent used], oldest first. */
  samples: [number, number][]
  /** Thresholds already toasted in this window. */
  toasted: number[]
}

export const THRESHOLDS = [80, 95] as const

const MAX_SAMPLES = 240
const RESAMPLE_MS = 5 * 60_000

/** Two reset times that differ by more than this are two windows. */
const RESET_SLACK_MS = 10 * 60_000

/** Whether the window started over since `w` was recorded. */
export function isReset(w: WinMemory | undefined, pct: number, resetsAt: string | undefined): boolean {
  if (!w) return false
  if (w.resetsAt && resetsAt) {
    const a = Date.parse(w.resetsAt)
    const b = Date.parse(resetsAt)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > RESET_SLACK_MS) return true
  }
  const last = w.samples[w.samples.length - 1]
  return last !== undefined && pct < last[1] - 0.5
}

/** Records a reading: starts the window over on a reset, samples on change or every 5 min, prunes. */
export function observe(w: WinMemory | undefined, kind: string, pct: number, resetsAt: string | undefined, now: number): WinMemory {
  const fresh: WinMemory = { resetsAt, samples: [], toasted: [] }
  const base = !w || isReset(w, pct, resetsAt) ? fresh : { resetsAt: resetsAt ?? w.resetsAt, samples: [...w.samples], toasted: [...w.toasted] }
  const last = base.samples[base.samples.length - 1]
  if (!last || last[1] !== pct || now - last[0] >= RESAMPLE_MS) base.samples.push([now, pct])
  const span = windowMs(kind) ?? 7 * 86_400_000
  base.samples = base.samples.filter(([t]) => t >= now - span).slice(-MAX_SAMPLES)
  return base
}

/** How far back the measured rate looks, per window. */
export function lookbackOf(kind: string): number {
  return kind === 'five_hour' ? 90 * 60_000 : 24 * 3600_000
}

/**
 * Percentage points per hour from the samples inside the lookback: the
 * slope from the first to the last reading there, once they span 10 min.
 */
export function measuredRate(samples: readonly (readonly [number, number])[], now: number, lookbackMs: number, minSpanMs = 10 * 60_000): number | undefined {
  const recent = samples.filter(([t]) => t >= now - lookbackMs)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || last[0] - first[0] < minSpanMs) return undefined
  return Math.max(0, ((last[1] - first[1]) / (last[0] - first[0])) * 3600_000)
}

/** The window's average burn since it began (reset time minus its length). */
export function averageRate(kind: string, pct: number, resetsAt: string | undefined, now: number): number | undefined {
  const len = windowMs(kind)
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (len === undefined || !Number.isFinite(end)) return undefined
  const elapsed = now - (end - len)
  if (elapsed < 10 * 60_000) return undefined
  return Math.max(0, (pct / elapsed) * 3600_000)
}

export type Forecast = { verdict: HgVerdict; etaMs?: number; marginMs?: number }

/** When the window runs dry at `rate` %/h, and whether the reset comes first. */
export function forecast(pct: number, rate: number | undefined, resetInMs: number | undefined): Forecast {
  if (pct >= 100) return { verdict: 'full', etaMs: 0, marginMs: resetInMs }
  if (rate === undefined) return { verdict: 'learning' }
  if (rate <= 0.01) return { verdict: 'idle', marginMs: resetInMs }
  const etaMs = ((100 - pct) / rate) * 3600_000
  if (resetInMs === undefined) return { verdict: 'safe', etaMs }
  if (etaMs > resetInMs) return { verdict: 'safe', etaMs, marginMs: etaMs - resetInMs }
  return { verdict: 'dry', etaMs, marginMs: resetInMs - etaMs }
}

/** The verdict as one line. */
export function verdictText(f: Forecast, resetInMs: number | undefined): string {
  switch (f.verdict) {
    case 'full':
      return resetInMs !== undefined ? `✖ limit reached — resets in ${fmtSpan(resetInMs)}` : '✖ limit reached'
    case 'dry':
      return `⚠ dry in ${fmtSpan(f.etaMs ?? 0)}, ${fmtSpan(f.marginMs ?? 0)} before reset`
    case 'safe':
      return f.marginMs !== undefined ? `✓ safe — resets ${fmtSpan(f.marginMs)} before you run dry` : `✓ safe — 100 % in ${fmtSpan(f.etaMs ?? 0)}`
    case 'idle':
      return resetInMs !== undefined ? `✓ safe — idle, resets in ${fmtSpan(resetInMs)}` : '✓ safe — idle'
    default:
      return '… learning your pace'
  }
}

/** Thresholds crossed now that were not toasted yet in this window. */
export function crossings(toasted: readonly number[], pct: number): number[] {
  return THRESHOLDS.filter(t => pct >= t && !toasted.includes(t))
}

/** `⏳ 5h 42% · 7d 18%`. */
export function statusText(windows: readonly { kind: string; pct: number }[], label: (kind: string) => string): string | undefined {
  if (windows.length === 0) return undefined
  return '⏳ ' + windows.map(w => `${label(w.kind)} ${Math.round(w.pct)}%`).join(' · ')
}
