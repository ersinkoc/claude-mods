/** One beat of the trace: a tool call (`t`), a model request (`s`) or a failed tool (`f`). */
export type HeartBeat = { at: number; k: 't' | 's' | 'f'; c: string }

export type HeartSnap = {
  now: number
  /** Beats of the last few minutes, oldest first. */
  beats: HeartBeat[]
  /** Tool calls in the last minute. */
  bpm: number
  /** Model requests in the last minute. */
  rpm: number
  /** Context fill, 0..100, or null before the first reading. */
  ctx: number | null
  /** Last activity of any kind; the band shows for 10 minutes after it. */
  lastAt: number
  isWorking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    heartline: { snap: HeartSnap | null; isHidden: boolean }
  }
}
