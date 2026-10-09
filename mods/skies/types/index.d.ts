export type Weather = 'clear' | 'fair' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'night' | 'rainbow'

export type SkiesSnap = {
  weather: Weather
  /** Failed tool calls among the last `total` (at most 20). */
  failed: number
  total: number
  /** Context fill and 5-hour use in percent, when known. */
  ctx: number | null
  fiveHour: number | null
  /** Minutes since the last tool call that succeeded, when there was one. */
  staleMin: number | null
  isWorking: boolean
  /** When this weather set in (ms). */
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    skies: { snap: SkiesSnap | null; isHidden: boolean }
  }
}
