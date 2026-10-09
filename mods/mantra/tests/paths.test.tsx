import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const SPIN = { component: 'Spinner' as const, requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
const ZEN = ['Breathing', 'Contemplating', 'Raking sand', 'Steeping', 'Pondering', 'Settling', 'Centering',
  'Listening', 'Unfolding', 'Balancing', 'Sitting still', 'Noticing', 'Letting go', 'Arranging stones',
  'Watering', 'Pruning', 'Flowing', 'Softening', 'Grounding', 'Releasing', 'Pouring tea', 'Folding paper',
  'Observing', 'Stilling', 'Rippling', 'Sweeping the path', 'Lighting incense']
const HACKER = ['Compiling', 'Grepping', 'Piping', 'Forking', 'Hashing', 'Fuzzing', 'Patching', 'Bootstrapping',
  'Spelunking', 'Decrypting', 'Rebasing', 'Bit-twiddling', 'Tunneling', 'Sniffing packets', 'Overclocking',
  'Refactoring', 'Linking', 'Disassembling', 'Recursing', 'Caching', 'Daemonizing', 'Hot-swapping',
  'Defragging', 'Yak-shaving', 'Multiplexing', 'Grokking', 'Pinging']
const COSMIC = ['Warping', 'Orbiting', 'Stargazing', 'Drifting', 'Slingshotting', 'Terraforming', 'Comet-chasing',
  'Moonwalking', 'Docking', 'Hyperjumping', 'Gravitating', 'Eclipsing', 'Pulsating', 'Spacewalking',
  'Star-charting', 'Accreting', 'Ionizing', 'Coalescing', 'Redshifting', 'Transiting', 'Quasar-hunting',
  'Nebula-weaving', 'Starhopping', 'Igniting', 'Free-falling', 'Aligning planets', 'Beaming down']

/** The bottoms every scenario needs; tool calls wait until their id is released. */
function base(on: On): { seen: RenderPropsOf['Spinner'][]; release: (id: string) => void } {
  const seen: RenderPropsOf['Spinner'][] = []
  const gates = new Map<string, () => void>()
  const waiting = new Map<string, Promise<void>>()
  const gate = (id: string) => {
    let p = waiting.get(id)
    if (!p) {
      p = new Promise<void>(r => gates.set(id, r))
      waiting.set(id, p)
    }
    return p
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('tool.call', async ($, e) => {
    await gate(e.tool_use_id ?? 'x')
    return { result: { stdout: e.tool_use_id ?? '', stderr: '', interrupted: false }, tool_use_id: e.tool_use_id ?? 'x' }
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    seen.push(e.props)
    const { Text } = $.ui.resolve(e)
    return <Text key="line">{e.props.word}{e.props.suffix}</Text>
  })
  return { seen, release: id => { void gate(id); gates.get(id)?.() } }
}

describe('packs and the /mantra command', () => {
  test('the configured pack is the default; /mantra toggles, on, and refuses an unknown pack', { options: { pack: 'zen' } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const a = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(ZEN).toContain(seen[seen.length - 1]?.word)
    await a.unmount()

    const off = await $.command.run({ command: 'mantra', args: '', ...RUN })
    expect(off.text).toBe('Mantra off.')
    const plain = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(seen[seen.length - 1]?.word).toBe('Sauteing')
    await plain.unmount()

    const back = await $.command.run({ command: 'mantra', args: '', ...RUN })
    expect(back.text).toBe('Mantra on (zen). Packs: cosmic, zen, pirate, turkish, hacker.')
    expect((await $.command.run({ command: 'mantra', args: ' ON ', ...RUN })).text).toBe('Mantra on.')
    expect((await $.command.run({ command: 'mantra', args: 'Disco', ...RUN })).text)
      .toBe('Unknown pack "disco". Packs: cosmic, zen, pirate, turkish, hacker; or on, off.')
    expect((await $.command.run({ command: 'mantra', args: 'hacker', ...RUN })).text).toBe('Mantra pack: hacker (Compiling, Grepping, Piping, …)')
    const after = await $.command.run({ command: 'mantra', args: 'off', ...RUN })
    expect(after.text).toContain('Mantra off: the spinner')
    expect((await $.command.run({ command: 'mantra', args: '', ...RUN })).text).toBe('Mantra on (hacker). Packs: cosmic, zen, pirate, turkish, hacker.')
  })

  test('a stored pack and off switch survive the session', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { pack: 'hacker', isOn: false })
    const { seen } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const off = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(seen[seen.length - 1]?.word).toBe('Sauteing')
    await off.unmount()
    expect((await $.command.run({ command: 'mantra', args: '', ...RUN })).text).toBe('Mantra on (hacker). Packs: cosmic, zen, pirate, turkish, hacker.')
    const on2 = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(HACKER).toContain(seen[seen.length - 1]?.word)
    await on2.unmount()
  })

  test('an unknown stored pack is ignored and the default pack names the toggle', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, { pack: 'nonsense' })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect((await $.command.run({ command: 'mantra', args: '', ...RUN })).text).toBe('Mantra off.')
    expect((await $.command.run({ command: 'mantra', args: '', ...RUN })).text).toBe('Mantra on (cosmic). Packs: cosmic, zen, pirate, turkish, hacker.')
  })

  test('with no store the defaults stand: the spinner is themed from cosmic', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const { seen } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const ui = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(COSMIC).toContain(seen[seen.length - 1]?.word)
    await ui.unmount()
  })
})

