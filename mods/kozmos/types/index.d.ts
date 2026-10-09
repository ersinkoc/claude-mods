export type KozmosHub = {
  /** Commands this session can run, refreshed when the hub opens. */
  installed: string[]
  /** The category the hub shows, or 'all'. */
  filter: string
  /** The last mod whose command the hub ran, and what it answered. */
  lastRun?: { name: string; text: string }
}

declare module 'claude-code' {
  interface PluginState {
    kozmos: { hub: KozmosHub }
  }
}
