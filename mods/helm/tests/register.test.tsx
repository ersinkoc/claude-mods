import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Row } from '../hooks/profiles.ts'
import { clockOf } from '../hooks/view.ts'
import { ROWS } from './rows.ts'

const FILE = '/home/me/.claude/settings.json'
const PANE = { title: 'KOZMOS · Helm', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

type World = {
  rows: Row[]
  file: string | null
  writes: { path: string; text: string }[]
  sets: { key: string; value: unknown }[]
  log: string[]
  denied: Set<string>
  efforts: unknown[]
  model: string | 'fail'
  limits: { kind: string; percentUsed: number }[]
  isPlaced: boolean
  isOpen: boolean
  /** The engine's loaded copy follows the file, unless it is frozen (it never reloads). */
  isFrozen: boolean
  readFails: boolean
  writeFails: boolean
  settingsFails: boolean
  storeFails: boolean
  closeFails: boolean
  /** Rows whose config.set throws. */
  throws: Set<string>
  /** Holds every config.set until it resolves. */
  gate: Promise<void> | null
  stored: Map<string, unknown>
}

let current: World | undefined

/** The engine hands hooks resolved paths (`D:\\home\\me\\…` on Windows): compare them as POSIX. */
const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function world(on: On, file: string | null = '{\n  "model": "opus"\n}\n', stored: Record<string, unknown> = {}, env: Record<string, string> = { HOME: '/home/me' }): World {
  const w: World = {
    rows: ROWS(), file, writes: [], sets: [], log: [], denied: new Set(), efforts: [], model: 'claude-opus-5-5', limits: [],
    isPlaced: true, isOpen: false, isFrozen: false, readFails: false, writeFails: false, settingsFails: false, storeFails: false, closeFails: false, throws: new Set(), gate: null,
    stored: new Map(Object.entries(stored)),
  }
  current = w
  let loaded = file
  mock.env(on, env)
  const path = env.CLAUDE_CONFIG_DIR ? `${env.CLAUDE_CONFIG_DIR}/settings.json` : FILE
  on('config.list', () => ({ value: w.rows.map(r => ({ ...r, provider: { kind: 'engine' } })) }) as never)
  on('config.set', async (_$, e) => {
    if (w.gate) await w.gate
    const r = w.rows.find(x => x.key === e.key)
    if (!r || w.throws.has(e.key)) throw new Error('no such row')
    if (w.denied.has(e.key)) return { deny: `${r.label} can only be changed from the /config panel.` }
    w.log.push(`set ${e.key}`)
    w.sets.push({ key: e.key, value: e.value })
    r.value = e.value as Row['value']
    return { value: e.value }
  })
  on('fs.read', (_$, e) => {
    if (w.readFails) throw new Error('EACCES')
    if (posix(e.path) === path && w.file !== null) return { value: w.file }
    throw new Error('ENOENT')
  })
  on('fs.write', (_$, e) => {
    const at = posix(e.path)
    if (w.writeFails && at === path) throw new Error('disk full')
    w.writes.push({ path: at, text: e.text })
    w.log.push(`write ${at.split('/').pop()}`)
    if (at === path) {
      w.file = e.text
      if (!w.isFrozen) loaded = e.text
    }
    return { value: undefined }
  })
  on('settings.read', () => {
    if (w.settingsFails) throw new Error('settings down')
    try {
      const v: unknown = JSON.parse(loaded ?? '{}')
      return { value: v && typeof v === 'object' && !Array.isArray(v) ? v : {} } as never
    } catch {
      return { value: {} } as never
    }
  })
  on('session.model', () => {
    if (w.model === 'fail') throw new Error('no model')
    return { value: w.model }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: w.limits } }) as never)
  on('store.get', (_$, e) => ({ value: w.stored.get(e.key) }))
  on('store.set', (_$, e) => {
    if (w.storeFails) throw new Error('store down')
    w.stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    w.isOpen = w.isPlaced
    return { value: { isPlaced: w.isPlaced } } as never
  })
  on('ui.close', () => {
    if (w.closeFails) throw new Error('close down')
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.isOpen ? [{ id: 'kz-helm', title: 'KOZMOS · Helm', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.step', async function* (_$, e) {
    w.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return w
}

const start = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.session.start({ surface, isInteractive: true, cwd: '/work' } as never)
const helm = async ($: Engine, args: string) => (await $.command.run({ command: 'helm', args, ...RUN })).text ?? ''
const json = (w: World) => JSON.parse(w.file!) as Record<string, any>
const mount = ($: Engine, surface: 'terminal' | 'desktop') => $.ui.mount({ plugin: 'helm', surface, component: 'Pane', requestId: 'kz-helm', props: PANE } as never)

/** One main-loop request; resolves to the effort it was sent with. */
async function step($: Engine, model: string, effort?: string, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3, ...(effort ? { effort } : {}), ...(agentId ? { agentId } : {}) } as never)
  for (;;) if ((await stream.next()).done) break
  return current!.efforts.at(-1)
}

describe('applying and undoing', () => {
  test('Token saver: settings.json first (backed up), then rows; effort waits for the new model; undo puts all back', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    const out = await helm($, 'apply saver')
    expect(out).toMatch(/^Token saver applied: 9 settings changed \(effort low\)/)
    expect(out).toContain('\n/helm undo reverts it')
    expect(w.writes[0]).toEqual({ path: `${FILE}.helm.bak`, text: '{\n  "model": "opus"\n}\n' })
    expect(json(w)).toEqual({ model: 'opus', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', MAX_MCP_OUTPUT_TOKENS: '10000' } })
    expect(w.log.lastIndexOf('write settings.json')).toBeLessThan(w.log.findIndex(l => l.startsWith('set ')))
    expect(w.sets).toContainEqual({ key: 'model', value: 'sonnet' })
    expect(w.sets).toContainEqual({ key: 'autoContinueAtUsageLimit', value: false })

    // the model switched, so the effort is saved under the id the next request names, and sent with it
    expect(await step($, 'claude-sonnet-5-5')).toBe('low')
    expect(json(w).modelSettings).toEqual({ 'claude-sonnet-5-5': { effortLevel: 'low' } })
    expect(await step($, 'claude-sonnet-5-5', 'medium')).toBe('medium')
    expect(await helm($, 'history')).toContain('◔ Token saver: 9 changed')

    w.sets.length = 0
    w.log.length = 0
    expect(await helm($, 'undo')).toBe('Undid Token saver: 9 settings restored')
    expect(w.log.lastIndexOf('write settings.json')).toBeLessThan(w.log.findIndex(l => l.startsWith('set ')))
    expect(w.sets).toContainEqual({ key: 'model', value: 'default' })
    expect(w.sets).toContainEqual({ key: 'outputStyle', value: 'default' })
    expect(json(w)).toEqual({ model: 'opus' })
    // the copy aside is taken once a session
    expect(w.writes.filter(x => x.path.endsWith('.helm.bak'))).toHaveLength(1)
    expect(await helm($, 'undo')).toBe('Nothing to undo')
    expect(await helm($, 'history')).toBe('Helm history: nothing applied yet')
  })

  test('Autopilot keeps the model: effort is saved for it at once and not again on the next request', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    expect(await helm($, 'apply autopilot')).toMatch(/^Autopilot applied: \d+ settings changed \(effort high\)/)
    expect(json(w).modelSettings).toEqual({ 'claude-opus-5-5': { effortLevel: 'high' } })
    const writes = w.writes.length
    expect(await step($, 'claude-opus-5-5', 'xhigh')).toBe('high')
    expect(w.writes.length).toBe(writes)
    await helm($, 'undo')
    expect(json(w).modelSettings).toBeUndefined()
  })

  test('an effort is left for the next request when the model is unknown or not an id', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.model = 'fail'
    await start($)
    await helm($, 'apply autopilot')
    expect(json(w).modelSettings).toBeUndefined()
    // a subagent's request is left alone
    expect(await step($, 'claude-haiku-5-5', 'low', 'agent-1')).toBe('low')
    expect(await step($, 'claude-opus-5-5')).toBe('high')
    expect(json(w).modelSettings).toEqual({ 'claude-opus-5-5': { effortLevel: 'high' } })

    w.model = 'Opus 5.5'
    await helm($, 'undo')
    await helm($, 'apply autopilot')
    expect(json(w).modelSettings).toBeUndefined()
    // a model id with a dot cannot be saved; the request still carries the effort
    expect(await step($, 'us.anthropic.claude-opus-5-5-v1:0')).toBe('high')
    expect(json(w).modelSettings).toBeUndefined()
  })

  test('a row the engine refuses is reported and left out of the undo', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.denied.add('permissionMode')
    w.rows = w.rows.filter(r => r.key !== 'workflows')
    await start($)
    const out = await helm($, 'apply autopilot')
    expect(out).toContain('\n  ⊘ Default permission mode: Default permission mode can only be changed from the /config panel.')
    expect(out).toContain('\n  ⊘ workflows: not in this Claude Code version')
    w.sets.length = 0
    expect(await helm($, 'undo')).toMatch(/^Undid Autopilot/)
    expect(w.sets.map(s => s.key)).not.toContain('permissionMode')
  })

  test('a row that throws, and an undo the engine refuses, are reported', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    await helm($, 'apply quiet')
    w.rows = w.rows.filter(r => r.key !== 'tips')
    w.denied.add('prStatus')
    const out = await helm($, 'undo')
    expect(out).toMatch(/^Undid Quiet focus, except /)
    expect(out).toContain('Show PR status footer (Show PR status footer can only be changed from the /config panel.)')
    expect(out).toContain('Show tips (no implementation for config.set)')
    // a refused row does not keep the entry: the rest was undone
    expect(await helm($, 'undo')).toBe('Nothing to undo')
  })

  test('a settings.json that is not JSON is never overwritten; rows still apply', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, '{ "model": "opus", // a comment\n}')
    await start($)
    const out = await helm($, 'apply saver')
    expect(out).toContain('⊘ Subagent model: settings.json is not valid JSON')
    expect(out).toContain('⊘ MCP output cap: settings.json is not valid JSON')
    expect(w.writes).toEqual([])
    expect(w.sets.length).toBeGreaterThan(0)
  })

  test('no home directory: settings steps are skipped, rows apply', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, undefined, {}, {})
    await start($)
    expect(await helm($, 'apply guarded')).toContain('⊘ Bypass mode: no home directory to find settings.json in')
    expect(w.writes).toEqual([])
    expect(await helm($, 'undo')).toMatch(/^Undid Guarded/)
  })

  test('CLAUDE_CONFIG_DIR wins; a missing file is created', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, null, {}, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' })
    await start($)
    await helm($, 'apply guarded')
    expect(w.writes.map(x => x.path)).toEqual(['/cfg/settings.json'])
    expect(JSON.parse(w.writes[0]!.text).permissions.disableBypassPermissionsMode).toBe('disable')
  })

  test('a file the engine loaded but Helm cannot read is never overwritten', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.readFails = true
    await start($)
    expect(await helm($, 'apply guarded')).toContain(`⊘ Deny rules: cannot read ${FILE}`)
    expect(w.writes).toEqual([])
  })

  test('when the engine never reloads the file, rows are skipped and the session restart is asked for', async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.sleep', () => ({ value: undefined }))
    const w = world(on)
    w.isFrozen = true
    await start($)
    const out = await helm($, 'apply saver')
    // written twice: once, then once more with a different body
    expect(w.writes.filter(x => x.path === FILE)).toHaveLength(2)
    expect(out).toContain('⊘ settings.json: Claude Code did not reload settings.json')
    expect(out).toContain('⊘ Model: Claude Code did not reload settings.json; restart the session, then apply again')
    expect(w.sets).toEqual([])
    // its undo puts the file back; the rows were never set, so nothing else is touched
    expect(await helm($, 'undo')).toBe('Undid Token saver: 2 settings restored')
    expect(json(w)).toEqual({ model: 'opus' })
  })

  test('a write that fails is reported, and undo can be tried again once it works', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.writeFails = true
    await start($)
    const out = await helm($, 'apply saver')
    // a hook that throws reaches the plugin as nothing answering the write
    expect(out).toContain('⊘ Subagent model: may not be written: no implementation for fs.write')
    expect(out).toContain('⊘ Model: Claude Code did not reload settings.json')
    expect(w.sets).toEqual([])
    expect(await helm($, 'undo')).toBe('Not undone: settings.json (no implementation for fs.write). Fix it and run /helm undo again')
    w.writeFails = false
    expect(await helm($, 'undo')).toBe('Undid Token saver: 2 settings restored')
    expect(json(w)).toEqual({ model: 'opus' })
  })

  test('an undo whose settings.json became unreadable keeps the entry', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    await helm($, 'apply guarded')
    w.file = '[]'
    expect(await helm($, 'undo')).toBe('Not undone: settings.json (settings.json is not a JSON object). Fix it and run /helm undo again')
    w.file = '{}'
    expect(await helm($, 'undo')).toMatch(/^Undid Guarded/)
  })

  test('a profile already in force changes nothing and keeps no history', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    world(on)
    await start($)
    await helm($, 'apply quiet')
    expect(await helm($, 'apply quiet')).toBe('Quiet focus: already in place\n/helm undo reverts it')
    expect(await helm($, 'history')).toContain('☾ Quiet focus: 5 changed')
    expect((await helm($, 'history')).split('\n')).toHaveLength(2)
  })
})

