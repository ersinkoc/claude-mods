import { describe, expect, mock, test } from 'claude-code/testing'

import { cacheShare, percentile, reqOf, statsOf, vbars } from '../hooks/lab.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-relay',
  props: { title: 'KOZMOS · Relay', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
}

const USAGE = { input_tokens: 2000, output_tokens: 600, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 8000 }

describe('lab', () => {
  test('a request reads its latency, ttft, tokens per second and cache share', () => {
    const r = reqOf(1000, 5000, 2000, { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high' }, { stopReason: 'end_turn', usage: { ...USAGE, model: 'claude-opus-5-5' } }, 'main')
    expect(r.ms).toBe(4000)
    expect(r.ttft).toBe(1000)
    expect(r.tps).toBe(200)
    expect(Math.round(cacheShare(r) * 100)).toBe(90)
    const failed = reqOf(0, 300, undefined, { turnId: 't', index: 1, model: 'm' }, { stopReason: null, usage: null }, 'main')
    expect(failed.tps).toBeUndefined()
    expect(failed.stop).toBeNull()
  })

  test('stats give percentiles, a histogram, the model mix and the slowest', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
    const mk = (i: number, ms: number, model: string) => reqOf(i * 10_000, i * 10_000 + ms, undefined, { turnId: 't', index: i, model }, { stopReason: 'tool_use', usage: { ...USAGE, model } }, 'main')
    const st = statsOf({ reqs: [mk(0, 500, 'claude-opus-5-5'), mk(1, 3000, 'claude-opus-5-5'), mk(2, 70_000, 'claude-haiku-5')], total: 3, failed: 0 })
    expect(st.hist).toEqual([1, 0, 1, 0, 0, 0, 0, 1])
    expect(st.mix[0]).toMatchObject({ model: 'Opus 5.5', n: 2 })
    expect(st.slowest[0]?.ms).toBe(70_000)
    expect(vbars([0, 4, 8], 2)).toEqual(['  █', ' ██'])
  })
})

describe('register', () => {
  test('timed requests draw the latency lab on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'ag1' }))
    on('turn.step', async function* ($, e) {
      await clock.sleep(e.agentId ? 400 : 1200)
      yield { kind: 'text' as const, index: 0, text: 'hello' }
      await clock.sleep(e.agentId ? 600 : 3000)
      return {
        turnId: e.turnId, index: e.index, answer: 'hello', toolUses: [], stopReason: e.index === 0 ? ('tool_use' as const) : ('end_turn' as const),
        usage: { model: e.model, ...USAGE },
      }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.agent.spawn({
      tool_use_id: 'tu1', prompt: 'find the tests', description: 'Find the tests', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
    const drive = async (index: number, model: string, agentId?: string) => {
      const stream = $.turn.step({ turnId: agentId ? 'a1' : 't1', index, model, effort: agentId ? 'low' : 'high', messageCount: 1, ...(agentId ? { agentId } : {}) })
      const done = (async () => {
        for (;;) {
          const step = await stream.next()
          if (step.done) return step.value
        }
      })()
      await clock.advance(5000)
      return done
    }
    const first = await drive(0, 'claude-opus-5-5')
    expect(first.stopReason).toBe('tool_use')
    await drive(1, 'claude-opus-5-5')
    await drive(0, 'claude-haiku-5', 'ag1')

    const { text } = await $.command.run({ command: 'relay', args: 'stats', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('3 requests')
    expect(text).toContain('p95 4.2s')
    expect(text).toContain('Find the tests')

    const term = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /RELAY/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /4\.2s/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /200t\/s/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Haiku 5/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /cache 90%/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Find the tests/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /[⠁-⣿]/ })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'relay', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(7)
    expect(String(svgs[0]?.props.source)).toContain('RELAY')
    expect(String(svgs[3]?.props.source)).toContain('Opus 5.5')
    await desk.unmount()
  })

  test('no requests yet draws a hint on both surfaces', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'relay', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /No model requests timed yet/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'relay', surface: 'desktop', ...PANE })
    expect(String((await desk.findAll({ type: 'Svg' }))[6]?.props.source)).toContain('no model requests yet')
    await desk.unmount()
  })
})
