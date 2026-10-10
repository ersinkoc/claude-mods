import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const PANE = (bodyColumns = 50) => ({
  component: 'Pane' as const,
  requestId: 'kz-chronicle',
  props: { title: 'KOZMOS · Chronicle', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = {
  tool_use_id: 'tu1', prompt: 'look', description: 'Find it', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}
const MSG = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
const done = (reason: 'answer' | 'aborted' | 'error' | 'refusal', durationMs = 1000, agentId?: string) =>
  ({ answer: '', durationMs, isAborted: reason === 'aborted', turnId: 't1', reason, ...(agentId ? { agentId } : {}) }) as TurnCompleteInput

type Opts = { usd?: () => number | undefined; spawn?: (e: { description: string }) => Record<string, unknown> }
function base(on: On, opts: Opts = {}): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (opts.usd) {
    const usd = opts.usd
    on('session.usage', () => {
      const v = usd()
      return { value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [], ...(v === undefined ? {} : { cost: { usd: v } }) } }
    })
  }
  on('prompt.submit', ($, e) => {
    if (e.text === 'blocked') return { drop: 'no' }
    if (e.text.startsWith('rewrite')) return { text: 'rewritten prompt' }
    if (e.text === 'blank') return { text: '' }
    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('agent.spawn', ($, e) => (opts.spawn ? opts.spawn(e) : { model: 'claude-haiku-5', agentId: 'a1' }) as never)
  on('session.compact', ($, e) => {
    if (e.instructions === 'skip') return { skip: 'nothing to do' }
    if (e.instructions === 'bare') return { messages: MSG }
    return { messages: MSG, tokensBefore: 640_000, tokensAfter: 90_000 }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Write') return { deny: 'not here' }
    if (e.tool === 'Bash') {
      if (e.command.startsWith('fail')) return { isError: true as const, result: 'exit 1' }
      if (e.command.includes('#amend')) return { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { kind: 'amended' as const } } } }
      if (e.command.includes('#pushop')) return { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { push: { branch: 'feature' } } } }
      if (e.command.includes('#barepush')) return { result: { stdout: '', stderr: '', interrupted: false, gitOperation: { push: {} } } }
      return { result: { stdout: '', stderr: '', interrupted: e.command.includes('#int') } }
    }
    if (String(e.tool) === 'Frob') return { isError: true as const, result: 'boom' }
    return { result: 'ok' }
  })
}

/** Every line of the terminal pane, as text. */
async function lines($: Engine, filter?: string, bodyColumns = 50): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'chronicle', surface: 'terminal', ...PANE(bodyColumns) })
  if (filter) await ui.press({ key: `f-${filter}` })
  const all = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate-end').map(t => t.text)
  await ui.unmount()
  return all
}
/** The lines under the tally, without their times. */
const titles = async ($: Engine, filter?: string) => (await lines($, filter)).slice(1).map(l => l.replace(/^\d\d:\d\d:\d\d /, ''))

