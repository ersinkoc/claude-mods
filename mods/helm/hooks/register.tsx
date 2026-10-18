/**
 * KOZMOS Helm: one-press settings profiles.
 *
 * A pane of profiles, each a way of working (Token saver, Fast flow, Max
 * quality, Plan first, Guarded, Autopilot, Quiet focus) or a setup the person
 * saved with `/helm save <name>`. A profile opens to show every step: what
 * changes (old → new, and why), what is already set, what is skipped; any
 * change can be left out before Apply. Every activation is kept in the store
 * and `/helm undo` (or the pane's Undo) puts back exactly what it changed.
 *
 * Where a step lands:
 *   - `/config` rows through `$.config.set`, as the menu writes them;
 *   - keys with no row (subagent model, MCP output cap, deny rules, bypass)
 *     into ~/.claude/settings.json, read-modified-written, after the file is
 *     copied to settings.json.helm.bak once a session. A file that is not
 *     valid JSON is never overwritten;
 *   - effort as `modelSettings[<model id>].effortLevel`, at once for the model
 *     in use, else under the id the next request names (and sent with it).
 *
 * The engine writes `/config` rows from the settings it holds, and may miss a
 * file write that lands right after one of its own: so settings.json is
 * written first, Helm waits until `$.settings.read` shows it (writing once
 * more if it does not), and only then sets rows.
 */
import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, Register } from 'claude-code'

import type { HelmBackup, HelmEntry, HelmLive, HelmPending, HelmProfile, HelmSnapshot, HelmUi } from '../types'
import { KZ, bar, pxOf } from './lib/kz.ts'
import {
  BUILT_IN, SKIP_REASON, advice, applySettings, captureProfile, currentEffort, effortPath, findProfile, inSync, isFileStep, isInForce,
  matchOf, parseSettings, planFor, restorable, revertSettings, sanitizeCustom, show, stepId, suggestAtOf, userSettingsPath,
} from './profiles.ts'
import type { Effort, Json, Live, PlanItem, Profile } from './profiles.ts'
import { cardSvg, clockOf, headerSvg, historySvg, historyText, lineText, listText, markOf, meterText, parseArgs, planText, stepSvg, summary } from './view.ts'

const PANE = 'kz-helm'
const TITLE = 'KOZMOS · Helm'
const KEEP = 20
/** How long a write waits for the engine to reload it, per attempt: 20 × 150 ms. */
const RELOAD_TRIES = 20
const RELOAD_STEP_MS = 150
const NOT_RELOADED = 'Claude Code did not reload settings.json; restart the session, then apply again'

type Host = EngineInterface
type Tone = 'success' | 'warning' | 'error'

const uiAtom = atom({ plugin: 'helm', key: 'ui' } as const, { selected: null, off: {}, notice: null, isBusy: false, isBackedUp: false } as HelmUi)
const snapAtom = atom({ plugin: 'helm', key: 'snapshot' } as const, { rows: [], user: {}, path: null, error: null, limits: [] } as HelmSnapshot)
const historyAtom = atom({ plugin: 'helm', key: 'history' } as const, [] as HelmBackup[])
const liveAtom = atom({ plugin: 'helm', key: 'live' } as const, {} as HelmLive)
const pendingAtom = atom({ plugin: 'helm', key: 'pending' } as const, null as HelmPending | null)
const customAtom = atom({ plugin: 'helm', key: 'custom' } as const, [] as HelmProfile[])

const message = (err: unknown): string => String(err).replace(/^\w*Error: /, '')
/** An id `$.session.model()` names that settings can key: `claude-…`, no alias, no dot. */
const isModelId = (m: string | undefined): m is string => typeof m === 'string' && /^claude-[a-z0-9-]+$/i.test(m)

// ---------------------------------------------------------------- reading

async function settingsPath($: Host): Promise<string | null> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined))
  return userSettingsPath(dir, home)
}

/** The user settings file, safe to write; or why it is not (and then never written). */
type UserFile =
  | { path: string; user: Json; text: string | null; error: null }
  | { path: string | null; user: Json; text: string | null; error: string }