describe('the command', () => {
  test('toggle opens and closes the pane; close closes it', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    expect(await helm($, '')).toBe('Helm open: press a profile to see what it sets.')
    expect(w.isOpen).toBe(true)
    expect(await helm($, '')).toBe('Helm closed.')
    await helm($, '')
    expect(await helm($, 'close')).toBe('Helm closed.')
    expect(w.isOpen).toBe(false)
  })

  test('where no pane can be placed, the answers are text', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.isPlaced = false
    await start($)
    expect(await helm($, '')).toMatch(/^Helm profiles\n  ◔ saver/)
    const out = await helm($, 'guarded')
    expect(out).toMatch(/^▣ Guarded/)
    expect(out).toContain('Deny rules: none → +5 rules')
    expect(out).toMatch(/\/helm apply guarded makes \d changes$/)
    expect(w.sets).toEqual([])
    expect(w.writes).toEqual([])
  })

  test('a profile name opens it in the pane without writing anything', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    expect(await helm($, 'Plan first')).toBe('◇ Plan first: 4 changes, shown in the pane · /helm apply planner')
    expect(await helm($, 'quiet')).toMatch(/^☾ Quiet focus: \d changes,/)
    w.rows = w.rows.map(r => (r.key === 'model' ? { ...r, value: 'opusplan' } : r.key === 'permissionMode' ? { ...r, value: 'plan' } : r))
    expect(await helm($, 'planner')).toMatch(/^◇ Plan first: 2 changes/)
    expect(w.sets).toEqual([])
  })

  test('unknown names and help', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    world(on)
    await start($)
    expect(await helm($, 'apply cheap')).toBe('Unknown profile "cheap". Profiles: saver, flow, quality, planner, guarded, autopilot, quiet')
    expect(await helm($, 'cheap')).toBe('Unknown "cheap". Profiles: saver, flow, quality, planner, guarded, autopilot, quiet; or /helm help')
    expect(await helm($, 'save')).toMatch(/^Usage: \/helm save/)
    expect(await helm($, 'help')).toMatch(/^\/helm \[/)
  })

  test('list marks Token saver as suggested near a limit, until it is in force', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.limits = [{ kind: 'five_hour', percentUsed: 92 }]
    await start($)
    expect(await helm($, 'list')).toContain('← suggested: 5-hour limit at 92%')
    await helm($, 'apply saver')
    await step($, 'claude-sonnet-5-5')
    expect(await helm($, 'list')).not.toContain('suggested')
    expect(await helm($, 'list')).toMatch(/◔ saver\s+✓ in force/)
  })

  test('suggestAt moves the threshold', { options: { suggestAt: 95 } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.limits = [{ kind: 'seven_day', percentUsed: 92 }]
    await start($)
    expect(await helm($, 'list')).not.toContain('suggested')
  })
})

