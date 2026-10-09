import { describe, expect, mock, test } from 'claude-code/testing'

import { DOT_MS, beatPeriod, ekgSvg, sampleTrace, traceFrame } from '../hooks/ekg.ts'

const BAND = (maxRows: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: 90, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})

describe('ekg', () => {
  test('a tool call stamps a spike at the right end of the trace', () => {
    const now = 100_000
    const { amp, col } = sampleTrace([{ at: now, k: 't', c: '#4ade80' }], now, 40)
    expect(amp[39]).toBe(1)
    expect(col[39]).toBe('#4ade80')
    const older = sampleTrace([{ at: now - 10 * DOT_MS, k: 'f', c: '#f87171' }], now, 40)
    expect(older.amp[29]).toBe(-1)
  })

  test('the braille frame is exactly as wide and tall as asked', () => {
    const frame = traceFrame([{ at: 5000, k: 't', c: '#60a5fa' }, { at: 4000, k: 's', c: '#22d3ee' }], 5200, 30, 3, 58)
    expect(frame).toHaveLength(3)
    for (const row of frame) expect(row.map(s => s.s).join('').length).toBe(30)
  })

  test('the heart beats faster with more tool calls', () => {
    expect(beatPeriod(120)).toBeLessThan(beatPeriod(40))
    expect(beatPeriod(0)).toBe(1500)
  })

  test('the desktop drawing is one glowing svg with a readout', () => {
    const src = ekgSvg({ beats: [{ at: 9000, k: 't', c: '#facc15' }], now: 10_000, bpm: 42, rpm: 7, ctx: 58, isWorking: true }, 700, 64)
    expect(src).toMatch(/^<svg/)
    expect(src).toContain('feGaussianBlur')
    expect(src).toContain('ctx 58%')
    expect(src).toContain('bpm')
  })
})

describe('register', () => {
  test('the band beats on tool calls, on the terminal and the desktop, and hides', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 580_000, window: 1_000_000, percent: 58 }, rateLimits: [] } }))
    on('tool.call', () => ({ result: 'ok' }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('command.run', () => ({ text: '' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    // Nothing happened yet: the band adds nothing.
    const quiet = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...BAND(20) })
    expect(await quiet.find({ type: 'Client' })).toBeUndefined()
    await quiet.unmount()

    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await clock.advance(400)
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })

    const term = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...BAND(20) })
    expect(await term.find({ type: 'Client', key: 'heartline' })).toBeDefined()
    await term.advance(200)
    expect(await term.find({ type: 'Text', text: /bpm/, in: 'heartline' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /58%/, in: 'heartline' })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'heartline-hide' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    const svg = await desk.find({ type: 'Svg' })
    expect(svg).toBeDefined()
    expect(String(svg?.props.source)).toContain('polyline')
    await desk.press({ key: 'heartline-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    // The command brings it back.
    await $.command.run({ command: 'heartline', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    const again = await $.ui.mount({ plugin: 'heartline', surface: 'desktop', ...BAND(20) })
    expect(await again.find({ type: 'Svg' })).toBeDefined()
    await again.unmount()
  })

  test('a survey holds the band', async ($, on) => {
    mock.clock(on, { now: 5_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
    on('tool.call', () => ({ result: 'ok' }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Grep', pattern: 'x' })
    const band = BAND(20)
    const term = await $.ui.mount({ plugin: 'heartline', surface: 'terminal', ...band, props: { ...band.props, hasSurvey: true } })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })
})