async function readUser($: Host): Promise<UserFile> {
  const path = await settingsPath($)
  if (path === null) return { path, user: {}, text: null, error: 'no home directory to find settings.json in' }
  let text: string
  try {
    text = String(await $.fs.read(path))
  } catch {
    // no file yet is fine; a file the engine has loaded but Helm cannot read is not
    const loaded = await $.settings.read({ source: 'user' }).catch(() => ({}))
    return Object.keys(loaded).length === 0 ? { path, user: {}, text: null, error: null } : { path, user: { ...loaded }, text: null, error: `cannot read ${path}` }
  }
  const parsed = parseSettings(text)
  return parsed.error === null ? { path, user: parsed.user, text, error: null } : { path, user: {}, text, error: parsed.error }
}

async function refresh($: Host): Promise<HelmSnapshot> {
  const rows = await $.config.list().catch(() => [] as ConfigRow[])
  const { path, user, error } = await readUser($)
  const usage = await $.session.usage().catch(() => undefined)
  const limits = (usage?.rateLimits ?? []).map(l => ({ kind: l.kind, percentUsed: l.percentUsed }))
  const snap: HelmSnapshot = {
    rows: rows.map(r => ({ key: r.key, label: r.label, kind: r.kind, value: r.value, ...(r.options ? { options: r.options } : {}), isLocked: r.isLocked })),
    user,
    path,
    error,
    limits,
  }
  await update($, snapAtom, () => snap)
  return snap
}

async function profiles($: Host): Promise<Profile[]> {
  return [...BUILT_IN, ...(await read($, customAtom))]
}

async function liveNow($: Host): Promise<Live> {
  const want = await read($, pendingAtom)
  return { ...(await read($, liveAtom)), ...(want ? { pending: want.value } : {}) }
}

// ---------------------------------------------------------------- keeping

async function saveHistory($: Host, list: HelmBackup[]): Promise<void> {
  await update($, historyAtom, () => list)
  await $.store.set('history', list).catch(() => undefined)
}

async function setPending($: Host, value: HelmPending | null): Promise<void> {
  await update($, pendingAtom, () => value)
  await $.store.set('pending', value).catch(() => undefined)
}

async function saveCustom($: Host, list: HelmProfile[]): Promise<void> {
  await update($, customAtom, () => list)
  await $.store.set('custom', list).catch(() => undefined)
}

async function load($: Host): Promise<void> {
  const history = await $.store.get('history').catch(() => undefined)
  if (Array.isArray(history)) await update($, historyAtom, () => (history as HelmBackup[]).filter(b => b && typeof b.id === 'string' && Array.isArray(b.entries)).slice(0, KEEP))
  const pending = await $.store.get('pending').catch(() => undefined)
  if (pending && typeof pending === 'object' && typeof (pending as HelmPending).value === 'string') await update($, pendingAtom, () => pending as HelmPending)
  const custom = await $.store.get('custom').catch(() => undefined)
  await update($, customAtom, () => sanitizeCustom(custom))
}

async function notify($: Host, text: string, tone: Tone): Promise<void> {
  await update($, uiAtom, s => ({ ...s, notice: { text, tone } }))
}

// ---------------------------------------------------------------- writing

/**
 * Writes settings.json (copying it aside first, once a session) and resolves
 * once the engine has loaded it: false if it never did.
 */
async function writeUser($: Host, path: string, before: string | null, next: Json, paths: string[]): Promise<boolean> {
  if (before !== null && !(await read($, uiAtom)).isBackedUp) {
    await $.fs.write(`${path}.helm.bak`, before)
    await update($, uiAtom, s => ({ ...s, isBackedUp: true }))
  }
  const text = `${JSON.stringify(next, null, 2)}\n`
  for (const body of [text, text.trimEnd()]) {
    await $.fs.write(path, body)
    for (let i = 0; i < RELOAD_TRIES; i++) {
      const loaded = await $.settings.read({ source: 'user' }).catch(() => undefined)
      if (loaded && inSync(loaded, next, paths)) return true
      await $.clock.sleep(RELOAD_STEP_MS)
    }
  }
  return false
}

/** Saves an effort under a model id and adds the write to its activation's history entry. */
async function saveEffort($: Host, model: string, value: Effort, backupId: string): Promise<boolean> {
  const at = effortPath(model)
  const file = await readUser($)
  if (at === undefined || file.error !== null) return false
  const { next, entries } = applySettings(file.user, [{ layer: 'settings', path: at, label: `Effort (${model})`, value, why: '' }])
  if (entries.length === 0) return true
  await saveHistory($, (await read($, historyAtom)).map(b => (b.id === backupId ? { ...b, entries: [...b.entries, ...entries] } : b)))
  return writeUser($, file.path, file.text, next, [at])
}

