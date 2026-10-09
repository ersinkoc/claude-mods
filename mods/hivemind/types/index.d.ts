export type HiveStatus = 'running' | 'done' | 'failed' | 'waiting'

export type HiveTool = { id: string; name: string; detail: string; startedAt: number }

export type HiveLastTool = { name: string; detail: string; ms: number; isError: boolean }

export type HiveNode = {
  id: string
  parentId?: string
  type: string
  description: string
  status: HiveStatus
  model?: string
  effort?: string
  startedAt: number
  endedAt?: number
  steps: number
  tokens: number
  usd: number
  ctxPct?: number
  tools: number
  tool?: HiveTool
  lastTool?: HiveLastTool
  isBackground?: boolean
}

export type HiveSnap = {
  root: HiveNode
  agents: HiveNode[]
  /** Running subagents, one sample per second while anything runs. */
  history: number[]
  now: number
}

export type HiveView = { showDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    hivemind: { snap: HiveSnap | null; view: HiveView }
  }
}
