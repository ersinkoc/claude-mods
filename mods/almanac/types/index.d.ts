/** One thing the session used: how often, and when first (ms since the session began). */
export type AlmanacEntry = { name: string; n: number; first: number }

export type AlmanacSnap = {
  /** Engine version, '' until $.session.version() answered. */
  version: string
  /** Session start ($.clock.now() ms) and the latest sample time. */
  startedAt: number
  now: number
  commands: AlmanacEntry[]
  skills: AlmanacEntry[]
  agents: AlmanacEntry[]
  mcp: AlmanacEntry[]
  models: AlmanacEntry[]
  plugins: AlmanacEntry[]
  families: AlmanacEntry[]
  /** Every tool call seen. */
  tools: number
  /** Slash commands the session offers ($.command.list), and how many of them never ran; -1 until listed. */
  installed: number
  unused: number
}

declare module 'claude-code' {
  interface PluginState {
    almanac: { snap: AlmanacSnap | null }
  }
}
