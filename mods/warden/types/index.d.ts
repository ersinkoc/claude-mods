export type WardenSeverity = 'critical' | 'high' | 'medium'

export type WardenVerdict = 'blocked' | 'allowed' | 'warned'

export type WardenEntry = {
  /** When it was judged, in $.clock.now() milliseconds. */
  at: number
  verdict: WardenVerdict
  /** The rule's short label: `git push --force`. */
  label: string
  severity: WardenSeverity
  /** The command, clipped. */
  command: string
  /** Who decided: `you`, `mode deny`, `mode warn`, `no one to ask`. */
  by: string
  /** True when a subagent made the call. */
  isAgent: boolean
}

export type WardenFlash = {
  verdict: WardenVerdict
  label: string
  severity: WardenSeverity
  command: string
  /** When the band stops showing it. */
  until: number
}

export type WardenSnap = {
  /** This session's judgements, newest last (at most 40). */
  log: WardenEntry[]
  blocked: number
  allowed: number
  warned: number
  /** What the band shows for 8 s after a block or a warning. */
  flash: WardenFlash | null
}

declare module 'claude-code' {
  interface PluginState {
    warden: { snap: WardenSnap; isHidden: boolean }
  }
}
