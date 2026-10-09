export type LaurelsBurst = { id: string; at: number; more: number }

declare module 'claude-code' {
  interface PluginState {
    laurels: {
      /** Badge id → unlock time (ms). */
      unlocked: Record<string, number>
      /** Badge id → current value toward its goal. */
      progress: Record<string, number>
      burst: LaurelsBurst | null
      isHidden: boolean
    }
  }
}
