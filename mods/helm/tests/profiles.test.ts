import { describe, expect, test } from 'claude-code/testing'

import {
  BUILT_IN, MAX_CUSTOM, advice, applySettings, captureProfile, currentEffort, effortPath, findProfile, inSync, isInForce, matchOf,
  parseSettings, planFor, restorable, revertSettings, sameValue, sanitizeCustom, setPath, show, slug, suggestAtOf, universe, userSettingsPath,
} from '../hooks/profiles.ts'
import type { Profile, Row } from '../hooks/profiles.ts'
import { cardSvg, changedCount, headerSvg, historySvg, historyText, lineText, listText, meterText, parseArgs, planText, stepSvg, summary } from '../hooks/view.ts'
import type { HelmBackup } from '../types'
import { ROWS, row } from './rows.ts'

const byId = (id: string) => BUILT_IN.find(p => p.id === id)!

describe('the built-in profiles', () => {
  test('seven, with distinct ids, names and colors', () => {
    expect(BUILT_IN.map(p => p.id)).toEqual(['saver', 'flow', 'quality', 'planner', 'guarded', 'autopilot', 'quiet'])
    expect(new Set(BUILT_IN.map(p => p.color)).size).toBe(7)
    expect(new Set(BUILT_IN.map(p => p.name)).size).toBe(7)
    for (const p of BUILT_IN) expect(p.steps.length).toBeGreaterThanOrEqual(6)
  })

  test('every config step names a row Claude Code 2.1.302 has, with a value the row takes', () => {
    const rows = ROWS()
    for (const p of BUILT_IN)
      for (const s of p.steps) {
        if (s.layer !== 'config') continue
        const r = rows.find(x => x.key === s.key)
        expect(r).toBeDefined()
        if (r!.kind === 'boolean') expect(typeof s.value).toBe('boolean')
        if (r!.kind === 'choice') expect(r!.options).toContain(s.value as string)
      }
    // and against those rows, nothing is skipped
    for (const p of BUILT_IN) expect(planFor(p, rows, {}).filter(x => x.status !== 'change' && x.status !== 'same')).toEqual([])
  })

  test('profiles are found by id or name, case and spaces aside', () => {
    expect(findProfile(BUILT_IN, ' SAVER ')?.id).toBe('saver')
    expect(findProfile(BUILT_IN, 'plan first')?.id).toBe('planner')
    expect(findProfile(BUILT_IN, '')).toBeUndefined()
    expect(findProfile(BUILT_IN, 'cheap')).toBeUndefined()
  })
})

