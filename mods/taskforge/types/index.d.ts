export type ForgeStatus = 'pending' | 'in_progress' | 'completed'

export type ForgeCard = {
  key: string
  subject: string
  activeForm?: string
  description?: string
  status: ForgeStatus
  /** When the card entered its current column. */
  since: number
  createdAt: number
  /** The agent or owner it belongs to; absent for the main loop. */
  owner?: string
  source: 'todo' | 'task'
  taskId?: string
}

export type ForgeSnap = {
  cards: ForgeCard[]
  firstAt?: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    taskforge: { snap: ForgeSnap | null }
  }
}
