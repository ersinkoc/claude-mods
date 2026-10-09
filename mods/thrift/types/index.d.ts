export type ThriftMode = 'on' | 'off' | 'auto'

export type ThriftLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type ThriftTally = { turns: number; cost: number }

export type ThriftSnap = {
  mode: ThriftMode
  /** Whether prompts carry the economy note now. */
  isOn: boolean
  autoAt: number
  /** The fullest 5h / 7d window, as the band shows it. */
  top: ThriftLimit | null
  /** Turns of this session run with and without the note, and what they cost. */
  thrift: ThriftTally
  normal: ThriftTally
}

declare module 'claude-code' {
  interface PluginState {
    thrift: { snap: ThriftSnap; isHidden: boolean }
  }
}
