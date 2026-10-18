// Helm's pure core: the built-in profiles, the plan a profile makes against
// the current settings, applying and undoing settings.json steps, and saving
// the current setup as a profile of its own. No `$` here (it may not cross an
// import), so every rule is tested directly.

import type { HelmEffort, HelmEntry, HelmProfile, HelmRow, HelmStep, HelmValue } from '../types'
import { KZ } from './lib/kz.ts'

export type Json = Record<string, unknown>
export type Step = HelmStep
export type Profile = HelmProfile
export type Row = HelmRow
export type Effort = HelmEffort

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const cfg = (key: string, value: HelmValue, why: string): Step => ({ layer: 'config', key, value, why })
const env = (name: string, label: string, value: string | null, why: string): Step => ({ layer: 'settings', path: `env.${name}`, label, value, why })
const effort = (value: Effort, why: string): Step => ({ layer: 'effort', value, why })

export const SUBAGENT = 'CLAUDE_CODE_SUBAGENT_MODEL'
export const MCP_CAP = 'MAX_MCP_OUTPUT_TOKENS'
export const NO_BYPASS = 'permissions.disableBypassPermissionsMode'

/**
 * The built-in profiles. Every `config` key is a row Claude Code 2.1.302
 * lists, with a value that row offers; a row a version lacks is skipped.
 */
