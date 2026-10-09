import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { climate, forecast, localHour, nextRainbow, parseOffset } from '../hooks/climate.ts'
import type { ClimateFacts } from '../hooks/climate.ts'
import { frame } from '../hooks/scene.tsx'

function engineBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

const calm: ClimateFacts = { results: [], ctx: 10, fiveHour: 10, staleMin: 0, hour: 14, isWorking: true }
const fails = (n: number, of = 20): boolean[] => Array.from({ length: of }, (_, i) => i < n)

describe('climate', () => {
  test('each pressure has its weather', async () => {
    expect(climate(calm)).toBe('clear')
    expect(climate({ ...calm, ctx: 45 })).toBe('fair')
    expect(climate({ ...calm, results: fails(1) })).toBe('cloudy')
    expect(climate({ ...calm, ctx: 70 })).toBe('cloudy')
    expect(climate({ ...calm, results: fails(3) })).toBe('rain')
    expect(climate({ ...calm, fiveHour: 88 })).toBe('rain')
    expect(climate({ ...calm, staleMin: 12 })).toBe('rain')
    expect(climate({ ...calm, staleMin: 12, isWorking: false })).toBe('clear')
    expect(climate({ ...calm, results: fails(6) })).toBe('storm')
    expect(climate({ ...calm, fiveHour: 97 })).toBe('storm')
    expect(climate({ ...calm, ctx: 91 })).toBe('fog')
    expect(climate({ ...calm, ctx: 91, results: fails(6) })).toBe('storm')
  })

  test('night falls late when nothing runs, only over calm or cloudy skies', async () => {
    expect(climate({ ...calm, hour: 23, isWorking: false })).toBe('night')
    expect(climate({ ...calm, hour: 3, isWorking: false, results: fails(1) })).toBe('night')
    expect(climate({ ...calm, hour: 23, isWorking: true })).toBe('clear')
    expect(climate({ ...calm, hour: 23, isWorking: false, results: fails(3) })).toBe('rain')
  })

  test('the window is the last twenty calls', async () => {
    expect(climate({ ...calm, results: [...fails(6, 6), ...Array.from({ length: 20 }, () => false)] })).toBe('clear')
  })

  test('a storm that clears leaves a rainbow for thirty seconds, even through rain', async () => {
    const none = { until: 0, stormAt: undefined }
    const stormy = nextRainbow('clear', 'storm', 1000, none)
    expect(stormy).toEqual({ until: 0, stormAt: 1000 })
    const easing = nextRainbow('storm', 'rain', 5000, stormy)
    expect(easing.until).toBe(0)
    const cleared = nextRainbow('rain', 'cloudy', 9000, easing)
    expect(cleared).toEqual({ until: 39_000, stormAt: undefined })
    expect(nextRainbow('cloudy', 'clear', 10_000, cleared).until).toBe(39_000)
    // Plain rain clearing, with no storm before it, brings no bow.
    expect(nextRainbow('rain', 'clear', 9000, none).until).toBe(0)
  })

  test('forecast line, time zones', async () => {
    expect(forecast({ weather: 'storm', failed: 6, total: 20, ctx: 91, fiveHour: 88, staleMin: 1, isWorking: true, since: 0 })).toBe('⛈ Storm · 6/20 tools failed · ctx 91 % · 5h 88 %')
    expect(forecast({ weather: 'clear', failed: 0, total: 0, ctx: null, fiveHour: null, staleMin: null, isWorking: false, since: 0 })).toBe('☀ Clear · no tools yet')
    expect(parseOffset('+0300\n')).toBe(180)
    expect(parseOffset('-05:30')).toBe(-330)
    expect(parseOffset('180\r\n')).toBe(180)
    expect(parseOffset('nope')).toBeUndefined()
    expect(localHour(Date.UTC(2026, 0, 1, 21, 30), 180)).toBe(0)
  })

  test('every weather paints something into three rows', async () => {
    for (const w of ['clear', 'fair', 'cloudy', 'rain', 'storm', 'fog', 'night', 'rainbow'] as const) {
      const f = frame(w, 60, 17)
      expect(f.px.length).toBe(60 * 6)
      expect(f.px.some(Boolean) || f.glyphs.some(Boolean)).toBe(true)
    }
  })
})

describe('register', () => {
  test('failures gather into a storm on both surfaces; ✕ and /skies hide and show it', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: '0\r\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 300_000, window: 1_000_000, percent: 30 }, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }] } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('tool.call', ($, e) => (e.tool === 'Bash' ? { isError: true as const, result: undefined, text: 'no' } : { result: {} }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const desk0 = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    expect(await desk0.find({ type: 'Svg' })).toBeUndefined()
    await desk0.unmount()

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/Clear/)

    for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Bash', command: 'false' })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: ⛈ Storm · 6/7 tools failed · ctx 30 % · 5h 20 %')

    const term = await $.ui.mount({ plugin: 'skies', surface: 'terminal', ...BAND })
    await term.advance(200)
    expect(await term.find({ type: 'Text', text: /Storm/, in: 'skies-scene' })).toBeDefined()
    await term.unmount()

    // Good calls push the failures out of the window: the storm eases, then clears into a rainbow.
    for (let i = 0; i < 20; i++) await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/Rainbow/)
    await clock.advance(32_000)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/Clear/)

    await desk.press({ key: 'skies-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    expect((await $.command.run({ command: 'skies', args: '', ...RUN })).text).toMatch(/shown/)
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
  })
})
