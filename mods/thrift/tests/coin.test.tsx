import { describe, expect, test } from 'claude-code/testing'

import Coin, { FRAMES } from '../hooks/coin.tsx'

// A surface in memory for the coin: elements build plain data, the timer fires
// when the test ticks it, and `setState` lands at once or, when `isLazy`, only
// when the test lands it (a surface that batches its updates).
type Node = { type: string; props: Record<string, unknown> & { children?: unknown[] } }
type S = { f: number }

function surfaceOf(isLazy = false) {
  const el = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  let state: S | undefined
  let pending: S | undefined
  const timers: { ms: number; fn: () => void }[] = []
  const surface = {
    elements: { Box: el('Box'), Text: el('Text') },
    get state() {
      return state
    },
    setState: (s: S) => {
      if (isLazy) pending = s
      else state = s
    },
    columns: 2,
    rows: 1,
    every: (ms: number, fn: () => void) => {
      timers.push({ ms, fn })
      return () => undefined
    },
  }
  return {
    surface: surface as never,
    timers,
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) for (const t of timers) t.fn()
    },
    land: () => (state = pending),
  }
}

const drawn = (n: unknown) => {
  const node = n as Node
  return { ch: (node.props.children ?? []).join(''), color: node.props.color, bold: node.props.bold }
}

describe('coin', () => {
  test('spins through its frames eight times a second, wrapping round', async () => {
    const s = surfaceOf()
    expect(drawn(Coin({ isOn: true }, s.surface))).toEqual({ ch: FRAMES[0]![0], color: FRAMES[0]![1], bold: true })
    expect(s.timers.map(t => t.ms)).toEqual([125])
    s.tick(3)
    expect(drawn(Coin({ isOn: true }, s.surface))).toEqual({ ch: '│', color: '#d97706', bold: true })
    expect(s.timers.length).toBe(1)
    s.tick(FRAMES.length)
    expect(drawn(Coin({ isOn: true }, s.surface)).ch).toBe('│')
  })

  test('off, the coin is grey', async () => {
    expect(drawn(Coin({ isOn: false }, surfaceOf().surface)).color).toBe('#9ca3af')
  })

  test('before its state lands it draws the first face, and a tick counts from it', async () => {
    const s = surfaceOf(true)
    expect(drawn(Coin({ isOn: true }, s.surface)).ch).toBe('●')
    s.tick()
    s.land()
    expect(drawn(Coin({ isOn: true }, s.surface)).ch).toBe('◗')
  })
})
