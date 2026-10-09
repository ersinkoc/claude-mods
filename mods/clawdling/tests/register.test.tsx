import { describe, expect, mock, test } from 'claude-code/testing'

import { accessoriesAt, levelOf, moodOf, unlocksBetween, xpAtLevel } from '../hooks/clawd.ts'
import { PERIOD, STAGE_H, STAGE_W, crabFrame, frameRuns, frameSvg } from '../hooks/sprite.ts'
import type { Mood } from '../hooks/sprite.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const MOODS: Mood[] = ['idle', 'working', 'thinking', 'sad', 'hot', 'sleepy', 'dance', 'love']
const SENSES = { now: 100, loveUntil: 0, sadUntil: 0, danceUntil: 0, ctxPercent: 10, limitPercent: 10, isTurnActive: false, toolsRunning: 0 }

describe('clawd', () => {
  test('levels grow and unlock accessories', async () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 })
    expect(levelOf(99).level).toBe(1)
    expect(levelOf(100)).toEqual({ level: 2, into: 0, need: 200 })
    expect(levelOf(830)).toEqual({ level: 4, into: 230, need: 400 })
    expect(xpAtLevel(12)).toBe(6600)
    expect(accessoriesAt(4)).toEqual({ hat: true, glasses: false, scarf: false, crown: false })
    expect(accessoriesAt(12)).toEqual({ hat: true, glasses: true, scarf: true, crown: true })
    expect(unlocksBetween(2, 5).map(u => u.key)).toEqual(['hat', 'glasses'])
  })

  test('mood priority', async () => {
    expect(moodOf(SENSES)).toBe('idle')
    expect(moodOf({ ...SENSES, isTurnActive: true })).toBe('thinking')
    expect(moodOf({ ...SENSES, isTurnActive: true, toolsRunning: 1 })).toBe('working')
    expect(moodOf({ ...SENSES, danceUntil: 200 })).toBe('dance')
    expect(moodOf({ ...SENSES, limitPercent: 93 })).toBe('sleepy')
    expect(moodOf({ ...SENSES, ctxPercent: 85, limitPercent: 93 })).toBe('hot')
    expect(moodOf({ ...SENSES, ctxPercent: 85, sadUntil: 200 })).toBe('sad')
    expect(moodOf({ ...SENSES, sadUntil: 200, loveUntil: 200 })).toBe('love')
  })

  test('every mood draws every frame inside the stage', async () => {
    const acc = { hat: true, glasses: true, scarf: true, crown: false }
    for (const mood of MOODS) {
      for (let f = 0; f < PERIOD; f++) {
        const fr = crabFrame({ mood, f, acc })
        expect(fr.px).toHaveLength(STAGE_H)
        for (const row of fr.px) expect(row).toHaveLength(STAGE_W)
        const runs = frameRuns(fr)
        expect(runs).toHaveLength(STAGE_H / 2)
        for (const row of runs) expect(row.reduce((n, r) => n + Array.from(r.text).length, 0)).toBe(STAGE_W)
      }
      expect(frameSvg(crabFrame({ mood, f: 0, acc }), 5)).toContain('<path')
    }
    // Blinks, scuttles, bubbles and z's are really there.
    expect(crabFrame({ mood: 'idle', f: 23, acc }).px[0]?.includes('G')).toBe(false)
    expect(crabFrame({ mood: 'thinking', f: 8, acc }).px[1]?.includes('O')).toBe(true)
    expect(crabFrame({ mood: 'sleepy', f: 12, acc }).marks.map(m => m.ch)).toContain('z')
    expect(crabFrame({ mood: 'working', f: 0, acc }).px[2]?.indexOf('R')).not.toBe(crabFrame({ mood: 'working', f: 12, acc }).px[2]?.indexOf('R'))
  })
})

describe('register', () => {
  test('XP, moods, level-up toast, feed and hide on both surfaces', { options: { name: 'Clacky' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, { xp: 295 })
    const toasts: string[] = []
    let ctx = 20
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1_000_000, percent: ctx }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', ($, e) => (e.tool === 'Bash' ? { isError: true as const, result: 'exit 1' } : { result: 'ok' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })

    const term = await $.ui.mount({ plugin: 'clawdling', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Text', text: /Clacky/, in: 'clawdling-crab' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Lv 2/, in: 'clawdling-crab' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /▀/, in: 'clawdling-crab' })).toBeDefined()
    await term.advance(3000)
    expect(await term.find({ type: 'Text', text: /lounging/, in: 'clawdling-crab' })).toBeDefined()

    // Five tools take it past 300 XP: Lv 3 and the party hat.
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Read', file_path: `/w/${i}.ts` })
    expect(toasts.some(t => /Clacky reached Lv 3/.test(t) && /party hat/.test(t))).toBe(true)
    await clock.advance(1000)
    expect(await term.find({ type: 'Text', text: /pondering/, in: 'clawdling-crab' })).toBeDefined()

    await $.tool.call({ tool: 'Bash', command: 'false' })
    await clock.advance(1000)
    expect(await term.find({ type: 'Text', text: /ouch/, in: 'clawdling-crab' })).toBeDefined()
    await $.turn.complete({ answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
    await term.unmount()

    // Context past 80%: on the desktop, a sweating flipbook.
    await clock.advance(9000)
    ctx = 86
    await $.session.measure({ context: { tokens: 860_000, window: 1_000_000, percent: 86 }, rateLimits: [], changed: ['context'] })
    const desk = await $.ui.mount({ plugin: 'clawdling', surface: 'desktop', ...BAND })
    const card = await desk.find({ type: 'Svg' })
    expect(String(card?.props.alt)).toContain('overheating')
    expect(String(card?.props.source)).toContain('class="cw-fr cw-f23"')
    expect(String(card?.props.source).length < 131_072).toBe(true)

    const fed = await $.command.run({ command: 'clawdling', args: 'feed', ...RUN })
    expect(fed.text).toContain('Clacky')
    expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('fed & happy')
    expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('♥')

    await desk.press({ key: 'clawdling-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()
    const back = await $.command.run({ command: 'clawdling', args: '', ...RUN })
    expect(back.text).toContain('is back')
    const stats = await $.command.run({ command: 'clawdling', args: 'stats', ...RUN })
    expect(stats.text).toContain('Lv 3')
  })
})
