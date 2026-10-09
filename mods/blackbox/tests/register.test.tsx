import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { BbTurn } from '../types'
import { addBar, addTick, axisSpan, axisTicks, fmtAxis, paint, pickLanes } from '../hooks/timeline.ts'

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

const blank = (): BbTurn => ({ turnId: 't', startedAt: 0, endedAt: null, lanes: ['main'], labels: {}, bars: [], ticks: [] })

describe('timeline', () => {
  test('the axis runs to the next round span while live and fits the turn once done', async () => {
    expect(axisSpan(0, true)).toBe(5000)
    expect(axisSpan(7000, true)).toBe(10_000)
    expect(axisSpan(42_000, true)).toBe(45_000)
    expect(axisSpan(44_000, true)).toBe(60_000)
    expect(axisSpan(42_000, false)).toBe(42_000)
    expect(axisTicks(60_000, 4)).toEqual([0, 15_000, 30_000, 45_000, 60_000])
    expect(fmtAxis(90_000)).toBe('1m30')
    expect(fmtAxis(42_000)).toBe('42s')
  })

  test('lanes: main first, then the busiest agents, the rest counted', async () => {
    const t = blank()
    for (const [lane, at] of [['a', 1], ['b', 5], ['c', 3], ['d', 9]] as const) addTick(t, lane, at)
    expect(pickLanes(t, 3)).toEqual({ lanes: ['main', 'b', 'd'], hidden: 2 })
    expect(pickLanes(t, 9).hidden).toBe(0)
  })

  test('the raster has an axis row plus a row per lane', async () => {
    const t = blank()
    addBar(t, { lane: 'main', tool: 'Bash', s: 1000, e: 4000, isError: false })
    addBar(t, { lane: 'x', tool: 'Read', s: 2000, e: null, isError: false })
    const f = paint(t, 6000, 80, 3, true)
    expect(f.rows).toBe(3)
    expect(f.columns).toBe(80)
    expect(f.cells.length).toBe(Math.ceil((80 * 3 * 12) / 3) * 4)
  })
})

describe('register', () => {
  test('a turn is recorded live, drawn on both surfaces, kept dimmed after, and ✕ hides it', async ($, on) => {
    const clock = mock.clock(on, { now: 5_000_000 })
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [{ id: 'ag1', description: 'Explore the repo', type: 'Explore', status: 'running' as const }] }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: null }
    })
    on('tool.call', async ($, e) => {
      await clock.sleep(e.tool === 'Bash' ? 3000 : 1000)
      return e.tool === 'Bash' ? { isError: true as const, result: undefined, text: 'exit 1' } : { result: { ok: true } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) void c
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId: 'ag1' })) void c
    const bash = $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.advance(1000)
    const read = $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    await clock.advance(3000)
    await Promise.all([bash, read])
    await clock.advance(1000)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'blackbox', surface, ...BAND })
      if (surface === 'terminal') expect(await ui.find({ type: 'Raster' })).toBeDefined()
      else {
        const pic = await ui.find({ type: 'Svg' })
        expect(String(pic?.props.alt)).toMatch(/recording/)
        expect(String(pic?.props.source)).toMatch(/REC/)
      }
      await ui.unmount()
    }

    await $.turn.complete({ answer: '', durationMs: 6000, isAborted: false, turnId: 't1', reason: 'answer' })
    const desk = await $.ui.mount({ plugin: 'blackbox', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toMatch(/LAST TURN/)
    await desk.press({ key: 'blackbox-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
    expect((await $.command.run({ command: 'blackbox', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text).toMatch(/shown/)
  })

  test('nothing shows before the first turn', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'blackbox', surface, ...BAND })
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      await ui.unmount()
    }
  })
})
