import { describe, expect, mock, test } from 'claude-code/testing'

import { BADGES, emptyFacts, isGitCommit, isGitPush, isTestRun, newlyUnlocked, todosDone, turnFlags } from '../hooks/badges.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-laurels',
  props: { title: 'KOZMOS · Laurels', isFocused: false, bodyColumns: 110, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 110 } }
const TURN = { startedAt: 0, durationMs: 60_000, tools: 0, fails: 0, files: 0, steps: 1, estUsd: 0.2, input: 1000, cacheRead: 0, cacheWrite: 0, reason: 'answer' }

describe('badges', () => {
  test('the book and its checks', async () => {
    expect(BADGES.length >= 24).toBe(true)
    expect(new Set(BADGES.map(b => b.id)).size).toBe(BADGES.length)
    for (const b of BADGES) expect(b.value(emptyFacts())).toBe(0)

    expect(turnFlags({ ...TURN }, 2, 3)).toEqual(['nightOwl'])
    expect(turnFlags({ ...TURN }, 6, 6)).toEqual(['earlyBird', 'weekend'])
    expect(turnFlags({ ...TURN, tools: 3, durationMs: 8000 }, 12, 2)).toEqual(['speedDemon'])
    expect(turnFlags({ ...TURN, tools: 12, estUsd: 0.03 }, 12, 2)).toEqual(['pennyPincher'])
    expect(turnFlags({ ...TURN, input: 500, cacheRead: 95_000, cacheWrite: 1000 }, 12, 2)).toEqual(['cacheWizard'])
    expect(turnFlags({ ...TURN, durationMs: 3000 }, 12, 2)).toEqual(['haiku'])
    expect(turnFlags({ ...TURN, durationMs: 11 * 60_000, fails: 6, tools: 9 }, 12, 2)).toEqual(['deepThinker', 'undaunted'])

    expect(isGitCommit('git commit -m "x"')).toBe(true)
    expect(isGitCommit('cd a && git -C repo commit -am wip')).toBe(true)
    expect(isGitCommit('git log --grep commit')).toBe(false)
    expect(isGitPush('git push origin main')).toBe(true)
    expect(isTestRun('npm test')).toBe(true)
    expect(isTestRun('cargo test --all')).toBe(true)
    expect(isTestRun('npm run build')).toBe(false)
    expect(todosDone([{ content: 'a', status: 'in_progress' }], [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }])).toBe(2)

    const f = emptyFacts()
    f.maxRunning = 5
    f.life.turns = 1
    expect(newlyUnlocked(f, {}).map(b => b.id)).toEqual(['first-light', 'hydra'])
    expect(newlyUnlocked(f, { hydra: 1 }).map(b => b.id)).toEqual(['first-light'])
  })
})

describe('register', () => {
  test('unlocks toast, burst on both surfaces, persist, and the gallery', async ($, on) => {
    const clock = mock.clock(on, { now: new Date(2026, 9, 9, 14, 0).getTime() })
    mock.store(on, {})
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: clock.now() - 60_000, context: { tokens: 1, window: 1_000_000, percent: 10 }, rateLimits: [], cost: { usd: 0.5 } } }))
    on('agent.list', () => ({ value: [] }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    let shouldFail = true
    on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'npm run lint' && shouldFail ? { isError: true as const, result: 'exit 1' } : { result: 'ok' }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await clock.advance(30_000)
    await $.turn.complete({ answer: 'hello', durationMs: 30_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(toasts).toContain('🏆 First Light unlocked — the first of many')

    const term = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /UNLOCKED/, in: 'laurels-burst' })).toBeDefined()
    await term.advance(600)
    expect(await term.find({ type: 'Text', text: /first of many/, in: 'laurels-burst' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', ...BAND })
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('First Light')
    await desk.unmount()

    await clock.advance(6500)
    const gone = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', ...BAND })
    expect(await gone.find({ type: 'Svg' })).toBeUndefined()
    await gone.unmount()

    // Red, then green with the same command; a commit too.
    await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
    shouldFail = false
    await $.tool.call({ tool: 'Bash', command: 'npm  run lint' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: laurels"' })
    expect(toasts.some(t => t.startsWith('🏆 Bug Squasher'))).toBe(true)
    expect(toasts.some(t => t.startsWith('🏆 Committed'))).toBe(true)

    // A new session keeps what was earned.
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const opened = await $.command.run({ command: 'laurels', args: '', ...RUN })
    expect(opened.text).toBe(`Laurels: 3/${BADGES.length} unlocked.`)
    const pane = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', ...PANE })
    expect(await pane.find({ type: 'Text', text: new RegExp(`3/${BADGES.length}`) })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Bug Squasher/ })).toBeDefined()
    await pane.unmount()
    const gallery = await $.ui.mount({ plugin: 'laurels', surface: 'desktop', ...PANE })
    const svgs = await gallery.findAll({ type: 'Svg' })
    expect(svgs.length > 3).toBe(true)
    expect(String(svgs[1]?.props.source)).toContain('shn')
    await gallery.unmount()
  })
})
