export type BallastCompaction = {
  /** Tokens in the window before and after; null when the engine did not say. */
  before: number | null
  after: number | null
  at: number
  /** Who compacted: `you` (/compact), `auto` (the engine), `ballast`. */
  by: string
}

export type BallastSnap = {
  /** The context fill, 0-100, or null before the first reading. */
  percent: number | null
  tokens: number | null
  window: number
  warnAt: number
  actAt: number
  autoCompact: boolean
  isWorking: boolean
  /** A compaction asked for while a turn ran, waiting for turn.complete. */
  isQueued: boolean
  isCompacting: boolean
  /** "Not now" at this percent: the band rests until the fill grows 4 points. */
  snoozedAt: number | null
  last: BallastCompaction | null
}

declare module 'claude-code' {
  interface PluginState {
    ballast: { snap: BallastSnap; isHidden: boolean }
  }
}
