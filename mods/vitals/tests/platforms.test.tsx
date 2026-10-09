import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { avg, brailleCanvas, chartPoints, countLines, parseDf, pushHist, ratioOf, smoothPaths, tempRatio } from '../hooks/meter.ts'

const PANE_ID = 'kz-vitals'
const PROPS = { title: 'KOZMOS · Vitals', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }

type Status = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** The machine beneath the plugin: what each command prints (undefined exits 1, an Error throws). */
type World = {
  sh: (argv: readonly string[]) => string | undefined | Error
  files?: Record<string, string>
  agents?: Status[] | Error
  usage?: number | Error
  /** Runs before each command answers: how a slow machine is made. */
  before?: (argv: readonly string[]) => Promise<void>
}

const out = (stdout: string | undefined) => ({ value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

/** Answers the pane list, the machine and the Claude side; returns every argv run. */
function world(on: On, w: World): string[][] {
  const runs: string[][] = []
  const open = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.usage', () => {
    if (w.usage instanceof Error) throw w.usage
    return { value: { startedAt: w.usage ?? 0, context: { tokens: 1, window: 100, percent: 1 }, rateLimits: [] } }
  })
  on('agent.list', () => {
    if (w.agents instanceof Error) throw w.agents
    return { value: (w.agents ?? []).map((status, i) => ({ id: `a${i}`, description: `task ${i}`, type: 'Explore', status })) }
  })
  on('process.run', async ($, e) => {
    runs.push([...e.argv])
    await w.before?.(e.argv)
    const r = w.sh(e.argv)
    if (r instanceof Error) throw r
    return out(r)
  })
  on('fs.read', ($, e) => {
    const text = w.files?.[e.path.replace(/\\/g, '/').replace(/^[A-Z]:/, '')]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  return runs
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const alts = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
const sources = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('\n')

const STAT = (busy: number, idle: number) => `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 2 3 4\n`
const MEMINFO = 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    4000000 kB\n'
const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000000 250000 750000 25% /\n'

describe('linux', () => {
  test('/proc, df and ps; no nvidia-smi is asked again once it failed', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.env(on, {})
    let busy = 100
    const files: Record<string, string> = { '/proc/meminfo': MEMINFO, '/proc/stat': STAT(busy, 900) }
    const runs = world(on, {
      sh: argv => (argv[0] === 'uname' ? 'Linux\n' : argv[0] === 'df' ? DF : argv[0] === 'ps' ? '1\n2\n3\n' : undefined),
      files,
      agents: ['running', 'pending', 'waiting', 'completed', 'idle', 'failed'],
      usage: 40_000,
    })
    await $.session.start(START)
    expect((await $.command.run({ command: 'vitals', ...RUN })).text).toBe('Vitals open.')
    busy = 400
    files['/proc/stat'] = STAT(busy, 1000)
    await clock.advance(2000)
    // The second reading is 300 busy ticks in 400: 75 %.
    const term = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    const all = await texts(term)
    expect(all).toContain('linux · 2s · 1 pts')
    expect(all).toContain('CPU 75%')
    expect(all).toContain('RAM 75%')
    expect(all).toContain('11.4G / 15.3G')
    expect(all).toContain('DISK / 25%')
    expect(all).toContain('PROC 3')
    expect(all).toContain('◈ 3 agents')
    expect(all).toContain('⏱ 1:02')
    expect(all).not.toContain('GPU')
    await term.unmount()
    expect(runs.filter(a => a[0] === 'nvidia-smi')).toHaveLength(1)
    expect(runs.filter(a => a[0] === 'uname')).toHaveLength(1)
    const desk = await $.ui.mount({ plugin: 'vitals', surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect(await alts(desk)).toEqual(['CPU 75%, 3 processes', 'Memory 11.4G of 15.3G', 'Disk / 25%', 'Session 1:02, 0 tool calls, 3 agents running'])
    const svg = await sources(desk)
    expect(svg).toContain('732M free')
    expect(svg).toContain('class="pulse"')
    await desk.unmount()
  })

  test('nothing readable: every figure shows a dash', async ($, on) => {
    mock.clock(on, { now: 100_000 })
    mock.env(on, {})
    world(on, { sh: argv => (argv[0] === 'uname' ? new Error('no uname') : undefined), usage: new Error('no usage'), agents: new Error('no agents') })
    await $.session.start(START)
    await $.command.run({ command: 'vitals', ...RUN })
    const term = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: { ...PROPS, bodyColumns: 0 } })
    const all = await texts(term)
    expect(all).toContain('CPU —')
    expect(all).toContain('RAM 0%')
    expect(all).toContain('— / —')
    expect(all).toContain('DISK / —')
    expect(all).toContain('PROC —')
    expect(all).toContain('◈ 0 agents')
    // No measured width: 40 columns of rule.
    expect(all).toContain('─'.repeat(40))
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'vitals', surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect(await alts(desk)).toEqual(['CPU —, unknown processes', 'Memory — of —', 'Disk / unknown', 'Session 0:00, 0 tool calls, 0 agents running'])
    const svg = await sources(desk)
    expect(svg).toContain('sampling…')
    expect(svg).toContain('not measured')
    expect(svg).toContain('— processes')
    await desk.unmount()
  })
})

describe('macOS and Windows', () => {
  test('macOS reads top and sysctl; a GPU without memory figures', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.env(on, {})
    let top = 'CPU usage: 10.5% user, 4.5% sys, 85.0% idle\nPhysMem: 12G used (2G wired), 4G unused.\n'
    world(on, {
      sh: argv => {
        if (argv[0] === 'uname') return 'Darwin\n'
        if (argv[0] === 'top') return top
        if (argv[0] === 'sysctl') return '17179869184\n'
        if (argv[0] === 'nvidia-smi') return '10, 0, 0, 30, Tiny GPU\n'
        return undefined
      },
    })
    await $.session.start(START)
    await $.command.run({ command: 'vitals', ...RUN })
    const term = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    let all = await texts(term)
    expect(all).toContain('mac · 2s · 1 pts')
    expect(all).toContain('CPU 15%')
    expect(all).toContain('12.0G / 16.0G')
    expect(all).toContain('GPU 10%')
    expect(all).toContain(' 30°C')
    // top without a memory line: used memory unknown, counted as none.
    top = 'CPU usage: 1.0% user, 1.0% sys, 98.0% idle\n'
    await clock.advance(2000)
    all = await texts(term)
    expect(all).toContain('RAM 0%')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'vitals', surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect((await alts(desk))[3]).toBe('GPU Tiny GPU 10%, 30 degrees')
    await desk.unmount()
  })

  test('macOS with top and sysctl failing shows dashes', async ($, on) => {
    mock.clock(on, { now: 100_000 })
    mock.env(on, {})
    world(on, { sh: argv => (argv[0] === 'uname' ? 'Darwin' : undefined) })
    await $.session.start(START)
    await $.command.run({ command: 'vitals', ...RUN })
    const term = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    const all = await texts(term)
    expect(all).toContain('mac · 2s · 0 pts')
    expect(all).toContain('CPU —')
    expect(all).toContain('— / —')
    await term.unmount()
  })

  test('Windows: one PowerShell call and nvidia-smi; a draw before the session has nothing', async ($, on) => {
    mock.clock(on, { now: 100_000 })
    mock.env(on, { OS: 'Windows_NT' })
    world(on, {
      sh: argv =>
        argv[0] === 'powershell'
          ? JSON.stringify({ cpu: 50, free: 8_000_000, total: 16_000_000, dfree: 600e9, dsize: 1000e9, procs: 200 })
          : argv[0] === 'nvidia-smi'
            ? '90, 20000, 24000, 88, Big GPU\n'
            : undefined,
    })
    const early = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect(await texts(early)).toContain('○ linux · 2s · 0 pts')
    await early.unmount()
    await $.session.start(START)
    await $.command.run({ command: 'vitals', ...RUN })
    const term = await $.ui.mount({ plugin: 'vitals', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    const all = await texts(term)
    expect(all).toContain('● win · 2s · 1 pts')
    expect(all).toContain('DISK C: 40%')
    expect(all).toContain('GPU 90%')
    expect(all).toContain(' 88°C')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'vitals', surface: 'desktop', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect(await alts(desk)).toContain('GPU Big GPU 90%, 88 degrees')
    await desk.unmount()
  })
})

describe('the sampler', () => {
  test('a tick while a sample runs is skipped', async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    mock.env(on, { OS: 'Windows_NT' })
    let calls = 0
    world(on, {
      sh: () => undefined,
      before: async argv => {
        if (argv[0] !== 'powershell') return
        calls++
        await clock.sleep(3000)
      },
    })
    await $.session.start(START)
    const opening = $.command.run({ command: 'vitals', ...RUN })
    await clock.advance(2000)
    expect(calls).toBe(1)
    await clock.advance(1000)
    expect((await opening).text).toBe('Vitals open.')
    // Ticks at 104 s (a second sample, until 107 s) and 106 s (skipped).
    await clock.advance(2000)
    await clock.advance(2500)
    expect(calls).toBe(2)
  })

  test('a failing sample, pane list or tool beneath never stops the pane', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 100_000 })
    const open = new Set<string>()
    let isListBroken = true
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      open.add(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', () => ({ value: undefined }))
    on('ui.panes', () => {
      if (isListBroken) throw new Error('no panes')
      return { value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }
    })
    on('tool.call', () => {
      throw new Error('tool broke')
    })
    // autoOpen opened the pane; the pane list fails: the tick is dropped.
    await $.session.start(START)
    expect([...open]).toEqual(['kz-vitals'])
    await clock.advance(2000)
    // No env beneath: the sample the command starts fails, the command still answers.
    isListBroken = false
    expect((await $.command.run({ command: 'vitals', ...RUN })).text).toBe('Vitals closed.')
    open.clear()
    expect((await $.command.run({ command: 'vitals', ...RUN })).text).toBe('Vitals open.')
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a' })).rejects.toThrow(/tool broke|tool\.call/)
  })
})