describe('what is recorded', () => {
  test('only the person’s own prompts, as they entered; dropped and empty ones are not', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '' })
    for (const [text, kind] of [['from composer', 'composer'], ['from bridge', 'bridge'], ['from sdk', 'sdk'], ['from a task', 'task-notification'],
      ['blocked', 'composer'], ['   ', 'composer'], ['blank', 'composer'], ['rewrite me', 'composer']] as const) {
      await $.prompt.submit({ text, wait: false, origin: { kind } as never })
    }
    const t = await titles($, 'prompts')
    // A prompt rewritten to nothing is recorded as typed; a blank one is not.
    expect(t.filter(l => l.startsWith('❯'))).toEqual(['❯ rewritten prompt', '❯ blank', '❯ from sdk', '❯ from bridge', '❯ from composer'])
    // The session line has no detail when there is no cwd.
    const all = await lines($, 'all')
    expect(all[all.length - 1]).toMatch(/★ session started$/)
  })

  test('turns: every reason, one tool or many, spend only when it grew', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    let usd: number | undefined = 1
    base(on, { usd: () => usd })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    usd = 1.25
    await $.turn.complete(done('answer', 5000))
    // The next turn starts from the cost the last one ended at.
    await $.turn.start({ text: 'b', turnId: 't1' })
    await $.turn.complete(done('aborted', 2000))
    await $.turn.start({ text: 'c', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/a' })
    await $.tool.call({ tool: 'Read', file_path: '/b' })
    await $.turn.complete(done('refusal', 3000))
    usd = undefined
    await $.turn.complete(done('error', 4000))
    const t = await lines($)
    const body = t.join('\n')
    expect(body).toContain('◆ turn · 0:05')
    expect(body).toContain('1 tool · +$0.25')
    expect(body).toContain('◆ turn interrupted · 0:02')
    expect(body).toContain('◆ turn refused · 0:03')
    expect(body).toContain('2 tools')
    expect(body).toContain('◆ turn failed · 0:04')
    const errs = await titles($, 'errors')
    expect(errs.filter(l => l.startsWith('◆'))).toEqual(['◆ turn failed · 0:04', '◆ turn refused · 0:03'])
  })

  test('with no usage at all a turn reads its tools and no spend', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'a', turnId: 't1' })
    await $.turn.complete(done('answer', 1000))
    expect((await lines($)).join('\n')).toContain('0 tools')
  })

  test('subagents: spawned (background, untyped), denied, finished, stopped, failed, and unknown ends', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    base(on, {
      spawn: e => e.description === 'deny' ? { deny: 'no' } : e.description === 'teammate' ? { model: 'm' } : { model: 'm', agentId: e.description },
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.agent.spawn({ ...SPAWN, description: 'a1' })
    await $.agent.spawn({ ...SPAWN, description: 'a2', subagentType: '', background: true })
    await $.agent.spawn({ ...SPAWN, description: 'a3', subagentType: 'Plan' })
    await $.agent.spawn({ ...SPAWN, description: 'deny' })
    await $.agent.spawn({ ...SPAWN, description: 'teammate' })
    await clock.advance(61_000)
    await $.turn.complete(done('answer', 1, 'a1'))
    await $.turn.complete(done('aborted', 1, 'a2'))
    await $.turn.complete(done('error', 1, 'a3'))
    await $.turn.complete(done('answer', 1, 'nobody'))
    const t = await titles($, 'agents')
    expect(t).toContain('◇ Plan failed · 1:01')
    expect(t).toContain('◇ agent stopped · 1:01')
    expect(t).toContain('◇ Explore finished · 1:01')
    expect(t).toContain('◈ agent spawned (background)')
    expect(t).toContain('◈ Explore spawned')
    expect(t.join('\n')).not.toContain('deny')
    expect(t.join('\n')).not.toContain('teammate')
    expect(t.filter(l => /^[◈◇]/.test(l))).toHaveLength(6)
  })

  test('failed and denied tools, in the main loop, a known subagent and an unknown one', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.agent.spawn(SPAWN)
    await $.tool.call({ tool: 'Bash', command: 'fail now', description: 'Run it' })
    await $.tool.call({ tool: 'Write', file_path: '/w/notes.md', content: '', agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Frob', agentId: 'ghost' } as never)
    const t = (await lines($, 'errors')).join('\n')
    expect(t).toContain('✖ Bash failed')
    expect(t).toContain('Run it')
    expect(t).toContain('✖ Write denied in Explore')
    expect(t).toContain('notes.md')
    expect(t).toContain('✖ Frob failed in agent')
  })

  test('commits and pushes: by the engine’s report or the command, with each message form; interrupted ones are not', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const command of [
      `git commit -m 'single quoted'`,
      'git commit -m bare',
      'git commit -m "line one\\nline two"',
      'git commit --no-edit #amend',
      'git commit -m "gone" #int',
      'ls -la',
      'git status #pushop',
      'git push origin main',
      'true #barepush',
    ]) await $.tool.call({ tool: 'Bash', command })
    const t = (await lines($, 'git')).slice(1).map(l => l.replace(/^\d\d:\d\d:\d\d /, '').trim())
    expect(t).toEqual([
      '⇡ push', '│ true #barepush',
      '⇡ push', '│ git push origin main',
      '⇡ push → feature', '│ git status #pushop',
      '◉ amend', '│',
      '◉ commit', '│ line one line two',
      '◉ commit', '│ bare',
      '◉ commit', 'single quoted',
    ])
  })

  test('a commit entry shows its message in every common form, never the shell around it', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const heredoc = (...body: string[]) => ['git commit -m "$(cat <<\'EOF\'', ...body, 'EOF', ')"'].join('\n')
    for (const command of [
      heredoc('Fix the parser', '', 'Co-Authored-By: X'),
      heredoc('', 'Blank first line'),
      heredoc('   '),
      "git commit -F - <<'EOF'\nFrom a file\n\nbody\nEOF",
      'git commit -am "All tracked"',
      'git commit -sm "Signed off"',
      'git commit --message "Long form"',
      'git commit --message="Equals form"',
      'git commit -m"Glued"',
      'git commit -m "Subject" -m "Body"',
    ]) await $.tool.call({ tool: 'Bash', command })
    const t = (await lines($, 'git')).slice(1).map(l => l.replace(/^\d\d:\d\d:\d\d /, '').trim())
    expect(t).toEqual([
      '◉ commit', '│ Subject',
      '◉ commit', '│ Glued',
      '◉ commit', '│ Equals form',
      '◉ commit', '│ Long form',
      '◉ commit', '│ Signed off',
      '◉ commit', '│ All tracked',
      '◉ commit', '│ From a file',
      '◉ commit', "│ $(cat <<'EOF' EOF )",
      '◉ commit', '│ Blank first line',
      '◉ commit', 'Fix the parser',
    ])
  })

  test('only a real commit or push leaves an entry: not a log, an echo, a dry run or commit-tree', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const command of [
      'git log --grep=commit', 'echo git push', 'grep -rn "git commit" docs', 'git commit --dry-run', 'git push --dry-run origin main',
      'git push -un origin main', 'git commit-tree abc', 'git status',
    ]) await $.tool.call({ tool: 'Bash', command })
    expect(await lines($, 'git')).toHaveLength(1)
    for (const command of ['GIT_AUTHOR_NAME=x git commit -m y', 'git -C r push origin main', 'git add . && git commit -m z', 'git push --dry-run && git push']) {
      await $.tool.call({ tool: 'Bash', command })
    }
    const t = (await lines($, 'git')).slice(1).map(l => l.replace(/^\d\d:\d\d:\d\d /, '').trim()).filter(l => l.startsWith('◉') || l.startsWith('⇡'))
    expect(t).toEqual(['⇡ push', '◉ commit', '⇡ push', '◉ commit'])
  })

  test('compactions: skipped, precomputed, without figures, and a subagent’s', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.agent.spawn(SPAWN)
    await $.session.compact({ trigger: 'manual', instructions: 'skip', messages: MSG })
    await $.session.compact({ trigger: 'precompute', messages: MSG })
    await $.session.compact({ trigger: 'manual', instructions: 'bare', messages: MSG })
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: MSG })
    await $.session.compact({ trigger: 'plugin', agentId: 'ghost', messages: MSG })
    const t = (await lines($)).join('\n')
    expect(t).toContain('⇊ compacted · plugin (agent)')
    expect(t).toContain('⇊ compacted · auto (Explore)')
    expect(t).toContain('640k → 90k')
    expect(t).toContain('⇊ compacted · manual')
    expect(t.match(/compacted/g)).toHaveLength(3)
  })

  test('milestones: seeded quietly, announced on the way up, re-armed on the way down and by a compaction', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const m = (ctx: number | undefined, limits: [string, number][], tokens = true) => $.session.measure({
      context: { ...(tokens ? { tokens: (ctx ?? 0) * 10_000 } : {}), window: 1_000_000, ...(ctx === undefined ? {} : { percent: ctx }) },
      rateLimits: limits.map(([kind, percentUsed]) => ({ kind, percentUsed })),
      changed: ['context', 'rateLimits'],
    } as never)
    await m(60, [['five_hour', 85]])
    await m(Number.NaN, [['five_hour', 85], ['seven_day', 96]])
    await m(undefined, [['five_hour', 40]])
    await m(82, [['five_hour', 55], ['weekly_opus', 81]], false)
    await $.session.compact({ trigger: 'auto', messages: MSG })
    await m(97, [['five_hour', 55]])
    const t = (await lines($)).join('\n')
    expect(t).not.toContain('context past 50%')
    expect(t).toContain('▲ 7d limit past 95%')
    expect(t).toContain('96% used')
    expect(t).toContain('▲ 5h limit past 50%')
    expect(t).toContain('▲ weekly opus limit past 80%')
    expect(t).toContain('◔ context past 80%')
    expect(t).toContain('◔ context past 95%')
    expect(t).toContain('970k of 1.0M')
    const errs = (await lines($, 'errors')).join('\n')
    expect(errs).toContain('7d limit past 95%')
    expect(errs).toContain('context past 95%')
    expect(errs).not.toContain('context past 80%')
  })
})

