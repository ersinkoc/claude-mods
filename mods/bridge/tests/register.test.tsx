import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-bridge',
  props: { title: 'KOZMOS · Bridge', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

const GIT_DIRTY = [
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 a a src/a.ts',
  '1 .M N... 100644 100644 100644 b b src/b.ts',
  'u UU N... 1 2 3 4 a b c src/c.ts',
  '? new.txt',
].join('\n')

/** Passes when a Text shows the text; fails listing what the drawing shows. */
async function shows(ui: Pick<Mounted, 'findAll'>, text: string | RegExp): Promise<void> {
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(all.some(t => (typeof text === 'string' ? t.includes(text) : text.test(t))), `${String(text)} in ${JSON.stringify(all)}`).toBe(true)
}

type World = {
  /** What each argv answers, by its first word (and the git verb). */
  sh?: (argv: readonly string[]) => ReturnType<typeof ok> | typeof fail
  usage?: boolean
  /** False: asking for the folder fails. */
  cwd?: boolean
  agents?: AgentStatus[]
  model?: string
  read?: (path: string) => string | undefined
}

/** The session beneath bridge: usage, model, agents, a shell and a disk. */
function world(on: On, w: World = {}) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (w.usage !== false) {
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 420_000, window: 1_000_000, percent: 42 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23.5, resetsAt: '1970-01-01T04:00:00Z' },
          { kind: 'seven_day', percentUsed: 61 },
        ],
        cost: { usd: 3.21 },
      },
    }))
  }
  on('session.model', () => ({ value: w.model ?? 'claude-opus-5-5' }))
  on('session.cwd', () => (w.cwd === false ? { deny: 'no folder' } : { value: '/work' }))
  on('agent.list', () => ({
    value: (w.agents ?? []).map((status, i) => ({ id: `a${i}`, description: `task ${i}`, type: 'Explore', status })),
  }))
  on('process.run', ($, e) => (w.sh ? w.sh(e.argv) : fail))
  on('fs.read', ($, e) => {
    const text = w.read?.(e.path.replace(/\\/g, '/').replace(/^[A-Z]:/, ''))
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
}

const WIN_JSON = JSON.stringify({ cpu: 37, free: 4 * 1024 * 1024, total: 16 * 1024 * 1024, dfree: 1, dsize: 2, procs: 300 })

describe('bridge on Windows with a dirty repo and a GPU', () => {
  test('the terminal pane shows every row', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: 7_200_000 })
    mock.env(on, { OS: 'Windows_NT' })
    world(on, {
      agents: ['running', 'pending', 'waiting', 'completed', 'idle', 'failed', 'killed'],
      sh: argv => {
        if (argv[0] === 'git') return argv[1] === 'status' ? ok(GIT_DIRTY) : ok('abc123\tFix it\t2 hours ago')
        if (argv[0] === 'powershell') return ok(WIN_JSON)
        if (argv[0] === 'nvidia-smi') return ok('55, 1000, 8000, 60, RTX 9090')
        return fail
      },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    // Four more seconds: the machine is sampled again, so the CPU line has two points.
    await clock.advance(4000)

    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /Opus 5\.5/)
    await shows(term, /○ idle/)
    await shows(term, /42%/)
    await shows(term, /420k\/1\.0M/)
    // The 5h window resets 4h after the epoch, 2h less 4s after now; the 7d one has no reset.
    await shows(term, /24% ↻1h59m/)
    await shows(term, /^ 61%$/)
    await shows(term, '$3.21')
    await shows(term, /\$1\.60\/h/)
    await shows(term, ' main')
    await shows(term, '↑2 ↓1 ●1 ✚1 ?1 ✖1')
    await shows(term, /^ 37%$/)
    await shows(term, / 12\.0G\/16\.0G/)
    await shows(term, /^ 55%$/)
    await shows(term, '◈ 3 running')
    await shows(term, ' · 2 done · 2 failed')
    await shows(term, '—')
    await term.unmount()
  })

  test('the desktop card draws the git chips, the CPU graph, RAM and GPU', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: 7_200_000 })
    mock.env(on, { OS: 'Windows_NT' })
    world(on, {
      sh: argv => {
        if (argv[0] === 'git') return argv[1] === 'status' ? ok(GIT_DIRTY) : ok('')
        if (argv[0] === 'powershell') return ok(WIN_JSON)
        if (argv[0] === 'nvidia-smi') return ok('55, 1000, 8000, 60, RTX 9090')
        return fail
      },
    })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
    await clock.advance(4000)
    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    const pic = await desk.find({ type: 'Svg' })
    const src = String(pic?.props.source)
    expect(src).toContain('1 staged')
    expect(src).toContain('1 changed')
    expect(src).toContain('1 new')
    expect(src).toContain('1 conflict')
    expect(src).toContain('↑2 ↓1')
    expect(src).toContain('url(#cpuG)')
    expect(src).toContain('12.0G / 16.0G')
    expect(src).toContain('>GPU<')
    expect(src).toContain('resets in 1h59m')
    expect(src).toContain('$1.60/h')
    expect(src).toContain('0 tool calls')
    expect(String(pic?.props.alt)).toBe('Opus 5.5; context 42%; 5h 24%, 7d 61%; cost $3.21; branch main; 0 agents running')
    await desk.unmount()
  })
})

