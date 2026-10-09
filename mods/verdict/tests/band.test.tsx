import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { VerdictRun } from '../types'
import { hash } from '../hooks/lib/kz.ts'

const NOW = 1_700_000_000_000
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const verdict = (args: string) => ({ command: 'verdict', args, ...RUN })
const BAND = (maxRows: number, bodyColumns = 110, hasSurvey = false) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey, isWorking: true, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})
const PANE = (bodyColumns = 60) => ({
  component: 'Pane' as const,
  requestId: 'kz-verdict',
  props: { title: 'KOZMOS · Verdict', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
})
const SNAP = { plugin: 'verdict', key: 'snap' } as const
const keyOf = (cwd: string) => `runs-${hash(cwd).toString(36)}`
const stored = (o: Partial<VerdictRun>): VerdictRun => ({
  id: 1, at: NOW - 60_000, ms: 1200, runner: 'vitest', kind: 'test', ok: true, pass: 12, fail: 0, skip: 0, errors: 0, warnings: 0, failures: [], command: 'npx vitest run', parsed: true, ...o,
})
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
/** What the plugin wrote to its store, seen on the way down to the mocked store. */
function storeWrites(on: On, key: string): unknown[] {
  const writes: unknown[] = []
  on('store.set', { key }, ($, e, next) => {
    writes.push(e.value)
    return next(e)
  })
  return writes
}
const SHELL = (stdout: string, stderr = '') => ({ result: { stdout, stderr, interrupted: false } })

/** The engine beneath: a drawn band, panes, and the shell answering `answer`. */
function world(on: On, answer: (command: string) => unknown = () => SHELL('')) {
  const open = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' || e.tool === 'PowerShell') return answer(e.command) as { result: unknown }
    return { result: 'ok' }
  })
  return { open }
}

describe('verdict commands', () => {
  test('/verdict opens and closes the pane, naming the last run', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    const { open } = world(on, () => SHELL(' Tests  3 passed (3)\n'))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. No runs yet.')
    expect((await $.command.run(verdict(''))).text).toBe('Verdict closed.')
    expect(open.size).toBe(0)
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. Last: vitest 3 passed.')
  })

  test('hide and show, kept in the store; /verdict alone shows the band again', async ($, on) => {
    mock.clock(on, { now: NOW })
    const writes = storeWrites(on, 'hidden')
    mock.store(on, {})
    world(on, () => ({ isError: true as const, result: undefined, text: 'Tests:       1 failed, 1 total\n' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Bash', command: 'npx jest' })
    expect((await $.command.run(verdict(' HIDE '))).text).toBe('Verdict band hidden.')
    expect(writes.at(-1)).toBe(true)
    let band = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(20) })
    expect(await band.find({ type: 'Svg' })).toBeUndefined()
    await band.unmount()
    expect((await $.command.run(verdict('show'))).text).toBe('Verdict band shown.')
    expect(writes.at(-1)).toBe(false)
    band = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(20) })
    expect(await band.find({ type: 'Svg' })).toBeDefined()
    await band.unmount()
    await $.command.run(verdict('hide'))
    expect(writes.at(-1)).toBe(true)
    await $.command.run(verdict(''))
    expect(writes.at(-1)).toBe(false)
  })

  test('a stored history comes back, bad entries dropped, the hidden flag kept', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {
      [keyOf('/work')]: [stored({ id: 1 }), null, 7, { runner: 'x' }, { runner: 'x', at: 1 }, { runner: 1, at: 1, failures: [] }, stored({ id: 2, runner: 'tsc', kind: 'types', at: NOW - 1000 })],
      hidden: true,
    })
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const pane = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...PANE() })
    expect(await texts(pane)).toContain('⚖ Verdict · 2 runs')
    await pane.unmount()
    const band = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(20) })
    expect(await band.find({ type: 'Svg' })).toBeUndefined()
    await band.unmount()
  })

  test('without a folder the history goes under a default key; a store that fails is shrugged off', async ($, on) => {
    mock.clock(on, { now: NOW })
    let gets = 0
    on('store.get', ($, e) => {
      gets++
      return { value: e.key === keyOf('default') ? [stored({ id: 5, runner: 'eslint', kind: 'lint' })] : undefined }
    })
    world(on, () => SHELL('✖ 1 problem (1 error, 0 warnings)'))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '' })
    expect(gets).toBe(2)
    await $.tool.call({ tool: 'Bash', command: 'npx eslint .' })
    expect((await $.command.run(verdict('hide'))).text).toBe('Verdict band hidden.')
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. Last: eslint 1 error.')
    expect((await $.command.run(verdict('clear'))).text).toBe('Verdict history cleared for this project.')
  })
})

