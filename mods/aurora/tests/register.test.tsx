import { describe, expect, mock, test } from 'claude-code/testing'

import { auroraFrame, auroraSvg, curtain, isLit, labelLines, levelOf } from '../hooks/lights.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 96, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}

describe('lights', () => {
  test('effort sets the intensity', () => {
    expect(levelOf('low')).toBeLessThan(levelOf('high'))
    expect(levelOf('max')).toBe(1)
    expect(levelOf(undefined)).toBe(0.5)
    expect(isLit('thinking')).toBe(true)
    expect(isLit('tool-use')).toBe(false)
  })

  test('max effort moves the curtain more than low effort', () => {
    const swing = (lv: number) => {
      const e = Array.from({ length: 40 }, (_, x) => curtain(x, 2, lv, 'thinking').edge)
      return Math.max(...e) - Math.min(...e)
    }
    expect(swing(1)).toBeGreaterThan(swing(0.25))
  })

  test('the frame fills the band and the label reads thinking · effort · seconds', () => {
    const frame = auroraFrame(1.5, 50, 3, 0.85, 'thinking')
    expect(frame).toHaveLength(3)
    for (const row of frame) expect(row.map(s => s.s).join('').length).toBe(50)
    expect(frame.flat().map(s => s.s).join('')).toMatch(/[▀▔█▓▒░]/)
    const label = labelLines('thinking', 'xhigh', 12.4, 0.85, 2, 0).flat().map(s => s.s).join('')
    expect(label).toContain('thinking')
    expect(label).toContain('12s')
    expect(label).toContain('xhigh')
  })

  test('the desktop drawing drifts blurred curtains with CSS', () => {
    const src = auroraSvg('thinking', 'max', 1, 7, 12_000, 760, 72)
    expect(src).toContain('feGaussianBlur')
    expect(src).toContain('@keyframes audrift')
    expect(src).toContain('thinking')
  })
})

describe('register', () => {
  test('thinking chunks light the aurora on both surfaces; the end of the step puts it out', async ($, on) => {
    mock.clock(on, { now: 3_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.step', async function* (_$, e) {
      yield { kind: 'thinking' as const, index: 0, text: 'Let me consider' }
      yield { kind: 'text' as const, index: 1, text: 'Done.' }
      return { turnId: e.turnId, index: e.index, answer: 'Done.', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const idle = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...BAND })
    expect(await idle.find({ type: 'Client' })).toBeUndefined()
    await idle.unmount()

    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
    const first = await stream.next()
    expect(first.value).toMatchObject({ kind: 'thinking' })

    const term = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client', key: 'aurora' })).toBeDefined()
    await term.advance(100)
    expect(await term.find({ type: 'Text', text: /thinking/, in: 'aurora' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /xhigh/, in: 'aurora' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'aurora', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('thinking')
    await desk.unmount()

    // The reply streams: a calmer wave.
    await stream.next()
    const reply = await $.ui.mount({ plugin: 'aurora', surface: 'desktop', ...BAND })
    expect(String((await reply.find({ type: 'Svg' }))?.props.source)).toContain('responding')
    await reply.unmount()

    for await (const _ of stream) void _
    const after = await $.ui.mount({ plugin: 'aurora', surface: 'terminal', ...BAND })
    expect(await after.find({ type: 'Client' })).toBeUndefined()
    await after.unmount()
  })
})