describe('bridge on a clean repo, the mac and linux probes', () => {
  test('a clean repo in sync reads "✓ clean" and "in sync"', { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on)
    mock.env(on, { OS: 'Windows_NT' })
    world(on, {
      usage: false,
      sh: argv => (argv[0] === 'git' && argv[1] === 'status' ? ok('# branch.head dev\n# branch.ab +0 -0') : fail),
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 0 } })
    await shows(term, ' ✓ clean')
    // No usage: the context and the cost fall back to dashes.
    await shows(term, /^ — 0\/1\.0M$/)
    await shows(term, '—')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    const pic = await desk.find({ type: 'Svg' })
    const src = String(pic?.props.source)
    expect(src).toContain('in sync')
    expect(src).toContain('✓ clean')
    expect(src).not.toContain('url(#cpuG)')
    expect(String(pic?.props.alt)).toContain('cost unknown; branch dev')
    await desk.unmount()
  })

  test('macOS: uname, top and sysctl; no GPU is asked for twice', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, {})
    const asked: string[] = []
    world(on, {
      sh: argv => {
        asked.push(argv[0]!)
        if (argv[0] === 'uname') return ok('Darwin\n')
        if (argv[0] === 'top') return ok('CPU usage: 10.5% user, 4.5% sys, 85% idle\nPhysMem: 12G used (2G wired), 4G unused.')
        if (argv[0] === 'sysctl') return ok(String(16 * 1024 ** 3))
        return fail
      },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(4000)
    expect(asked.filter(a => a === 'nvidia-smi')).toHaveLength(1)
    expect(asked.filter(a => a === 'top')).toHaveLength(2)
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /^ 15%$/)
    await shows(term, / 12\.0G\/16\.0G/)
    expect(await term.find({ type: 'Text', text: /GPU/ })).toBeUndefined()
    await term.unmount()
  })

  test('macOS whose top says nothing: RAM total only, and a dirty tree with no conflict', { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on)
    mock.env(on, {})
    world(on, {
      sh: argv => {
        if (argv[0] === 'uname') return ok('Darwin\n')
        if (argv[0] === 'git' && argv[1] === 'status') return ok('# branch.head wip\n? scratch.txt')
        if (argv[0] === 'sysctl') return ok('1048576')
        return fail
      },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, / —\/1M/)
    const tree = await term.find({ type: 'Text', text: /^ \?1$/ })
    expect(tree?.props.color).toBe('#fb923c')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('— / 1M')
    await desk.unmount()
  })

  test('macOS whose sysctl fails: the CPU without a RAM row', { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on)
    mock.env(on, {})
    world(on, { sh: argv => (argv[0] === 'uname' ? ok('Darwin') : argv[0] === 'top' ? ok('CPU usage: 1.0% user, 2.0% sys') : fail) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /^ 3%$/)
    expect(await term.find({ type: 'Text', text: 'RAM' })).toBeUndefined()
    await term.unmount()
  })

  test('Linux: /proc/stat twice gives a CPU figure, /proc/meminfo the RAM', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, {})
    let stats = 0
    const read = (path: string) =>
      path === '/proc/meminfo'
        ? 'MemTotal: 1000 kB\nMemAvailable: 250 kB\n'
        : ++stats === 1 ? 'cpu 10 0 10 80 0 0 0 0' : 'cpu 30 0 30 140 0 0 0 0'
    world(on, { sh: argv => (argv[0] === 'uname' ? ok('Linux\n') : fail), read })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(4000)
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /^ 40%$/)
    await shows(term, / 750K\/1000K/)
    await term.unmount()
  })

  test('Linux without /proc, and a shell that throws, leave the machine blank', { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on)
    mock.env(on, {})
    world(on, {
      sh: argv => {
        if (argv[0] === 'uname') return ok('Linux\n')
        throw new Error('spawn failed')
      },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /RAM/ })).toBeUndefined()
    expect(await term.find({ type: 'Text', text: /GIT/ })).toBeUndefined()
    await shows(term, /^ —$/)
    await term.unmount()
  })
})

