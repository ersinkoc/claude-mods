/** The tool a loop is running now. */
export type MantraTool = { name: string; label: string; startedAt: number }

export type MantraLive = {
  /** Running tool per loop: 'main', or a subagent's id. */
  tools: Record<string, MantraTool>
  /** Loops seen calling tools, so a subagent's spinner never borrows main's tool. */
  agents: string[]
  effort?: string
  isWorking: boolean
  /** Seeds the word order for the turn. */
  turnSeed: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    mantra: { live: MantraLive; pack: string; isOn: boolean }
  }
}
