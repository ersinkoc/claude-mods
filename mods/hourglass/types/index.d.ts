export type HgVerdict = 'safe' | 'idle' | 'dry' | 'full' | 'learning'

export type HgWindow = {
  kind: string
  /** Percent used, 0..100 (past 100 on an exceeded spend limit). */
  pct: number
  resetsAt?: string
  /** Milliseconds until the window resets, when known. */
  resetInMs?: number
  /** Measured burn in percentage points per hour. */
  rate?: number
  /** Where the rate came from: recent samples, or the window's average since it began. */
  rateSource?: 'measured' | 'average'
  /** Milliseconds until 100 % at the current rate. */
  etaMs?: number
  verdict: HgVerdict
  /** Safe: how long before running dry the window resets; dry: how long before the reset it runs dry. */
  marginMs?: number
  /** Recent percent readings, oldest first, for a sparkline. */
  history: number[]
}

export type HgSnap = {
  now: number
  isWorking: boolean
  windows: HgWindow[]
}

declare module 'claude-code' {
  interface PluginState {
    hourglass: { snap: HgSnap | null }
  }
}
