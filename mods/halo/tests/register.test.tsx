import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellColor } from '../hooks/line.tsx'
import { moodOf } from '../hooks/mood.ts'

function engineBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="spin">{e.props.word}</Text>
  })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 90, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

describe('mood', () => {
  test('waiting beats a failure beats a tool beats the model phase', async () => {
    const base = { now: 10_000, isWorking: true, isWaiting: false }
    expect(moodOf({ ...base, isWorking: false }).mood).toBe('idle')
    expect(moodOf({ ...base }).mood).toBe('flow')
    expect(moodOf({ ...base, phase: 'thinking' }).mood).toBe('think')
    expect(moodOf({ ...base, spinner: { mode: 'thinking', at: 9000 } }).mood).toBe('think')
    expect(moodOf({ ...base, spinner: { mode: 'thinking', at: 1000 } }).mood).toBe('flow')
    expect(moodOf({ ...base, tool: 'Bash', phase: 'thinking' })).toMatchObject({ mood: 'tool', label: 'Bash', color: '#4ade80' })
    expect(moodOf({ ...base, tool: 'Bash', failedAt: 8000 }).mood).toBe('error')
    expect(moodOf({ ...base, tool: 'Bash', failedAt: 5000 }).mood).toBe('tool')
    expect(moodOf({ ...base, isWaiting: true, failedAt: 9000 }).mood).toBe('wait')
  })

  test('the tool comet is brightest at its head', async () => {
    const p = { mood: 'tool' as const, color: '#4ade80', label: '' }
    // At frame 25 the head is at x = 40.
    const head = cellColor(p, 40, 100, 25, 0)
    const far = cellColor(p, 90, 100, 25, 0)
    expect(head).not.toBe(far)
  })
})

describe('register', () => {
  test('the line follows tools, failures, the spinner and waiting, on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: 2_000_000 })
    mock.store(on)
    engineBand(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('tool.call', async ($, e) => {
      await clock.sleep(1000)
      return e.tool === 'Bash' ? { isError: true as const, result: undefined, text: 'no' } : { result: {} }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const term = await $.ui.mount({ plugin: 'halo', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeDefined()
    await term.advance(100)

    const desk = await $.ui.mount({ plugin: 'halo', surface: 'desktop', ...BAND })
    const alt = async () => String((await desk.find({ type: 'Svg' }))?.props.alt)
    expect(await alt()).toBe('Halo: idle')

    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(await alt()).toBe('Halo: requesting')

    const spin = await $.ui.mount({ plugin: 'halo', surface: 'terminal', component: 'Spinner', props: { word: 'Pondering', message: null, suffix: '…', mode: 'thinking' } })
    await spin.unmount()
    await clock.advance(400)
    expect(await alt()).toBe('Halo: thinking')

    const read = $.tool.call({ tool: 'Read', file_path: '/w/a' })
    await clock.advance(10)
    expect(await alt()).toBe('Halo: Read')
    await clock.advance(1000)
    await read

    const bash = $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.advance(1000)
    await bash
    expect(await alt()).toBe('Halo: tool failed')
    await clock.advance(4500)
    expect(await alt()).not.toBe('Halo: tool failed')

    const ask = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    await clock.advance(10)
    expect(await alt()).toBe('Halo: waiting for you')
    await clock.advance(1000)
    await ask

    expect(await term.find({ type: 'Text', in: 'halo-line' })).toBeDefined()
    await desk.press({ key: 'halo-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    expect((await $.command.run({ command: 'halo', args: '', ...RUN })).text).toMatch(/shown/)
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()
    await term.unmount()
  })
})