describe('your own profiles', () => {
  test('save captures the setup, apply brings it back, rm removes it; all kept in the store', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on, '{ "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" }, "modelSettings": { "claude-opus-5-5": { "effortLevel": "xhigh" } } }')
    await start($)
    await step($, 'claude-opus-5-5')
    expect(await helm($, 'save Deep work')).toMatch(/^Saved ★ Deep work: \d+ settings · \/helm apply my-deep-work brings them back$/)
    expect((w.stored.get('custom') as { id: string }[]).map(p => p.id)).toEqual(['my-deep-work'])
    expect(await helm($, 'save deep work')).toMatch(/^Updated ★ deep work/)

    await helm($, 'apply saver')
    await step($, 'claude-sonnet-5-5')
    expect(json(w).env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku')
    expect(await helm($, 'apply deep work')).toMatch(/^deep work applied: \d+ settings changed/)
    expect(w.sets).toContainEqual({ key: 'model', value: 'default' })
    expect(json(w).env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet')
    await step($, 'claude-opus-5-5')
    expect(await helm($, 'list')).toMatch(/★ my-deep-work ✓ in force/)

    expect(await helm($, 'rm saver')).toBe('Built-in profiles cannot be removed')
    expect(await helm($, 'rm nope')).toBe('No saved profile "nope"')
    expect(await helm($, 'rm deep-work')).toBe('Removed ★ deep work')
    expect(w.stored.get('custom')).toEqual([])
  })

  test('history, pending effort and saved profiles come back from the store; junk is dropped', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const custom = [{ id: 'my-a', name: 'A', icon: '★', color: '#fff', tagline: 't', steps: [{ layer: 'config', key: 'tips', value: false, why: 'w' }] }, { id: 'bad' }]
    const history = [{ id: 'h1', profile: 'my-a', name: 'A', icon: '★', at: 0, entries: [{ layer: 'config', key: 'tips', label: 'Show tips', previous: true }], skipped: [] }, { id: 3 }]
    const w = world(on, '{}', { custom, history, pending: { value: 'max', backupId: 'h1' } })
    await start($)
    expect(await helm($, 'list')).toContain('★ my-a')
    expect(await helm($, 'history')).toContain('★ A: 1 changed')
    expect(await step($, 'claude-opus-5-5')).toBe('max')
    expect(json(w).modelSettings).toEqual({ 'claude-opus-5-5': { effortLevel: 'max' } })
    expect(await helm($, 'undo')).toBe('Undid A: 2 settings restored')
    expect(w.sets).toContainEqual({ key: 'tips', value: true })
    expect(json(w)).toEqual({})
  })

  test('a store that holds nothing usable starts fresh', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    world(on, '{}', { custom: 'x', history: 'y', pending: 'z' })
    await start($)
    expect(await helm($, 'history')).toBe('Helm history: nothing applied yet')
    expect(await step($, 'claude-opus-5-5', 'low')).toBe('low')
  })
})

