/** One tool family's count in a turn, with a representative tool name for its glyph and color. */
export type StampChip = { family: string; tool: string; n: number }

/** What one finished main-loop turn did. */
export type StampReceipt = {
  turnId: string
  /** turn.complete's wall-clock length, used to find the turn's TurnDuration line. */
  durationMs: number
  /** When the turn ended, in $.clock.now() ms. */
  endedAt: number
  reason: string
  tools: number
  chips: StampChip[]
  /** Fresh input: uncached input plus cache writes. */
  inTokens?: number
  outTokens?: number
  cacheRead?: number
  costUsd?: number
  ctxPercent?: number
  ctxDelta?: number
}

declare module 'claude-code' {
  interface PluginState {
    stamp: { receipts: StampReceipt[]; isOn: boolean }
  }
}