export const BUILT_IN: readonly Profile[] = [
  {
    id: 'saver',
    name: 'Token saver',
    icon: '◔',
    color: KZ.green,
    tagline: 'Sonnet, low effort, short answers, Haiku subagents',
    steps: [
      cfg('model', 'sonnet', 'cheaper per token than Opus'),
      effort('low', 'less thinking per request'),
      env(SUBAGENT, 'Subagent model', 'haiku', 'subagents run on the cheapest model'),
      cfg('outputStyle', 'Concise', 'shorter answers, fewer output tokens'),
      cfg('promptSuggestionEnabled', false, 'each suggestion is another model call'),
      cfg('recap', false, 'the recap is another model call'),
      cfg('autoCompact', true, 'the context never grows unbounded'),
      cfg('workflowSizeGuideline', 'small', 'smaller multi-agent fan-outs'),
      cfg('workflowKeywordTriggerEnabled', false, 'no fan-out from a stray "ultracode"'),
      cfg('autoContinueAtUsageLimit', false, 'stops at the usage limit instead of carrying on'),
      env(MCP_CAP, 'MCP output cap', '10000', 'caps MCP tool results (default 25000)'),
    ],
  },
  {
    id: 'flow',
    name: 'Fast flow',
    icon: '»',
    color: KZ.amber,
    tagline: 'Sonnet, edits auto-accepted, fewer interruptions',
    steps: [
      cfg('model', 'sonnet', 'faster answers than Opus'),
      effort('medium', 'balanced reasoning time'),
      cfg('permissionMode', 'acceptEdits', 'file edits go through without a prompt'),
      cfg('outputStyle', 'Concise', 'less to read between steps'),
      cfg('promptSuggestionEnabled', true, 'Tab takes the next likely prompt'),
      cfg('turnDuration', true, 'see how long each turn took'),
      cfg('progressBar', true, 'progress shows in the terminal tab'),
      cfg('workflowSizeGuideline', 'medium', 'parallel agents when they help'),
    ],
  },
  {
    id: 'quality',
    name: 'Max quality',
    icon: '◆',
    color: KZ.violet,
    tagline: 'The most capable model, deepest reasoning, big workflows',
    steps: [
      cfg('model', 'best', 'the most capable model available to you'),
      effort('xhigh', 'the deepest reasoning per request'),
      env(SUBAGENT, 'Subagent model', null, 'subagents keep the model they ask for'),
      cfg('outputStyle', 'default', 'full explanations, nothing trimmed'),
      cfg('workflows', true, 'multi-agent workflows available'),
      cfg('workflowKeywordTriggerEnabled', true, '"ultracode" starts a workflow'),
      cfg('workflowSizeGuideline', 'large', 'room for large fan-outs'),
      cfg('checkpoints', true, 'any change can be rewound'),
      cfg('autoCompact', true, 'long sessions keep going'),
    ],
  },
  {
    id: 'planner',
    name: 'Plan first',
    icon: '◇',
    color: KZ.cyan,
    tagline: 'Opus plans, Sonnet builds; nothing runs before you approve',
    steps: [
      cfg('model', 'opusplan', 'Opus while planning, Sonnet while building'),
      effort('high', 'a careful plan'),
      cfg('permissionMode', 'plan', 'every session starts by planning'),
      cfg('useAutoModeDuringPlan', false, 'the plan waits for your approval'),
      cfg('askUserQuestionTimeout', 'never', 'questions wait for your answer'),
      cfg('checkpoints', true, 'any change can be rewound'),
    ],
  },
  {
    id: 'guarded',
    name: 'Guarded',
    icon: '▣',
    color: KZ.blue,
    tagline: 'You approve each change; secrets unreadable; no bypass',
    steps: [
      cfg('permissionMode', 'default', 'every edit and command asks first'),
      cfg('useAutoModeDuringPlan', false, 'plan mode never acts on its own'),
      { layer: 'settings', path: NO_BYPASS, label: 'Bypass mode', value: 'disable', why: 'bypassPermissions cannot be turned on' },
      {
        layer: 'list',
        path: 'permissions.deny',
        label: 'Deny rules',
        add: ['Read(./.env)', 'Read(./.env.*)', 'Read(./secrets/**)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)'],
        why: 'the Read tool is refused .env, secrets/, ~/.ssh and ~/.aws',
      },
      cfg('askUserQuestionTimeout', 'never', 'Claude never answers its own question'),
      cfg('checkpoints', true, 'every change can be rewound'),
      cfg('verbose', true, 'see each tool call in full'),
      cfg('workflowKeywordTriggerEnabled', false, 'no fan-out from a keyword'),
    ],
  },
  {
    id: 'autopilot',
    name: 'Autopilot',
    icon: '➤',
    color: KZ.red,
    tagline: 'Long unattended runs: auto mode, recap, push alerts',
    steps: [
      cfg('permissionMode', 'auto', 'the classifier approves safe actions'),
      cfg('useAutoModeDuringPlan', true, 'plans run without stopping'),
      effort('high', 'fewer wrong turns on long runs'),
      cfg('workflows', true, 'parallel agents for big tasks'),
      cfg('askUserQuestionTimeout', '5m', 'a question waits 5 minutes, then work goes on'),
      cfg('autoContinueAtUsageLimit', true, 'the run carries on at the usage limit'),
      cfg('recap', true, 'a summary waits for you when you return'),
      cfg('agentPushNotifEnabled', true, 'a push when Claude decides something'),
      cfg('inputNeededNotifEnabled', true, 'a push when it needs you'),
      cfg('autoCompact', true, 'the run never stops on a full context'),
    ],
  },
  {
    id: 'quiet',
    name: 'Quiet focus',
    icon: '☾',
    color: KZ.teal,
    tagline: 'No tips, suggestions, pushes or motion',
    steps: [
      cfg('tips', false, 'no tips while you work'),
      cfg('promptSuggestionEnabled', false, 'an empty prompt box stays empty'),
      cfg('reduceMotion', true, 'calmer animations'),
      cfg('agentPushNotifEnabled', false, 'no push when Claude decides'),
      cfg('inputNeededNotifEnabled', false, 'no push when it needs you'),
      cfg('recap', false, 'no recap after you step away'),
      cfg('prStatus', false, 'no PR status footer'),
    ],
  },
]

export const findProfile = (profiles: readonly Profile[], id: string): Profile | undefined => {
  const want = id.trim().toLowerCase()
  return want ? profiles.find(p => p.id === want || p.name.toLowerCase() === want) : undefined
}

// ---------------------------------------------------------------- reading values

/** A row's shown value equals what a profile sets (the menu shows `Default (recommended)` for `default`). */
export function sameValue(current: HelmValue | undefined, wanted: HelmValue): boolean {
  if (current === wanted) return true
  if (typeof current !== 'string' || typeof wanted !== 'string') return false
  const c = current.toLowerCase()
  const w = wanted.toLowerCase()
  return c === w || c.startsWith(`${w} (`)
}

export const show = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return 'unset'
  if (v === true) return 'on'
  if (v === false) return 'off'
  if (Array.isArray(v)) return v.length === 0 ? 'none' : `${v.length} rule${v.length === 1 ? '' : 's'}`
  return String(v)
}

