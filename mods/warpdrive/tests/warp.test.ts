import { describe, expect, test } from 'claude-code/testing'

import { rng } from '../hooks/lib/kz.ts'
import { RateMeter, arrivalLine, depthColor, fmtTok, hudLine, stepStars, warpAlt, warpFactor, warpFrame, warpSvg } from '../hooks/warp.ts'
import type { Run, Star, WarpView } from '../hooks/warp.ts'

const text = (frame: Run[][]) => frame.map(row => row.map(r => r.s).join(''))
const VIEW: WarpView = { now: 9000, speed: 0.5, rate: 40, tokens: 1200, elapsedMs: 8000, isWorking: true, label: '', flashSeq: 0 }

describe('numbers and lines', () => {
  test('token counts, warp factors and the arrival line', () => {
    expect([Number.NaN, -1, 0, 950.4, 18_400, 184_000, 2_300_000].map(fmtTok)).toEqual(['0', '0', '0', '950', '18.4k', '184k', '2.3M'])
    expect(warpFactor(0)).toBe('1.0')
    expect(warpFactor(2)).toBe('9.9')
    expect(arrivalLine(5000, 0, true)).toBe('⇢ dropped out · 5s · 0 tok')
    expect(hudLine(0.5, 39.6, 1200, 61_000)).toBe('▸ WARP 5.5 │ 40 tok/s │ 1.2k tok │ 1m')
  })

  test('near stars are brighter, and warp tints them', () => {
    expect(depthColor(0, 0)).toBe('#3f4a8f')
    expect(depthColor(1, 0)).toBe('#e0e7ff')
    expect(depthColor(1, 1)).not.toBe(depthColor(1, 0))
    expect(depthColor(0.25, 0)).not.toBe(depthColor(0.75, 0))
  })

  test('the meter keeps only real samples', () => {
    const m = new RateMeter()
    m.add(1000, 0)
    m.add(1000, -5)
    expect(m.rate(1500)).toBe(0)
    m.add(1000, 30)
    expect(m.rate(1500)).toBe(10)
    m.reset()
    expect(m.rate(1500)).toBe(0)
  })

  test('a star past the edge respawns near the center', () => {
    const [s] = stepStars([{ a: 1, d: 1.09, z: 1 }], 1, rng(1))
    expect(s!.d).toBeLessThan(0.14)
  })
})

describe('the terminal frame', () => {
  test('at rest: only heads, by depth; a star near the center is dimmed; one off the grid is dropped', () => {
    const stars: Star[] = [
      { a: 0, d: 0.5, z: 0.2 },
      { a: Math.PI, d: 0.5, z: 0.5 },
      { a: Math.PI / 2, d: 0.6, z: 0.9 },
      { a: 0, d: 0.05, z: 0.9 },
      { a: 1, d: 3, z: 0.9 },
    ]
    const rows = text(warpFrame(stars, 21, 5, 0, -1, '', ''))
    expect(rows).toHaveLength(5)
    const all = rows.join('')
    expect(all).toContain('·')
    expect(all).toContain('∙')
    expect(all).toContain('•')
    expect(all.replace(/[ ·∙•]/g, '')).toBe('')
  })

  test('at warp: streak glyphs follow each heading; nearer stars win a shared cell', () => {
    const glyph = (a: number, z: number) => text(warpFrame([{ a, d: 0.7, z }], 41, 9, 1, -1, '', '')).join('')
    expect(glyph(0, 0.9)).toContain('═')
    expect(glyph(0, 0.4)).toContain('─')
    expect(glyph(Math.PI / 2, 0.9)).toContain('│')
    expect(glyph((70 * Math.PI) / 180, 0.9)).toContain('╲')
    expect(glyph((110 * Math.PI) / 180, 0.9)).toContain('╱')
    // Two stars on one cell: the far one drawn second does not cover the near one.
    const both = warpFrame([{ a: 0, d: 0.5, z: 0.9 }, { a: 0, d: 0.5, z: 0.1 }], 21, 5, 0, -1, '', '')
    expect(text(both).join('')).toContain('•')
    expect(text(both).join('')).not.toContain('·')
  })

  test('the jump flash: a ring early, dots late, none outside 0..1', () => {
    const early = text(warpFrame([], 40, 7, 0, 0.2, '', '')).join('')
    expect(early).toMatch(/[✦*]/)
    const late = text(warpFrame([], 40, 7, 0, 0.8, '', '')).join('')
    expect(late).toContain('·')
    expect(late).not.toContain('*')
    expect(text(warpFrame([], 40, 7, 0, 1.5, '', '')).join('').trim()).toBe('')
    expect(text(warpFrame([], 40, 7, 0, -1, '', '')).join('').trim()).toBe('')
  })

  test('the label sits on the middle row, the HUD on the last; both cut at the edge', () => {
    const rows = text(warpFrame([], 12, 3, 0, -1, 'a very long hud line', 'arrived far away'))
    expect(rows.map(r => [...r].length)).toEqual([12, 12, 12])
    expect(rows[1]).toBe(' arrived far')
    expect(rows[2]).toBe(' a very long')
    const tiny = warpFrame([], 0, 0, 0, -1, '', '')
    expect(text(tiny)).toEqual([' '])
  })

  test('cells of one colour join one run; blanks join whatever run is open', () => {
    const frame = warpFrame([], 10, 1, 0, -1, 'ab', '')
    expect(frame[0]).toEqual([{ s: ' ', c: '' }, { s: 'ab       ', c: '#a5b4fc' }])
  })
})

describe('the desktop picture', () => {
  test('working: the HUD and the meter; no label, no flash', () => {
    const src = warpSvg(VIEW, 600, 84)
    expect(src).toContain('WARP 5.5')
    expect(src).toContain('40 tok/s · 1.2k tok · 8s')
    expect(src).not.toContain('class="ring"')
    expect(src).not.toContain('class="lbl"')
    expect(warpAlt(VIEW)).toBe('Warp 5.5: 40 output tokens per second, 1.2k this turn')
  })

  test('landed: the label, a flash only for a numbered jump', () => {
    const landed = { ...VIEW, isWorking: false, label: '⇢ arrived · 8s · 1.2k tok', flashSeq: 0 }
    const src = warpSvg(landed, 600, 66)
    expect(src).toContain('class="lbl"')
    expect(src).not.toContain('class="ring"')
    expect(src).not.toContain('WARP')
    expect(warpSvg({ ...landed, flashSeq: 2 }, 600, 66)).toContain('class="ring"')
    expect(warpAlt(landed)).toBe('⇢ arrived · 8s · 1.2k tok')
    // A flash number without a label draws no ring.
    expect(warpSvg({ ...VIEW, flashSeq: 3 }, 600, 66)).not.toContain('class="ring"')
  })
})
