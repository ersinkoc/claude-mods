import { describe, expect, test } from 'claude-code/testing'
import type { ClientSurface } from 'claude-code'

import Eq from '../hooks/eq.tsx'
import { eqBars, gainOf, moodSettingOf } from '../hooks/mood.ts'

type S = { t: number }
type El = { type: string; props: Record<string, unknown> & { children?: unknown } }

/** A surface in memory: setState replaces the state at once, `tick` fires the timers. */
function fakeSurface() {
  const timers: (() => void)[] = []
  const tag = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const surface = {
    elements: { Text: tag('Text'), Box: tag('Box') },
    state: undefined as S | undefined,
    setState(next: S) { surface.state = next },
    columns: 40,
    rows: 1,
    every(ms: number, fn: () => void) { timers.push(fn); return () => undefined },
    onPointer: () => () => undefined,
    onKey: () => () => undefined,
    post: () => undefined,
  }
  return { surface, as: surface as unknown as ClientSurface<S>, tick: () => timers.forEach(f => f()), timers }
}

/** Every string under an element, in order. */
function textOf(n: unknown): string {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  const el = n as El
  return textOf(el.props?.children)
}

describe('eq surface module', () => {
  test('starts at frame 0 with one 30 fps tick, then counts frames', () => {
    const f = fakeSurface()
    const first = Eq({ mood: 'night', bands: 8 }, f.as)
    expect(f.timers).toHaveLength(1)
    expect(f.surface.state).toEqual({ t: 0 })
    expect(textOf(first)).toStartWith('♪ lofi · night  ')
    expect(textOf(first)).toHaveLength('♪ lofi · night  '.length + 8)
    // Later frames reuse the state and start no second timer.
    for (let i = 0; i < 30; i++) f.tick()
    expect(f.surface.state).toEqual({ t: 30 })
    const later = Eq({ mood: 'night', bands: 8 }, f.as)
    expect(f.timers).toHaveLength(1)
    // 30 frames at 62 bpm: beat 1, the other note.
    expect(textOf(later)).toStartWith('♫ lofi · night')
  })

  test('an unknown mood draws as focus, and never fewer than 4 bands', () => {
    const f = fakeSurface()
    const drawn = Eq({ mood: 'disco', bands: 1 }, f.as)
    expect(textOf(drawn)).toBe(`♪ lofi · focus  ${textOf(drawn).slice(-4)}`)
    expect(textOf(drawn).slice(-4)).toMatch(/^[▁▂▃▄▅▆▇█]{4}$/)
  })
})

describe('mood helpers', () => {
  test('options fall back to auto and 40', () => {
    expect(moodSettingOf('night')).toBe('night')
    expect(moodSettingOf(undefined)).toBe('auto')
    expect(moodSettingOf(3)).toBe('auto')
    expect(gainOf('loud')).toBe(0.5)
    expect(gainOf(Number.NaN)).toBe(0.5)
    expect(gainOf(-10)).toBe(0)
  })

  test('levels past the ends draw the top and bottom bars', () => {
    expect(eqBars([2, -1, 0.5], 'sunny').map(b => b.s)).toEqual(['█', '▁', '▄'])
  })
})