async function applyProfile($: Host, profile: Profile, off: readonly string[]): Promise<HelmBackup> {
  const snap = await refresh($)
  const plan = planFor(profile, snap.rows, snap.user, await liveNow($))
  const steps = profile.steps.filter(s => !off.includes(stepId(s)))
  const entries: HelmEntry[] = []
  const skipped: { label: string; reason: string }[] = []
  let isSynced = true

  // settings.json first: the /config writes below then start from it
  const fileSteps = steps.filter(isFileStep).filter(s => plan.find(p => p.id === stepId(s))!.status === 'change')
  if (fileSteps.length > 0) {
    const file = await readUser($)
    if (file.error !== null) {
      for (const s of fileSteps) skipped.push({ label: s.label, reason: file.error })
    } else {
      const { next, entries: written } = applySettings(file.user, fileSteps)
      // recorded before the write: a write that fails halfway can still be undone
      entries.push(...written)
      try {
        isSynced = await writeUser($, file.path, file.text, next, written.map(w => w.path))
        if (!isSynced) skipped.push({ label: 'settings.json', reason: NOT_RELOADED })
      } catch (err) {
        isSynced = false
        for (const w of written) skipped.push({ label: w.label, reason: `may not be written: ${message(err)}` })
      }
    }
  }

  let switchedModel = false
  for (const step of steps) {
    if (step.layer !== 'config') continue
    const item = plan.find(p => p.id === stepId(step))!
    if (item.status === 'same') continue
    if (item.status !== 'change') {
      skipped.push({ label: item.label, reason: SKIP_REASON[item.status] })
      continue
    }
    if (!isSynced) {
      skipped.push({ label: item.label, reason: NOT_RELOADED })
      continue
    }
    const row = snap.rows.find(r => r.key === step.key)!
    const r = await $.config.set({ key: step.key, value: step.value }).catch(err => ({ deny: message(err) }))
    if (r.deny !== undefined) skipped.push({ label: item.label, reason: r.deny })
    else {
      entries.push({ layer: 'config', key: step.key, label: row.label, previous: restorable(row) })
      if (step.key === 'model') switchedModel = true
    }
  }

  const effortStep = steps.find(s => s.layer === 'effort')
  const effort = effortStep?.layer === 'effort' && plan.find(p => p.id === 'effort')?.status === 'change' ? effortStep.value : undefined
  const backup: HelmBackup = {
    id: `${await $.clock.now().catch(() => 0)}-${(await read($, historyAtom)).length}`,
    profile: profile.id,
    name: profile.name,
    icon: profile.icon,
    at: await $.clock.now().catch(() => 0),
    entries,
    skipped,
    ...(effort ? { effort } : {}),
  }
  if (entries.length > 0 || effort) await saveHistory($, [backup, ...(await read($, historyAtom))].slice(0, KEEP))
  if (effort) {
    // the model in use is known now, unless this activation just switched it
    const model = switchedModel || !isSynced ? undefined : await $.session.model().catch(() => undefined)
    const saved = isModelId(model) ? await saveEffort($, model, effort, backup.id).catch(() => false) : false
    await setPending($, { value: effort, backupId: backup.id, ...(saved ? { savedFor: model } : {}) })
  }
  await refresh($)
  return (await read($, historyAtom)).find(b => b.id === backup.id) ?? backup
}

