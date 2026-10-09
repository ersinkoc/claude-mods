import { describe, expect, test } from 'claude-code/testing'

import type { ThrottleSnap } from '../types'
import { tokensPerSec } from '../hooks/model.ts'
import { altOf, dashSvg } from '../hooks/svg.ts'

const SNAP: ThrottleSnap = {
  isVisible: true,
  isWorking: false,
  speed: 0,
  speedPrev: 0,
  speedMax: 100,
  fuel: null,
  fuelPrev: null,
  temp: null,
  tempPrev: null,
  odo: null,
  odoPrev: null,
  lamps: { engine: false, fuel: false, heat: false },
  agents: 0,
  idleMs: 42_000,
}

describe('dashSvg', () => {
  test('a parked car: the speedometer alone, lamps dark, coasting', async () => {
    const pic = dashSvg(SNAP, 300)
    // Never narrower than the dials and lamps need; scaled down to the room given.
    expect(pic.width).toBe(300)
    expect(pic.height).toBe(Math.round(80 * (300 / 540)))
    expect(pic.source).toContain('TOK/S · 100')
    expect(pic.source).not.toContain('5H FUEL')
    expect(pic.source).not.toContain('ODOMETER')
    expect(pic.source).toContain('class="m" opacity=".35"')
    expect(pic.source.match(/<g class="">/g)).toHaveLength(3)
    expect(pic.source).toContain('coasting · 42s')
    expect(pic.source).not.toContain('animation:rd')
    expect(pic.alt).toBe('Throttle: 0 output tokens per second')
  })

  test('a wide one with every gauge, rolling odometer wheels and every lamp lit', async () => {
    const pic = dashSvg({
      ...SNAP,
      isWorking: true,
      speed: 150,
      speedPrev: 40,
      speedMax: 200,
      fuel: 12,
      fuelPrev: 20,
      temp: 91,
      tempPrev: null,
      odo: 12.34,
      odoPrev: 12.29,
      lamps: { engine: true, fuel: true, heat: true },
      agents: 2,
    }, 900)
    expect(pic.width).toBe(900)
    expect(pic.source).toContain('5H FUEL')
    expect(pic.source).toContain('CTX TEMP')
    expect(pic.source).toContain('ODOMETER · SESSION $')
    // Two wheels changed (2→3, 9→4) and roll; the rest stand.
    expect(pic.source.match(/@keyframes w\d/g)).toHaveLength(2)
    // The fuel and heat lamps blink; the engine lamp glows steady; the car turns amber.
    expect(pic.source.match(/class="glow blink"/g)).toHaveLength(2)
    expect(pic.source).toContain('class="glow"')
    expect(pic.source).toContain('fill="#111"')
    expect(pic.source).toContain('fill="#fb923c" d="M')
    // The needle shivers, the road and the hills scroll.
    expect(pic.source).toContain('animation:ssp')
    expect(pic.source).toContain('animation:rd ')
    expect(pic.source).toContain('animation:rk ')
    expect(pic.source).toContain('◈ 2 agents on the road')
    expect(pic.alt).toBe('Throttle: 150 output tokens per second; 12% of the 5-hour limit left; context 91%; session $12.34; warnings: check engine (a tool failed), low fuel, overheating')
  })

  test('one agent, then the engine alone; no road when the row is full', async () => {
    const one = dashSvg({ ...SNAP, isWorking: true, speed: 0.2, agents: 1, odo: 3 }, 900)
    expect(one.source).toContain('◈ 1 agent on the road')
    // Barely moving: no shiver, no scrolling road.
    expect(one.source).not.toContain('animation:ssp')
    expect(one.source).not.toContain('animation:rd ')
    expect(one.source).not.toMatch(/@keyframes w\d/)
    expect(dashSvg({ ...SNAP, isWorking: true, speed: 10 }, 900).source).toContain('engine running')
    // Every gauge and the odometer leave no room for the road at the minimum width.
    const full = dashSvg({ ...SNAP, fuel: 50, temp: 50, odo: 1 }, 100)
    expect(full.width).toBe(100)
    expect(full.source).not.toContain('coasting')
  })
})

describe('altOf', () => {
  test('one warning at a time', async () => {
    expect(altOf({ ...SNAP, lamps: { engine: false, fuel: true, heat: false } })).toBe('Throttle: 0 output tokens per second; warnings: low fuel')
    expect(altOf({ ...SNAP, temp: 90, lamps: { engine: false, fuel: false, heat: true } })).toBe('Throttle: 0 output tokens per second; context 90%; warnings: overheating')
  })
})

describe('tokensPerSec', () => {
  test('a span with no length counts whole', async () => {
    expect(tokensPerSec([{ s: 5000, e: 5000, tok: 10 }], 6000)).toBe(5)
  })
})
