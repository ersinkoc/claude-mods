import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepChunk, TurnStepInput } from 'claude-code'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-relay',
  props: { title: 'KOZMOS · Relay', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const USAGE = { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 }

/** One scripted model request: what it streams, how it stops, the waits around the chunks. */
type Script = { chunks?: TurnStepChunk[]; stop?: 'end_turn' | 'tool_use' | null; noUsage?: boolean; before?: number; after?: number }

/** A full Agent spawn as the engine raises it. */
const spawnOf = (description: string, subagentType: string) => ({
  tool_use_id: `tu-${description}`, prompt: 'p', description, subagentType,
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
})

function engine(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

/** A clock the scripted requests move by hand: Relay only reads the time. */
function clockAt(on: On, start: number): { now: number } {
  const time = { now: start }
  on('clock.now', () => ({ value: time.now }))
  return time
}

/** A turn.step beneath the plugin answering each request by its `turnId`, moving `time` (when given) around the chunks. */
function steps(on: On, scripts: Record<string, Script>, time?: { now: number }): void {
  on('turn.step', async function* ($, e) {
    const s = scripts[e.turnId] ?? {}
    if (time) time.now += s.before ?? 1000
    for (const c of s.chunks ?? [{ kind: 'text' as const, index: 0, text: 'hi' }]) yield c
    if (time) time.now += s.after ?? 2000
    return {
      turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: s.stop === undefined ? 'end_turn' as const : s.stop,
      usage: s.noUsage ? null : { model: e.model, ...USAGE },
    }
  })
}

/** Runs one request to its end. */
async function drive($: Engine, input: Omit<TurnStepInput, 'messageCount'>) {
  const stream = $.turn.step({ messageCount: 1, ...input })
  for (;;) {
    const step = await stream.next()
    if (step.done) return step.value
  }
}

describe('before the session (a hot reload)', () => {
  test('carries on from the snapshot the last module published', async ($, on) => {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    let seeded = false
    on('state.get', ($, e, next) => {
      if (seeded || e.key !== 'snap') return next(e)
      seeded = true
      const req = { id: 'old:0', at: 0, ms: 2000, model: 'claude-opus-5-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, stop: 'end_turn', who: 'main' }
      return { value: { value: { reqs: [req], total: 41, failed: 0 }, version: 1 } }
    })
    const { text } = await $.command.run({ command: 'relay', args: 'stats', ...RUN })
    expect(text).toContain('Relay: 41 requests · p50 2.0s')
  })

  test('nothing kept: the stats and the pane say so', async ($, on) => {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const ui = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /No model requests timed yet/ })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'relay', args: ' stats', ...RUN })).text).toBe('Relay: no model requests timed yet.')
  })
})

describe('the pane toggle', () => {
  test('autoOpen opens the pane at start; the command closes an open one', { options: { autoOpen: true } }, async ($, on) => {
    engine(on)
    const opened: string[] = []
    let closed = ''
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.panes', () => ({ value: [{ id: 'kz-relay', title: 'KOZMOS · Relay', isShown: true, isFocused: false, isPlaced: true }] }))
    on('ui.close', ($, e) => {
      closed = e.id
      return { value: undefined }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual(['kz-relay'])
    expect((await $.command.run({ command: 'relay', args: '', ...RUN })).text).toBe('Relay closed.')
    expect(closed).toBe('kz-relay')
  })

  test('the command opens a closed pane', async ($, on) => {
    engine(on)
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(`${e.id} ${e.title}`)
      return { value: { isPlaced: true } }
    })
    on('ui.panes', () => ({ value: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    expect(opened).toEqual([])
    expect((await $.command.run({ command: 'relay', args: '', ...RUN })).text).toBe('Relay open.')
    expect(opened).toEqual(['kz-relay KOZMOS · Relay'])
  })

  test('a pane that cannot open does not stop the session', { options: { autoOpen: true } }, async ($, on) => {
    engine(on)
    expect((await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })).cwd).toBe('/w')
  })
})

describe('who asked', () => {
  test('spawned agents by description or type; the roster; an id when nobody knows', async ($, on) => {
    const time = clockAt(on, 1_000_000)
    engine(on)
    on('agent.spawn', ($, e) => {
      if (e.description === 'refuse') return { deny: 'no agents' }
      if (e.description === 'hollow') return { model: 'haiku' }
      return { model: 'haiku', agentId: e.description === '' ? 'ag-typed' : 'ag-named' }
    })
    let listed = 0
    on('agent.list', () => {
      listed++
      return { value: [{ id: 'ag-roster', description: '', type: 'Explore', status: 'running' as const }] }
    })
    steps(on, {}, time)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    await $.agent.spawn(spawnOf('Fix the build', 'general-purpose'))
    await $.agent.spawn(spawnOf('', 'Plan'))
    expect(await $.agent.spawn(spawnOf('refuse', 'x'))).toMatchObject({ deny: 'no agents' })
    await $.agent.spawn(spawnOf('hollow', 'x'))

    await drive($, { turnId: 'a', index: 0, model: 'claude-haiku-5', agentId: 'ag-named' })
    await drive($, { turnId: 'b', index: 0, model: 'claude-haiku-5', agentId: 'ag-typed' })
    expect(listed).toBe(0)
    await drive($, { turnId: 'c', index: 0, model: 'claude-haiku-5', agentId: 'ag-roster' })
    await drive($, { turnId: 'd', index: 0, model: 'claude-haiku-5', agentId: 'ag-roster' })
    expect(listed).toBe(1)
    await drive($, { turnId: 'e', index: 0, model: 'claude-haiku-5', agentId: 'ag-stranger' })

    const ui = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE })
    for (const who of ['Fix the build', 'Plan', 'Explore', 'agent ag-str']) expect(await ui.find({ type: 'Text', text: new RegExp(`· ${who}$`) })).toBeDefined()
    await ui.unmount()
  })

  test('an unreadable roster falls back to the id; a failing spawn chain is handed on', async ($, on) => {
    const time = clockAt(on, 1_000_000)
    engine(on)
    steps(on, {}, time)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await drive($, { turnId: 'a', index: 0, model: 'claude-haiku-5', agentId: 'xyz123456' })
    expect((await $.command.run({ command: 'relay', args: 'stats', ...RUN })).text).toContain('· agent xyz123 ·')
    await expect($.agent.spawn(spawnOf('d', 't'))).rejects.toThrow()
  })
})