describe('meter helpers', () => {
  test('histories skip missing values', async () => {
    expect(pushHist([1], undefined)).toEqual([1])
    expect(pushHist([1], Number.NaN)).toEqual([1])
    expect(avg([])).toBe(0)
    expect(avg([2, 4])).toBe(3)
  })

  test('ratios with unknown parts', async () => {
    expect(ratioOf(5, 20)).toBe(0.25)
    expect(ratioOf(undefined, 20)).toBe(0)
    expect(ratioOf(5, undefined)).toBe(0)
    expect(ratioOf(5, 0)).toBe(0)
  })

  test('df and ps output that says nothing', async () => {
    expect(parseDf('')).toEqual({})
    expect(parseDf('Filesystem\n/dev/x - - - - /\n')).toEqual({})
    expect(countLines('\n  \n')).toBeUndefined()
    expect(tempRatio(100)).toBe(1)
  })

  test('a braille canvas defaults to a 0..100 scale and the heat tint', async () => {
    const c = brailleCanvas([0, 50, 100], 4, 2)
    expect(c.cols).toBe(4)
    expect(c.rows).toBe(2)
    expect(smoothPaths([], 10)).toEqual({ line: '', area: '' })
    expect(chartPoints([50], 0, 0, 10, 10, 0)[0]).toEqual([10, 0])
  })
})
