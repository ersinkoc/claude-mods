// Helm's $.state contract: what its pane draws from.

export type HelmValue = string | number | boolean | readonly string[]
export type HelmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One step of a profile, on one of the layers Helm writes. */
export type HelmStep =
  /** A `/config` row, written with `$.config.set` as the menu writes it. */
  | { layer: 'config'; key: string; value: HelmValue; why: string }
  /** A settings.json key with no `/config` row; `value: null` removes it. */
  | { layer: 'settings'; path: string; label: string; value: string | null; why: string }
  /** Entries added to a settings.json list (`permissions.deny`), keeping what is there. */
  | { layer: 'list'; path: string; label: string; add: string[]; why: string }
  /** The effort for the model in use, saved as `modelSettings[<id>].effortLevel`. */
  | { layer: 'effort'; value: HelmEffort; why: string }

export type HelmProfile = {
  id: string
  name: string
  icon: string
  color: string
  tagline: string
  steps: HelmStep[]
  /** Saved by the person with `/helm save`, not built in. */
  isCustom?: boolean
}

/** A `/config` row, the part Helm reads. */
export type HelmRow = {
  key: string
  label: string
  kind: 'boolean' | 'choice' | 'text' | 'number'
  value: HelmValue
  options?: readonly string[]
  isLocked: boolean
}

export type HelmLimit = { kind: string; percentUsed: number }

export type HelmSnapshot = {
  rows: HelmRow[]
  /** ~/.claude/settings.json as parsed; `{}` when there is none. */
  user: Record<string, unknown>
  /** Where that file is; null when no config or home directory is known. */
  path: string | null
  /** Why the file cannot be written (not JSON): its steps are then skipped. */
  error: string | null
  /** The 5-hour and weekly limits as last read. */
  limits: HelmLimit[]
}

/** What one activation changed, so undo can put it back. */
export type HelmEntry =
  | { layer: 'config'; key: string; label: string; previous: HelmValue }
  | { layer: 'settings'; path: string; label: string; previous: unknown; had: boolean }
  | { layer: 'list'; path: string; label: string; added: string[] }

export type HelmBackup = {
  id: string
  profile: string
  name: string
  icon: string
  at: number
  entries: HelmEntry[]
  skipped: { label: string; reason: string }[]
  /** The effort the activation set, when it set one. */
  effort?: HelmEffort
}

/** The main loop's model id and effort, as the last request carried them. */
export type HelmLive = { model?: string; effort?: string | number }

/** An effort still to send with the next request (and to save, if that request names another model). */
export type HelmPending = { value: HelmEffort; backupId: string; savedFor?: string }

export type HelmUi = {
  /** The profile whose detail is open; null means the first. */
  selected: string | null
  /** Step ids left out of the next activation, per profile. */
  off: Record<string, string[]>
  /** A one-line result under the header. */
  notice: { text: string; tone: 'success' | 'warning' | 'error' } | null
  isBusy: boolean
  /** Whether settings.json was copied aside already this session. */
  isBackedUp: boolean
}

declare module 'claude-code' {
  interface PluginState {
    helm: {
      ui: HelmUi
      snapshot: HelmSnapshot
      history: HelmBackup[]
      live: HelmLive
      pending: HelmPending | null
      custom: HelmProfile[]
    }
  }
}
