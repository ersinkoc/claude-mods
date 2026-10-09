import { describe, expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { buildSegments, parseSegments } from '../hooks/ticker.ts'

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const NOW = Date.UTC(2030, 0, 1, 12, 0, 0)
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }

type World = {
  /** The session's folder; '' for none, null when it cannot be read. */
  cwd?: string | null
  model?: string
  /** What git answers, by its verb. */
  git?: (verb: string | undefined) => ReturnType<typeof ok> | typeof fail
  /** Git cannot be started at all. */
  noShell?: boolean
  /** How long each git call takes on the mocked clock. */
  gitMs?: number
  clock?: MockClock
}

/** The session beneath marquee: the status line recorded, git and the store answered. */
function world(on: On, w: World = {}) {
  const lines: (string | undefined)[] = []
  const runs: { argv: readonly string[]; cwd?: string }[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('session.model', () => ({ value: w.model ?? 'claude-opus-5-5' }))
  on('session.cwd', () => (w.cwd === null ? { deny: 'no folder' } : { value: w.cwd ?? '/work' }))
  on('process.run', async ($, e) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd })
    if (w.noShell) return { deny: 'spawn ENOENT' }
    if (w.gitMs) await w.clock?.sleep(w.gitMs)
    return (w.git ?? (() => fail))(e.argv[1])
  })
  return { lines, runs, last: () => lines[lines.length - 1] }
}

describe('ticker edges', () => {
  test('a limit with no reset time, a clean branch in sync, a tool with no detail', async () => {
    const segs = buildSegments({
      limits: [{ kind: 'five_hour', percentUsed: 10 }],
      git: { branch: 'main', ahead: 0, behind: 1, dirty: 0 },
      tool: { name: 'ExitPlanMode', detail: '', startedAt: 0 },
      now: 5000,
    }, parseSegments(undefined))
    expect(segs).toEqual(['5h 10%', '⎇ main ↓1', '▶ ExitPlanMode 0:05'])
    expect(buildSegments({ limits: [], git: { branch: 'dev', ahead: 0, behind: 0, dirty: 0 }, now: 0 }, ['git'])).toEqual(['⎇ dev'])
    // A detached or unborn branch with no name shows nothing.
    expect(buildSegments({ limits: [], git: { branch: '', ahead: 1, behind: 0, dirty: 0 }, now: 0 }, ['git'])).toEqual([])
    expect(buildSegments({ limits: [], ctxPercent: Number.NaN, now: 0 }, ['ctx'])).toEqual([])
  })
})

