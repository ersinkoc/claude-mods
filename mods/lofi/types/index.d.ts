export type LofiMood = 'focus' | 'deep' | 'night' | 'sunny'

export type LofiSnap = {
  /** True while a loop is playing. */
  isPlaying: boolean
  /** The mood playing, or the one that would. */
  mood: LofiMood
  /** Music is opt-in: `/lofi on`. */
  isEnabled: boolean
  /** The clock when the loop started (ms); the desktop bars keep their phase from it. */
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    lofi: { snap: LofiSnap | null; isHidden: boolean }
  }
}
