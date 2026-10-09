export type ThermalMetric = 'heat' | 'reads' | 'edits'

export type ThermalFile = {
  /** Tree path: segments relative to the session cwd, joined by '/'; outside it, under '↗ outside'. */
  path: string
  reads: number
  edits: number
  writes: number
  searches: number
  /** Heat as of `heatAt`; it halves every HALF_LIFE_MS after that. */
  heat: number
  heatAt: number
  lastAt: number
}

export type ThermalSnap = { cwd: string; files: ThermalFile[]; now: number }

declare module 'claude-code' {
  interface PluginState {
    thermal: { snap: ThermalSnap | null; metric: ThermalMetric }
  }
}