export function getPath(obj: Json, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Json)[part]
  }
  return cur
}

/** A copy of `obj` with `path` set, or removed when `value` is undefined; parents left empty are dropped. */
export function setPath(obj: Json, path: string, value: unknown): Json {
  const dot = path.indexOf('.')
  const out: Json = { ...obj }
  if (dot < 0) {
    if (value === undefined) delete out[path]
    else out[path] = value
    return out
  }
  const head = path.slice(0, dot)
  const child = out[head]
  const base = child !== null && typeof child === 'object' && !Array.isArray(child) ? (child as Json) : {}
  const next = setPath(base, path.slice(dot + 1), value)
  if (Object.keys(next).length === 0) delete out[head]
  else out[head] = next
  return out
}

const listAt = (obj: Json, path: string): string[] => {
  const v = getPath(obj, path)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** The main loop's model id and effort as last seen, and an effort waiting for the next request. */
export type Live = { model?: string; effort?: string | number; pending?: string }

/**
 * Where a model's effort is saved: `modelSettings.<id>.effortLevel`. Undefined
 * for an id a dotted path cannot name (a Bedrock or Vertex id with a dot).
 */
export const effortPath = (model: string | undefined): string | undefined =>
  !model || model.includes('.') ? undefined : `modelSettings.${model}.effortLevel`

/** The effort the model in use runs at: an effort waiting to be sent, its saved level, else what the last request carried. */
export function currentEffort(user: Json, live: Live): string | undefined {
  if (live.pending !== undefined) return live.pending
  const path = effortPath(live.model)
  const saved = path ? getPath(user, path) : undefined
  if (typeof saved === 'string') return saved
  return live.effort === undefined ? undefined : String(live.effort)
}

// ---------------------------------------------------------------- planning

export type Status = 'change' | 'same' | 'locked' | 'missing' | 'invalid'

export type PlanItem = {
  /** Names the step within its profile: `config:<key>`, `settings:<path>`, `list:<path>`, `effort`. */
  id: string
  layer: Step['layer']
  label: string
  from: string
  to: string
  why: string
  status: Status
}

export const SKIP_REASON: Record<Exclude<Status, 'change' | 'same'>, string> = {
  locked: 'locked by your organization',
  missing: 'not in this Claude Code version',
  invalid: 'value not offered here',
}

export const stepId = (s: Step): string =>
  s.layer === 'config' ? `config:${s.key}` : s.layer === 'effort' ? 'effort' : `${s.layer}:${s.path}`

/** Whether a `/config` row takes the value a step sets. */
function fits(row: Row, value: HelmValue): boolean {
  if (row.kind === 'boolean') return typeof value === 'boolean'
  if (row.kind === 'number') return typeof value === 'number'
  if (row.kind === 'choice') return typeof value === 'string' && (!row.options || row.options.some(o => sameValue(o, value)))
  return typeof value === 'string'
}

/** What each step of a profile would do now. */
export function planFor(profile: Profile, rows: readonly Row[], user: Json, live: Live = {}): PlanItem[] {
  const modelStep = profile.steps.find(s => s.layer === 'config' && s.key === 'model')
  const modelRow = rows.find(r => r.key === 'model')
  // a profile that switches model makes the current model's saved effort moot
  const switchesModel = modelStep?.layer === 'config' && modelRow !== undefined && !sameValue(modelRow.value, modelStep.value)
  return profile.steps.map((step): PlanItem => {
    const id = stepId(step)
    if (step.layer === 'effort') {
      const current = live.pending ?? (switchesModel ? undefined : currentEffort(user, live))
      return { id, layer: 'effort', label: 'Effort', from: current ?? 'default', to: step.value, why: step.why, status: current === step.value ? 'same' : 'change' }
    }
    if (step.layer === 'config') {
      const row = rows.find(r => r.key === step.key)
      const to = show(step.value)
      if (!row) return { id, layer: 'config', label: step.key, from: '—', to, why: step.why, status: 'missing' }
      const base = { id, layer: 'config' as const, label: row.label, from: show(row.value), to, why: step.why }
      if (row.isLocked) return { ...base, status: 'locked' }
      if (!fits(row, step.value)) return { ...base, status: 'invalid' }
      return { ...base, status: sameValue(row.value, step.value) ? 'same' : 'change' }
    }
    if (step.layer === 'settings') {
      const current = getPath(user, step.path)
      return { id, layer: 'settings', label: step.label, from: show(current), to: show(step.value), why: step.why, status: (current ?? null) === step.value ? 'same' : 'change' }
    }
    const have = listAt(user, step.path)
    const missing = step.add.filter(x => !have.includes(x))
    return {
      id,
      layer: 'list',
      label: step.label,
      from: show(have),
      to: missing.length === 0 ? show(have) : `+${missing.length} rule${missing.length === 1 ? '' : 's'}`,
      why: step.why,
      status: missing.length === 0 ? 'same' : 'change',
    }
  })
}

/** How much of a profile is in force: steps that match, of those that can apply. */
export function matchOf(plan: readonly PlanItem[]): { same: number; of: number } {
  const applicable = plan.filter(p => p.status === 'same' || p.status === 'change')
  return { same: applicable.filter(p => p.status === 'same').length, of: applicable.length }
}

export const isInForce = (plan: readonly PlanItem[]): boolean => {
  const { same, of } = matchOf(plan)
  return of > 0 && same === of
}

/** A row's value as `$.config.set` takes it back: a choice's option, not the menu's label for it. */
export function restorable(row: Row): HelmValue {
  if (row.kind === 'choice' && row.options) return row.options.find(o => sameValue(row.value, o)) ?? row.value
  return row.value
}

// ---------------------------------------------------------------- applying and undoing

type FileStep = Extract<Step, { layer: 'settings' | 'list' }>

export const isFileStep = (s: Step): s is FileStep => s.layer === 'settings' || s.layer === 'list'

/** Applies settings and list steps to a settings object; returns the new object and what undoes it. */
export type FileEntry = Exclude<HelmEntry, { layer: 'config' }>

export function applySettings(user: Json, steps: readonly FileStep[]): { next: Json; entries: FileEntry[] } {
  let next = user
  const entries: FileEntry[] = []
  for (const step of steps) {
    if (step.layer === 'settings') {
      const previous = getPath(next, step.path)
      if ((previous ?? null) === step.value) continue
      next = setPath(next, step.path, step.value ?? undefined)
      entries.push({ layer: 'settings', path: step.path, label: step.label, previous: previous ?? null, had: previous !== undefined })
    } else {
      const have = listAt(next, step.path)
      const added = step.add.filter(x => !have.includes(x))
      if (added.length === 0) continue
      next = setPath(next, step.path, [...have, ...added])
      entries.push({ layer: 'list', path: step.path, label: step.label, added })
    }
  }
  return { next, entries }
}

/** Puts back what `applySettings` changed, newest first; entries the person added themselves since stay. */
export function revertSettings(user: Json, entries: readonly HelmEntry[]): Json {
  let next = user
  for (const entry of [...entries].reverse()) {
    if (entry.layer === 'settings') next = setPath(next, entry.path, entry.had ? entry.previous : undefined)
    else if (entry.layer === 'list') {
      const kept = listAt(next, entry.path).filter(x => !entry.added.includes(x))
      next = setPath(next, entry.path, kept.length === 0 ? undefined : kept)
    }
  }
  return next
}

/** Whether the settings the engine loaded hold `next`'s value at every path. */
export function inSync(loaded: Json, next: Json, paths: readonly string[]): boolean {
  return paths.every(p => JSON.stringify(getPath(loaded, p) ?? null) === JSON.stringify(getPath(next, p) ?? null))
}

/** Parses a settings.json text: the object, or why it must not be overwritten. */
export function parseSettings(text: string): { user: Json; error: string | null } {
  if (text.trim() === '') return { user: {}, error: null }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { user: {}, error: 'settings.json is not a JSON object' }
    return { user: parsed as Json, error: null }
  } catch {
    return { user: {}, error: 'settings.json is not valid JSON' }
  }
}

