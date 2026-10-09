/** What the halo says: idle, the model at work, thinking, a tool running, a failure, or waiting for the person. */
export type HaloMood = 'idle' | 'flow' | 'think' | 'tool' | 'error' | 'wait'

export type HaloSnap = {
  mood: HaloMood
  /** The mood's color (a tool's family color while one runs). */
  color: string
  /** A word or two for the mood: "thinking", "Bash", "waiting for you". */
  label: string
  /** When this mood began (ms). */
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    halo: { snap: HaloSnap | null; isHidden: boolean }
  }
}
