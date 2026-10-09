// Skies' climate: the session's weather from plain facts. No `$`.
import type { SkiesSnap, Weather } from '../types'

export const WINDOW = 20
export const RAINBOW_MS = 30_000

export type ClimateFacts = {
  /** The last tool calls, oldest first: true where it failed. */
  results: readonly boolean[]
  ctx: number | null
  fiveHour: number | null
  /** Minutes since the last tool call that succeeded, null before the first. */
  staleMin: number | null
  /** The local hour, 0..23. */
  hour: number
  isWorking: boolean
}

export const isNightHour = (hour: number): boolean => hour >= 22 || hour < 6

/**
 * The weather before any rainbow: storms come from many failures or an
 * exhausted 5-hour window, fog from a nearly full context, rain from a few
 * failures, heavy limits or a long stall; clouds from any pressure; night
 * when the hour is late and nothing runs.
 */
export function climate(f: ClimateFacts): Exclude<Weather, 'rainbow'> {
  const recent = f.results.slice(-WINDOW)
  const failed = recent.filter(Boolean).length
  const ctx = f.ctx ?? 0
  const limit = f.fiveHour ?? 0
  const stale = f.isWorking && f.staleMin !== null ? f.staleMin : 0
  if (failed >= 5 || limit >= 95) return 'storm'
  if (ctx > 85) return 'fog'
  if (failed >= 3 || limit >= 85 || stale >= 10) return 'rain'
  const calm = !f.isWorking && isNightHour(f.hour)
  if (failed >= 1 || ctx >= 65 || limit >= 70 || stale >= 4) return calm ? 'night' : 'cloudy'
  if (calm) return 'night'
  if (ctx >= 40 || limit >= 50) return 'fair'
  return 'clear'
}

export type Bow = { until: number; stormAt: number | undefined }

const WET: readonly Weather[] = ['storm', 'rain', 'fog']

/**
 * A storm that clears leaves a rainbow for thirty seconds. Failures slide out
 * of the window one by one, so a storm usually eases into rain first: the bow
 * appears when the sky turns dry again within ten minutes of the last storm.
 */
export function nextRainbow(prev: Weather | undefined, next: Weather, now: number, bow: Bow): Bow {
  if (next === 'storm') return { until: 0, stormAt: now }
  if (WET.includes(next)) return { until: 0, stormAt: bow.stormAt }
  const wasWet = prev !== undefined && WET.includes(prev)
  if (wasWet && bow.stormAt !== undefined && now - bow.stormAt < 10 * 60_000) return { until: now + RAINBOW_MS, stormAt: undefined }
  return bow
}

export const WEATHER: Record<Weather, { icon: string; name: string }> = {
  clear: { icon: '☀', name: 'Clear' },
  fair: { icon: '🌤', name: 'Fair' },
  cloudy: { icon: '⛅', name: 'Cloudy' },
  rain: { icon: '🌧', name: 'Rain' },
  storm: { icon: '⛈', name: 'Storm' },
  fog: { icon: '🌫', name: 'Fog' },
  night: { icon: '🌙', name: 'Night' },
  rainbow: { icon: '🌈', name: 'Rainbow' },
}

/** "⛈ Storm · 6/20 tools failed · ctx 91 % · 5h 88 %" */
export function forecast(s: SkiesSnap): string {
  const w = WEATHER[s.weather]
  const bits = [`${w.icon} ${w.name}`]
  bits.push(s.total ? `${s.failed}/${s.total} tools failed` : 'no tools yet')
  if (s.ctx !== null) bits.push(`ctx ${Math.round(s.ctx)} %`)
  if (s.fiveHour !== null) bits.push(`5h ${Math.round(s.fiveHour)} %`)
  if (s.isWorking && s.staleMin !== null && s.staleMin >= 4) bits.push(`${Math.round(s.staleMin)} min since a tool worked`)
  return bits.join(' · ')
}

/** "+0300" or "-0530" (date +%z), or a number of minutes, as minutes east of UTC. */
export function parseOffset(text: string): number | undefined {
  const t = text.trim()
  const z = /^([+-])(\d{2}):?(\d{2})$/.exec(t)
  if (z) return (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3]))
  const n = Number(t)
  return t !== '' && Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : undefined
}

export function localHour(now: number, offsetMin: number): number {
  return new Date(now + offsetMin * 60_000).getUTCHours()
}