describe('verdict runs', () => {
  test('stdout and stderr, a plain string result, the text, or nothing', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    world(on, command => {
      if (command === 'npx tsc a') return SHELL('a.ts(1,1): error TS1: x', 'Found 1 error.')
      if (command === 'npx tsc b') return { result: 'b.ts(1,1): error TS2: y' }
      if (command === 'npx tsc c') return { isError: true as const, result: { code: 2 }, text: 'Found 3 errors.' }
      return { isError: true as const, result: { code: 2 } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const c of ['a', 'b', 'c', 'd']) await $.tool.call({ tool: 'Bash', command: `npx tsc ${c}` })
    const pane = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...PANE() })
    const all = await texts(pane)
    expect(all).toContain('✗ tsc 1 error · ')
    expect(all).toContain('a.ts:1 TS1 x')
    expect(all).toContain('b.ts:1 TS2 y')
    expect(all).toContain('✗ tsc 3 errors')
    expect(all).toMatch(/✗ tsc 1 error\n/)
    await pane.unmount()
  })

  test('what is not a finished run: other tools, other commands, background, denied, interrupted', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    world(on, command => {
      if (command.includes('deny')) return { deny: 'not now' }
      if (command.includes('bg')) return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
      if (command.includes('int')) return { result: { stdout: '', stderr: '', interrupted: true } }
      return SHELL('ok')
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run', run_in_background: true })
    expect(await $.tool.call({ tool: 'Bash', command: 'npx vitest deny' })).toMatchObject({ deny: 'not now' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest bg' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest int' })
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. No runs yet.')
    await $.tool.call({ tool: 'PowerShell', command: 'npm run build' })
    expect((await $.command.run(verdict(''))).text).toBe('Verdict closed.')
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. Last: build built.')
  })

  test('a state that refuses writes keeps the history in memory', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('state.set', SNAP, () => ({ deny: 'read-only' }))
    world(on, () => SHELL(' Tests  2 passed (2)\n'))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
    expect((await $.command.run(verdict(''))).text).toBe('Verdict open. Last: vitest 2 passed.')
  })

  test('a shell call nothing answers passes its failure on', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await expect($.tool.call({ tool: 'Bash', command: 'npx vitest run' })).rejects.toThrow()
  })
})

describe('verdict drawings', () => {
  test('before the session started, the band leaves the engine drawing alone and the pane is empty', async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on)
    const band = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...BAND(20) })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    expect(await band.find({ key: 'engine' })).toBeDefined()
    await band.unmount()
    const term = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...PANE() })
    const all = await texts(term)
    expect(all).toContain('⚖ Verdict · 0 runs')
    expect(all).toContain('No test, type-check, lint or build runs yet.')
    expect(await term.find({ key: 'verdict-clear' })).toBeUndefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...PANE() })
    expect((await desk.find({ type: 'Svg' }))?.props.alt).toBe('No runs yet')
    await desk.unmount()
  })

  test('the band: a survey hides it, a short band has one row, a narrow terminal still draws', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, {})
    world(on, () => ({ isError: true as const, result: undefined, text: ' FAIL  a > b\n      Tests  1 failed (1)\n' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
    const survey = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...BAND(20, 110, true) })
    expect(await survey.find({ type: 'Client' })).toBeUndefined()
    await survey.unmount()
    const short = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...BAND(4, 0) })
    const client = await short.find({ type: 'Client' })
    expect(client?.props).toMatchObject({ width: 77, height: 1 })
    await short.unmount()
    const desk = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(4) })
    expect((await desk.find({ type: 'Svg' }))?.props.height).toBe(30)
    await desk.unmount()
  })

  test('the pane lists failures, warns on a passing run with notes, and clears', async ($, on) => {
    mock.clock(on, { now: NOW })
    const writes = storeWrites(on, keyOf('/w'))
    mock.store(on, {
      [keyOf('/w')]: [
        stored({ id: 1, runner: 'maven', kind: 'build', ok: true, failures: ['Something odd'] }),
        stored({ id: 2, runner: 'eslint', kind: 'lint', ok: false, errors: 1, failures: ['a.ts:1 bad'] }),
        stored({ id: 3, runner: 'vitest', ok: false, pass: 1, fail: 1, failures: ['a > b'] }),
      ],
    })
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const term = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...PANE() })
    const all = await texts(term)
    expect(all).toContain('  ! Something odd')
    expect(all).toContain('  ! a.ts:1 bad')
    expect(all).toContain('  ✗ a > b')
    const warned = (await term.findAll({ type: 'Text', text: /Something odd/ }))[0]
    expect(warned?.props.color).not.toBe((await term.findAll({ type: 'Text', text: /a\.ts:1 bad/ }))[0]?.props.color)
    await term.press({ key: 'verdict-clear' })
    expect(await texts(term)).toContain('⚖ Verdict · 0 runs')
    await term.unmount()
    expect(writes.at(-1)).toEqual([])
  })
})
