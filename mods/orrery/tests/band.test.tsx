import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const band = (o: { maxRows?: number; bodyColumns?: number; hasSurvey?: boolean } = {}) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: o.hasSurvey ?? false, isWorking: true, maxRows: o.maxRows ?? 20, bodyColumns: o.bodyColumns ?? 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
})
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = 1_000_000

type Status = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
type Info = { id: string; description: string; type: string; status: Status }

const SPAWN = { tool_use_id: 'tu', prompt: 'go', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }

/** The engine beneath: a roster the test edits, spawns that answer with an id, turns. */
function world(on: On, roster: () => Info[]): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: roster() }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    const out = e.model === 'none' ? null : { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: out }
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

async function step($: Engine, model: string, agentId?: string): Promise<void> {
  const s = $.turn.step({ turnId: 't', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) void _
  await s.result
}

describe('the band', () => {
  test('/orrery remembers being hidden, then shows and hides again', async ($, on) => {
    mock.clock(on, { now: T0 })
    const store = new Map<string, unknown>([['hidden', true]])
    on('store.get', ($, e) => ({ value: store.get(e.key) }))
    on('store.set', ($, e) => {
      store.set(e.key, e.value)
      return { value: undefined }
    })
    world(on, () => [{ id: 'ag1', description: 'Survey', type: 'Explore', status: 'running' }])
    await $.session.start(START)

    let ui = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()

    expect((await $.command.run({ command: 'orrery', args: '', ...RUN }))?.text).toBe('Orrery shown.')
    expect(store.get('hidden')).toBe(false)
    ui = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...band() })
    expect(await ui.find({ type: 'Client', key: 'orrery' })).toBeDefined()
    await ui.unmount()

    expect((await $.command.run({ command: 'orrery', args: '', ...RUN }))?.text).toBe('Orrery hidden.')
    expect(store.get('hidden')).toBe(true)
  })

  test('a store that cannot be written still hides the band for the session', async ($, on) => {
    mock.clock(on, { now: T0 })
    on('store.get', () => ({ value: 'not a flag' }))
    on('store.set', () => ({ deny: 'read-only' }))
    world(on, () => [{ id: 'ag1', description: 'Survey', type: 'Explore', status: 'running' }])
    await $.session.start(START)
    expect((await $.command.run({ command: 'orrery', args: '', ...RUN }))?.text).toBe('Orrery hidden.')
    const ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('the band sizes to the space it is given, and steps aside for a survey', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [{ id: 'ag1', description: 'Survey', type: 'Explore', status: 'running' }])
    await $.session.start(START)

    let ui = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...band({ maxRows: 8, bodyColumns: 0 }) })
    expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ width: 78, height: 4 })
    await ui.unmount()
    ui = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...band({ maxRows: 12, bodyColumns: 30 }) })
    expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ width: 38, height: 5 })
    await ui.unmount()
    let desk = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band({ maxRows: 6 }) })
    expect((await desk.find({ type: 'Svg' }))?.props.height).toBe(92)
    await desk.unmount()
    desk = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band({ hasSurvey: true }) })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    expect(await desk.find({ key: 'engine' })).toBeDefined()
    await desk.unmount()
  })
})

