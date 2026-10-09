export type PadCount = { n: number; at: number }

export type LaunchpadData = {
  /** How often the person ran each slash command (by name, no slash), and when last. */
  counts: Record<string, PadCount>
  /** Pinned command names, in pin order. */
  pinned: string[]
  /** Saved prompts, oldest first. */
  saved: string[]
  /** Command name → description, from $.command.list(); empty until read. */
  known: Record<string, string>
  /** True once $.command.list() answered, so unknown names can be hidden. */
  hasList: boolean
  /** The last launch and what came of it. */
  lastRun?: { label: string; text: string }
}

declare module 'claude-code' {
  interface PluginState {
    launchpad: { pad: LaunchpadData }
  }
}
