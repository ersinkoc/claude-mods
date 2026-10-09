export type SpCategory = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
  /** A palette color the mod chose for the row. */
  color: string
  /** Share of the measured window, 0..100. */
  pct: number
}

export type SpSnap = {
  now: number
  /** The session's start, to tell a reload from a new session. */
  startedAt: number
  model: string
  /** The window the breakdown measured against (may be the compaction window). */
  window: number
  /** Tokens in use, by the breakdown's estimate. */
  total: number
  percentage: number
  /** Auto-compact threshold in tokens. */
  threshold: number
  /** `engine` when the breakdown gave the threshold, `assumed` for 95 % of the window. */
  thresholdSource: 'engine' | 'assumed'
  isAutoCompact: boolean
  categories: SpCategory[]
  /** The breakdown's grid, row by row: [category index or -1, fullness 0..1]. */
  grid: [number, number][][]
  /** Context tokens at each main-loop turn.complete, oldest first. */
  growth: number[]
  /** Tokens added per turn over the recent run. */
  slope?: number
  /** Turns left until auto-compact at that slope. */
  turnsLeft?: number
  memoryFiles: number
  mcpTools: number
  hasBreakdown: boolean
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    spectra: { snap: SpSnap | null }
  }
}