describe('bridge follows the turn and its tools', () => {
  test('working, effort, the running tool, then the last one', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    mock.env(on, { OS: 'Windows_NT' })
    world(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
    })
    on('tool.call', async ($, e) => {
      if (e.tool === 'Bash') {
        await clock.sleep(2000)
        return { isError: true as const, result: undefined, text: 'exit 1' }
      }
      if (e.tool === 'Write') return { deny: 'not here' }
      await clock.sleep(e.tool === 'Read' ? 1500 : 500)
      return { result: { ok: true } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5', effort: 'xhigh', messageCount: 1 })) void c
    // A step with no effort keeps the last one; an agent's step is not the main loop's.
    for await (const c of $.turn.step({ turnId: 't1', index: 1, model: 'claude-sonnet-5', messageCount: 2 })) void c
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5', effort: 'low', messageCount: 1, agentId: 'ag' })) void c

    // The tool's start publishes what the steps said; the next sample reads the model from the session again.
    const bash = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    await clock.settle()
    const model = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(model, '◆ Sonnet 5 · xhigh')
    await shows(model, ' Run the tests · 0:00')
    await model.unmount()
    await clock.advance(1000)
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, '◆ Opus 5.5 · xhigh')
    await shows(term, '● working')
    await shows(term, /Bash/)
    await shows(term, ' Run the tests · 0:01')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    const running = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(running).toContain('RUNNING · Bash')
    expect(running).toContain('effort · xhigh')
    expect(running).toContain('WORKING')
    expect(running).toContain('Bash · 0:01')
    await desk.unmount()

    // A Read starts while Bash still runs; Bash ends first and leaves the Read showing.
    const read = $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.advance(1000)
    await bash
    let t2 = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(t2, /Read/)
    await t2.unmount()
    await clock.advance(500)
    await read
    // An agent's call counts but does not show as the running tool.
    const sub = $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag' } as never)
    await clock.advance(500)
    await sub
    await $.tool.call({ tool: 'Write', file_path: '/work/b.ts', content: '' })
    await clock.settle()

    t2 = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(t2, /✖ Write/)
    await shows(t2, ' b.ts · 0ms · #4')
    await t2.unmount()

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'ag', reason: 'answer' })
    const stillWorking = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(stillWorking, '● working')
    await stillWorking.unmount()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    const idle = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    const last = String((await idle.find({ type: 'Svg' }))?.props.source)
    expect(last).toContain('LAST · Write')
    expect(last).toContain('0ms')
    expect(last).toContain('IDLE')
    await idle.unmount()
  })

  test('a successful last tool reads ✓; one with no detail reads —', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { OS: 'Windows_NT' })
    world(on)
    on('tool.call', () => ({ result: { ok: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Glob', pattern: '**/*.ts' })
    await $.tool.call({ tool: 'ExitPlanMode' } as never)
    await clock.settle()
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /✓ ExitPlanMode/)
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'bridge', surface: 'desktop', ...PANE })
    const src = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(src).toContain('LAST · ExitPlanMode')
    expect(src).toContain('>—<')
    await desk.unmount()
  })
})

describe('bridge pane and command', () => {
  test('/bridge opens the pane when it is shut and closes it when open', { options: { autoOpen: false } }, async ($, on) => {
    mock.clock(on)
    world(on)
    mock.env(on, { OS: 'Windows_NT' })
    let open = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-bridge', title: 'KOZMOS · Bridge', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id}`)
      open = true
      return { value: { isPlaced: true } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      open = false
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(calls).toEqual([])
    expect((await $.command.run({ command: 'bridge', args: '', ...RUN })).text).toBe('Bridge open.')
    expect((await $.command.run({ command: 'bridge', args: '', ...RUN })).text).toBe('Bridge closed.')
    expect(calls).toEqual(['open kz-bridge', 'close kz-bridge'])
  })

  test('the pane opens itself on start by default', async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { OS: 'Windows_NT' })
    world(on)
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.settle()
    expect(opened).toEqual(['kz-bridge'])
  })

  test('a sample that fails publishes nothing; the samples between go on', { options: { autoOpen: false } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { OS: 'Windows_NT' })
    world(on, { cwd: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    let term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, '◆ —')
    await term.unmount()
    // Git is asked every fifth second; the seconds between publish.
    await clock.advance(6000)
    term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, '◆ Opus 5.5')
    expect(await term.find({ type: 'Text', text: 'GIT' })).toBeUndefined()
    await term.unmount()
  })

  test('a tool call goes through even when bridge cannot read the clock', async ($, on) => {
    on('tool.call', () => ({ result: { ok: true } }))
    expect(await $.tool.call({ tool: 'Glob', pattern: '*' })).toEqual({ result: { ok: true } })
  })

  test('a pane drawn before any sample shows a blank snapshot', async ($, on) => {
    mock.clock(on)
    const term = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', ...PANE })
    await shows(term, /◆ —/)
    await shows(term, '◈ 0 running')
    await term.unmount()
  })
})
