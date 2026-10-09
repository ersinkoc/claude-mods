/** One local day: sessions started, turns, tool calls, tokens, dollars, active minutes. */
export type MoDay = { s: number; t: number; c: number; k: number; u: number; m: number }

export type MoMetric = 'turns' | 'tools' | 'tokens' | 'usd'

export type MoSnap = {
  now: number
  /** Today's local date, YYYY-MM-DD. */
  today: string
  /** Days with any activity inside the drawn range, by local date. */
  days: Record<string, MoDay>
  isWorking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    mosaic: { snap: MoSnap | null; metric: MoMetric }
  }
}