async function undoLast($: Host): Promise<{ text: string; tone: Tone }> {
  const [last, ...rest] = await read($, historyAtom)
  if (!last) return { text: 'Nothing to undo', tone: 'warning' }
  if ((await read($, pendingAtom))?.backupId === last.id) await setPending($, null)
  // the effort the last request carried was this activation's: unknown again until the next one
  if (last.effort) await update($, liveAtom, l => ({ ...(l.model ? { model: l.model } : {}) }))
  const failed: string[] = []
  let isSynced = true
  const fileEntries = last.entries.filter(e => e.layer !== 'config')
  if (fileEntries.length > 0) {
    const file = await readUser($)
    if (file.error !== null) failed.push(`settings.json (${file.error})`)
    else {
      try {
        isSynced = await writeUser($, file.path, file.text, revertSettings(file.user, fileEntries), fileEntries.map(f => f.path))
      } catch (err) {
        failed.push(`settings.json (${message(err)})`)
      }
    }
  }
  for (const entry of [...last.entries].reverse()) {
    if (entry.layer !== 'config') continue
    if (!isSynced) {
      failed.push(`${entry.label} (${NOT_RELOADED})`)
      continue
    }
    const r = await $.config.set({ key: entry.key, value: entry.previous }).catch(err => ({ deny: message(err) }))
    if (r.deny !== undefined) failed.push(`${entry.label} (${r.deny})`)
  }
  // a settings.json that could not be put back keeps the entry, so undo can be tried again
  const isFileFailed = failed.some(f => f.startsWith('settings.json'))
  if (!isFileFailed) await saveHistory($, rest)
  await refresh($)
  if (isFileFailed) return { text: `Not undone: ${failed.join(', ')}. Fix it and run /helm undo again`, tone: 'error' }
  const n = last.entries.length
  return failed.length === 0
    ? { text: `Undid ${last.name}: ${n} setting${n === 1 ? '' : 's'} restored`, tone: 'success' }
    : { text: `Undid ${last.name}, except ${failed.join(', ')}`, tone: 'warning' }
}

/** Applies a profile with the steps left out in the pane; undefined while another activation runs. */
async function activate($: Host, profile: Profile): Promise<HelmBackup | undefined> {
  if ((await read($, uiAtom)).isBusy) return undefined
  await update($, uiAtom, s => ({ ...s, isBusy: true }))
  try {
    const b = await applyProfile($, profile, (await read($, uiAtom)).off[profile.id] ?? [])
    await update($, uiAtom, s => ({ ...s, off: { ...s.off, [profile.id]: [] } }))
    await notify($, summary(b), b.skipped.length === 0 ? 'success' : 'warning')
    return b
  } finally {
    await update($, uiAtom, s => ({ ...s, isBusy: false }))
  }
}

async function saveCurrent($: Host, name: string): Promise<{ text: string; tone: Tone }> {
  const snap = await refresh($)
  const custom = await read($, customAtom)
  const made = captureProfile(name, snap.rows, snap.user, await liveNow($), custom)
  if (typeof made === 'string') return { text: made, tone: 'error' }
  const isNew = !custom.some(p => p.id === made.id)
  await saveCustom($, isNew ? [...custom, made] : custom.map(p => (p.id === made.id ? made : p)))
  await update($, uiAtom, s => ({ ...s, selected: made.id }))
  return { text: `${isNew ? 'Saved' : 'Updated'} ★ ${made.name}: ${made.steps.length} settings · /helm apply ${made.id} brings them back`, tone: 'success' }
}

async function removeCustom($: Host, id: string): Promise<{ text: string; tone: Tone }> {
  const custom = await read($, customAtom)
  const p = findProfile(custom, id) ?? findProfile(custom, `my-${id.trim().toLowerCase()}`)
  if (!p) return { text: findProfile(BUILT_IN, id) ? 'Built-in profiles cannot be removed' : `No saved profile "${id}"`, tone: 'error' }
  await saveCustom($, custom.filter(x => x.id !== p.id))
  await update($, uiAtom, s => ({ ...s, selected: s.selected === p.id ? null : s.selected }))
  return { text: `Removed ★ ${p.name}`, tone: 'success' }
}

async function snapshotName($: Host): Promise<string> {
  const now = await $.clock.now().catch(() => 0)
  return `Snapshot ${clockOf(now).replace(':', '')}`
}

async function toggleStep($: Host, profileId: string, id: string): Promise<void> {
  await update($, uiAtom, s => {
    const cur = s.off[profileId] ?? []
    return { ...s, off: { ...s.off, [profileId]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] } }
  })
}

async function select($: Host, id: string): Promise<void> {
  await update($, uiAtom, s => ({ ...s, selected: id, notice: null }))
}

async function press($: Host, run: () => Promise<{ text: string; tone: Tone }>): Promise<void> {
  const r = await run()
  await notify($, r.text, r.tone)
}

