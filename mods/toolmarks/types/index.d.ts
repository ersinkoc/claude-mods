/** What one finished tool call came to, keyed by its tool_use_id. */
export type ToolMark = {
  tool: string
  ms: number
  isError: boolean
  /** Bash and PowerShell: the exit status when it is known. */
  exit?: number
  isDenied?: boolean
  isInterrupted?: boolean
  isBackground?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    toolmarks: { mark: StateFamily<ToolMark | null>; isOn: boolean }
  }
}
