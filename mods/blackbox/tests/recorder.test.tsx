import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const T0 = 5_000_000
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const SPAWN = { tool_use_id: 'tu1', prompt: 'look', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false }

type Blit = { requestId: string; key: string }
type Bed = { blits: Blit[]; blitMode: 'ok' | 'deny' | 'throw'; agents: { id: string; description: string }[]; agentsThrow: boolean }

/** The world beneath blackbox: the engine's band, a session, turns, steps, tools and blits. */
function bed(on: On, store: Record<string, unknown> = {}): Bed {
  const b: Bed = { blits: [], blitMode: 'ok', agents: [], agentsThrow: false }
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('agent.list', () => {
    if (b.agentsThrow) throw new Error('agents down')
    return { value: b.agents.map(a => ({ ...a, type: 'Explore', status: 'running' as const })) }
  })
  on('ui.blit', ($, e) => {
    b.blits.push({ requestId: e.requestId, key: 'key' in e ? String(e.key) : '' })
    if (b.blitMode === 'throw') throw new Error('blit down')
    return { value: b.blitMode === 'deny' ? { deny: 'nothing mounted' } : {} }
  })
  mock.store(on, store)
  return b
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
const step = async ($: Engine, agentId?: string) => {
  for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })) void c
}
const complete = ($: Engine) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

describe('terminal band', () => {
  test('the band height picks the lanes; a narrow band still gets 24 columns', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step($, 'agent-one')
    await step($, 'agent-two')
    await step($, 'agent-three')
    const rowsAt = async (maxRows: number, bodyColumns = 100) => {
      const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, maxRows, bodyColumns } })
      const r = await ui.find({ type: 'Raster' })
      await ui.unmount()
      return [r?.props.rows, r?.props.columns]
    }
    expect(await rowsAt(12)).toEqual([4, 97])
    expect(await rowsAt(8)).toEqual([3, 97])
    expect(await rowsAt(4)).toEqual([2, 97])
    expect(await rowsAt(12, 0)).toEqual([4, 77])
    expect(await rowsAt(12, 10)).toEqual([4, 24])
  })

  test('a survey or no turn yet leaves the band to the engine', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test('the timer repaints the drawn Raster while the turn runs', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const b = bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    // Not drawn yet: nothing to repaint.
    await clock.advance(250)
    expect(b.blits).toHaveLength(0)
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND_PROPS })
    await clock.advance(250)
    expect(b.blits).toEqual([{ requestId: 'band', key: 'blackbox-rec' }, { requestId: 'band', key: 'blackbox-rec' }])
    // A new lane redraws the band, and the repaint goes on at its new size.
    await step($, 'agent-one')
    await clock.advance(250)
    expect(b.blits).toHaveLength(4)
    // The turn over, the timer stops.
    await complete($)
    await clock.advance(1000)
    expect(b.blits).toHaveLength(4)
    await ui.unmount()
  })

  test('a refused or failing blit stops the repaint until the band draws again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const b = bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND_PROPS })
    b.blitMode = 'deny'
    await clock.advance(500)
    expect(b.blits).toHaveLength(1)
    b.blitMode = 'throw'
    await ui.redraw()
    await clock.advance(500)
    expect(b.blits).toHaveLength(2)
    b.blitMode = 'ok'
    await ui.redraw()
    await clock.advance(250)
    expect(b.blits).toHaveLength(4)
    await ui.unmount()
  })

  test('✕ hides the band and stops the repaint; /blackbox toggles it back and forth', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const b = bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND_PROPS })
    await ui.press({ key: 'blackbox-hide' })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    const before = b.blits.length
    await clock.advance(500)
    expect(b.blits).toHaveLength(before)
    expect((await $.command.run({ command: 'blackbox', args: '', ...RUN })).text).toBe('Blackbox shown: it records each turn as it runs.')
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect((await $.command.run({ command: 'blackbox', args: '', ...RUN })).text).toBe('Blackbox hidden. /blackbox brings it back.')
    await ui.unmount()
    // Kept for the next session.
    await start($)
    await $.turn.start({ text: 'go', turnId: 't2' })
    const next = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await next.find({ type: 'Svg' })).toBeUndefined()
    await next.unmount()
  })

  test('after the turn the band shows the finished recording at its end time', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    bed(on)
    on('tool.call', async ($, e) => {
      await clock.sleep(2000)
      return { result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }
    })
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const call = $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await clock.advance(2000)
    await call
    await complete($)
    // A turn.complete for a subagent, or a second one, changes nothing.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'x' })
    await complete($)
    await clock.advance(60_000)
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const pic = await desk.find({ type: 'Svg' })
    expect(String(pic?.props.alt)).toBe('Blackbox: last turn 0:02, 1 tool calls, 0 model requests, 0 subagents')
    await desk.unmount()
    const term = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await term.find({ type: 'Raster' })).toBeDefined()
    await term.unmount()
  })
})

