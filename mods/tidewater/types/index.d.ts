/** One file of the turn's tide: lines added and removed, edits, last edit time. */
export type TideFile = { path: string; name: string; added: number; removed: number; edits: number; at: number }

export type TideSnap = {
  /** Files edited since the last prompt, the most recently edited last. */
  files: TideFile[]
  /** The clock at the last edit (ms): the desktop waves resume from it. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    tidewater: { snap: TideSnap | null; isHidden: boolean }
  }
}
