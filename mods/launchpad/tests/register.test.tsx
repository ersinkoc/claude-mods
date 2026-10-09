import { describe, expect, mock, test } from 'claude-code/testing'

import { bump, frequentTiles, parseArgs, promptCardSvg } from '../hooks/pad.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-launchpad',
  props: { title: 'KOZMOS · Launchpad', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('pad', () => {
  test('arguments parse into actions', () => {
    expect(parseArgs('')).toEqual({ kind: 'toggle' })
    expect(parseArgs('save  fix the flaky test ')).toEqual({ kind: 'save', text: 'fix the flaky test' })
    expect(parseArgs('rm 2')).toEqual({ kind: 'rm', index: 1 })
    expect(parseArgs('rm x').kind).toBe('help')
    expect(parseArgs('pin /commit')).toEqual({ kind: 'pin', name: 'commit' })
  })

  test('frequent ranks by count, leaves pins and unknown commands out', () => {
    let counts = bump({}, 'review', 1)
    counts = bump(counts, 'review', 2)
    counts = bump(counts, 'commit', 3)
    counts = bump(counts, 'gone', 4)
    const d = { counts, pinned: ['commit'], saved: [], known: { review: 'Review', commit: 'Commit' }, hasList: true }
    expect(frequentTiles(d).map(t => t.name)).toEqual(['review'])
  })

  test('a saved prompt card escapes its text', () => {
    expect(promptCardSvg('use <script> & "quotes"', 0, 400)).toContain('&lt;script&gt; &amp; &quot;quotes&quot;')
  })
})

describe('register', () => {
  test('learns commands, launches them, fills saved prompts', async ($, on) => {
    mock.clock(on, { now: 5_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({ value: [
      { name: 'review', description: 'Review the diff', source: 'builtin' as const },
      { name: 'commit', description: 'Create a git commit', source: 'plugin' as const, plugin: 'commit' },
    ] }))
    const ran: string[] = []
    on('command.run', ($, e) => {
      ran.push(`${e.origin.kind}:${e.command}`)
      return { text: `ran ${e.command}` }
    })
    let filled = ''
    on('prompt.fill', ($, e) => {
      filled = e.text
      return { isFilled: true }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'review', args: '', ...RUN })
    await $.command.run({ command: 'review', args: '', ...RUN })
    await $.command.run({ command: 'commit', args: '', ...RUN })
    await $.command.run({ command: 'review', args: '', origin: { kind: 'sdk' }, presentation: RUN.presentation })

    expect((await $.command.run({ command: 'launchpad', args: 'save Explain this repo to me', ...RUN })).text).toContain('Saved as prompt 1')
    const list = await $.command.run({ command: 'launchpad', args: 'list', ...RUN })
    expect(list.text).toContain('/review ×2')
    expect(list.text).toContain('/commit ×1')
    expect((await $.command.run({ command: 'launchpad', args: 'pin commit', ...RUN })).text).toContain('Pinned')
    expect((await $.command.run({ command: 'launchpad', args: '', ...RUN })).text).toContain('open')

    const term = await $.ui.mount({ plugin: 'launchpad', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /PINNED/ })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'run-review' })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'run-commit' })).toBeDefined()
    await term.press({ key: 'run-review' })
    expect(ran).toContain('plugin:review')
    await term.press({ key: 'fill-0' })
    expect(filled).toBe('Explain this repo to me')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'launchpad', surface: 'desktop', ...PANE })
    const cards = await desk.findAll({ type: 'Svg' })
    expect(cards.some(c => String(c.props.source).includes('/review'))).toBe(true)
    expect(cards.some(c => String(c.props.source).includes('Explain this repo'))).toBe(true)
    expect(await desk.find({ type: 'Button', key: 'unpin-commit' })).toBeDefined()
    await desk.press({ key: 'rm-0' })
    expect(await desk.find({ type: 'Button', key: 'fill-0' })).toBeUndefined()
    await desk.unmount()
  })
})
