import { describe, expect, test } from 'claude-code/testing'

import { ASSUMED_COMPACT, categoryColor, growthSlope, ranked, recentRun, thresholdOf, toCategories, toGrid, turnsUntil } from '../hooks/calc.ts'
import { KZ, hue } from '../hooks/lib/kz.ts'

describe('colors', () => {
  test('by kind first, then by what the name says, else a hue by position', async () => {
    expect(categoryColor('Free space', 'free', 0)).toBe('#52525b')
    expect(categoryColor('Autocompact buffer', 'buffer', 0)).toBe(KZ.amber)
    expect(categoryColor('MCP tools', 'deferred', 0)).toBe(KZ.mist)
    const used: [string, string][] = [
      ['System prompt', KZ.violet], ['MCP tools', KZ.magenta], ['System tools', KZ.blue], ['Memory files', KZ.teal], ['Custom agents', KZ.cyan],
      ['Skills', KZ.lime], ['Slash commands', KZ.green], ['Messages', KZ.yellow],
    ]
    for (const [name, color] of used) expect(categoryColor(name, 'used', 0), name).toBe(color)
    expect(categoryColor('Something new', 'used', 3)).toBe(hue(0.13 * 3 + 0.05))
  })
})

describe('categories and the grid', () => {
  test('a share of the window, or none when the window is unknown', async () => {
    const cats = toCategories([{ name: 'Messages', tokens: 50, kind: 'used' }], 1000)
    expect(cats).toEqual([{ name: 'Messages', tokens: 50, kind: 'used', color: KZ.yellow, pct: 5 }])
    expect(toCategories([{ name: 'Messages', tokens: 50, kind: 'used' }], 0)[0]?.pct).toBe(0)
  })

  test('ranked: used by size, then free, buffer, deferred', async () => {
    const cats = toCategories([
      { name: 'Deferred', tokens: 900, kind: 'deferred' },
      { name: 'Buffer', tokens: 800, kind: 'buffer' },
      { name: 'Free', tokens: 700, kind: 'free' },
      { name: 'Small', tokens: 10, kind: 'used' },
      { name: 'Big', tokens: 100, kind: 'used' },
    ], 1000)
    expect(ranked(cats).map(c => c.name)).toEqual(['Big', 'Small', 'Free', 'Buffer', 'Deferred'])
  })

  test('toGrid clamps fullness and empties unfilled squares', async () => {
    const cats = toCategories([{ name: 'A', tokens: 1, kind: 'used' }], 10)
    expect(toGrid([[
      { categoryName: 'A', squareFullness: 1.7, isFilled: true },
      { categoryName: 'A', squareFullness: -1, isFilled: true },
      { categoryName: 'A', squareFullness: 0.4, isFilled: false },
    ]], cats)).toEqual([[[0, 1], [0, 0], [0, 0]]])
  })
})

describe('growth and the forecast', () => {
  test('the threshold: the engine\'s when above zero, else assumed', async () => {
    expect(thresholdOf(0, 100_000)).toEqual({ tokens: Math.round(100_000 * ASSUMED_COMPACT), source: 'assumed' })
    expect(thresholdOf(-5, 1000)).toEqual({ tokens: 950, source: 'assumed' })
  })

  test('recentRun starts after the last drop of more than 10 % and keeps k + 1 points', async () => {
    expect(recentRun([])).toEqual([])
    expect(recentRun([100, 95, 92])).toEqual([100, 95, 92])
    expect(recentRun([100, 50, 60, 20, 30])).toEqual([20, 30])
    expect(recentRun([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5])
  })

  test('the slope is flat, rising or falling', async () => {
    expect(growthSlope([10, 10, 10])).toBe(0)
    expect(growthSlope([100, 95, 90])).toBe(-5)
    expect(growthSlope([])).toBeUndefined()
  })

  test('turnsUntil: none when not growing, zero at or past the threshold', async () => {
    expect(turnsUntil(10, 100, undefined)).toBeUndefined()
    expect(turnsUntil(10, 100, -3)).toBeUndefined()
    expect(turnsUntil(100, 100, 5)).toBe(0)
    expect(turnsUntil(91, 100, 3)).toBe(3)
  })
})
