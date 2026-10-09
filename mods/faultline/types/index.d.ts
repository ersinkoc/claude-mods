/** What failed: a tool error, a refused/denied tool call, a turn that ended badly, an API error. */
export type FaultKind = 'error' | 'denied' | 'turn' | 'api'

/** One error signature: every failure whose tool and masked first line match. */
export type Fault = {
  /** `tool|masked line`: the group key. */
  sig: string
  /** The tool (`Bash`, `mcp__x__y`), or `turn` / `api`. */
  tool: string
  kind: FaultKind
  /** The first telling error line with numbers, paths, URLs and ids masked. */
  head: string
  /** What the first failing call was about (its command, file, URL). */
  detail?: string
  /** The full error text of the first occurrence, clipped at 1500 characters. */
  firstText: string
  isTruncated: boolean
  count: number
  /** First and last time seen, `$.clock.now()` milliseconds. */
  first: number
  last: number
  /** Who hit it: `main` and subagent descriptions, at most 5. */
  agents: string[]
}

export type FaultlineSnap = {
  /** Most recently seen first, at most 300 signatures. */
  faults: Fault[]
  /** Failures over the whole session. */
  total: number
  /** Times of the failures of the last 10 minutes (at most 300). */
  hits: number[]
  /** The clock the severity strip is drawn at, moved while it has recent hits. */
  now: number
}

export type FaultlineView = {
  /** Signatures whose full error text is unfolded. */
  expanded: string[]
}

declare module 'claude-code' {
  interface PluginState {
    faultline: { snap: FaultlineSnap | null; view: FaultlineView }
  }
}
