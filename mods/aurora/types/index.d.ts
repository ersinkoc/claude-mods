export type AuroraMode = 'idle' | 'requesting' | 'thinking' | 'responding' | 'tool-input' | 'tool-use'

export type AuroraSnap = {
  now: number
  mode: AuroraMode
  /** When the current mode began: the label counts from it. */
  since: number
  /** The effort the main loop asks for: low, medium, high, xhigh, max, a number, or null. */
  effort: string | null
  /** 0..1 intensity from the effort: how tall, fast and wild the curtains are. */
  level: number
}

declare module 'claude-code' {
  interface PluginState {
    aurora: { snap: AuroraSnap | null; isHidden: boolean }
  }
}