describe('lanes and names', () => {
  test('a spawned agent names its lane; one spawned without an id or description is handled', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5', agentId: e.description === 'none' ? undefined : e.tool_use_id === 'tu2' ? 'ag2' : 'ag1' }))
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.agent.spawn({ ...SPAWN, description: 'Survey the repo' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2', description: '' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu3', description: 'none' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'ag1' } as Parameters<Engine['tool']['call']>[0])
    await step($, 'ag2')
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const source = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(source).toContain('>Survey the repo<')
    expect(source).toContain('>Explore<')
    await desk.unmount()
  })

  test('lanes the recording cannot name are named from the agent list each second', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const b = bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step($, 'abcdef-1')
    await step($, 'ghijkl-2')
    b.agentsThrow = true
    await clock.advance(1000)
    const labels = async () => {
      const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
      const source = String((await desk.find({ type: 'Svg' }))?.props.source)
      await desk.unmount()
      return source
    }
    expect(await labels()).toContain('>agent abcdef<')
    b.agentsThrow = false
    b.agents = [{ id: 'abcdef-1', description: 'Find the bug' }, { id: 'ghijkl-2', description: '' }]
    await clock.advance(1000)
    const named = await labels()
    expect(named).toContain('>Find the bug<')
    expect(named).toContain('>agent ghijkl<')
  })

  test('with every lane named, a snapshot is taken when the axis rescales or every five seconds', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    bed(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const shown = async () => {
      const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
      const alt = String((await desk.find({ type: 'Svg' }))?.props.alt)
      await desk.unmount()
      return alt
    }
    await clock.advance(3000)
    expect(await shown()).toBe('Blackbox: recording 0:00, 0 tool calls, 0 model requests, 0 subagents')
    // At 5 s the axis grows from 5 s to 10 s: a fresh snapshot.
    await clock.advance(2000)
    expect(await shown()).toBe('Blackbox: recording 0:05, 0 tool calls, 0 model requests, 0 subagents')
    await clock.advance(4000)
    expect(await shown()).toBe('Blackbox: recording 0:05, 0 tool calls, 0 model requests, 0 subagents')
    await clock.advance(1000)
    expect(await shown()).toBe('Blackbox: recording 0:10, 0 tool calls, 0 model requests, 0 subagents')
  })
})

describe('pass-through and failures', () => {
  test('tool calls outside a turn pass straight through and are not recorded', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).result).toEqual({ ok: true })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('0 tool calls')
    await desk.unmount()
  })

  test('model steps outside a live turn are not recorded', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    await start($)
    await step($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step($)
    await complete($)
    await step($, 'late-agent')
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Blackbox: last turn 0:00, 0 tool calls, 1 model requests, 0 subagents')
    await desk.unmount()
  })

  test('a call that outlives its turn does not overwrite the next turn', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    bed(on)
    on('tool.call', async ($, e) => {
      await clock.sleep(3000)
      return { result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }
    })
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const call = $.tool.call({ tool: 'Bash', command: 'sleep 3', run_in_background: true })
    await clock.advance(1000)
    await complete($)
    await $.turn.start({ text: 'next', turnId: 't2' })
    await clock.advance(2000)
    await call
    await clock.settle()
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Blackbox: recording 0:00, 0 tool calls, 0 model requests, 0 subagents')
    await desk.unmount()
  })

  test('a denied call is recorded as failed', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    on('tool.call', ($, e) => ({ deny: 'no', tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }).catch(() => undefined)
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('1 tool calls (1 failed)')
    await desk.unmount()
  })

  test('a tool call or spawn nothing answers beneath fails through the catch unchanged', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on)
    await start($)
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).rejects.toThrow(/no implementation for tool.call/)
    await expect($.agent.spawn({ ...SPAWN, description: 'd' })).rejects.toThrow(/no implementation for agent.spawn/)
  })

  test('a stored hidden flag hides the band from the start', async ($, on) => {
    mock.clock(on, { now: T0 })
    bed(on, { isHidden: true })
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('a failing clock', () => {
  test('never escapes the timers or the snapshots, and the recording recovers', async ($, on) => {
    // A hand-run clock: each read takes the next planned outcome (true fails);
    // each period of `every` waits for the test to tick its interval.
    const plan: boolean[] = []
    const waits: { ms: number; go: () => void }[] = []
    on('clock.now', () => {
      if (plan.shift() === true) throw new Error('clock down')
      return { value: T0 }
    })
    on('clock.every', ($, e) => new Promise<{ value: undefined }>(resolve => waits.push({ ms: e.ms, go: () => resolve({ value: undefined }) })))
    const settle = () => new Promise<void>(r => (globalThis as unknown as { setTimeout(f: () => void, ms: number): void }).setTimeout(r, 20))
    const tick = async (ms: number) => {
      for (const w of waits.splice(0)) {
        if (w.ms === ms) w.go()
        else waits.push(w)
      }
      await settle()
    }
    const b = bed(on)
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ plugin: 'blackbox', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND_PROPS })
    expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(2)

    // A step whose snapshot fails: the turn has a new lane the drawn Raster lacks,
    // so the repaint waits rather than blit a frame of the wrong size.
    plan.push(false, true)
    await step($, 'agent-x')
    await settle()
    await tick(125)
    expect(b.blits).toHaveLength(0)
    // A repaint or a sync whose clock fails is dropped.
    plan.push(true)
    await tick(125)
    plan.push(true)
    await tick(1000)
    // Both snapshots of a tool call fail; the call itself goes through.
    plan.push(false, true, false, true)
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).result).toEqual({ ok: true })
    await settle()
    expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(2)

    // The clock back: the next sync names nothing but snapshots the new lane.
    await tick(1000)
    expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(3)
    await ui.unmount()
  })
})
