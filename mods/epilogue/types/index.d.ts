export type EpilogueRecap = {
  id: string
  endedAt: number
  durationMs: number
  reason: string
  prompt: string
  tools: { family: string; count: number }[]
  toolCount: number
  files: string[]
  agents: number
  failed: { tool: string; detail: string }[]
  tokens: number
  outputTokens: number
  estUsd: number
  sessionDeltaUsd?: number
  summary?: string
}

declare module 'claude-code' {
  interface PluginState {
    epilogue: { recaps: EpilogueRecap[]; isShown: boolean; isHidden: boolean }
  }
}
