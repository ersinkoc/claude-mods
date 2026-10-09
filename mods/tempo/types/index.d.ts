export type TempoSnap = {
  phase: 'work' | 'break' | 'long'
  startedAt: number
  endsAt: number
  now: number
  workMin: number
  breakMin: number
  round: number
  today: number
  isClaudeWorking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    tempo: { snap: TempoSnap | null; isHidden: boolean }
  }
}
