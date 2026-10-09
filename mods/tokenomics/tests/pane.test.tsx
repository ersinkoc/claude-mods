import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const PANE_ID = 'kz-tokenomics'
const props = (bodyColumns: number) => ({
  title: 'KOZMOS · Tokenomics', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {},
})
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)

type Tokens = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const ZERO: Tokens = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function world(on: On, cost: () => number | undefined, tokens: () => Tokens): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    const c = cost()
    return { value: { startedAt: T0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [], ...(c === undefined ? {} : { cost: { usd: c } }) } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: e.model, ...tokens() } }
  })
  on('turn.complete', () => ({ text: '' }))
}

describe('pane', () => {
  test('with nothing published yet the pane draws a blank session at its floor width', async ($, on) => {
    mock.clock(on, { now: T0 })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tokenomics', surface, component: 'Pane', requestId: PANE_ID, props: props(0) })
      if (surface === 'terminal') {
        const rule = await ui.find({ type: 'Text', text: /── by model / })
        expect(rule?.text.length).toBe(40)
        expect(await ui.find({ type: 'Text', text: /learning the pace…/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /no turn yet/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ —$/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(4)
        expect(String(svgs[0]?.props.source)).toContain('cost per turn appears after two turns')
        expect(String(svgs[0]?.props.alt)).toContain('pace unknown')
        expect(String(svgs[1]?.props.source)).toContain('no request priced yet')
        expect(String(svgs[1]?.props.alt)).toContain('nothing yet')
        expect(String(svgs[2]?.props.alt)).toContain('cache hit unknown')
        expect(String(svgs[3]?.props.source)).toContain('days fill in as sessions spend')
      }
      await ui.unmount()
    }
  })

  test('a working turn pulses; a model that cost nothing reads 0%', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => undefined, () => ZERO)
    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tokenomics', surface, component: 'Pane', requestId: PANE_ID, props: props(44) })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /● burning/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ 0%$/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        const [head, model, , days] = svgs.map(x => String(x.props.source))
        expect(head).toContain('class="pulse"')
        expect(model).toContain('class="spin"')
        // No arc for a model with no spend, and its share reads 0%.
        expect(model).not.toContain('rotate(-90')
        expect(model).toContain('>0%<')
        expect(days).toContain('class="pulse"')
      }
      await ui.unmount()
    }
  })

  test('two turns draw the per-turn chart; one paid model fills the ring', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    let cost = 0
    world(on, () => cost, () => ({ ...ZERO, input_tokens: 250_000, output_tokens: 10_000 }))
    await $.session.start(START)
    for (const [i, c] of [[1, 0.4], [2, 1.0]] as const) {
      await $.turn.start({ text: 'go', turnId: `t${i}` })
      const s = $.turn.step({ turnId: `t${i}`, index: 0, model: 'claude-opus-5-5', messageCount: i })
      for await (const _ of s) void _
      await s.result
      cost = c
      await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: `t${i}`, reason: 'answer' })
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'tokenomics', surface, component: 'Pane', requestId: PANE_ID, props: props(44) })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /2 turns · 2 requests/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /last \$0\.60/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /avg \$0\.50 · max \$0\.60/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^ 100%$/ })).toBeDefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        const head = String(svgs[0]?.props.source)
        expect(head).toContain('per turn · max $0.60')
        expect(head).toMatch(/<path d="M[\d.,L]+L/)
        expect(String(svgs[0]?.props.alt)).toContain('2 turns')
        const model = String(svgs[1]?.props.source)
        // One model: its arc runs the whole ring, no gap.
        const C = (2 * Math.PI * 34).toFixed(2)
        expect(model).toContain(`stroke-dasharray="${C} 0.00"`)
        expect(model).toContain('>100%<')
      }
      await ui.unmount()
    }
  })
})
