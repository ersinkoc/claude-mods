/** One tool call as a falling word. */
export type FallTool = {
  id: string
  at: number
  /** When it finished; null while it runs (its word hangs mid-band until then). */
  end: number | null
  name: string
  detail: string
  color: string
  isError: boolean
}

export type GlyphSnap = {
  now: number
  /** The latest tool calls, oldest first. */
  tools: FallTool[]
}

declare module 'claude-code' {
  interface PluginState {
    glyphfall: { snap: GlyphSnap | null; isHidden: boolean }
  }
}