describe('planning', () => {
  test('the plan says what changes, what is already set and what cannot be', () => {
    const rows = ROWS().filter(r => r.key !== 'workflowKeywordTriggerEnabled')
    const plan = planFor(byId('saver'), rows, { env: { MAX_MCP_OUTPUT_TOKENS: '10000' } })
    const by = (id: string) => plan.find(p => p.id === id)!
    expect(by('config:model')).toMatchObject({ status: 'change', from: 'Default (recommended)', to: 'sonnet', label: 'Model' })
    expect(by('config:autoCompact').status).toBe('same')
    expect(by('config:recap').status).toBe('same')
    expect(by('config:workflowKeywordTriggerEnabled')).toMatchObject({ status: 'missing', from: '—', label: 'workflowKeywordTriggerEnabled' })
    expect(by('effort')).toMatchObject({ status: 'change', from: 'default', to: 'low' })
    expect(by('settings:env.MAX_MCP_OUTPUT_TOKENS').status).toBe('same')
    expect(by('settings:env.CLAUDE_CODE_SUBAGENT_MODEL')).toMatchObject({ status: 'change', from: 'unset', to: 'haiku' })
    expect(matchOf(plan)).toEqual({ same: 3, of: plan.length - 1 })
    expect(isInForce(plan)).toBe(false)
  })

  test('a locked row, a value the row does not offer and a value of the wrong kind are skipped', () => {
    const narrow = ROWS().map(r => (r.key === 'permissionMode' ? { ...r, options: ['default', 'plan'] } : r))
    expect(planFor(byId('autopilot'), narrow, {}).find(p => p.id === 'config:permissionMode')!.status).toBe('invalid')
    const locked = ROWS().map(r => (r.key === 'model' ? { ...r, isLocked: true } : r))
    expect(planFor(byId('saver'), locked, {}).find(p => p.id === 'config:model')!.status).toBe('locked')
    const odd: Profile = { id: 'odd', name: 'Odd', icon: '?', color: '#fff', tagline: '', steps: [
      { layer: 'config', key: 'tips', value: 'yes', why: '' },
      { layer: 'config', key: 'n', value: 'x', why: '' },
      { layer: 'config', key: 'lang', value: 'Turkish', why: '' },
      { layer: 'config', key: 'free', value: 'any', why: '' },
    ] }
    const rows = [...ROWS(), row('n', 'Number', 'number', 3), row('lang', 'Language', 'text', 'English'), row('free', 'Free choice', 'choice', 'a')]
    expect(planFor(odd, rows, {}).map(p => p.status)).toEqual(['invalid', 'invalid', 'change', 'change'])
    const num: Profile = { ...odd, steps: [{ layer: 'config', key: 'n', value: 3, why: '' }] }
    expect(planFor(num, rows, {})[0]!.status).toBe('same')
  })

  test('a profile fully set is in force; one with nothing that applies is not', () => {
    const rows = ROWS().map(r => {
      const s = byId('quiet').steps.find(x => x.layer === 'config' && x.key === r.key)
      return s && s.layer === 'config' ? { ...r, value: s.value } : r
    })
    const plan = planFor(byId('quiet'), rows, {})
    expect(isInForce(plan)).toBe(true)
    expect(meterText(plan)).toBe('✓ in force')
    expect(isInForce(planFor(byId('quiet'), [], {}))).toBe(false)
    expect(meterText(planFor(byId('quiet'), [], {}))).toBe('0/0')
  })

  test('effort is compared per model, unless the profile switches model', () => {
    const user = { effortLevel: 'high', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'medium' } } }
    const at = (live: Parameters<typeof planFor>[3]) => planFor(byId('autopilot'), ROWS(), user, live).find(p => p.id === 'effort')!
    // a top-level effortLevel is ignored by current models, so it does not count
    expect(at({ model: 'claude-sonnet-5-5' })).toMatchObject({ status: 'change', from: 'medium', to: 'high' })
    expect(at({ model: 'claude-opus-5-5', effort: 'high' }).status).toBe('same')
    expect(at({ model: 'claude-opus-5-5' }).from).toBe('default')
    expect(at({ pending: 'high' }).status).toBe('same')
    const s = planFor(byId('saver'), ROWS(), { modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } }, { model: 'claude-sonnet-5-5' })
    expect(s.find(p => p.id === 'effort')!.status).toBe('change')
    expect(effortPath('claude-sonnet-5-5')).toBe('modelSettings.claude-sonnet-5-5.effortLevel')
    expect(effortPath('us.anthropic.claude-sonnet-5-5-v1:0')).toBeUndefined()
    expect(effortPath(undefined)).toBeUndefined()
    expect(currentEffort({}, { effort: 3 })).toBe('3')
    expect(currentEffort({}, {})).toBeUndefined()
  })

  test("the menu's label for a value counts as that value, and is given back as the option", () => {
    expect(sameValue('Default (recommended)', 'default')).toBe(true)
    expect(sameValue('Default (recommended)', 'sonnet')).toBe(false)
    expect(sameValue(true, true)).toBe(true)
    expect(sameValue(1, '1')).toBe(false)
    expect(restorable(row('model', 'Model', 'choice', 'Default (recommended)', ['default', 'sonnet']))).toBe('default')
    expect(restorable(row('model', 'Model', 'choice', 'Custom', ['default']))).toBe('Custom')
    expect(restorable(row('tips', 'Tips', 'boolean', false))).toBe(false)
    expect([show(undefined), show(''), show(true), show(false), show([]), show(['a']), show(['a', 'b']), show(7)]).toEqual(['unset', 'unset', 'on', 'off', 'none', '1 rule', '2 rules', '7'])
  })

  test('the deny list counts what is missing', () => {
    const plan = planFor(byId('guarded'), ROWS(), { permissions: { deny: ['Read(./.env)', 3] } })
    expect(plan.find(p => p.id === 'list:permissions.deny')).toMatchObject({ status: 'change', from: '1 rule', to: '+4 rules' })
    const all = byId('guarded').steps.find(s => s.layer === 'list')!
    const full = planFor(byId('guarded'), ROWS(), { permissions: { deny: all.layer === 'list' ? all.add.slice(1) : [] } })
    expect(full.find(p => p.id === 'list:permissions.deny')!.to).toBe('+1 rule')
    const done = planFor(byId('guarded'), ROWS(), { permissions: { deny: all.layer === 'list' ? all.add : [] } })
    expect(done.find(p => p.id === 'list:permissions.deny')).toMatchObject({ status: 'same', to: '5 rules' })
  })
})

