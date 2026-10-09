import { describe, expect, mock, test } from 'claude-code/testing'

import type { FaultlineSnap } from '../types'
import { emptySnap } from '../hooks/lens.ts'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-faultline',
  props: { title: 'KOZMOS · Faultline', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = { tool_use_id: 'tu1', prompt: 'look', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }
const inAgent = (agentId: string) => ({ agentId })
const SNAP = { plugin: 'faultline', key: 'snap' } as const
// The test realm's timer (the type roots carry no DOM or Node globals).
declare const setTimeout: (fn: () => void, ms: number) => unknown
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

describe('faultline events', () => {
  test('/faultline opens the sidebar, closes it, and lists a clean session', async ($, on) => {
    let open = false
    const calls: string[] = []
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-faultline', title: 'KOZMOS · Faultline', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id}`)
      open = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      open = false
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await $.command.run({ command: 'faultline', args: ' list ', ...RUN })).text).toBe('Faultline: no failures this session.')
    expect((await $.command.run({ command: 'faultline', args: '', ...RUN })).text).toBe('Faultline open.')
    expect((await $.command.run({ command: 'faultline', args: '', ...RUN })).text).toBe('Faultline closed.')
    expect(calls).toEqual(['open kz-faultline', 'close kz-faultline'])
  })

  test('autoOpen opens the sidebar on start, and a refused open is shrugged off', { options: { autoOpen: true } }, async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await $.command.run({ command: 'faultline', args: 'list', ...RUN })).text).toBe('Faultline: no failures this session.')
  })

  test('tool failures: the text, the result, or a plain "failed"; denials by text; who hit them', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    let roster = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.spawn', ($, e) => {
      if (e.description === 'denied') return { deny: 'no' }
      if (e.description === 'remote') return { model: 'claude-haiku-5' }
      return { model: 'claude-haiku-5', agentId: e.description === '' ? 'a2' : 'a1' }
    })
    on('agent.list', ($, e, next) => {
      roster++
      if (roster === 1) return next(e)
      return { value: [{ id: 'listed1', description: 'Review docs', type: 'general-purpose', status: 'running' as const }, { id: 'listed2', description: '', type: 'Plan', status: 'running' as const }] }
    })
    on('tool.call', ($, e) => {
      if (e.tool === 'Bash' && e.command === 'a') return { isError: true as const, result: 'plain result text' }
      if (e.tool === 'Bash' && e.command === 'b') return { isError: true as const, result: { code: 1 } }
      if (e.tool === 'Bash') return { isError: true as const, result: undefined, text: 'The user doesn\'t want to proceed with this tool use.' }
      return { isError: true as const, result: undefined, text: `boom in ${e.tool}` }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.agent.spawn({ ...SPAWN, description: 'Explore tests', subagentType: 'Explore' })
    await $.agent.spawn({ ...SPAWN, description: '', subagentType: 'Plan' })
    await $.agent.spawn({ ...SPAWN, description: 'remote', subagentType: 'Plan' })
    expect(await $.agent.spawn({ ...SPAWN, description: 'denied', subagentType: 'Plan' })).toMatchObject({ deny: 'no' })

    await $.tool.call({ tool: 'Bash', command: 'a' })
    await $.tool.call({ tool: 'Bash', command: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'c' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', ...inAgent('a1') })
    await $.tool.call({ tool: 'Glob', pattern: 'x', ...inAgent('a2') })
    await $.tool.call({ tool: 'Read', file_path: '/w/a', ...inAgent('ghost-agent-1') }) // the roster is not readable
    await $.tool.call({ tool: 'WebFetch', url: 'https://x.dev', prompt: 'p', ...inAgent('listed1') })
    await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard', ...inAgent('listed2') })

    const { text } = await $.command.run({ command: 'faultline', args: 'list', ...RUN })
    expect(text).toContain('8 failures in 8 signatures, 8 in the last 10 minutes.')
    expect(text).toContain('denied  The user doesn\'t want to proceed with this tool use.')
    expect(text).toContain('Bash  plain result text')
    expect(text).toContain('Bash  failed')

    const ui = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...pane(0) })
    const all = await texts(ui)
    expect(all).toContain('◈ Explore tests')
    expect(all).toContain('◈ Plan')
    expect(all).toContain('◈ agent ghost-')
    expect(all).toContain('◈ Review docs')
    expect(all).toContain(' · 5 agents') // main, Explore tests, Plan, agent ghost-, Review docs
    expect(all).toMatch(/^ {2}on a$/m)
    await ui.unmount()
  })

  test('refusals, API errors and errored turns', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.StopFailure', () => ({}))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't-refused-1', reason: 'refusal', refusal: { category: null, explanation: null } })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't-error-22', reason: 'error' })
    await $.turn.complete({ answer: 'fine', durationMs: 1, isAborted: false, turnId: 't-ok', reason: 'answer' })
    await $.classic.StopFailure({ error: 'server_error', last_assistant_message: 'I was about to say' })

    const { text } = await $.command.run({ command: 'faultline', args: 'list', ...RUN })
    expect(text).toContain('3 failures in 3 signatures')
    expect(text).toMatch(/turn {2}Refusal$/m)
    expect(text).toContain('turn  Turn ended on an API error')
    expect(text).toContain('API  API error: server_error')

    const ui = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...pane(48) })
    const all = await texts(ui)
    expect(all).toContain('on turn t-refuse')
    expect(all).toContain('on turn t-error-')
    expect(all).toContain('on after: I was about to say')
    await ui.unmount()
  })

  test('fold, unfold and fold again; desktop cards fold too', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.copy', () => ({ value: { isCopied: true as const } }))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'fatal: one\ntwo\nthree\nfour\nfive' }))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'make' })

    const desk = await $.ui.mount({ plugin: 'faultline', surface: 'desktop', ...pane(48) })
    expect(await desk.find({ type: 'Code' })).toBeUndefined()
    const more = (await desk.findAll({ type: 'Button', text: '▾ more' }))[0]?.key ?? ''
    expect(String((await desk.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('1 failure in the last 10 min')
    await desk.press({ key: more })
    expect(await desk.find({ type: 'Code' })).toBeDefined()
    expect((await desk.find({ key: more }))?.props.label).toBe('▴ less')
    await desk.press({ key: more })
    expect(await desk.find({ type: 'Code' })).toBeUndefined()
    await desk.unmount()
  })

  test('copy puts the error on the clipboard, and a failed copy is shrugged off', async ($, on) => {
    mock.clock(on)
    const copied: string[] = []
    let canCopy = true
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.copy', ($, e, next) => {
      if (!canCopy) return next(e)
      copied.push(`${e.surface} ${e.text}`)
      return { value: { isCopied: true as const } }
    })
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'fatal: bad object' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'git show x' })
    const ui = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...pane(48) })
    const copy = (await ui.findAll({ type: 'Button', text: 'copy' }))[0]?.key ?? ''
    await ui.press({ key: copy })
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatch(/^terminal Bash — 1× .*\non: git show x\n\nfatal: bad object$/s)
    canCopy = false
    await ui.press({ key: copy })
    expect(copied).toHaveLength(1)
    await ui.unmount()
  })

  test('more than fifty signatures: the oldest are counted, not drawn', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', ($, e) => ({ isError: true as const, result: undefined, text: `fatal: ${e.tool === 'Grep' ? e.pattern : ''}` }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike'.split(' ')
    for (const a of words) for (const b of ['red', 'green', 'blue', 'cyan', 'pink']) await $.tool.call({ tool: 'Grep', pattern: `${a} ${b}` })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'faultline', surface, ...pane(48) })
      expect(await ui.find({ type: 'Text', text: '… 15 older signatures not shown' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the severity strip moves on with the clock, and goes quiet', async ($, on) => {
    const clock = mock.clock(on)
    const sets: number[] = []
    on('state.set', SNAP, ($, e, next) => {
      sets.push((e.value as FaultlineSnap).now)
      return next(e)
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(20_000) // one tick with nothing to show
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    expect(sets).toEqual([0, 20_000])
    await clock.advance(10_000) // tick at 30 s: the strip moves to its 30 s bucket
    await clock.advance(15_000) // tick at 45 s: same bucket, nothing to publish
    expect(sets).toEqual([0, 20_000, 30_000])
    await clock.advance(11 * 60_000)
    const ui = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...pane(48) })
    expect(await ui.find({ type: 'Text', text: /^0 recent$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('faultline without a started session', () => {
  test('the pane draws empty before anything was kept', async ($, on) => {
    mock.clock(on)
    const ui = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...pane(48) })
    expect(await ui.find({ type: 'Text', text: /No failures yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('a reload picks up what the session kept, and adds to it', async ($, on) => {
    mock.clock(on, { now: 5_000 })
    const kept: FaultlineSnap = { ...emptySnap(1_000), total: 4 }
    let isKept = true
    on('state.get', SNAP, ($, e, next) => (isKept ? { value: { value: kept, version: 1 } } : next(e)))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    isKept = false
    const { text } = await $.command.run({ command: 'faultline', args: 'list', ...RUN })
    expect(text).toContain('Faultline: 5 failures in 1 signatures')
  })

  test('a list after a reload with nothing kept', async ($, on) => {
    mock.clock(on)
    on('state.get', SNAP, () => ({ value: { value: null, version: 0 } }))
    const { text } = await $.command.run({ command: 'faultline', args: 'list', ...RUN })
    expect(text).toBe('Faultline: no failures this session.')
  })

  test('when state cannot be read or written, failures are dropped quietly', async ($, on) => {
    mock.clock(on)
    on('state.get', SNAP, () => ({ deny: 'unreadable' }))
    on('state.set', SNAP, () => ({ deny: 'unwritable' }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.StopFailure', () => ({}))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await $.tool.call({ tool: 'Read', file_path: '/w/a' })).toMatchObject({ isError: true })
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })).toBeDefined()
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'refusal', refusal: { category: 'cyber', explanation: null } })).toBeDefined()
    expect(await $.classic.StopFailure({ error: 'server_error' })).toBeDefined()
  })

  test('a broken clock: the timer and the recorders swallow it', async ($, on) => {
    let isBroken = false
    let release: () => void = () => undefined
    let brokenReads = 0
    on('clock.now', ($, e, next) => {
      if (!isBroken) return { value: 0 }
      brokenReads++
      return next(e)
    })
    on('clock.every', () => new Promise<{ value: undefined }>(resolve => { release = () => resolve({ value: undefined }) }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    isBroken = true
    expect(await $.tool.call({ tool: 'Read', file_path: '/w/a' })).toMatchObject({ isError: true })
    const before = brokenReads
    release()
    // The timer's tick reads the broken clock and lets the failure go.
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(brokenReads).toBeGreaterThan(before)
    // Nothing was recorded: the list reads no clock.
    expect((await $.command.run({ command: 'faultline', args: 'list', ...RUN })).text).toBe('Faultline: no failures this session.')
  })

  test('a hook that fails beneath passes the failure on', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a' })).rejects.toThrow()
    await expect($.agent.spawn({ ...SPAWN, description: 'x', subagentType: 'Plan' })).rejects.toThrow()
    await expect($.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).rejects.toThrow()
    await expect($.classic.StopFailure({ error: 'server_error' })).rejects.toThrow()
  })
})
