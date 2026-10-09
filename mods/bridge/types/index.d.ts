export type BridgeLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type BridgeSnap = {
  model: string
  effort?: string
  isWorking: boolean
  ctxTokens?: number
  ctxWindow: number
  ctxPercent?: number
  limits: BridgeLimit[]
  costUsd?: number
  startedAt: number
  branch: string
  isRepo: boolean
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  cpu?: number
  cpuHistory: number[]
  memUsed?: number
  memTotal?: number
  gpuUtil?: number
  gpuName?: string
  agentsRunning: number
  agentsDone: number
  agentsFailed: number
  tool?: { name: string; detail: string; startedAt: number }
  lastTool?: { name: string; detail: string; ms: number; isError: boolean }
  toolCount: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    bridge: { snap: BridgeSnap | null }
  }
}
