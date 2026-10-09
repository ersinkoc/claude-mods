import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { SkiesSnap, Weather } from '../types'
import { climate, forecast } from '../hooks/climate.ts'
import { skySvg } from '../hooks/svg.ts'

function basics(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const usage = (percent: number | undefined, rateLimits: { kind: string; percentUsed: number }[] = []) => ({
  value: { startedAt: 0, context: { tokens: 1, window: 100, ...(percent === undefined ? {} : { percent }) }, rateLimits },
})

// A clock by hand: each `now` call takes the next entry of `script` (true
// throws) and answers `now` once it is empty; each `every` tick waits for
// the test to release it.
function handClock(on: On, now: number) {
  const st = { now, script: [] as boolean[], ticks: [] as (() => void)[] }
  on('clock.now', () => {
    if (st.script.shift() === true) throw new Error('clock gone')
    return { value: st.now }
  })
  on('clock.every', async () => {
    await new Promise<void>(r => st.ticks.push(r))
    return { value: undefined }
  })
  return st
}

const later = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout
const flush = () => new Promise<void>(r => later(r, 20))

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }
const DONE = { answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' as const }

const snapOf = (weather: Weather, extra: Partial<SkiesSnap> = {}): SkiesSnap => ({
  weather,
  failed: 0,
  total: 3,
  ctx: 20,
  fiveHour: null,
  staleMin: null,
  isWorking: true,
  since: 0,
  ...extra,
})

describe('climate and sky edges', () => {
  test('unknown context and limits count as none', async () => {
    expect(climate({ results: [], ctx: null, fiveHour: null, staleMin: null, hour: 12, isWorking: true })).toBe('clear')
  })

  test('a long stall while working shows in the forecast', async () => {
    expect(forecast(snapOf('cloudy', { staleMin: 5 }))).toBe('⛅ Cloudy · 0/3 tools failed · ctx 20 % · 5 min since a tool worked')
    expect(forecast(snapOf('cloudy', { staleMin: 5, isWorking: false }))).toBe('⛅ Cloudy · 0/3 tools failed · ctx 20 %')
  })

  test('every weather paints its own desktop sky', async () => {
    const marks: Record<Weather, string> = {
      clear: 'class="bird"',
      fair: 'class="drift"',
      cloudy: 'fill="#94a3b8"',
      rain: 'class="fall"',
      storm: 'class="bolt"',
      fog: 'class="fog"',
      night: 'class="tw"',
      rainbow: 'class="arc"',
    }
    for (const [w, mark] of Object.entries(marks) as [Weather, string][]) {
      const pic = skySvg(snapOf(w), 400)
      expect(pic.source).toContain(mark)
      expect(pic.alt).toBe(`Skies: ${forecast(snapOf(w))}`)
    }
    expect(skySvg(snapOf('clear'), 10).width).toBe(280)
  })
})

describe('register edges', () => {
  test('on a POSIX host the zone comes from date +%z: a late idle hour is night', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 5, 1, 20) })
    mock.store(on)
    mock.env(on, {})
    basics(on)
    const argvs: string[][] = []
    on('process.run', ($, e) => {
      argvs.push([...e.argv])
      return ran('+0300\n')
    })
    on('session.usage', () => usage(10))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: ☀ Clear · no tools yet · ctx 10 %')
    await $.turn.complete(DONE)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toMatch(/^Skies: 🌙 Night/)
    expect(argvs).toEqual([['date', '+%z']])
    await desk.unmount()
  })

  test('a zone probe that fails or throws falls back; a subagent turn changes nothing', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    let calls = 0
    on('process.run', () => {
      calls++
      if (calls > 1) throw new Error('no shell')
      return ran('', 1)
    })
    on('session.usage', () => usage(undefined, [{ kind: 'seven_day', percentUsed: 40 }]))
    await $.session.start(START)
    await flush()
    await $.session.start(START)
    await flush()
    expect(calls).toBe(2)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    // Working: never night, whatever the zone; no context figure, no 5-hour window.
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: ☀ Clear · no tools yet')
    await $.turn.complete({ ...DONE, agentId: 'ag1' })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: ☀ Clear · no tools yet')
    await desk.unmount()
  })

  test('nothing shows before work starts; a usage read that fails keeps none', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    on('process.run', () => ran('0\r\n'))
    on('session.usage', () => {
      throw new Error('no usage')
    })
    await $.session.start(START)
    await $.turn.complete(DONE)
    await clock.advance(2000)
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: ☀ Clear · no tools yet')
    await desk.unmount()
  })

  test('the timer reads usage while work goes on, and a stall turns to rain', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    on('process.run', () => ran('0\r\n'))
    let pct = 10
    on('session.usage', () => usage(pct, [{ kind: 'five_hour', percentUsed: 12.4 }]))
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a' })
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    pct = 50
    await clock.advance(2000)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: 🌤 Fair · 0/1 tools failed · ctx 50 % · 5h 12 %')
    await clock.advance(11 * 60_000)
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: 🌧 Rain · 0/1 tools failed · ctx 50 % · 5h 12 % · 11 min since a tool worked')
    await desk.unmount()
  })

  test('before a session the zone is UTC; denials count as failures', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 5, 1, 23) })
    mock.store(on)
    basics(on)
    on('tool.call', () => ({ deny: 'no' }))
    await $.tool.call({ tool: 'Bash', command: 'x' }).catch(() => undefined)
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toBe('Skies: 🌙 Night · 1/1 tools failed')
    await desk.unmount()
  })

  test('a short band draws a one-row scene; the terminal ✕ hides; the command toggles', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.store(on, { isHidden: false })
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    on('process.run', () => ran('0\r\n'))
    on('session.usage', () => usage(10))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const term = await $.ui.mount({ plugin: 'skies', surface: 'terminal', ...BAND, props: { ...BAND.props, maxRows: 4 } })
    expect((await term.find({ type: 'Client' }))?.props.height).toBe(1)
    await term.press({ key: 'skies-hide' })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    expect((await $.command.run({ command: 'skies', args: '', ...RUN })).text).toMatch(/shown/)
    expect((await $.command.run({ command: 'skies', args: '', ...RUN })).text).toBe('Skies hidden. /skies brings it back.')
    await term.unmount()
  })

  test('a stored hide is restored; a failing store hides for the session', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 5, 1, 12) })
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    let isBroken = false
    on('store.get', () => ({ value: true }))
    on('store.set', () => {
      if (isBroken) throw new Error('no store')
      return { value: undefined }
    })
    on('process.run', () => ran('0\r\n'))
    on('session.usage', () => usage(10))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const desk = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    isBroken = true
    expect((await $.command.run({ command: 'skies', args: '', ...RUN })).text).toMatch(/shown/)
    // No measured width: 80 columns, 77 cells of 8 px.
    expect((await desk.find({ type: 'Svg' }))?.props.width).toBe(608)
    const survey = await $.ui.mount({ plugin: 'skies', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()
    await desk.unmount()
  })

  test('a clock that fails drops the tick, and lets a tool call through', async ($, on) => {
    const clock = handClock(on, Date.UTC(2026, 5, 1, 12))
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    basics(on)
    on('process.run', () => ran('0\r\n'))
    on('session.usage', () => usage(10))
    on('tool.call', () => ({ result: { ok: 1 } }))
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    clock.script = [true]
    clock.ticks.shift()?.()
    await flush()
    expect(clock.script).toHaveLength(0)
    clock.script = [true]
    expect((await $.tool.call({ tool: 'Read', file_path: '/w/a' })).result).toEqual({ ok: 1 })
  })
})