describe('the pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: profiles, the first open, another opens on press, a step left out, Apply and Undo`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 })
      const w = world(on)
      w.limits = [{ kind: 'five_hour', percentUsed: 88 }]
      await start($, surface)
      await helm($, '')
      const ui = await mount($, surface)
      for (const id of ['saver', 'flow', 'quality', 'planner', 'guarded', 'autopilot', 'quiet']) expect(await ui.find({ key: `pick:${id}` })).toBeDefined()
      expect(await ui.find({ key: 'apply:saver' })).toBeDefined()
      expect(await ui.find({ key: 'apply:flow' })).toBeUndefined()
      expect(await ui.find({ key: 'undo' })).toBeUndefined()
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /Token saver suggested: 5-hour limit at 88%/ })).toBeDefined()
      else expect((await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))[0]).toContain('Token saver suggested (5-hour limit at 88%)')

      await ui.press({ key: 'pick:flow' })
      expect(await ui.find({ key: 'apply:saver' })).toBeUndefined()
      expect((await ui.find({ key: 'apply:flow' }))?.props.label).toBe('Apply Fast flow · 4')
      // leave the permission mode out
      await ui.press({ key: 'step:flow:config:permissionMode' })
      expect((await ui.find({ key: 'step:flow:config:permissionMode' }))?.props.label).toBe('☐')
      expect((await ui.find({ key: 'apply:flow' }))?.props.label).toBe('Apply Fast flow · 3')
      await ui.press({ key: 'step:flow:config:permissionMode' })
      await ui.press({ key: 'step:flow:config:permissionMode' })
      await ui.press({ key: 'apply:flow' })
      expect(w.sets.map(s => s.key)).not.toContain('permissionMode')
      expect(w.sets).toContainEqual({ key: 'model', value: 'sonnet' })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /✓ Fast flow applied: 3 settings changed \(effort medium\)/ })).toBeDefined()
      // the left-out step is back on for the next activation
      expect((await ui.find({ key: 'apply:flow' }))?.props.label).toBe('Apply Fast flow · 1')
      expect((await ui.find({ key: 'undo' }))?.props.label).toBe('↶ Undo Fast flow')

      await ui.press({ key: 'undo' })
      expect(w.sets).toContainEqual({ key: 'model', value: 'default' })
      expect(await ui.find({ key: 'undo' })).toBeUndefined()

      // save my setup, then remove it from its card
      await ui.press({ key: 'snapshot' })
      const rm = `rm:my-snapshot-${clockOf(1_000_000).replace(':', '')}`
      expect(await ui.find({ key: rm })).toBeDefined()
      await ui.press({ key: rm })
      expect(await ui.find({ key: rm })).toBeUndefined()
      await ui.unmount()
    })

    test(`${surface}: a profile in force, history rows, and a file Helm cannot write`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 })
      const w = world(on, 'not json')
      await start($, surface)
      await helm($, 'apply quiet')
      await helm($, 'quiet')
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'apply:quiet' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /In force: nothing to change/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /settings.json is not valid JSON: its steps are left alone/ })).toBeDefined()
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /☾ Quiet focus in force/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /☾ Quiet focus: 5 settings changed/ })).toBeDefined()
      } else {
        const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
        expect(alts[0]).toContain('Quiet focus in force')
        expect(alts.some(a => a.includes('Quiet focus: Quiet focus applied: 5 settings changed'))).toBe(true)
      }
      // a /config change made elsewhere redraws the cards
      w.rows = w.rows.map(r => (r.key === 'tips' ? { ...r, value: true } : r))
      await $.config.set({ key: 'tips', value: true, origin: { kind: 'composer' } } as never)
      expect((await ui.find({ key: 'apply:quiet' }))?.props.label).toBe('Apply Quiet focus · 1')
      await ui.unmount()
    })
  }

  test('leaving every change out offers nothing to apply', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    await helm($, 'planner')
    const ui = await mount($, 'terminal')
    for (const id of ['config:model', 'effort', 'config:permissionMode', 'config:useAutoModeDuringPlan']) await ui.press({ key: `step:planner:${id}` })
    expect(await ui.find({ key: 'apply:planner' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Nothing selected to change/ })).toBeDefined()
    await ui.unmount()
    expect(w.sets).toEqual([])
  })
})

