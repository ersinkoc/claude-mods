import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const SPAWN = {
  tool_use_id: 'tu1', prompt: 'look', description: 'Find it', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}
const USAGE = { model: 'claude-haiku-5', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Opts = { usage?: boolean; model?: string; root?: string; copy?: boolean; version?: boolean; write?: boolean }
/** The engine beneath; what was written lands in `written`. */
function base(on: On, opts: Opts = {}): { written: { path: string; text: string }[] } {
  const written: { path: string; text: string }[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (opts.usage !== false) {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 500_000, window: 1_000_000, percent: 50 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] } }))
  }
  on('session.model', () => ({ value: opts.model ?? 'claude-opus-5-5' }))
  if (opts.version !== false) on('session.version', () => ({ value: { version: '2.1.293' } }))
  if (opts.root !== undefined) on('session.root', () => ({ value: opts.root as string }))
  on('session.cwd', () => ({ value: '/cwd' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: e.index === 0 ? { ...USAGE, model: e.model } : null }
  })
  on('agent.spawn', ($, e) => (e.description === 'deny' ? { deny: 'no' } : e.description === 'teammate' ? { model: 'm' } : { model: 'claude-haiku-5', agentId: e.description }) as never)
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') return { isError: true as const, result: 'exit 1' }
    if (e.tool === 'Write') return { deny: 'no writes' }
    return { result: 'ok' }
  })
  if (opts.write !== false) on('fs.write', ($, e) => { written.push({ path: e.path, text: e.text }); return { value: undefined } })
  if (opts.copy !== false) on('ui.copy', () => ({ value: { isCopied: false } as never }))
  return { written }
}
const shoot = async ($: Engine, args = '') => (await $.command.run({ command: 'polaroid', args, ...RUN })).text
const done = (extra: Record<string, unknown> = {}) => ({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', ...extra }) as never

describe('the collector', () => {
  test('turns, steps, models, subagents, files and failures make it into the report', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const { written } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // A blank prompt does not title the session; the next one does.
    await $.turn.start({ text: '   ', turnId: 't0' })
    await $.turn.complete(done({ turnId: 't0' }))
    await $.turn.start({ text: 'Build the <thing>', turnId: 't1' })
    for (const [index, model] of [[0, 'claude-opus-5-5'], [1, 'claude-opus-5-5'], [0, 'claude-haiku-5']] as const) {
      for await (const c of $.turn.step({ turnId: 't1', index, model, messageCount: 1 })) void c
    }
    await $.agent.spawn({ ...SPAWN, description: 'ag-ok' })
    await $.agent.spawn({ ...SPAWN, description: 'ag-bad' })
    await $.agent.spawn({ ...SPAWN, description: 'ag-live' })
    await $.agent.spawn({ ...SPAWN, description: 'deny' })
    await $.agent.spawn({ ...SPAWN, description: 'teammate' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag-ok' } as never)
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await $.tool.call({ tool: 'Write', file_path: '/w/b.ts', content: '' })
    await clock.advance(30_000)
    await $.turn.complete(done({ agentId: 'ag-ok', usage: USAGE }))
    await $.turn.complete(done({ agentId: 'ag-bad', reason: 'error' }))
    await $.turn.complete(done({ agentId: 'nobody' }))
    await $.turn.complete(done({ durationMs: 42_000, usage: { ...USAGE, model: 'claude-opus-5-5' } }))
    // A turn still running when the picture is taken.
    await $.turn.start({ text: 'and more', turnId: 't2' })
    await clock.advance(5_000)
    const r = await shoot($, 'HTML')
    // No root: the report lands under the cwd; the copy did not land, so no note.
    expect(r).toMatch(/^Polaroid report saved: \/cwd\/\.kozmos\/reports\/session-\d{8}-\d{6}\.html$/)
    const html = written[0]?.text ?? ''
    expect(html).toContain('<title>Polaroid · Build the &lt;thing&gt;</title>')
    expect(html).toContain('also <b>Haiku 5</b>')
    expect(html).toContain('<span class="pill" style="--c:#22d3ee">running</span>')
    expect(html).toContain('2 failed')
    expect(html).toContain('<td>ag-ok</td>')
    for (const status of ['done', 'failed', 'running']) expect(html).toContain(`">${status}</span></td></tr>`)
    expect(html).toContain('/w/a.ts</td><td class="n">2</td>')
    // No cost from the engine: estimated from the turn's and the subagent's own usage.
    expect(html).toContain('<div class="v">&lt;$0.01</div><div class="s">estimated</div>')
    // Two requests carried usage.
    expect(html).toContain('2 requests')
    const md = await shoot($, 'markdown')
    expect(md).toContain('Polaroid Markdown saved: ')
    expect(written[1]?.path).toMatch(/\.md$/)
    expect(written[1]?.text).toContain('| 3 | and more |')
  })

  test('context and limits from measures: small moves are skipped, the series is thinned past 360 points', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const { written } = base(on, { usage: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const m = (percent: number | undefined, cost?: number) => $.session.measure({
      context: { tokens: (percent ?? 0) * 10_000, window: 1_000_000, ...(percent === undefined ? {} : { percent }) },
      rateLimits: [{ kind: 'seven_day', percentUsed: percent ?? 5 }],
      ...(cost === undefined ? {} : { cost: { usd: cost } }),
      changed: ['context'],
    } as never)
    await m(undefined)
    await m(40, 0.5)
    // Within half a point: the peak moves to it, the series does not.
    await m(40.2)
    for (let i = 0; i < 360; i++) {
      await clock.advance(1000)
      await m(i % 2 ? 20 : 30)
    }
    await shoot($)
    const html = written[0]?.text ?? ''
    // 361 points thinned once: 90 of the older 180, and the newer 181.
    const line = /<polyline points="([^"]+)" fill="none" stroke="#22d3ee" stroke-width="2"/.exec(html)?.[1] ?? ''
    expect(line.split(' ')).toHaveLength(271)
    expect(html).toContain('<div class="k">Context peak</div><div class="v">40%</div><div class="s">402k of 1.0M</div>')
    expect(html).toContain('<div class="v">$0.50</div><div class="s">as /cost totals it</div>')
    expect(html).toContain('peak 40%')
  })

  test('a snapshot reads the engine: its start, cost, context, limits, model, version and root', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const { written } = base(on, { root: 'D:\\proj', model: '', copy: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await shoot($)
    expect(r).toMatch(/^Polaroid report saved: D:\\proj\\\.kozmos\\reports\\session-\d{8}-\d{6}\.html$/)
    const html = written[0]?.text ?? ''
    expect(html).toContain('model <b>—</b>')
    expect(html).toContain('Claude Code <b>2.1.293</b>')
    expect(html).toContain('<span class="chip mono">D:\\proj</span>')
    expect(html).toContain('<div class="v">50%</div>')
    expect(html).toContain('peak 30%')
  })

  test('an engine that answers nothing: the hooks’ own record stands', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.cwd', () => ({ value: '/cwd' }))
    const written: string[] = []
    on('fs.write', ($, e) => { written.push(e.text); return { value: undefined } })
    on('ui.copy', () => ({ value: { isCopied: true as const } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await shoot($)).toContain('\n(path copied to the clipboard)')
    expect(written[0]).toContain('Claude Code <b>?</b>')
    expect(written[0]).toContain('No context readings yet.')
  })

  test('a report that cannot be written says why', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    base(on, { write: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(await shoot($)).toBe('Polaroid could not write the report: no implementation for fs.write')
  })
})

describe('caps', () => {
  test('at most 200 commands are kept, and /polaroid itself is never one', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const { written } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 201; i++) await $.command.run({ command: `c${i}`, args: '', ...RUN })
    await shoot($, 'md')
    const md = written[0]?.text ?? ''
    expect(md).toContain('`/c199`')
    expect(md).not.toContain('`/c200`')
    expect(md).not.toContain('`/polaroid`')
  })

  test('at most 500 turns are kept', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const { written } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 501; i++) {
      await $.turn.start({ text: `turn ${i}`, turnId: `t${i}` })
      await $.turn.complete(done({ turnId: `t${i}` }))
    }
    await shoot($, 'md')
    const md = written[0]?.text ?? ''
    expect(md).toContain('| 500 | turn 499 |')
    expect(md).not.toContain('turn 500')
  })
})

describe('failures', () => {
  test('with no clock every observer passes its event on', async ($, on) => {
    base(on)
    expect(await $.command.run({ command: 'other', args: '', ...RUN })).toMatchObject({ text: '' })
    expect(await $.turn.complete(done())).toMatchObject({ text: '' })
    expect(await $.agent.spawn({ ...SPAWN, description: 'ag-1' })).toMatchObject({ agentId: 'ag-1' })
  })

  test('a failure beneath tool.call reaches the caller', async ($, on) => {
    mock.clock(on, { now: 1 })
    let err = ''
    try { await $.tool.call({ tool: 'Read', file_path: '/a' }) } catch (e) { err = String(e) }
    expect(err).toContain('no implementation for tool.call')
  })
})
