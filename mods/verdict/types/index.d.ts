export type VerdictKind = 'test' | 'types' | 'lint' | 'build'

/** One recorded run of a test runner, type checker, linter or build. */
export type VerdictRun = {
  id: number
  /** When it finished (ms). */
  at: number
  /** How long it ran (ms). */
  ms: number
  runner: string
  kind: VerdictKind
  ok: boolean
  pass: number
  fail: number
  skip: number
  errors: number
  warnings: number
  /** Failing test names or first error lines. */
  failures: string[]
  /** The shell command, clipped. */
  command: string
  /** False when only the exit status was known. */
  parsed: boolean
}

export type VerdictSnap = {
  /** This project's recent runs, oldest first (persisted across sessions). */
  runs: VerdictRun[]
  /** Runs at or after this time belong to this session (the band shows them). */
  sessionStartedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    verdict: { snap: VerdictSnap | null; isHidden: boolean }
  }
}
