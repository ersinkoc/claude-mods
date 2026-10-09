import { describe, expect, test } from 'claude-code/testing'

import { mix } from '../hooks/lib/kz.ts'
import { FADE, auroraAlt, auroraFrame, auroraSvg, curtain, labelLines, levelOf } from '../hooks/lights.ts'
import type { Mode, Seg } from '../hooks/lights.ts'

const textOf = (rows: Seg[][]): string => rows.flat().map(s => s.s).join('')

/** Every glyph a sweep of frames drew, with its color. */
function sweep(mode: Mode, levels: number[], rowsList: number[], cols = 120): Map<string, Set<string | undefined>> {
  const seen = new Map<string, Set<string | undefined>>()
  for (const level of levels) {
    for (const rows of rowsList) {
      for (let t = 0; t < 12; t += 0.7) {
        for (const seg of auroraFrame(t, cols, rows, level, mode).flat()) {
          for (const ch of seg.s) {
            const set = seen.get(ch) ?? new Set()
            set.add(seg.c)
            seen.set(ch, set)
          }
        }
      }
    }
  }
  return seen
}

describe('effort', () => {
  test('every named effort, and a token budget on a log scale', () => {
    expect([levelOf('low'), levelOf('medium'), levelOf('high'), levelOf('xhigh'), levelOf('max')]).toEqual([0.25, 0.45, 0.65, 0.85, 1])
    expect(levelOf(null)).toBe(0.5)
    expect(levelOf(100_000)).toBe(1)
    expect(levelOf(1000)).toBe(0.6)
    expect(levelOf(0)).toBe(0.2)
  })
})

describe('curtains', () => {
  test('responding is one calm cyan ribbon, a fixed height above its edge', () => {
    for (let x = 0; x < 20; x++) {
      const c = curtain(x, 3, 1, 'responding')
      expect(Math.abs(c.top - c.edge - 0.32)).toBeLessThan(1e-9)
      expect(c.ray).toBe(0.5)
      expect(c.hu).toBeGreaterThan(0.49)
      expect(c.hu).toBeLessThan(0.55)
    }
  })

  test('the thinking sweep draws solid edges, shading, rays and a few stars', () => {
    const seen = sweep('thinking', [0.25, 1], [1, 2, 3, 6])
    for (const ch of ['█', '▓', '▒', '░', '▀', '▔', '▁']) expect(seen.has(ch)).toBe(true)
    // Stars under the curtain and in the open sky above it.
    expect(seen.get('✦')).toContain(mix('#cbd5e1', FADE, 0.35))
    expect(seen.get('·')).toContain(mix('#cbd5e1', FADE, 0.35))
    expect(seen.get('·')).toContain(mix('#cbd5e1', FADE, 0.45))
    // A blank cell carries no color.
    expect([...(seen.get(' ') ?? [])]).toEqual([undefined])
  })

  test('the responding ribbon fits inside one row as a thin band', () => {
    const seen = sweep('responding', [0.5], [1, 2, 4])
    expect(seen.has('━')).toBe(true)
    expect(seen.has('▀')).toBe(true)
  })
})

describe('label', () => {
  test('two rows: the word and seconds, then the effort and its pips', () => {
    const [a, b] = labelLines('responding', null, -3, 0.5, 2, 0)
    expect(a?.map(s => s.s).join('')).toBe('✧ responding · 0s')
    expect(b?.map(s => s.s).join('')).toBe('  effort — ▰▰▰▱▱')
  })

  test('three rows: the word, effort and seconds, then the pips', () => {
    const lines = labelLines('thinking', 'high', 9.9, 0.65, 3, 0.3)
    expect(lines.map(l => l.map(s => s.s).join(''))).toEqual(['✦ thinking', '  high · 9s', '  ▰▰▰▱▱'])
    expect(textOf(labelLines('thinking', null, 1, 0.5, 3, 0))).toContain('  — · 1s')
  })
})

describe('desktop', () => {
  test('a gentle think has three curtains; a reply one, with no effort named', () => {
    const think = auroraSvg('thinking', 'low', 0.25, 3, 1000, 700, 56)
    expect(think.match(/id="auL\d"/g)).toHaveLength(3)
    const reply = auroraSvg('responding', null, 0.5, 4.5, 1000, 700, 56)
    expect(reply.match(/id="auL\d"/g)).toHaveLength(1)
    expect(reply).toContain('>responding<')
    expect(reply).toContain('effort — · 4s')
  })

  test('the alt text names the effort only when known', () => {
    expect(auroraAlt('responding', null, 2.5)).toBe('Aurora: the model is responding, 2 seconds.')
    expect(auroraAlt('thinking', 'max', 7)).toBe('Aurora: the model is thinking at max effort, 7 seconds.')
  })
})
