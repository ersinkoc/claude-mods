export type VitalsGpu = { name: string; util: number; memUsed: number; memTotal: number; temp: number }

export type VitalsSnap = {
  platform: 'win' | 'mac' | 'linux'
  cpu?: number
  cpuHist: number[]
  memUsed?: number
  memTotal?: number
  /** RAM use in percent, one per sample. */
  memHist: number[]
  diskLabel: string
  diskUsed?: number
  diskTotal?: number
  procs?: number
  gpu?: VitalsGpu
  gpuHist: number[]
  samples: number
  sessionStart: number
  toolCalls: number
  agentsRunning: number
  agentsDone: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    vitals: { snap: VitalsSnap | null }
  }
}