/** The user settings file: `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`. */
export function userSettingsPath(configDir: string | undefined, home: string | undefined): string | null {
  const trim = (s: string) => s.replace(/[\\/]+$/, '')
  if (configDir) return `${trim(configDir)}/settings.json`
  return home ? `${trim(home)}/.claude/settings.json` : null
}

// ---------------------------------------------------------------- your own profiles

export const MAX_CUSTOM = 6
const CUSTOM_COLORS = [KZ.magenta, KZ.yellow, KZ.lime, KZ.clay, KZ.blue, KZ.violet]

export const slug = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

/** Every key and path the built-in profiles touch: what a saved profile records. */
export function universe(profiles: readonly Profile[] = BUILT_IN): { config: string[]; settings: { path: string; label: string }[] } {
  const config: string[] = []
  const settings: { path: string; label: string }[] = []
  for (const p of profiles)
    for (const s of p.steps) {
      if (s.layer === 'config' && !config.includes(s.key)) config.push(s.key)
      if (s.layer === 'settings' && !settings.some(x => x.path === s.path)) settings.push({ path: s.path, label: s.label })
    }
  return { config, settings }
}

/**
 * The current setup as a profile: each `/config` row the built-ins touch (not
 * the locked ones), their settings.json keys, and the effort of the model in
 * use. Deny rules are left out: undoing someone's own rules is not a profile's
 * job.
 */
