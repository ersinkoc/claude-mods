export type WarpSnap = {
  /** The clock when this snapshot was taken (ms). */
  now: number
  /** True while a main turn runs. */
  isWorking: boolean
  /** Output tokens per second over the last few seconds. */
  rate: number
  /** 0 (drift) .. 1 (hyperspace). */
  speed: number
  /** Output tokens this turn, subagents included. */
  tokens: number
  /** When the running turn began, 0 when none ran yet. */
  turnStartedAt: number
  /** The last jump: a turn that ended, numbered. */
  arrival?: { seq: number; at: number; durationMs: number; tokens: number; isAborted: boolean }
  /** Whether the band shows: working, or within a few seconds of a jump. */
  visible: boolean
}

declare module 'claude-code' {
  interface PluginState {
    warpdrive: { snap: WarpSnap | null; isHidden: boolean }
  }
}
