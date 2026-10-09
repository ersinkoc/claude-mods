export type OrbitStatus = 'run' | 'done' | 'fail'

/** One subagent as a planet. */
export type OrbitAgent = {
  id: string
  desc: string
  type: string
  model: string
  /** Spawn order in the session, from 0: picks the orbit and the color. */
  order: number
  status: OrbitStatus
  start: number
  end: number | null
  /** Output tokens per second over the last 20 s. */
  tps: number
  tokens: number
  /** Where the planet is on its orbit at `now` (radians), and its angular speed (rad/s). */
  angle: number
  omega: number
}

export type OrrerySnap = {
  now: number
  agents: OrbitAgent[]
  /** The main loop's own output tokens per second: how bright the sun burns. */
  sunTps: number
  isWorking: boolean
  /** When the last agent finished, 0 while none has. */
  lastEnd: number
}

declare module 'claude-code' {
  interface PluginState {
    orrery: { snap: OrrerySnap | null; isHidden: boolean }
  }
}