describe('the tail', () => {
  test('labels: a file for Read, the first line of a PowerShell command, the description of a Bash call, the bare tool name', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen, release } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const cases: [Record<string, unknown>, string][] = [
      [{ tool: 'Read', file_path: '/repo/src/deep/notes.md', tool_use_id: 'r1' }, '… · ◉ notes.md 0:00'],
      [{ tool: 'PowerShell', command: 'Get-ChildItem\nSelect-Object -First 3', tool_use_id: 'p1' }, '… · $ Get-ChildItem 0:00'],
      [{ tool: 'Bash', description: 'List files', tool_use_id: 'b1' }, '… · $ List files 0:00'],
      [{ tool: 'Frobnicate', tool_use_id: 'f1' }, '… · • Frobnicate 0:00'],
    ]
    for (const [input, tail] of cases) {
      const id = input.tool_use_id as string
      const call = $.tool.call(input as never)
      await clock.settle()
      const ui = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN, props: { ...SPIN.props, mode: 'tool-use' as const } })
      expect(seen[seen.length - 1]?.suffix).toBe(tail)
      await ui.unmount()
      release(id)
      await call
      await clock.settle()
    }
  })

  test('a subagent spinner shows its own tool and never borrows main’s; parallel calls keep the newest', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen, release } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const sub = $.tool.call({ tool: 'Grep', pattern: 'TODO', tool_use_id: 'g1', agentId: 'a1' } as never)
    const sub2 = $.tool.call({ tool: 'Glob', pattern: '*.ts', tool_use_id: 'g2', agentId: 'a1' } as never)
    await clock.advance(3000)
    const spin = async (requestId: string, mode: RenderPropsOf['Spinner']['mode'] = 'tool-use') => {
      const ui = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN, requestId, props: { ...SPIN.props, mode } })
      const p = seen[seen.length - 1]
      await ui.unmount()
      return p
    }
    expect((await spin('a1'))?.suffix).toBe('… · ⌕ *.ts 0:03')
    release('g2')
    await sub2
    await clock.settle()
    // g1 still runs, but g2 replaced it in the loop's slot and took it away.
    expect((await spin('a1'))?.suffix).toBe('…')
    release('g1')
    await sub
    await clock.settle()

    const main = $.tool.call({ tool: 'Edit', file_path: '/x/app.ts', tool_use_id: 'e1' } as never)
    await clock.advance(1000)
    expect((await spin('a1'))?.suffix).toBe('…')
    expect((await spin('other'))?.suffix).toBe('… · ✎ app.ts 0:01')
    // Thinking with no effort known yet: no tail.
    release('e1')
    await main
    await clock.settle()
    expect((await spin('main', 'thinking'))?.suffix).toBe('…')
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  })

  test('effort: only the main loop’s, shown while thinking, not in other modes', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const steps = [
      { turnId: 't1', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a1' },
      { turnId: 't1', index: 1, model: 'm', messageCount: 1 },
      { turnId: 't1', index: 2, model: 'm', effort: 'max', messageCount: 1 },
      { turnId: 't1', index: 3, model: 'm', effort: 'max', messageCount: 1 },
    ]
    for (const s of steps) for await (const c of $.turn.step(s as never)) void c
    const think = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(seen[seen.length - 1]?.suffix).toBe('… · ∴ max')
    await think.unmount()
    const resp = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN, props: { ...SPIN.props, mode: 'responding' as const } })
    expect(seen[seen.length - 1]?.suffix).toBe('…')
    await resp.unmount()
    // A subagent's end leaves main working.
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  })

  test('desktop keeps a descriptive word and themes only “Working”', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen } = base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    const kept = await $.ui.mount({ plugin: 'mantra', surface: 'desktop', ...SPIN, props: { ...SPIN.props, word: 'Creating notes.md', mode: 'responding' as const } })
    expect(seen[seen.length - 1]).toMatchObject({ word: 'Creating notes.md', suffix: '…' })
    expect(await kept.find({ type: 'Text', text: 'Creating notes.md…' })).toBeDefined()
    await kept.unmount()
    const themed = await $.ui.mount({ plugin: 'mantra', surface: 'desktop', ...SPIN, props: { ...SPIN.props, word: 'Working', mode: 'responding' as const } })
    expect(seen[seen.length - 1]?.word).not.toBe('Working')
    await themed.unmount()
  })
})

