export type ThrottleSnap = {
  /** Shown while something runs and for a minute after. */
  isVisible: boolean
  isWorking: boolean
  /** Output tokens per second over the last ~10 s, main loop and agents together. */
  speed: number
  speedPrev: number
  /** The dial's full scale (100, 200, 400, ...). */
  speedMax: number
  /** Percent of the 5-hour window left; null without a rate-limit reading. */
  fuel: number | null
  fuelPrev: number | null
  /** Context fill in percent. */
  temp: number | null
  tempPrev: number | null
  /** Session cost in USD. */
  odo: number | null
  odoPrev: number | null
  lamps: { engine: boolean; fuel: boolean; heat: boolean }
  /** Subagent loops that streamed in the last few seconds. */
  agents: number
  /** Milliseconds since the last activity (0 while working). */
  idleMs: number
}

declare module 'claude-code' {
  interface PluginState {
    throttle: { snap: ThrottleSnap | null; isHidden: boolean }
  }
}
