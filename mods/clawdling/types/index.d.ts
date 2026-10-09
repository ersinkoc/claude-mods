export type ClawdlingSnap = {
  mood: 'idle' | 'working' | 'thinking' | 'sad' | 'hot' | 'sleepy' | 'dance' | 'love'
  name: string
  xp: number
  level: number
  into: number
  need: number
  acc: { hat: boolean; glasses: boolean; scarf: boolean; crown: boolean }
  quip: string
  streak: number
  ctxPercent: number
  limitPercent: number
}

declare module 'claude-code' {
  interface PluginState {
    clawdling: { snap: ClawdlingSnap | null; isHidden: boolean }
  }
}
