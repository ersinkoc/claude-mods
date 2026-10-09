/** How one shell call ended: still running, exit 0, failed, refused, or sent to the background. */
export type ShellStatus = 'running' | 'ok' | 'fail' | 'denied' | 'bg'

/** One Bash / PowerShell tool call of the session, main loop or a subagent's. */
export type ShellRun = {
  id: string
  /** `Bash` or `PowerShell`. */
  tool: string
  /** The command as the model wrote it (clipped at 2000 characters). */
  command: string
  /** The model's short description of the command, when it gave one. */
  description?: string
  /** The working directory: an input `cwd`, or a leading `cd <dir> &&`. */
  cwd?: string
  /** When the call started, `$.clock.now()` milliseconds. */
  at: number
  /** How long it ran; absent while it runs. */
  ms?: number
  status: ShellStatus
  /** The exit code when known (0 on success, parsed from the error text otherwise). */
  exit?: number
  /** The first telling line of the error, when it failed. */
  error?: string
  /** Characters of output (stdout + stderr, or the error text). */
  outBytes?: number
  /** `main`, or the subagent's description. */
  who: string
}

export type TerminusSnap = {
  /** Newest first, at most 300. */
  runs: ShellRun[]
  /** Counters over the whole session (not only the kept runs). */
  total: number
  failures: number
  slow: number
  totalMs: number
}

export type TerminusFilter = 'all' | 'failed' | 'slow'

export type TerminusView = { filter: TerminusFilter }

declare module 'claude-code' {
  interface PluginState {
    terminus: { snap: TerminusSnap | null; view: TerminusView }
  }
}