describe('the roster', () => {
  test('agents from the roster join, and their end states settle them', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let roster: Info[] = [
      { id: 'p', description: 'Queued', type: '', status: 'pending' },
      { id: 'w', description: 'Waiting', type: 'Plan', status: 'waiting' },
      { id: 'gone', description: 'Done before we looked', type: 'Explore', status: 'completed' },
    ]
    world(on, () => roster)
    await $.session.start(START)
    // A step from an agent the roster has not listed yet: a nameless planet.
    await step($, 'claude-haiku-5', 'x')
    await clock.advance(1000)

    let ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('3 orbiting · 0 done')
    expect(svg).toContain('>Queued<')
    expect(svg).not.toContain('Done before we looked')
    await ui.unmount()

    roster = [
      { id: 'p', description: 'Queued', type: 'Explore', status: 'idle' },
      { id: 'w', description: 'Waiting', type: 'Plan', status: 'killed' },
      { id: 'x', description: 'Named at last', type: 'Review', status: 'running' },
      { id: 'gone', description: 'Done before we looked', type: 'Explore', status: 'failed' },
    ]
    await clock.advance(2000)
    ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('1 orbiting · 1 done · 1 failed')
    expect(svg).toContain('>Named at last<')
    expect(svg).toContain('Review · ')
    // The pending agent, now idle, is done.
    expect(svg).toContain('>Queued<')
    await ui.unmount()

    roster = [{ id: 'x', description: 'Named at last', type: 'Explore', status: 'completed' }]
    await clock.advance(2000)
    const term = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...band() })
    await term.advance(40)
    expect(await term.find({ type: 'Text', text: /0 orbiting/, in: 'orrery' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Review/, in: 'orrery' })).toBeDefined()
    await term.unmount()
  })

  test('when all have finished the band lingers five minutes, then leaves', { timeoutMs: 20_000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let roster: Info[] = [{ id: 'a', description: 'Short job', type: 'Explore', status: 'running' }]
    let lists = 0
    world(on, () => (lists++, roster))
    await $.session.start(START)
    roster = [{ id: 'a', description: 'Short job', type: 'Explore', status: 'completed' }]
    await clock.advance(2000)
    lists = 0
    // Nothing runs: the roster is read every ten seconds.
    await clock.advance(20_000)
    expect(lists).toBe(2)
    let ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
    await clock.advance(5 * 60_000)
    ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('a roster that cannot be read is skipped', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ deny: 'no roster' }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('spawns and turns', () => {
  test('a spawn names a planet; a known one keeps what it has', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    let answer: { model?: string; agentId?: string } = { agentId: 'unused' }
    on('agent.spawn', () => answer as never)
    await $.session.start(START)

    // Its step came first: a nameless agent, then the spawn fills it in.
    await step($, 'claude-haiku-5', 'k')
    answer = { model: '', agentId: 'k' }
    await $.agent.spawn({ ...SPAWN, description: 'Find the bug', subagentType: 'Explore', model: 'claude-sonnet-5' })
    // A second spawn answer for the same id changes nothing it already has.
    await $.agent.spawn({ ...SPAWN, description: 'Other', subagentType: 'Plan' })
    // No model anywhere, no type: a plain agent.
    answer = { model: '', agentId: 'n' }
    await $.agent.spawn({ ...SPAWN, description: 'Plain', subagentType: '' })
    // A spawn answered without an id adds nothing.
    answer = { deny: 'no room' } as never
    await $.agent.spawn({ ...SPAWN, description: 'Ghost', subagentType: 'Explore' })

    const ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('2 orbiting')
    expect(svg).toContain('>Find the bug<')
    expect(svg).toContain('Explore · ')
    expect(svg).toContain('>Plain<')
    expect(svg).toContain('agent · ')
    expect(svg).not.toContain('Ghost')
    expect(svg).not.toContain('Other')
    await ui.unmount()
  })

  test('a known agent spawned again without a type keeps its own', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'k' }))
    await $.session.start(START)
    await step($, 'claude-haiku-5', 'k')
    await $.agent.spawn({ ...SPAWN, description: 'Untyped', subagentType: '' })
    const ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('>Untyped<')
    expect(svg).toContain('agent · ')
    await ui.unmount()
  })

  test('a spawn with nothing beneath falls through its catch', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    await $.session.start(START)
    await expect($.agent.spawn({ ...SPAWN, description: 'x', subagentType: 'Explore' })).rejects.toThrow()
  })

  test('the main loop lights the sun; its turn end dims it; agents finish by reason', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5', agentId: e.description }))
    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await step($, 'claude-opus-5-5')
    await step($, 'none')
    await $.agent.spawn({ ...SPAWN, description: 'ok', subagentType: 'Explore' })
    await $.agent.spawn({ ...SPAWN, description: 'bad', subagentType: 'Explore' })
    await clock.advance(1000)

    let ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    // 400 tokens over the 20 s window: 20 a second, a faster sun.
    expect(svg).toContain(`animation:orsun ${(2.2 - 20 / 60).toFixed(2)}s`)
    await ui.unmount()

    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'a', reason: 'answer', agentId: 'ok' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'b', reason: 'error', agentId: 'bad' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'c', reason: 'answer', agentId: 'stranger' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    // The sun's samples age out of the window.
    await clock.advance(21_000)
    ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('animation:orsun 4s')
    expect(svg).toContain('0 orbiting · 1 done · 1 failed')
    await ui.unmount()
  })

  test('a state that refuses writes never breaks the hooks; the refused write lands later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'a1' }))
    let isFrozen = true
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'frozen' } : next(e)))
    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.agent.spawn({ ...SPAWN, description: 'x', subagentType: 'Explore' })
    await clock.advance(1000)
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: '' })
    await clock.settle()
    // The same moment again: nothing changed, yet the refused snapshot is written now.
    isFrozen = false
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...band() })
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('1 orbiting')
    await ui.unmount()
  })
})
