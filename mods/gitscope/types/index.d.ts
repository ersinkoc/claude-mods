export type GitscopeCommit = { sha: string; subject: string; author: string; at: number }

export type GitscopeFile = {
  /** Repo-relative, forward slashes. */
  path: string
  added: number
  removed: number
  /** `new` for an untracked file (no numstat), else `mod`. */
  kind: 'mod' | 'new'
  /** The session edited it (Edit / Write / NotebookEdit, any agent). */
  isTouched: boolean
}

export type GitscopeSnap = {
  isRepo: boolean
  root: string
  branch: string
  isDetached: boolean
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  stash: number
  head?: { sha: string; subject: string }
  commits: GitscopeCommit[]
  files: GitscopeFile[]
  /** Touched files of this session that git shows no change for (or outside the repo). */
  touchedClean: number
  refreshedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    gitscope: { snap: GitscopeSnap | null }
  }
}
