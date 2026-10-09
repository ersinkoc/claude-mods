export type TokTypeKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite'
export type TokByType = Record<TokTypeKey, number>
export type TokModelRow = { model: string; usd: number; tokens: number; steps: number }
export type TokLedger = { byModel: TokModelRow[]; usd: TokByType; tokens: TokByType; steps: number }

export type TokSnap = {
  /** The engine's session total, when the host keeps a ledger. */
  costUsd?: number
  startedAt: number
  now: number
  isWorking: boolean
  /** Estimated from every turn.step usage, main loop and subagents. */
  ledger: TokLedger
  /** Cost of each finished main-loop turn, oldest first (last 48). */
  turnCosts: number[]
  turns: number
  /** Recent burn (last 30 min), else the session average. */
  perHour?: number
  avgPerHour?: number
  /** The last 14 local days, oldest first, today last. */
  days: { date: string; usd: number }[]
  weekUsd: number
  todayUsd: number
}

declare module 'claude-code' {
  interface PluginState {
    tokenomics: { snap: TokSnap | null }
  }
}
