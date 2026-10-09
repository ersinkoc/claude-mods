export type QuestStatus = 'pending' | 'in_progress' | 'completed'

/** One task, from TodoWrite or TaskCreate/TaskUpdate. */
export type Quest = {
  /** `todo:<n>` for a TodoWrite row, `task:<id>` for a task. */
  id: string
  title: string
  /** The present-continuous form shown while it runs ("Running the tests"). */
  active: string
  status: QuestStatus
  /** When it went in progress (ms), while it is. */
  since?: number
}

export type QuestSnap = {
  items: Quest[]
  done: number
  total: number
  /** When the last task completed with nothing left, else null. */
  allDoneAt: number | null
  isVisible: boolean
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    questline: { snap: QuestSnap | null; isHidden: boolean }
  }
}