describe('settings.json', () => {
  test('steps write, undo restores exactly, other keys are untouched', () => {
    const before = { model: 'opus', env: { KEEP: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' }, permissions: { deny: ['Read(./.env)', 'Bash(curl:*)'] } }
    const steps = [...byId('saver').steps, ...byId('guarded').steps].filter(s => s.layer === 'settings' || s.layer === 'list')
    const { next, entries } = applySettings(before, steps as never)
    expect(next.effortLevel).toBeUndefined()
    expect(next.env).toEqual({ KEEP: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', MAX_MCP_OUTPUT_TOKENS: '10000' })
    const deny = (next.permissions as { deny: string[] }).deny
    expect(deny.filter(d => d === 'Read(./.env)')).toHaveLength(1)
    expect(deny).toContain('Bash(curl:*)')
    expect(deny).toContain('Read(~/.ssh/**)')
    expect((next.permissions as Record<string, string>).disableBypassPermissionsMode).toBe('disable')
    expect(revertSettings(next, entries)).toEqual(before)
  })

  test('a step already in place writes nothing; undo removes keys and parents it created', () => {
    const steps = byId('guarded').steps.filter(s => s.layer !== 'config' && s.layer !== 'effort')
    const { next, entries } = applySettings({}, steps as never)
    expect(Object.keys(next)).toEqual(['permissions'])
    expect(applySettings(next, steps as never).entries).toEqual([])
    expect(revertSettings(next, entries)).toEqual({})
  })

  test('undo of settings.json passes over a /config entry', () => {
    expect(revertSettings({ a: 1 }, [{ layer: 'config', key: 'tips', label: 'Show tips', previous: true }])).toEqual({ a: 1 })
  })

  test('undo keeps a deny rule the person added since', () => {
    const steps = byId('guarded').steps.filter(s => s.layer === 'list')
    const { next, entries } = applySettings({}, steps as never)
    const later = setPath(next, 'permissions.deny', [...(next.permissions as { deny: string[] }).deny, 'Bash(rm:*)'])
    expect(revertSettings(later, entries)).toEqual({ permissions: { deny: ['Bash(rm:*)'] } })
  })

  test('a null value removes the key; paths through non-objects are replaced', () => {
    const { next } = applySettings({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }, byId('quality').steps.filter(s => s.layer === 'settings') as never)
    expect(next.env).toBeUndefined()
    expect(setPath({ a: { b: 1 } }, 'a.b', undefined)).toEqual({})
    expect(setPath({ a: 'x' }, 'a.b', 1)).toEqual({ a: { b: 1 } })
    expect(setPath({ a: [1] }, 'a.b', 1)).toEqual({ a: { b: 1 } })
  })

  test('the engine is in sync when it holds every written path', () => {
    expect(inSync({ env: { A: '1' } }, { env: { A: '1' }, x: 2 }, ['env.A'])).toBe(true)
    expect(inSync({}, { env: { A: '1' } }, ['env.A'])).toBe(false)
    expect(inSync({}, {}, ['env.A'])).toBe(true)
  })

  test('a file that is not a JSON object is never trusted for a write', () => {
    expect(parseSettings('')).toEqual({ user: {}, error: null })
    expect(parseSettings('{"a":1}')).toEqual({ user: { a: 1 }, error: null })
    expect(parseSettings('[1]').error).toBe('settings.json is not a JSON object')
    expect(parseSettings('null').error).toBe('settings.json is not a JSON object')
    expect(parseSettings('{ // no').error).toBe('settings.json is not valid JSON')
  })

  test('settings.json is found through CLAUDE_CONFIG_DIR, else the home directory', () => {
    expect(userSettingsPath('/cfg/', '/home/me')).toBe('/cfg/settings.json')
    expect(userSettingsPath(undefined, 'C:\\Users\\me\\')).toBe('C:\\Users\\me/.claude/settings.json')
    expect(userSettingsPath('', '/home/me')).toBe('/home/me/.claude/settings.json')
    expect(userSettingsPath(undefined, undefined)).toBeNull()
  })
})

describe('your own profiles', () => {
  test('the current setup is saved: unlocked rows, effort, settings keys; no deny rules', () => {
    const rows = ROWS()
    const user = { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', MAX_MCP_OUTPUT_TOKENS: 5000 }, modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
    const p = captureProfile('  Deep   work ', rows, user, { model: 'claude-opus-5-5' }, []) as Profile
    expect(p).toMatchObject({ id: 'my-deep-work', name: 'Deep work', icon: '★', isCustom: true })
    const { config } = universe()
    expect(p.steps.filter(s => s.layer === 'config')).toHaveLength(config.length)
    expect(p.steps.find(s => s.layer === 'config' && s.key === 'model')).toMatchObject({ value: 'default' })
    expect(p.steps.find(s => s.layer === 'effort')).toMatchObject({ value: 'xhigh' })
    // a non-string value is left out rather than rewritten
    expect(p.steps.filter(s => s.layer === 'settings').map(s => (s.layer === 'settings' ? [s.path, s.value] : []))).toEqual([
      ['env.CLAUDE_CODE_SUBAGENT_MODEL', 'sonnet'],
      ['permissions.disableBypassPermissionsMode', null],
    ])
    expect(p.steps.some(s => s.layer === 'list')).toBe(false)
    expect(p.tagline).toBe(`your setup, ${p.steps.length} settings`)
    // applying it at once changes nothing
    expect(isInForce(planFor(p, rows, user, { model: 'claude-opus-5-5' }))).toBe(true)
  })

  test('a locked row and an unknown effort are left out', () => {
    const rows = ROWS().map(r => (r.key === 'model' ? { ...r, isLocked: true } : r))
    const p = captureProfile('x', rows, {}, { effort: 7 }, []) as Profile
    expect(p.steps.some(s => s.layer === 'config' && s.key === 'model')).toBe(false)
    expect(p.steps.some(s => s.layer === 'effort')).toBe(false)
  })

  test('names: empty, a built-in name, and the cap are refused; the same name updates', () => {
    expect(captureProfile('  !!  ', ROWS(), {}, {}, [])).toBe('Give the profile a name: /helm save <name>')
    expect(captureProfile('Token saver', ROWS(), {}, {}, [])).toMatch(/built-in profile's name/)
    expect(captureProfile('saver', ROWS(), {}, {}, [])).toMatch(/built-in/)
    const taken = Array.from({ length: MAX_CUSTOM }, (_, i) => captureProfile(`p${i}`, ROWS(), {}, {}, []) as Profile)
    expect(captureProfile('another', ROWS(), {}, {}, taken)).toMatch(/Up to 6 saved profiles/)
    expect((captureProfile('p0', ROWS(), {}, {}, taken) as Profile).id).toBe('my-p0')
    expect(slug('Çalışma Düzeni İ')).toBe('calisma-duzeni-i')
  })

  test('stored profiles are read back defensively', () => {
    const good = captureProfile('mine', ROWS(), {}, { effort: 'low' }, []) as Profile
    expect(sanitizeCustom('x')).toEqual([])
    const back = sanitizeCustom([
      good,
      null,
      { ...good, id: 'saver' },
      { ...good, steps: [{ layer: 'config', key: 'a', value: {}, why: '' }] },
      { ...good, id: 'my-b', steps: [{ layer: 'list', path: 'x', add: [], why: '' }] },
      { ...good, id: 'my-c', steps: [{ layer: 'effort', value: 'huge', why: '' }] },
      { ...good, id: 'my-d', steps: [{ layer: 'settings', path: 'x', label: 'X', value: 3, why: '' }] },
      { ...good, id: 'my-e', steps: [null] },
      { ...good, id: 'my-f', steps: [{ layer: 'config', key: 'tips', value: true }] },
      { ...good, id: 'my-g', icon: '!', tagline: 4 },
    ])
    expect(back.map(p => p.id)).toEqual(['my-mine', 'my-g'])
    expect(back[1]).toMatchObject({ icon: '★', tagline: '', isCustom: true })
  })
})

describe('advice', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 86.4 }, { kind: 'seven_day', percentUsed: 91 }, { kind: 'spend_limit', percentUsed: Number.NaN }]
  test('the hottest window over the threshold, unless Token saver is on or advice is off', () => {
    expect(advice(limits, 80, false)).toBe('weekly limit at 91%')
    expect(advice(limits.slice(0, 1), 80, false)).toBe('5-hour limit at 86%')
    expect(advice([{ kind: 'spend_limit', percentUsed: 99 }], 80, false)).toBe('spend limit limit at 99%')
    expect(advice(limits, 95, false)).toBeNull()
    expect(advice(limits, 80, true)).toBeNull()
    expect(advice(limits, 100, false)).toBeNull()
    expect([suggestAtOf(undefined), suggestAtOf(10), suggestAtOf(120), suggestAtOf(85.6), suggestAtOf(Number.NaN)]).toEqual([80, 50, 100, 86, 80])
  })
})

describe('view', () => {
  test('arguments parse into actions', () => {
    expect(parseArgs('')).toEqual({ kind: 'toggle' })
    expect(parseArgs('Saver')).toEqual({ kind: 'open', id: 'Saver' })
    expect(parseArgs('apply  plan first')).toEqual({ kind: 'apply', id: 'plan first' })
    expect(parseArgs('use')).toMatchObject({ kind: 'help' })
    expect(parseArgs('save Deep work')).toEqual({ kind: 'save', name: 'Deep work' })
    expect(parseArgs('save')).toMatchObject({ kind: 'help' })
    expect(parseArgs('rm deep')).toEqual({ kind: 'rm', id: 'deep' })
    expect(parseArgs('delete')).toMatchObject({ kind: 'help' })
    expect(['undo', 'list', 'ls', 'history', 'log', 'close', 'off'].map(v => parseArgs(v).kind)).toEqual(['undo', 'list', 'list', 'history', 'history', 'close', 'close'])
    expect(parseArgs('help')).toMatchObject({ kind: 'help', reason: expect.stringContaining('/helm [') })
  })

  test('plan, list, history and summary text', () => {
    const plan = planFor(byId('guarded'), ROWS().filter(r => r.key !== 'verbose'), {})
    const text = planText(byId('guarded'), plan, ['config:checkpoints', 'config:useAutoModeDuringPlan'])
    expect(text).toContain('▣ Guarded: You approve each change')
    expect(text).toContain('  ○ Use auto mode during plan: on → off  (left out)')
    expect(text).toContain('  ● Deny rules: none → +5 rules  (the Read tool is refused .env, secrets/, ~/.ssh and ~/.aws)')
    expect(text).toContain('  ⊘ verbose: not in this Claude Code version')
    expect(text).toContain('  ✓ Rewind code (checkpoints): on')
    expect(text).toContain('  ✓ Default permission mode: default')
    expect(text).toMatch(/\/helm apply guarded makes 3 changes$/)
    const one = planFor(byId('quiet'), ROWS().map(r => (r.key === 'tips' ? r : { ...r, value: ({ promptSuggestionEnabled: false, reduceMotion: true, agentPushNotifEnabled: false, recap: false, prStatus: false } as Record<string, Row['value']>)[r.key] ?? r.value })), {})
    expect(planText(byId('quiet'), one)).toMatch(/makes 1 change$/)
    expect(planText(byId('quiet'), one, ['config:tips'])).toMatch(/already in force$/)
    expect(lineText(one.find(x => x.id === 'config:reduceMotion')!)).toBe('Reduce motion: on')

    const list = listText([{ profile: byId('saver'), plan }, { profile: byId('flow'), plan: [] }], '5-hour limit at 90%')
    expect(list).toContain('← suggested: 5-hour limit at 90%')
    expect(list.split('\n')[2]).not.toContain('suggested')

    const b: HelmBackup = { id: '1', profile: 'saver', name: 'Token saver', icon: '◔', at: new Date(2026, 9, 18, 9, 5).getTime(), entries: [{ layer: 'config', key: 'model', label: 'Model', previous: 'default' }], skipped: [], effort: 'low' }
    expect(changedCount(b)).toBe(2)
    expect(summary(b)).toBe('Token saver applied: 2 settings changed (effort low)')
    const saved = { ...b, entries: [...b.entries, { layer: 'settings' as const, path: 'modelSettings.claude-opus-5-5.effortLevel', label: 'Effort', previous: null, had: false }] }
    expect(changedCount(saved)).toBe(2)
    expect(summary({ ...b, entries: [], effort: undefined })).toBe('Token saver: already in place')
    expect(summary({ ...b, effort: undefined, skipped: [{ label: 'x', reason: 'y' }] })).toBe('Token saver applied: 1 setting changed, 1 skipped')
    expect(historyText([])).toBe('Helm history: nothing applied yet')
    expect(historyText([b, { ...b, skipped: [{ label: 'x', reason: 'y' }] }])).toContain('  09:05  ◔ Token saver: 2 changed, 1 skipped')
  })

  test('desktop rows escape their text and mark state', () => {
    const p = { ...(captureProfile('a<b>', ROWS(), {}, {}, []) as Profile), name: 'a<b> & "c"' }
    const plan = planFor(p, ROWS(), {})
    const card = cardSvg(400, p, plan, true, true)
    expect(card).toContain('a&lt;b&gt; &amp; &quot;c&quot;')
    expect(card).toContain(`stroke="${p.color}"`)
    expect(card).toContain('suggested')
    expect(card).toContain('✓ in force')
    expect(cardSvg(400, byId('saver'), planFor(byId('saver'), ROWS(), {}), false, false)).not.toContain('stroke=')
    expect(cardSvg(400, byId('saver'), [], false, false)).toContain('0/0')
    const head = headerSvg(400, 'opus · high effort · auto mode', 'Guarded', '5-hour limit at 90%')
    expect(head).toContain('height="64"')
    expect(head).toContain('✓ Guarded')
    expect(headerSvg(400, 'x', null, null)).toContain('height="46"')
    const saver = planFor(byId('saver'), ROWS().filter(r => r.key !== 'recap'), {})
    expect(stepSvg(400, saver.find(x => x.id === 'config:model')!, '#fff', false)).toContain('cheaper per token')
    expect(stepSvg(400, saver.find(x => x.id === 'config:model')!, '#fff', true)).toContain('left out of this activation')
    expect(stepSvg(400, saver.find(x => x.id === 'config:autoCompact')!, '#fff', false)).toContain('height="20"')
    expect(stepSvg(400, saver.find(x => x.id === 'config:recap')!, '#fff', false)).toContain('not in this Claude Code version')
    const b: HelmBackup = { id: '1', profile: 'saver', name: 'Token saver', icon: '◔', at: 0, entries: [], skipped: [{ label: 'x', reason: 'y' }] }
    expect(historySvg(400, b, '#fff')).toContain('0 changed · 1 skipped')
    expect(historySvg(400, { ...b, skipped: [] }, '#fff')).not.toContain('skipped')
  })
})
