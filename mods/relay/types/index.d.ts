/** One model request (a `turn.step`): how long it took and what it moved. */
export type RelayReq = {
  /** `turnId:index`. */
  id: string
  /** When the request started, `$.clock.now()` milliseconds. */
  at: number
  /** From the step's start to its result. */
  ms: number
  /** From the step's start to the first text, thinking or tool chunk. */
  ttft?: number
  /** The model that answered (the usage's), else the one the request named. */
  model: string
  effort?: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Output tokens per second over the streaming part (after the first chunk). */
  tps?: number
  /** Why the model stopped; null when no response arrived. */
  stop: string | null
  /** `main`, or the subagent's description. */
  who: string
}

export type RelaySnap = {
  /** Oldest first, at most 300. */
  reqs: RelayReq[]
  /** Requests over the whole session. */
  total: number
  /** Requests that got no response (failed or interrupted). */
  failed: number
}

declare module 'claude-code' {
  interface PluginState {
    relay: { snap: RelaySnap | null }
  }
}