export function captureProfile(name: string, rows: readonly Row[], user: Json, live: Live, taken: readonly Profile[]): Profile | string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 32)
  const base = slug(clean)
  if (!base) return 'Give the profile a name: /helm save <name>'
  const id = `my-${base}`
  if (BUILT_IN.some(p => p.id === base || p.name.toLowerCase() === clean.toLowerCase())) return `"${clean}" is a built-in profile's name; pick another`
  const others = taken.filter(p => p.id !== id)
  if (others.length >= MAX_CUSTOM) return `Up to ${MAX_CUSTOM} saved profiles; remove one first (/helm rm <name>)`
  const { config, settings } = universe()
  const steps: Step[] = []
  for (const key of config) {
    const row = rows.find(r => r.key === key)
    if (row && !row.isLocked) steps.push(cfg(key, restorable(row), 'as you had it'))
  }
  const e = currentEffort(user, live)
  if (e && (EFFORTS as readonly string[]).includes(e)) steps.push(effort(e as Effort, 'as you had it'))
  for (const s of settings) {
    const v = getPath(user, s.path)
    if (v === undefined || typeof v === 'string') steps.push({ layer: 'settings', path: s.path, label: s.label, value: v ?? null, why: 'as you had it' })
  }
  const color = CUSTOM_COLORS[others.length % CUSTOM_COLORS.length]!
  return { id, name: clean, icon: '★', color, tagline: `your setup, ${steps.length} settings`, steps, isCustom: true }
}

/** Saved profiles read back from the store: anything malformed is dropped. */
export function sanitizeCustom(v: unknown): Profile[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((p): p is Profile => {
      if (p === null || typeof p !== 'object') return false
      const o = p as Profile
      return typeof o.id === 'string' && o.id.startsWith('my-') && typeof o.name === 'string' && typeof o.color === 'string' && Array.isArray(o.steps) && o.steps.every(isStep)
    })
    .map(p => ({ ...p, icon: '★', tagline: typeof p.tagline === 'string' ? p.tagline : '', isCustom: true }))
    .slice(0, MAX_CUSTOM)
}

function isStep(s: unknown): s is Step {
  if (s === null || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  if (typeof o.why !== 'string') return false
  if (o.layer === 'config') return typeof o.key === 'string' && ['string', 'number', 'boolean'].includes(typeof o.value)
  if (o.layer === 'settings') return typeof o.path === 'string' && typeof o.label === 'string' && (o.value === null || typeof o.value === 'string')
  if (o.layer === 'effort') return (EFFORTS as readonly unknown[]).includes(o.value)
  return false
}

// ---------------------------------------------------------------- advice

/** Token saver is suggested when a limit window passes `at` percent and it is not in force already. */
export function advice(limits: readonly { kind: string; percentUsed: number }[], at: number, isSaverOn: boolean): string | null {
  if (isSaverOn || at >= 100) return null
  const hot = [...limits].filter(l => Number.isFinite(l.percentUsed) && l.percentUsed >= at).sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (!hot) return null
  const name = hot.kind === 'five_hour' ? '5-hour' : hot.kind === 'seven_day' ? 'weekly' : hot.kind.replace(/_/g, ' ')
  return `${name} limit at ${Math.round(hot.percentUsed)}%`
}

export const suggestAtOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(50, Math.round(v))) : 80)