describe('the status line', () => {
  test('the main loop names the model and effort; an agent does not', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    // The session reports no model: the step's stays.
    const { last } = world(on, { model: '' })
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for await (const c of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5', effort: 'high', messageCount: 1 })) void c
    for await (const c of $.turn.step({ turnId: 't', index: 1, model: 'claude-sonnet-5', messageCount: 1 })) void c
    for await (const c of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5', effort: 'low', messageCount: 1, agentId: 'ag' })) void c
    await clock.advance(1000)
    expect(last()).toBe('◆ Sonnet 5·high')
  })

  test('git: no folder runs it where the session is; a failed HEAD still gives the branch', { options: { segments: 'git' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { runs, last } = world(on, { cwd: '', git: verb => (verb === 'status' ? ok('# branch.head topic\n? new.txt\n') : fail) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(1000)
    expect(last()).toBe('⎇ topic ●1')
    expect(runs.map(r => [r.argv[1], r.cwd])).toEqual([['status', undefined], ['log', undefined]])
  })

  test('outside a repo and with nothing else chosen, the line stays empty', { options: { segments: 'git, nonsense' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { lines } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(3000)
    expect(lines).toEqual([])
  })

  test('a slow git is not asked twice at once', { options: { segments: 'git' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const w: World = { gitMs: 4000, git: verb => (verb === 'status' ? ok('# branch.head main\n') : ok('')) }
    const { runs, last } = world(on, w)
    w.clock = clock
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    // A Bash asks for git again at the next beat, while the first look still runs.
    await $.tool.call({ tool: 'Bash', command: 'git commit' })
    await clock.advance(1000)
    expect(runs).toHaveLength(1)
    await clock.advance(8000)
    expect(last()).toBe('⎇ main')
    expect(runs.length).toBeGreaterThan(1)
  })

  test('a folder that cannot be read leaves git out', { options: { segments: 'git,model' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { runs, last } = world(on, { cwd: null })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(1000)
    expect(last()).toBe('◆ Opus 5.5')
    expect(runs).toEqual([])
  })

  test('a machine without git leaves git out', { options: { segments: 'git,model' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { runs, last } = world(on, { noShell: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(1000)
    expect(last()).toBe('◆ Opus 5.5')
    expect(runs.map(r => r.argv[1])).toEqual(['status'])
  })

  test('the tool running now: overlapping calls, agents left out, git looked at again after edits', { options: { segments: 'tool' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { lines, last } = world(on)
    on('tool.call', async ($, e) => {
      await clock.sleep(e.tool === 'PowerShell' ? 3000 : 1000)
      return { result: 'ok' }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ps = $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem', description: 'List' })
    await clock.settle()
    expect(last()).toBe('▶ PowerShell List 0:00')
    // An Edit starts while PowerShell runs: the line follows the newest call, and clears when it ends.
    const edit = $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
    await clock.settle()
    expect(last()).toBe('▶ Edit a.ts 0:00')
    await clock.advance(1000)
    await edit
    // A subagent's call does not show.
    const sub = $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag' } as never)
    await clock.advance(2000)
    await Promise.all([ps, sub])
    expect(lines).toContain('▶ Edit a.ts 0:01')
    expect(lines.some(l => l?.startsWith('▶ Grep'))).toBe(false)
    expect(last()).toBeUndefined()
    for (const tool of ['Write', 'Read'] as const) {
      const call = $.tool.call({ tool, file_path: '/work/b.ts', content: '' } as never)
      await clock.advance(1000)
      await call
    }
    expect(lines).toContain('▶ Write b.ts 0:00')
    expect(lines).toContain('▶ Read b.ts 0:00')
  })

  test('turned off mid-call, the line stays clear; tools pass through while off', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { lines, last } = world(on)
    on('tool.call', async () => {
      await clock.sleep(1000)
      return { result: 'ok' }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const call = $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.settle()
    expect(last()).toContain('▶ Read a.ts')
    expect((await $.command.run({ command: 'marquee', ...RUN })).text).toBe('Marquee off.')
    await clock.advance(1000)
    expect(await call).toEqual({ result: 'ok' })
    const n = lines.length
    const off = $.tool.call({ tool: 'Read', file_path: '/work/b.ts' })
    await clock.advance(1000)
    expect(await off).toEqual({ result: 'ok' })
    expect(lines.length).toBe(n)
    expect(last()).toBeUndefined()
  })

  test('marquee off last session stays off until /marquee', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, { enabled: false })
    const { lines, last } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(2000)
    expect(lines).toEqual([])
    expect((await $.command.run({ command: 'marquee', ...RUN })).text).toBe('Marquee on.')
    expect(last()).toBe('◆ Opus 5.5')
  })

  test('a store that cannot be read leaves marquee on', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('store.get', () => ({ deny: 'no store' }))
    on('store.set', () => ({ value: undefined }))
    const { last } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(1000)
    expect(last()).toBe('◆ Opus 5.5')
  })

  test('a tool that fails below fails as it would without marquee', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    world(on)
    on('tool.call', () => {
      throw new Error('no tools')
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await expect($.tool.call({ tool: 'Read', file_path: '/work/a.ts' })).rejects.toThrow()
  })

  test('a clock that stops answering stops the beat, not the session', {
    plugins: [{
      name: 'stopped-clock',
      tier: 'prepend',
      register(on) {
        // The first reading (marquee's session start) passes; every later one is refused.
        let reads = 0
        on('clock.now', ($, e, next) => (++reads > 1 ? { deny: 'clock stopped' } : next(e)))
      },
    }],
  }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const { lines } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(2000)
    expect(lines).toEqual([])
  })
})