describe('edges', () => {
  test('nothing beneath answers: every command still answers, the pane still draws', async ($, on) => {
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await start($)
    expect(await helm($, '')).toMatch(/^Helm profiles\n/)
    expect(await helm($, 'close')).toBe('Helm closed.')
    expect(await helm($, 'list')).toMatch(/◔ saver\s+0\/3/)
    expect(await helm($, 'save Mine')).toBe('Saved ★ Mine: 3 settings · /helm apply my-mine brings them back')
    expect(await helm($, 'apply mine')).toBe('Mine: already in place\n/helm undo reverts it')
    const out = await helm($, 'apply guarded')
    expect(out).toContain('⊘ Bypass mode: no home directory to find settings.json in')
    expect(out).toContain('⊘ permissionMode: not in this Claude Code version')
    expect(await helm($, 'undo')).toBe('Nothing to undo')
    const ui = await $.ui.mount({ plugin: 'helm', surface: 'terminal', component: 'Pane', requestId: 'kz-helm', props: { ...PANE, bodyColumns: 0 } } as never)
    await ui.press({ key: 'pick:quiet' })
    expect(await ui.find({ type: 'Text', text: /0\/0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tips: not in this Claude Code version/ })).toBeDefined()
    await ui.press({ key: 'snapshot' })
    expect(await ui.find({ key: `rm:my-snapshot-${clockOf(0).replace(':', '')}` })).toBeDefined()
    await ui.unmount()
  })

  test('a settings.read that fails: a missing file is still created, and the wait gives up', async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.sleep', () => ({ value: undefined }))
    const w = world(on, null)
    w.settingsFails = true
    await start($)
    const out = await helm($, 'apply guarded')
    expect(json(w).permissions.disableBypassPermissionsMode).toBe('disable')
    expect(out).toContain('⊘ settings.json: Claude Code did not reload settings.json')
    expect(w.sets).toEqual([])
  })

  test('an undo the engine does not reload leaves the rows, and says so', async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.sleep', () => ({ value: undefined }))
    const w = world(on)
    await start($)
    await helm($, 'apply guarded')
    w.isFrozen = true
    const out = await helm($, 'undo')
    expect(out).toMatch(/^Undid Guarded, except Ultracode keyword trigger \(Claude Code did not reload settings.json/)
    expect(out).toContain('Use auto mode during plan (Claude Code did not reload')
  })

  test('one change, one setting', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.rows = w.rows.map(r => (({ promptSuggestionEnabled: false, reduceMotion: true, agentPushNotifEnabled: false, prStatus: false } as Record<string, Row['value']>)[r.key] === undefined ? r : { ...r, value: ({ promptSuggestionEnabled: false, reduceMotion: true, agentPushNotifEnabled: false, prStatus: false } as Record<string, Row['value']>)[r.key]! }))
    await start($)
    expect(await helm($, 'quiet')).toBe('☾ Quiet focus: 1 change, shown in the pane · /helm apply quiet')
    expect(await helm($, 'apply quiet')).toBe('Quiet focus applied: 1 setting changed\n/helm undo reverts it')
    expect(await helm($, 'undo')).toBe('Undid Quiet focus: 1 setting restored')
  })

  test('saving: a bad name, two profiles, updating one, removing the other', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    expect(await helm($, 'save !!!')).toBe('Give the profile a name: /helm save <name>')
    await helm($, 'save One')
    await helm($, 'save Two')
    await helm($, 'save One')
    expect((w.stored.get('custom') as { id: string }[]).map(p => p.id)).toEqual(['my-one', 'my-two'])
    expect(await helm($, 'rm two')).toBe('Removed ★ Two')
    await helm($, '')
    const ui = await mount($, 'terminal')
    // One stays open: it was the one last saved
    expect(await ui.find({ key: 'rm:my-one' })).toBeDefined()
    await ui.unmount()
  })

  test('while one activation runs, another is refused and the pane says Applying…', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    let open!: () => void
    w.gate = new Promise(resolve => (open = resolve))
    await helm($, 'quiet')
    const ui = await mount($, 'terminal')
    const first = ui.press({ key: 'apply:quiet' })
    await clock.settle()
    expect(await helm($, 'apply quiet')).toBe('Helm is already applying a profile; try again in a moment')
    expect((await ui.find({ key: 'apply:quiet' }))?.props.label).toBe('Applying…')
    open()
    w.gate = null
    await first
    expect(await ui.find({ key: 'apply:quiet' })).toBeUndefined()
    await ui.unmount()
  })

  test('an effort that cannot be saved still goes with the next request', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    await helm($, 'apply saver')
    w.file = 'not json'
    expect(await step($, 'claude-sonnet-5-5')).toBe('low')
    expect(w.file).toBe('not json')
  })

  test('an effort saved into the newest of several activations', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    await helm($, 'apply quiet')
    await helm($, 'apply saver')
    await step($, 'claude-sonnet-5-5')
    expect(await helm($, 'history')).toMatch(/◔ Token saver: 8 changed\n.*☾ Quiet focus: 5 changed$/)
    expect(json(w).modelSettings).toEqual({ 'claude-sonnet-5-5': { effortLevel: 'low' } })
  })

  test('an effort write that fails, at apply and at the next request, still sends the effort', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    w.writeFails = true
    expect(await helm($, 'apply autopilot')).toMatch(/^Autopilot applied: \d+ settings changed \(effort high\)/)
    expect(await step($, 'claude-opus-5-5')).toBe('high')
    expect(json(w)).toEqual({ model: 'opus' })
  })

  test('a row whose write throws is reported with the reason', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    w.throws.add('tips')
    await start($)
    expect(await helm($, 'apply quiet')).toContain('⊘ Show tips: no implementation for config.set')
  })

  test('the pane: a warning notice, and history of a removed profile on the desktop', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($, 'desktop')
    await helm($, 'undo')
    const desk = await mount($, 'desktop')
    expect(await desk.find({ type: 'Text', text: /^! Nothing to undo/ })).toBeDefined()
    await desk.unmount()
    await helm($, 'save Mine')
    w.rows = w.rows.map(r => (r.key === 'tips' ? { ...r, value: false } : r))
    await helm($, 'apply mine')
    await helm($, 'rm mine')
    const again = await mount($, 'desktop')
    const alts = (await again.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
    expect(alts.some(a => /Mine: Mine applied: 1 setting changed/.test(a))).toBe(true)
    await again.unmount()
  })

  test('a store that refuses writes, and a pane that will not close, are lived with', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const w = world(on)
    await start($)
    w.storeFails = true
    expect(await helm($, 'apply autopilot')).toMatch(/^Autopilot applied/)
    expect(await helm($, 'history')).toContain('➤ Autopilot')
    await helm($, '')
    w.closeFails = true
    expect(await helm($, '')).toBe('Helm closed.')
  })
})
