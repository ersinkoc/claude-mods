/** One tool call on the recording: its loop's lane, the tool, start and end (null while running). */
export type BbBar = { lane: string; tool: string; s: number; e: number | null; isError: boolean }

/** One model request: a thin tick where it was sent. */
export type BbTick = { lane: string; at: number }

export type BbTurn = {
  turnId: string
  startedAt: number
  /** Null while the turn runs. */
  endedAt: number | null
  /** 'main' first, then each subagent id in the order it first showed up. */
  lanes: string[]
  /** A subagent's description by its id. */
  labels: Record<string, string>
  bars: BbBar[]
  ticks: BbTick[]
}

export type BlackboxSnap = {
  turn: BbTurn
  isLive: boolean
  /** When the snapshot was taken. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    blackbox: { snap: BlackboxSnap | null; isHidden: boolean }
  }
}
