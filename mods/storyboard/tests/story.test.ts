import { describe, expect, test } from 'claude-code/testing'

import {
  PHASE_COLOR, bandSvg, chapterAlt, chapterRowSvg, headerSvg, parseChapter, phaseTimes, railRuns, stepText, timesSvg,
} from '../hooks/story.ts'
import type { StoryChapter } from '../types'

const ch = (o: Partial<StoryChapter>): StoryChapter => ({ title: 'Map it', phase: 'explore', at: 0, ...o })
const ZERO = { explore: 0, plan: 0, build: 0, verify: 0, ship: 0 }

describe('reading a chapter call', () => {
  test('counts below one, fractions and non-numbers are dropped or floored', () => {
    expect(parseChapter({ title: 'Plan', phase: 'plan', step: 0, steps: 'x' }, 5)).toEqual({ title: 'Plan', phase: 'plan', at: 5 })
    expect(parseChapter({ title: 'Plan', phase: 'plan', step: 2.7, steps: Number.POSITIVE_INFINITY }, 5)).toEqual({ title: 'Plan', phase: 'plan', at: 5, step: 2 })
    expect(parseChapter({ title: 'Plan', phase: 'plan', steps: 4, note: 'why' }, 5)).toEqual({ title: 'Plan', phase: 'plan', at: 5, steps: 4, note: 'why' })
  })

  test('the step reads as n/m, step n, or nothing', () => {
    expect(stepText(ch({ step: 2, steps: 5 }))).toBe('2/5')
    expect(stepText(ch({ step: 2 }))).toBe('step 2')
    expect(stepText(ch({ steps: 5 }))).toBe('')
    expect(stepText(ch({}))).toBe('')
  })

  test('time per phase runs from each chapter to the next, the last one to now', () => {
    const log = [ch({ phase: 'explore', at: 0 }), ch({ phase: 'build', at: 1000 }), ch({ phase: 'explore', at: 4000 })]
    expect(phaseTimes(log, 4500)).toEqual({ ...ZERO, explore: 1500, build: 3000 })
  })
})

describe('the rail', () => {
  test('a tiny rail drops the labels; the first stage has nothing behind it', () => {
    const runs = railRuns('explore', 30)
    expect(runs.map(r => r.text).join('')).toBe('◉ ─ ○ ─ ○ ─ ○ ─ ○')
    expect(runs[0]).toEqual({ text: '◉', color: PHASE_COLOR.explore, bold: true })
    expect(railRuns('ship', 40).map(r => r.text).join('')).toBe('● expl ── ● plan ── ● bld ── ● ver ── ◉ SHIP')
  })

  test('a narrow band stacks the rail under the chapter; no steps, no meter', () => {
    const { source, height } = bandSvg(ch({ title: 'Look around', phase: 'explore' }), 400)
    expect(height).toBe(92)
    expect(source).toContain('>CHAPTER · EXPLORE<')
    expect(source).not.toContain('stroke="url(#trailb)"')
    expect(source).not.toContain('class="k"')
    expect(source).toContain('<stop offset="0"')
  })

  test('a wide band with steps draws the meter, a note and the trail behind the active stage', () => {
    const { source, height } = bandSvg(ch({ phase: 'verify', step: 1, steps: 3, note: 'two to go' }), 700)
    expect(height).toBe(60)
    expect(source).toContain('>two to go<')
    expect(source).toContain('stroke="url(#trailb)"')
    expect(source.match(/width="6" height="4"/g)).toHaveLength(3)
  })
})

describe('the log pane drawings', () => {
  test('the header with no chapter, one, or several', () => {
    expect(headerSvg(null, 0, 400)).toContain('No chapters yet')
    expect(headerSvg(null, 0, 400)).toContain('>0 chapters<')
    const one = headerSvg(ch({ phase: 'plan' }), 1, 400)
    expect(one).toContain('>1 chapter<')
    expect(one).toContain('orbh')
  })

  test('time per phase: an empty bar, then the phases that took time', () => {
    const empty = timesSvg(ZERO, 600)
    expect(empty).not.toContain('clip-path')
    expect(empty).toContain('explore —')
    const some = timesSvg({ ...ZERO, plan: 60_000, build: 30_000 }, 600)
    expect(some).toContain('clip-path="url(#tc)"')
    expect(some.match(/height="8" fill=/g)).toHaveLength(2)
    expect(some).toContain('plan 1:00')
  })

  test('a past chapter row without step or note; the current one with both', () => {
    const past = chapterRowSvg(ch({ at: 65_000 }), 400, 0, false, false)
    expect(past).toContain('height="36"')
    expect(past).toContain('y2="36"')
    expect(past).toContain('r="4.5"')
    expect(past).toContain('>1:05<')
    expect(past).toContain('font-weight="560"')
    const now = chapterRowSvg(ch({ step: 2, steps: 4, note: 'halfway' }), 400, 0, true, true)
    expect(now).toContain('height="50"')
    expect(now).toContain('y2="18"')
    expect(now).toContain('class="pulse"')
    expect(now).toContain('>2/4<')
    expect(now).toContain('>halfway<')
  })

  test('the alt text names the step and note when there are any', () => {
    expect(chapterAlt(ch({}))).toBe('Chapter: Map it; phase explore')
    expect(chapterAlt(ch({ step: 1, note: 'first' }))).toBe('Chapter: Map it; phase explore, step 1; first')
  })
})
