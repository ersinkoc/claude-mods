export type CompassSnap = {
  /** The five-hour window, when the subscription reports one. */
  fiveHour?: { percent: number; resetsAt?: string }
  ctxPercent?: number
  agentsRunning: number
  isRepo: boolean
  /** Staged, unstaged and untracked paths together. */
  changedFiles: number
  /** Edit / Write calls this session, any loop. */
  edits: number
  /** Whole minutes since the last turn started or ended. */
  idleMin: number
  /** $.clock.now() at the last whole minute, for reset countdowns. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    compass: { snap: CompassSnap; isOn: boolean }
  }
}
