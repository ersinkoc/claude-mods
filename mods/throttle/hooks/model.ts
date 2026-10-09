// Throttle's arithmetic: no `$`, no engine, so the tests can drive it directly.

/** Output tokens a model request produced between `s` and `e` (ms). */
export type Span = { s: number; e: number; tok: number }

/** How many characters of streamed text make one output token, roughly. */
export const CHARS_PER_TOKEN = 4

/** The window the speedometer averages over. */
export const SPEED_WINDOW_MS = 10_000

/**
 * Output tokens per second over the last `windowMs`, every span spread evenly
 * over its own length. The divisor is the part of the window that actually saw
 * output (at least 2 s), so the needle reads the current pace from the first
 * seconds of a stream instead of creeping up for ten seconds.
 */
export function tokensPerSec(spans: readonly Span[], now: number, windowMs = SPEED_WINDOW_MS): number {
  const from = now - windowMs
  let tok = 0
  let earliest = now
  for (const sp of spans) {
    const end = Math.min(sp.e, now)
    if (end <= from || sp.s >= now || sp.tok <= 0) continue
    const start = Math.max(sp.s, from)
    const len = sp.e - sp.s
    const share = len <= 0 ? 1 : Math.max(0, (end - start) / len)
    tok += sp.tok * share
    if (start < earliest) earliest = start
  }
  if (tok <= 0) return 0
  const seen = Math.min(windowMs, Math.max(2000, now - earliest))
  return tok / (seen / 1000)
}

/** The dial's full scale: the smallest of 100, 200, 400 ... that holds `peak` with 10 % headroom. */
export function speedScale(peak: number): number {
  let top = 100
  while (top < peak * 1.1 && top < 102_400) top *= 2
  return top
}

/** Fuel left in the 5-hour window, 0..100, or null without a reading. */
export function fuelLeft(limits: readonly { kind: string; percentUsed: number }[]): number | null {
  const five = limits.find(l => l.kind === 'five_hour')
  if (!five || !Number.isFinite(five.percentUsed)) return null
  return Math.max(0, Math.min(100, 100 - five.percentUsed))
}

export type Lamps = { engine: boolean; fuel: boolean; heat: boolean }

export const ENGINE_LAMP_MS = 30_000
export const FUEL_LAMP_BELOW = 15
export const HEAT_LAMP_ABOVE = 85

export function lamps(now: number, failedAt: number | undefined, fuel: number | null, temp: number | null): Lamps {
  return {
    engine: failedAt !== undefined && now - failedAt < ENGINE_LAMP_MS,
    fuel: fuel !== null && fuel < FUEL_LAMP_BELOW,
    heat: temp !== null && temp > HEAT_LAMP_ABOVE,
  }
}

/** Drops spans that ended before the window (keeping a minute for the peak). */
export function prune(spans: Span[], now: number, keepMs = 60_000): Span[] {
  return spans.filter(sp => sp.e > now - keepMs)
}

/** `$12.34` as odometer wheels: `0012.34` (wraps past 9999.99). */
export function odoDigits(usd: number): string {
  const cents = Math.max(0, Math.round(usd * 100)) % 1_000_000
  const s = String(cents).padStart(6, '0')
  return `${s.slice(0, 4)}.${s.slice(4)}`
}
