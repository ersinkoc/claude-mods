import { describe, expect, mock, test } from 'claude-code/testing'

import { rng } from '../hooks/lib/kz.ts'
import { RateMeter, arrivalLine, seedStars, stepStars, warpFrame, warpSpeed, warpSvg } from '../hooks/warp.ts'

const BAND = (maxRows: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: 100, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})

describe('warp', () => {
  test('the rate meter counts tokens per second over its window', () => {
    const m = new RateMeter()
    m.add(1000, 150)
    m.add(2000, 150)
    expect(m.rate(2500)).toBe(100)
    expect(m.rate(9000)).toBe(0)
  })

  test('speed rises with the rate and the arrival line reads like a log', () => {
    expect(warpSpeed(0)).toBe(0)
    expect(warpSpeed(40)).toBeLessThan(warpSpeed(120))
    expect(warpSpeed(10_000)).toBe(1)
    expect(arrivalLine(42_000, 18_400)).toBe('⇢ arrived · 42s · 18.4k tok')
  })

  test('stars fly outward and respawn near the center', () => {
    const stars = seedStars(30, rng(3))
    const next = stepStars(stars, 1, rng(4))
    const kept = next.filter((s, i) => s.a === stars[i]?.a)
    for (const s of kept) expect(s.d).toBeGreaterThan(stars[next.indexOf(s)]?.d ?? 0)
  })

  test('a hyperspace frame is exactly as wide as asked and streaks', () => {
    const stars = seedStars(80, rng(9))
    const frame = warpFrame(stars, 60, 3, 1, -1, '▸ WARP 9.9', '')
    expect(frame).toHaveLength(3)
    for (const row of frame) expect([...row.map(r => r.s).join('')].length).toBe(60)
    const text = frame.flat().map(r => r.s).join('')
    expect(/[─═╲╱│]/.test(text)).toBe(true)
    expect(text).toContain('WARP 9.9')
  })

  test('the desktop svg flies stars by css and flashes on a jump', () => {
    const src = warpSvg({ now: 5000, speed: 0.8, rate: 90, tokens: 4000, elapsedMs: 12_000, isWorking: false, label: '⇢ arrived · 12s · 4.0k tok', flashSeq: 1 }, 700, 66)
    expect(src).toMatch(/^<svg/)
    expect(src).toContain('@keyframes fly')
    expect(src).toContain('class="ring"')
    expect(src).toContain('arrived')
  })
})

describe('register', () => {
  test('the band warps while Claude writes, flashes on arrival, then leaves', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('turn.step', async function* ($, e) {
      yield { kind: 'text' as const, index: 0, text: 'w'.repeat(1600) }
      return {
        turnId: e.turnId, index: e.index, answer: 'w', toolUses: [], stopReason: 'end_turn' as const,
        usage: { input_tokens: 10, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
      }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const quiet = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20), props: { ...BAND(20).props, isWorking: false } })
    expect(await quiet.find({ type: 'Client' })).toBeUndefined()
    await quiet.unmount()

    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) void c
    await clock.advance(600)

    const term = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20) })
    expect(await term.find({ type: 'Client', key: 'warpdrive' })).toBeDefined()
    await term.advance(400)
    expect(await term.find({ type: 'Text', text: /WARP/, in: 'warpdrive' })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'warpdrive-hide' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20) })
    const pic = await desk.find({ type: 'Svg' })
    expect(String(pic?.props.source)).toContain('tok/s')
    await desk.unmount()

    await clock.advance(41_400)
    await $.turn.complete({ answer: 'done', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(500)
    const landed = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...BAND(20), props: { ...BAND(20).props, isWorking: false } })
    await landed.advance(300)
    expect(await landed.find({ type: 'Text', text: /arrived · 42s · 600 tok/, in: 'warpdrive' })).toBeDefined()
    await landed.unmount()

    const flash = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20), props: { ...BAND(20).props, isWorking: false } })
    expect(String((await flash.find({ type: 'Svg' }))?.props.source)).toContain('arrived')
    await flash.press({ key: 'warpdrive-hide' })
    expect(await flash.find({ type: 'Svg' })).toBeUndefined()
    await flash.unmount()

    const r = await $.command.run({ command: 'warpdrive', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(r.text).toMatch(/engaged/)

    // Five seconds after the jump the band is gone.
    await clock.advance(6000)
    const later = await $.ui.mount({ plugin: 'warpdrive', surface: 'desktop', ...BAND(20), props: { ...BAND(20).props, isWorking: false } })
    expect(await later.find({ type: 'Svg' })).toBeUndefined()
    await later.unmount()
  })

  test('a survey holds the band', async ($, on) => {
    mock.clock(on, { now: 5_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const band = BAND(20)
    const term = await $.ui.mount({ plugin: 'warpdrive', surface: 'terminal', ...band, props: { ...band.props, hasSurvey: true } })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })
})
