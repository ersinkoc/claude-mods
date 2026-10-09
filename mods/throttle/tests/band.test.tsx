import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

// Nothing beneath the plugins draws the band: an empty Box stands for the engine's.
function engineBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 110, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

/** The session beneath: a store, the engine's band, and usage with no limits, context or cost. */
function bare(on: On, store: Record<string, unknown> = {}): void {
  mock.store(on, store)
  engineBand(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

/** The props the band handed its terminal Client. */
async function dashProps(ui: Pick<Mounted, 'find'>): Promise<Record<string, unknown> | undefined> {
  return (await ui.find({ type: 'Client' }))?.props.props as Record<string, unknown> | undefined
}

describe('the band', () => {
  test('an agent streaming thinking and tool input drives on its own; the band coasts, then leaves', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on)
    on('turn.step', async function* ($, e) {
      if (e.index === 0) {
        yield { kind: 'thinking' as const, index: 0, text: 'y'.repeat(400) }
        yield { kind: 'input' as const, index: 1, json: `{"q":"${'z'.repeat(392)}"}` }
      }
      yield { kind: 'tool' as const, index: 1, id: 'tu1', name: 'Read' }
      await clock.sleep(3000)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
    })
    on('tool.call', () => ({ deny: 'not allowed' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    // Two agent requests at once: one streams 800 characters, one only names a tool.
    const drain = async (index: number) => {
      for await (const c of $.turn.step({ turnId: 't1', index, model: 'claude-haiku-5', messageCount: 1, agentId: 'ag1' })) void c
    }
    const a = drain(0)
    const b = drain(1)
    await clock.advance(1000)
    let term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await dashProps(term)).toMatchObject({ working: true, agents: 1, fuel: null, temp: null, odo: null, engine: false })
    await term.unmount()
    await clock.advance(2000)
    await Promise.all([a, b])
    // A denied tool lights the check-engine lamp.
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
    await clock.advance(1000)
    term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    // 800 characters are 200 tokens, over the 4 s since the stream began.
    expect(await dashProps(term)).toMatchObject({ working: true, agents: 1, engine: true, speed: 50 })
    await term.unmount()

    // Five seconds after the agent's last word it no longer counts: the band coasts
    // from the last tick that still saw it.
    await clock.advance(5000)
    const desk = await $.ui.mount({ plugin: 'throttle', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('coasting · 2s')
    await desk.unmount()
    term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await dashProps(term)).toMatchObject({ working: false, agents: 0, idleSec: 2 })
    await term.unmount()

    // A minute after, it leaves.
    await clock.advance(60_000)
    term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })

  test('a hidden band stays hidden from the store; /throttle and ✕ toggle it', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on, { isHidden: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.settle()
    let term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    expect(await term.find({ key: 'engine' })).toBeDefined()
    await term.unmount()

    expect((await $.command.run({ command: 'throttle', args: '', ...RUN })).text).toBe('Throttle shown: it appears while Claude works and for a minute after.')
    term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    // No width given: 80 columns, less the ✕.
    expect((await term.find({ type: 'Client' }))?.props.width).toBe(77)
    expect(await dashProps(term)).toMatchObject({ working: true, speed: 0, agents: 0 })
    await term.press({ key: 'throttle-hide' })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
    expect((await $.command.run({ command: 'throttle', args: '', ...RUN })).text).toBe('Throttle shown: it appears while Claude works and for a minute after.')
    expect((await $.command.run({ command: 'throttle', args: '', ...RUN })).text).toBe('Throttle hidden. /throttle brings it back.')
  })

  test('a survey above the prompt leaves the band to it', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on, { isHidden: 'garbled' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.settle()
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'throttle', surface, ...BAND, props: { ...BAND.props, hasSurvey: true } })
      expect(await ui.find({ key: 'throttle' })).toBeUndefined()
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      await ui.unmount()
    }
    // The garbled stored value was ignored: the band shows without a survey.
    const ui = await $.ui.mount({ plugin: 'throttle', surface: 'desktop', ...BAND })
    expect(await ui.find({ key: 'throttle' })).toBeDefined()
    await ui.unmount()
  })

  test('a tick that lands while the turn starts reads the usage', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const started = $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(1000)
    await started
    const term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await dashProps(term)).toMatchObject({ working: true })
    await term.unmount()
  })

  test('a snapshot that cannot be written breaks nothing', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on)
    on('state.set', { plugin: 'throttle', key: 'snap' } as const, () => ({ deny: 'frozen' }))
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(1000)
    expect(await $.tool.call({ tool: 'Bash', command: 'false' })).toMatchObject({ isError: true })
    await clock.settle()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    // An agent's end leaves the main loop alone.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'ag', reason: 'answer' })
    await clock.advance(1000)
    const term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })

  test('a request that streamed nothing but reports its tokens counts from a second before its end', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    bare(on)
    on('turn.step', async function* ($, e) {
      await clock.sleep(5000)
      return {
        turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
        usage: { input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
      }
    })
    on('tool.call', () => ({ result: { ok: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const step = (async () => {
      for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void c
    })()
    await clock.advance(5000)
    await step
    // A tool that worked leaves the check-engine lamp dark.
    expect(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })).toEqual({ result: { ok: true } })
    await clock.advance(1000)
    const term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    // 300 tokens in the second before the end, read two seconds on: 150 tok/s.
    expect(await dashProps(term)).toMatchObject({ speed: 150, working: true, engine: false })
    await term.unmount()
  })

  test('a failed tool goes through even when throttle cannot read the clock', async ($, on) => {
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))
    expect(await $.tool.call({ tool: 'Bash', command: 'false' })).toEqual({ isError: true, result: undefined, text: 'boom' })
  })
})
