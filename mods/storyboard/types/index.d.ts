export type StoryPhase = 'explore' | 'plan' | 'build' | 'verify' | 'ship'

export type StoryChapter = {
  /** A few words naming what this chapter is about. */
  title: string
  phase: StoryPhase
  /** Which step of the task this is, and how many there are, when the model said. */
  step?: number
  steps?: number
  /** One short line of detail. */
  note?: string
  /** When the model called the tool ($.clock.now()). */
  at: number
}

export type StoryBoard = {
  /** The chapter the model is in now, or null before the first call. */
  current: StoryChapter | null
  /** Every chapter of this session, oldest first (capped). */
  log: StoryChapter[]
  /** When the session started, for relative times in the log. */
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    storyboard: { board: StoryBoard; isHidden: boolean }
  }
}
