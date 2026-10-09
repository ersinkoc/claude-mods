import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fuelLeft, lamps, odoDigits, speedScale, tokensPerSec } from '../hooks/model.ts'
import { dialCells } from '../hooks/dash.tsx'

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

describe('speedometer math', () => {
  test('a span is spread over its length and averaged over the part of the window that saw output', async () => {
    // 500 tokens over 5 s, read at the end: 100 tok/s.
    expect(Math.round(tokensPerSec([{ s: 0, e: 5000, tok: 500 }], 5000))).toBe(100)
    // Ten seconds later the span has left the window.
    expect(tokensPerSec([{ s: 0, e: 5000, tok: 500 }], 15_000)).toBe(0)
    // Half of a 20 s span lies in the window: 1000 of 2000 tokens over 10 s.
    expect(Math.round(tokensPerSec([{ s: 0, e: 20_000, tok: 2000 }], 20_000))).toBe(100)
    // Two loops at once add up.
    expect(Math.round(tokensPerSec([{ s: 0, e: 4000, tok: 400 }, { s: 0, e: 4000, tok: 200 }], 4000))).toBe(150)
    // A burst shorter than 2 s is not blown up.
    expect(Math.round(tokensPerSec([{ s: 9500, e: 10_000, tok: 100 }], 10_000))).toBe(50)
  })

  test('scale, fuel, lamps and odometer', async () => {
    expect(speedScale(0)).toBe(100)
    expect(speedScale(95)).toBe(200)
    expect(speedScale(350)).toBe(400)
    expect(fuelLeft([])).toBeNull()
    expect(fuelLeft([{ kind: 'seven_day', percentUsed: 10 }, { kind: 'five_hour', percentUsed: 88.5 }])).toBe(11.5)
    expect(lamps(40_000, 20_000, 11, 90)).toEqual({ engine: true, fuel: true, heat: true })
    expect(lamps(60_000, 20_000, 50, 40)).toEqual({ engine: false, fuel: false, heat: false })
    expect(odoDigits(12.345)).toBe('0012.35')
  })

  test('the braille dial puts the needle on the left at 0 and on the right at full', async () => {
    const low = dialCells(0, () => '#fff')
    const high = dialCells(1, () => '#fff')
    expect(low.length).toBe(2)
    expect(low[1]?.[1]?.color).toBe('#ff5a4f')
    expect(low[1]?.[5]?.color).not.toBe('#ff5a4f')
    expect(high[1]?.[5]?.color).toBe('#ff5a4f')
  })
})

describe('register', () => {
  test('a working turn draws the dashboard on the terminal and the desktop, and ✕ hides it', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 910_000, window: 1_000_000, percent: 91 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 88, resetsAt: '2030-01-01T00:00:00Z' }],
        cost: { usd: 12.34 },
      },
    }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      yield { kind: 'text' as const, index: 0, text: 'x'.repeat(2000) }
      await clock.sleep(4000)
      return {
        turnId: e.turnId, index: e.index, answer: 'x', toolUses: [], stopReason: 'end_turn' as const,
        usage: { input_tokens: 10, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
      }
    })
    on('tool.call', () => ({ isError: true as const, result: undefined, text: 'boom' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    const drain = (async () => {
      for await (const c of stream) void c
    })()
    await clock.advance(4000)
    await drain
    await $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.advance(1000)

    const term = await $.ui.mount({ plugin: 'throttle', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeDefined()
    await term.advance(300)
    expect(await term.find({ type: 'Text', text: /tok\/s/, in: 'throttle-dash' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /ENG/, in: 'throttle-dash' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'throttle', surface: 'desktop', ...BAND })
    const pic = await desk.find({ type: 'Svg' })
    expect(pic).toBeDefined()
    await desk.press({ key: 'throttle-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    // /throttle brings it back.
    const r = await $.command.run({ command: 'throttle', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(r.text).toMatch(/shown/)
  })

  test('nothing shows before the first turn', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'throttle', surface, ...BAND })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await ui.unmount()
    }
  })
})