async function isOpen($: Host): Promise<boolean> {
  return (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
}

async function openPane($: Host): Promise<boolean> {
  try {
    return (await $.ui.open({ id: PANE, title: TITLE, focus: true })).isPlaced
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const suggestAt = suggestAtOf(options.suggestAt)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command
      .register({
        name: 'helm',
        description: 'KOZMOS: settings profiles (token saver, fast flow, max quality, plan first, guarded, autopilot, quiet, your own)',
        argumentHint: '[<profile> | apply <profile> | save <name> | rm <name> | undo | list | history | close]',
        immediate: true,
      })
      .catch(() => undefined)
    await load($)
    return started
  })

  // The main loop's requests: learn the model and effort in use; send a just
  // applied effort, and save it under this model when it was not saved yet.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const want = await read($, pendingAtom)
    if (!want) {
      await update($, liveAtom, () => ({ model: e.model, ...(e.effort !== undefined ? { effort: e.effort } : {}) }))
      return yield* next(e)
    }
    await setPending($, null)
    if (want.savedFor !== e.model) await saveEffort($, e.model, want.value, want.backupId).catch(() => false)
    await update($, liveAtom, () => ({ model: e.model, effort: want.value }))
    await refresh($)
    return yield* next({ ...e, effort: want.value })
  })

  // keep the cards in step with changes made in /config itself
  on('config.set', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && (await isOpen($))) await refresh($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'helm' }, async ($, e) => {
    const action = parseArgs(e.args)
    switch (action.kind) {
      case 'close':
        await $.ui.close({ id: PANE }).catch(() => undefined)
        return { text: 'Helm closed.' }
      case 'toggle': {
        if (await isOpen($)) {
          await $.ui.close({ id: PANE }).catch(() => undefined)
          return { text: 'Helm closed.' }
        }
        const snap = await refresh($)
        await update($, uiAtom, s => ({ ...s, notice: null }))
        if (await openPane($)) return { text: 'Helm open: press a profile to see what it sets.' }
        const live = await liveNow($)
        return { text: listText((await profiles($)).map(p => ({ profile: p, plan: planFor(p, snap.rows, snap.user, live) })), null) }
      }
      case 'list': {
        const snap = await refresh($)
        const live = await liveNow($)
        const rows = (await profiles($)).map(p => ({ profile: p, plan: planFor(p, snap.rows, snap.user, live) }))
        const saver = rows.find(r => r.profile.id === 'saver')!
        return { text: listText(rows, advice(snap.limits, suggestAt, isInForce(saver.plan))) }
      }
      case 'history':
        return { text: historyText(await read($, historyAtom)) }
      case 'undo': {
        const r = await undoLast($)
        await notify($, r.text, r.tone)
        return { text: r.text }
      }
      case 'save': {
        const r = await saveCurrent($, action.name)
        await notify($, r.text, r.tone)
        return { text: r.text }
      }
      case 'rm': {
        const r = await removeCustom($, action.id)
        await notify($, r.text, r.tone)
        return { text: r.text }
      }
      case 'apply': {
        const profile = findProfile(await profiles($), action.id)
        if (!profile) return { text: `Unknown profile "${action.id}". Profiles: ${(await profiles($)).map(p => p.id).join(', ')}` }
        const b = await activate($, profile)
        if (!b) return { text: 'Helm is already applying a profile; try again in a moment' }
        const skipped = b.skipped.map(x => `\n  ⊘ ${x.label}: ${x.reason}`).join('')
        return { text: `${summary(b)}${skipped}\n/helm undo reverts it` }
      }
      case 'open': {
        const profile = findProfile(await profiles($), action.id)
        if (!profile) return { text: `Unknown "${action.id}". Profiles: ${(await profiles($)).map(p => p.id).join(', ')}; or /helm help` }
        const snap = await refresh($)
        await update($, uiAtom, s => ({ ...s, selected: profile.id, notice: null }))
        const plan = planFor(profile, snap.rows, snap.user, await liveNow($))
        if (!(await openPane($))) return { text: planText(profile, plan, (await read($, uiAtom)).off[profile.id]) }
        const n = plan.filter(p => p.status === 'change').length
        return { text: `${profile.icon} ${profile.name}: ${n} change${n === 1 ? '' : 's'}, shown in the pane · /helm apply ${profile.id}` }
      }
      case 'help':
        return { text: action.reason }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, uiAtom)
    const snap = await read($, snapAtom)
    const history = await read($, historyAtom)
    const live = await liveNow($)
    const all = await profiles($)
    const plans = new Map(all.map(p => [p.id, planFor(p, snap.rows, snap.user, live)] as const))
    const planOf = (p: Profile): PlanItem[] => plans.get(p.id)!
    const open = findProfile(all, state.selected ?? '') ?? all[0]!
    const inForce = all.find(p => isInForce(planOf(p)))
    const suggestion = advice(snap.limits, suggestAt, isInForce(planOf(BUILT_IN[0]!)))
    const effort = currentEffort(snap.user, live)
    const model = snap.rows.find(r => r.key === 'model')
    const mode = snap.rows.find(r => r.key === 'permissionMode')
    const facts = `${show(model?.value).replace(/ \(.*\)$/, '').toLowerCase()} · ${effort ?? 'default'} effort · ${show(mode?.value)} mode`
    const last = history[0]
    const off = (p: Profile): string[] => state.off[p.id] ?? []
    const changes = (p: Profile): number => planOf(p).filter(x => x.status === 'change' && !off(p).includes(x.id)).length

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const notice = state.notice ? (
      <Text key="notice" color={state.notice.tone} wrap="truncate-end">{state.notice.tone === 'success' ? '✓ ' : '! '}{state.notice.text}</Text>
    ) : null
    const fileError = snap.error ? <Text key="ferr" color="warning" wrap="truncate-end">! {snap.error}: its steps are left alone</Text> : null
    const tools = (
      <Box key="tools" flexDirection="row" gap={1}>
        {last ? <Button key="undo" label={`↶ Undo ${last.name}`} onPress={() => void press($, () => undoLast($))} /> : null}
        <Button key="snapshot" label="⎘ Save my setup" dimColor onPress={() => void press($, async () => saveCurrent($, await snapshotName($)))} />
      </Box>
    )
    const applyRow = (p: Profile) => {
      const n = changes(p)
      return (
        <Box key={`actions:${p.id}`} flexDirection="row" gap={1} marginTop={1}>
          {n > 0 ? (
            <Button key={`apply:${p.id}`} variant="primary" hotkey="a" autoFocus label={state.isBusy ? 'Applying…' : `Apply ${p.name} · ${n}`} onPress={() => void activate($, p)} />
          ) : (
            <Text color="success" bold>{isInForce(planOf(p)) ? '✓ In force: nothing to change' : 'Nothing selected to change'}</Text>
          )}
          {p.isCustom ? <Button key={`rm:${p.id}`} label="✕ Remove" dimColor onPress={() => void press($, () => removeCustom($, p.id))} /> : null}
        </Box>
      )
    }

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 52)
      const cardW = Math.max(180, W - 76)
      const stepW = Math.max(180, W - 48)
      const detail = (p: Profile) => (
        <Box key={`detail:${p.id}`} flexDirection="column">
          {planOf(p).map(x => {
            const isOff = off(p).includes(x.id)
            return (
              <Box key={`row:${p.id}:${x.id}`} flexDirection="row" alignItems="center" gap={1}>
                <Svg source={stepSvg(stepW, x, p.color, isOff)} alt={`${markOf(x, isOff)} ${lineText(x, isOff)}`} width={stepW} height={x.status === 'change' ? 34 : 20} />
                {x.status === 'change' ? <Button key={`step:${p.id}:${x.id}`} label={isOff ? '☐' : '☑'} plain dimColor={isOff} onPress={() => void toggleStep($, p.id, x.id)} /> : null}
              </Box>
            )
          })}
          {applyRow(p)}
        </Box>
      )
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={headerSvg(W, facts, inForce?.name ?? null, suggestion)} alt={`Helm: ${facts}${inForce ? `, ${inForce.name} in force` : ''}${suggestion ? `, Token saver suggested (${suggestion})` : ''}`} width={W} height={suggestion ? 64 : 46} />
          {notice}
          {fileError}
          {tools}
          {all.map(p => (
            <Box key={`card:${p.id}`} flexDirection="column">
              <Box flexDirection="row" alignItems="center" gap={1}>
                <Svg source={cardSvg(cardW, p, planOf(p), p.id === open.id, suggestion !== null && p.id === 'saver')} alt={`${p.icon} ${p.name}: ${p.tagline}, ${meterText(planOf(p))}`} width={cardW} height={54} />
                <Button key={`pick:${p.id}`} label={p.id === open.id ? '▾' : '▸'} plain onPress={() => void select($, p.id)} />
              </Box>
              {p.id === open.id ? detail(p) : null}
            </Box>
          ))}
          {history.slice(0, 5).map((b, i) => (
            <Svg key={`h:${i}`} source={historySvg(W, b, all.find(p => p.id === b.profile)?.color ?? KZ.mist)} alt={`${clockOf(b.at)} ${b.name}: ${summary(b)}`} width={W} height={20} />
          ))}
        </Box>
      )
    }

    const cols = Math.max(40, e.props.bodyColumns || 52)
    const labelW = Math.min(26, Math.max(14, Math.floor(cols * 0.42)))
    const meterW = 10
    const detail = (p: Profile) => (
      <Box key={`detail:${p.id}`} flexDirection="column" borderStyle="round" borderColor={p.color} paddingX={1}>
        {planOf(p).map(x => {
          const isOff = off(p).includes(x.id)
          if (x.status === 'change')
            return (
              <Box key={`row:${p.id}:${x.id}`} flexDirection="column">
                <Box flexDirection="row">
                  <Button key={`step:${p.id}:${x.id}`} label={isOff ? '☐' : '☑'} plain dimColor={isOff} onPress={() => void toggleStep($, p.id, x.id)} />
                  <Text wrap="truncate-end">
                    <Text dimColor={isOff}> {x.label.padEnd(labelW)}</Text>
                    <Text dimColor strikethrough>{x.from}</Text>
                    <Text dimColor> → </Text>
                    <Text color={isOff ? undefined : p.color} dimColor={isOff} bold={!isOff}>{x.to}</Text>
                  </Text>
                </Box>
                <Text color={KZ.mist} wrap="truncate-end">{'   '}{isOff ? 'left out of this activation' : x.why}</Text>
              </Box>
            )
          if (x.status === 'same')
            return (
              <Text key={`row:${p.id}:${x.id}`} wrap="truncate-end">
                <Text color="success">✓ </Text>
                <Text dimColor> {x.label.padEnd(labelW)}{x.to}</Text>
              </Text>
            )
          return (
            <Text key={`row:${p.id}:${x.id}`} color="warning" wrap="truncate-end">
              ⊘ <Text dimColor> {x.label}: {SKIP_REASON[x.status]}</Text>
            </Text>
          )
        })}
        {applyRow(p)}
      </Box>
    )
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="head" flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={KZ.clay} bold>⎈ HELM</Text>
            <Text dimColor>  {facts}</Text>
          </Text>
          {inForce ? <Text color="success" wrap="truncate-end">✓ {inForce.icon} {inForce.name} in force</Text> : null}
          {suggestion ? <Text color={KZ.amber} wrap="truncate-end">◔ Token saver suggested: {suggestion}</Text> : null}
          {notice}
          {fileError}
          {tools}
        </Box>
        {all.map(p => {
          const plan = planOf(p)
          const { same, of } = matchOf(plan)
          const isOpenCard = p.id === open.id
          return (
            <Box key={`card:${p.id}`} flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Button key={`pick:${p.id}`} label={`${isOpenCard ? '▾' : '▸'} ${p.icon} ${p.name}`} plain dimColor={!isOpenCard} onPress={() => void select($, p.id)} />
                <Text>
                  {suggestion !== null && p.id === 'saver' ? <Text color={KZ.amber}>suggested </Text> : null}
                  <Text color={p.color}>{bar(of === 0 ? 0 : same / of, meterW, '·')}</Text>
                  <Text color={isInForce(plan) ? 'success' : undefined} dimColor={!isInForce(plan)}> {meterText(plan)}</Text>
                </Text>
              </Box>
              <Text dimColor wrap="truncate-end">{'    '}{p.tagline}</Text>
              {isOpenCard ? detail(p) : null}
            </Box>
          )
        })}
        {history.length > 0 ? (
          <Box key="history" flexDirection="column">
            <Text dimColor bold>HISTORY</Text>
            {history.slice(0, 5).map((b, i) => (
              <Text key={`h:${i}`} dimColor wrap="truncate-end">{clockOf(b.at)}  {b.icon} {b.name}: {summary(b).replace(`${b.name} applied: `, '')}</Text>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
