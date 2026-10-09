export type GearTool = {
  name: string
  calls: number
  errors: number
  totalMs: number
  avgMs: number
  p95Ms: number
  maxMs: number
  /** Calls made by the main loop and by subagents. */
  main: number
  sub: number
}

export type GearSlow = { name: string; detail: string; ms: number; at: number; agent?: string; isError: boolean }

export type GearSort = 'time' | 'calls' | 'errors'

export type GearSnap = {
  tools: GearTool[]
  slowest: GearSlow[]
  /** Calls started in each minute of the session, oldest first (at most 120). */
  perMinute: number[]
  startedAt: number
  mainCalls: number
  subCalls: number
  mainMs: number
  subMs: number
  inFlight: number
}

declare module 'claude-code' {
  interface PluginState {
    gearbox: { snap: GearSnap | null; sort: GearSort }
  }
}