describe('timers and failures', () => {
  test('the clock republishes a running tool’s time, also outside a turn, and stays quiet when idle', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const { seen, release } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.advance(1000)
    const call = $.tool.call({ tool: 'Bash', command: 'sleep 9', tool_use_id: 's1' } as never)
    await clock.advance(5000)
    const ui = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN, props: { ...SPIN.props, mode: 'tool-use' as const } })
    expect(seen[seen.length - 1]?.suffix).toBe('… · $ sleep 9 0:05')
    await ui.unmount()
    release('s1')
    await call
    await clock.settle()
    await clock.advance(2000)
    const idle = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN, props: { ...SPIN.props, mode: 'tool-use' as const } })
    expect(seen[seen.length - 1]?.suffix).toBe('…')
    await idle.unmount()
  })

  test('a failing tool.call hook (no clock to read) hands the call on unchanged', async ($, on) => {
    base(on).release('n1')
    const r = await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'n1' })
    expect(r.result).toMatchObject({ stdout: 'n1' })
  })

  test('turn hooks fail open: a failure beneath turn.start and turn.complete reaches the caller', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    on('turn.start', () => { throw new Error('start broke') })
    on('turn.complete', () => { throw new Error('complete broke') })
    let started = 'ok'
    try { await $.turn.start({ text: 'go', turnId: 't1' }) } catch (err) { started = String(err) }
    let completed = 'ok'
    try { await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) } catch (err) { completed = String(err) }
    expect(started).toContain('no implementation for turn.start')
    expect(completed).toContain('no implementation for turn.complete')
  })

  test('with no clock to read, publishing fails quietly and the turn goes on', async ($, on) => {
    mock.store(on, {})
    base(on)
    expect(await $.turn.start({ text: 'go', turnId: 't1' })).toMatchObject({ turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', effort: 'high', messageCount: 1 })) void c
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toMatchObject({ text: '' })
  })
})