describe('the pane', () => {
  test('/chronicle opens and closes it; autoOpen opens it at the start', { options: { autoOpen: true } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    let open = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-chronicle', title: 'KOZMOS · Chronicle', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => { calls.push(`open ${e.id}`); open = true; return { value: { isPlaced: true as const } } })
    on('ui.close', ($, e) => { calls.push(`close ${e.id}`); open = false; return { value: undefined } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(calls).toEqual(['open kz-chronicle'])
    expect((await $.command.run({ command: 'chronicle', args: '', ...RUN })).text).toBe('Chronicle closed.')
    expect((await $.command.run({ command: 'chronicle', args: '', ...RUN })).text).toBe('Chronicle open.')
    expect(calls).toEqual(['open kz-chronicle', 'close kz-chronicle', 'open kz-chronicle'])
  })

  test('the terminal: tally colors, filter counts, an empty filter, a narrow body', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    let ui = await $.ui.mount({ plugin: 'chronicle', surface: 'terminal', ...PANE(0) })
    const exact = async (text: string) => (await ui.findAll({ type: 'Text' })).find(x => x.text === text)?.props
    expect((await exact('✖ 0'))?.color).toBe('#9ca3af')
    expect((await ui.find({ type: 'Raster', key: 'ribbon' }))?.props.columns).toBe(42)
    expect((await ui.find({ type: 'Button', key: 'f-prompts' }))?.props.label).toBe('Prompts 0')
    expect((await ui.find({ type: 'Button', key: 'f-all' }))?.props).toMatchObject({ label: 'All 1', variant: 'primary', dimColor: false })
    await ui.press({ key: 'f-prompts' })
    expect(await ui.find({ type: 'Text', text: '  nothing here yet' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'f-prompts' }))?.props).toMatchObject({ variant: 'primary' })
    await ui.unmount()
    await $.tool.call({ tool: 'Frob' } as never)
    ui = await $.ui.mount({ plugin: 'chronicle', surface: 'terminal', ...PANE(0) })
    await ui.press({ key: 'f-all' })
    expect((await exact('✖ 1'))?.color).toBe('#f87171')
    await ui.unmount()
  })

  test('the desktop: a header and a timeline; one event has no rail; an empty filter says so', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    let ui = await $.ui.mount({ plugin: 'chronicle', surface: 'desktop', ...PANE(0) })
    let svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs[0]?.props.alt).toBe('1 events: 0 prompts, 0 agents, 0 commits, 0 errors')
    expect(String(svgs[1]?.props.source)).not.toContain('chG')
    expect(String(svgs[1]?.props.alt)).toContain('session started')
    await ui.press({ key: 'f-git' })
    svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs[1]?.props.alt).toBe('no events')
    expect(String(svgs[1]?.props.source)).toContain('Nothing here yet.')
    await ui.unmount()

    // Every kind, so each draws its own dot.
    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'hello', turnId: 't1' })
    await $.agent.spawn(SPAWN)
    await $.turn.complete(done('answer', 1, 'a1'))
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x && git push' })
    await $.tool.call({ tool: 'Frob' } as never)
    await $.session.compact({ trigger: 'auto', messages: MSG })
    await $.turn.complete(done('answer', 1))
    ui = await $.ui.mount({ plugin: 'chronicle', surface: 'desktop', ...PANE(60) })
    await ui.press({ key: 'f-all' })
    svgs = await ui.findAll({ type: 'Svg' })
    const head = String(svgs[0]?.props.source)
    const line = String(svgs[1]?.props.source)
    expect(svgs[0]?.props.alt).toBe('9 events: 1 prompts, 1 agents, 1 commits, 1 errors')
    expect(head).toContain('fill="#f87171"')
    expect(line).toContain('chG')
    expect(line).toContain('class="ring"')
    expect(line).toContain('r="1.8" class="p"')
    expect(line).toContain('r="5" fill="#f87171"')
    await ui.unmount()
  })

  test('before the session starts the pane draws an empty record', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'chronicle', surface, ...PANE() })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '  nothing here yet' })).toBeDefined()
      else expect((await ui.findAll({ type: 'Svg' }))[0]?.props.alt).toBe('0 events: 0 prompts, 0 agents, 0 commits, 0 errors')
      await ui.unmount()
    }
  })
})

describe('failures', () => {
  test('with no clock every observer passes its event on', async ($, on) => {
    base(on)
    expect(await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })).toMatchObject({ text: 'hi' })
    expect(await $.agent.spawn(SPAWN)).toMatchObject({ agentId: 'a1' })
    expect(await $.tool.call({ tool: 'Read', file_path: '/a' })).toMatchObject({ result: 'ok' })
    expect(await $.session.compact({ trigger: 'auto', messages: MSG })).toMatchObject({ tokensAfter: 90_000 })
    expect(await $.session.measure({ context: { window: 1 }, rateLimits: [], changed: [] } as never)).toMatchObject({ changed: [] })
  })

  test('two records at once publish once, the later winning', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await Promise.all([
      $.prompt.submit({ text: 'one', wait: false, origin: { kind: 'composer' } }),
      $.prompt.submit({ text: 'two', wait: false, origin: { kind: 'composer' } }),
    ])
    const t = (await titles($, 'prompts')).filter(l => l.startsWith('❯'))
    expect(t.sort()).toEqual(['❯ one', '❯ two'])
  })
})
