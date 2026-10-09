import { describe, expect, mock, test } from 'claude-code/testing'

import { NUDGE, bandSvg, parseChapter, railRuns } from '../hooks/story.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} },
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-storyboard',
  props: { title: 'KOZMOS · Storyboard', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const COMPOSE = (tools: string[]) => ({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal' as const], tools, outputStyle: null, traits: [] })
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('story', () => {
  test('a chapter call is read strictly', () => {
    expect(parseChapter({ title: 'Wire it', phase: 'nope' }, 0)).toContain('phase must be')
    expect(parseChapter({ phase: 'plan' }, 0)).toContain('title')
    const c = parseChapter({ title: 'Wire it', phase: 'build', step: 9, steps: 5, note: ' ' }, 7)
    expect(c).toEqual({ title: 'Wire it', phase: 'build', step: 5, steps: 5, at: 7 })
  })

  test('the nudge stays short', () => {
    expect(NUDGE.split(/\s+/).length).toBeLessThanOrEqual(60)
  })

  test('the rail marks the active stage and shortens when narrow', () => {
    const wide = railRuns('build', 100)
    expect(wide.find(r => r.bold)?.text).toBe('◉ BUILD')
    expect(railRuns('plan', 40).map(r => r.text).join('')).toContain('◉ PLAN')
    const svgSrc = bandSvg({ title: 'A <b> & c', phase: 'verify', step: 3, steps: 5, at: 0 }, 700).source
    expect(svgSrc).toContain('orbb')
    expect(svgSrc).toContain('A &lt;b&gt; &amp; c')
  })
})

describe('register', () => {
  test('the tool, the prompt section, the band and the log', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    let registered = ''
    let deferred: unknown
    on('tool.register', ($, e) => {
      registered = e.name
      deferred = e.isDeferred
      return { value: { tool: `mcp__storyboard__${e.name}` } }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: [] }))
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(registered).toBe('chapter')
    expect(deferred).toBe(false)

    // Before any chapter, the band adds nothing of its own.
    const quiet = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...BAND })
    expect(await quiet.find({ type: 'Text', text: /explore/ })).toBeUndefined()
    await quiet.unmount()

    const composed = await $.prompt.compose(COMPOSE(['Read', 'mcp__storyboard__chapter']))
    const nudge = composed.sections.find(s => s.id === 'storyboard:nudge')
    expect(nudge?.scope).toBe('session')
    const without = await $.prompt.compose(COMPOSE(['Read']))
    expect(without.sections.some(s => s.id === 'storyboard:nudge')).toBe(false)

    const bad = await $.tool.call({ tool: 'mcp__storyboard__chapter', title: 'x', phase: 'dance' })
    expect(String(bad.result)).toContain('not noted')
    const ok = await $.tool.call({ tool: 'mcp__storyboard__chapter', title: 'Wire the band', phase: 'build', step: 3, steps: 5, note: 'stacking under the others' })
    expect(ok.result).toBe('noted')

    const term = await $.ui.mount({ plugin: 'storyboard', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /Wire the band/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /◉ BUILD/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /stacking under/ })).toBeDefined()
    expect(await term.find({ type: 'Box', key: 'engine' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'storyboard', surface: 'desktop', ...BAND })
    const svgEl = await desk.find({ type: 'Svg' })
    expect(String(svgEl?.props.source)).toContain('BUILD')
    await desk.press({ key: 'storyboard-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    const shown = await $.command.run({ command: 'storyboard', args: '', ...RUN })
    expect(shown.text).toContain('shown')
    const opened = await $.command.run({ command: 'storyboard', args: 'log', ...RUN })
    expect(opened.text).toContain('open')
    const printed = await $.command.run({ command: 'storyboard', args: 'list', ...RUN })
    expect(printed.text).toContain('Wire the band')

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'storyboard', surface, ...PANE })
      expect(await pane.find({ type: surface === 'terminal' ? 'Text' : 'Svg' })).toBeDefined()
      if (surface === 'terminal') expect(await pane.find({ type: 'Text', text: /Wire the band/ })).toBeDefined()
      await pane.unmount()
    }
  })
})