describe('timing requests', () => {
  test('the first token is the first text, thinking or tool chunk; failures count apart', async ($, on) => {
    const time = clockAt(on, 1_000_000)
    engine(on)
    steps(on, {
      think: { chunks: [{ kind: 'input', index: 0, json: '{}' }, { kind: 'thinking', index: 0, text: 'hm' }, { kind: 'text', index: 1, text: 'a' }], before: 500, after: 1500 },
      tool: { chunks: [{ kind: 'tool', index: 0, id: 'tu', name: 'Read' }], stop: 'tool_use', before: 2000, after: 500 },
      quiet: { chunks: [{ kind: 'input', index: 0, json: '{}' }], before: 100, after: 100 },
      dead: { chunks: [], stop: null, noUsage: true, before: 3000, after: 0 },
    }, time)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await drive($, { turnId: 'think', index: 0, model: 'claude-opus-5-5', effort: 'high' })
    expect(r.stopReason).toBe('end_turn')
    await drive($, { turnId: 'tool', index: 1, model: 'claude-opus-5-5' })
    await drive($, { turnId: 'quiet', index: 2, model: 'claude-opus-5-5' })
    await drive($, { turnId: 'dead', index: 3, model: 'claude-opus-5-5' })

    const { text } = await $.command.run({ command: 'relay', args: 'stats', ...RUN })
    expect(text).toContain('Relay: 4 requests · p50 2.0s · p95 2.5s')
    expect(text).toContain('1.   2.5s  Opus 5.5 · main · tool use')
    expect(text).toContain('Opus 5.5 (high) · main · end turn')

    const term = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 0 } })
    expect(await term.find({ type: 'Text', text: /1 without response/ })).toBeDefined()
    // ttft: thinking at 500 ms, the tool at 2000 ms; the quiet one streamed nothing countable.
    expect(await term.find({ type: 'Text', text: /ttft 1\.3s/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /no response · main/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Opus 5\.5 high 2\.0s 267t\/s/ })).toBeDefined()
    await term.unmount()
  })

  test('without a clock the requests are timed by the wall clock', async ($, on) => {
    engine(on)
    steps(on, {})
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await drive($, { turnId: 'a', index: 0, model: 'claude-sonnet-5' })
    expect((await $.command.run({ command: 'relay', args: 'stats', ...RUN })).text).toContain('Relay: 1 requests')
  })

  test('a state that never settles: the record gives up quietly and the stream ends', async ($, on) => {
    const time = clockAt(on, 1_000_000)
    let stale = false
    on('state.get', ($, e, next) => (stale ? { value: { value: null, version: 1 } } : next(e)))
    on('state.set', ($, e, next) => (stale ? { value: { isSet: false as const, version: 2 } } : next(e)))
    engine(on)
    steps(on, {}, time)
    stale = true
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const r = await drive($, { turnId: 'a', index: 0, model: 'claude-opus-5-5' })
    expect(r.answer).toBe('hi')
  })
})

describe('the pane', () => {
  test('only failed requests: no percentiles, no streamed output', async ($, on) => {
    const time = clockAt(on, 1_000_000)
    engine(on)
    steps(on, { a: { chunks: [], stop: null, noUsage: true } }, time)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await drive($, { turnId: 'a', index: 0, model: 'claude-opus-5-5' })
    const term = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /^p50 — · p95 — · — t\/s/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /no streamed output yet/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1 without response/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'relay', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.map(s => s.props.alt)).toContain('Slowest requests: none')
    await desk.unmount()
  })

  test('the desktop alt texts name a pane with no data', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const desk = await $.ui.mount({ plugin: 'relay', surface: 'desktop', ...PANE })
    const alts = (await desk.findAll({ type: 'Svg' })).map(s => s.props.alt)
    expect(alts).toContain('Model mix: none')
    expect(alts).toContain('The last 0 requests')
    await desk.unmount()
  })
})
