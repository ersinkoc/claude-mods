export type ChronKind =
  | 'session'
  | 'prompt'
  | 'turn'
  | 'agent-start'
  | 'agent-end'
  | 'commit'
  | 'push'
  | 'tool-fail'
  | 'compact'
  | 'limit'
  | 'context'

export type ChronEvent = {
  id: number
  at: number
  kind: ChronKind
  title: string
  detail?: string
  /** Drawn red, and kept by the Errors filter. */
  isError?: boolean
}

export type ChronFilter = 'all' | 'prompts' | 'agents' | 'git' | 'errors'

export type ChronSnap = {
  /** Oldest first, at most 300. */
  events: ChronEvent[]
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    chronicle: { snap: ChronSnap | null; filter: ChronFilter }
  }
}
