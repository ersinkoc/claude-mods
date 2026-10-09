export type SwitchStatus = 'healthy' | 'erroring' | 'idle' | 'busy'

export type SwitchTool = {
  name: string
  /** Listed by $.tool.list() now. */
  isListed: boolean
  calls: number
  errors: number
  avgMs: number | null
  p95Ms: number | null
  lastAt: number | null
  inFlight: number
}

export type SwitchServer = {
  name: string
  /** Tools of this server the model can call now. */
  toolCount: number
  calls: number
  errors: number
  avgMs: number | null
  p95Ms: number | null
  lastAt: number | null
  lastTool: string | null
  lastError: string | null
  inFlight: number
  status: SwitchStatus
  tools: SwitchTool[]
}

export type SwitchSnap = {
  servers: SwitchServer[]
  calls: number
  errors: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: { snap: SwitchSnap; expanded: string[] }
  }
}
