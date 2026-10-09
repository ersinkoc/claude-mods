import { describe, expect, test } from 'claude-code/testing'

import Field from '../hooks/field.tsx'
import type { FieldProps } from '../hooks/field.tsx'

type El = { type: string; props: Record<string, unknown> & { children?: unknown } }

/** A surface in memory: setState replaces the state at once, `tick` fires the frame timer. */
function fakeSurface(columns: number, rows: number) {
  const timers: (() => void)[] = []
  const tag = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const surface = {
    elements: { Text: tag('Text'), Box: tag('Box') },
    state: undefined as unknown,
    setState(next: unknown) { surface.state = next },
    columns,
    rows,
    every(ms: number, fn: () => void) { timers.push(fn); return () => undefined },
    onPointer: () => () => undefined,
    onKey: () => () => undefined,
    post: () => undefined,
  }
  return {
    surface,
    as: surface as unknown as Parameters<typeof Field>[1],
    timers,
    tick(n = 1) { for (let i = 0; i < n; i++) for (const f of timers) f() },
  }
}

/** The rows of text a drawing shows, and how many coloured runs it has. */
function rowsOf(n: unknown): string[] {
  const el = n as El
  const kids = ([] as unknown[]).concat(el.props.children ?? [])
  return kids.map(k => flat(k))
}
function flat(n: unknown): string {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(flat).join('')
  return flat((n as El).props.children)
}
function plainRuns(n: unknown): number {
  if (Array.isArray(n)) return n.reduce((a: number, k) => a + plainRuns(k), 0)
  if (n === null || typeof n !== 'object') return 0
  const kids = ([] as unknown[]).concat((n as El).props.children ?? [])
  return kids.reduce((a: number, k) => a + (typeof k === 'string' ? 1 : plainRuns(k)), 0)
}

const PROPS: FieldProps = { cols: 40, rows: 3, speed: 0.8, rate: 120, tokens: 5000, elapsedMs: 12_000, isWorking: true, label: '', flashSeq: 0 }

describe('the star field module', () => {
  test('the first frame seeds the stars and starts one timer; later frames reuse them', () => {
    const f = fakeSurface(0, 0)
    const first = Field(PROPS, f.as)
    expect(f.timers).toHaveLength(1)
    // An unmeasured region takes the props' size.
    expect(rowsOf(first)).toHaveLength(3)
    expect(rowsOf(first).map(r => [...r].length)).toEqual([40, 40, 40])
    expect(rowsOf(first)[2]).toContain('WARP')
    // Blank-coloured runs are drawn as plain strings.
    expect(plainRuns(first)).toBeGreaterThan(0)
    f.tick(30)
    const later = Field(PROPS, f.as)
    expect(f.timers).toHaveLength(1)
    expect((f.surface.state as { t: number }).t).toBe(30)
    expect((f.surface.state as { sp: number }).sp).toBeGreaterThan(0.6)
    expect(rowsOf(later)).toHaveLength(3)
  })

  test('a measured region wins over the props; idle engines spool down and show no HUD', () => {
    const f = fakeSurface(30, 2)
    const idle = { ...PROPS, isWorking: false, speed: 0.9 }
    Field(idle, f.as)
    f.tick(40)
    expect((f.surface.state as { sp: number }).sp).toBeLessThan(0.1)
    const drawn = Field(idle, f.as)
    expect(rowsOf(drawn).map(r => [...r].length)).toEqual([30, 30])
    expect(rowsOf(drawn).join('')).not.toContain('WARP')
  })

  test('a new jump number fires the flash and a burst; a reset to 0 does not', () => {
    const f = fakeSurface(40, 5)
    // Mounted on a landed label: that jump flashes on the first frame.
    Field({ ...PROPS, isWorking: false, label: '⇢ arrived', flashSeq: 4 }, f.as)
    f.tick()
    const st = () => f.surface.state as { t: number; seen: number; flashAt: number }
    expect(st().seen).toBe(4)
    expect(st().flashAt).toBe(0)
    f.tick(30)
    // The next jump.
    Field({ ...PROPS, isWorking: false, label: '⇢ arrived', flashSeq: 5 }, f.as)
    f.tick()
    expect(st().seen).toBe(5)
    expect(st().flashAt).toBe(31)
    f.tick(5)
    const flashing = rowsOf(Field({ ...PROPS, isWorking: false, label: '⇢ arrived', flashSeq: 5 }, f.as)).join('')
    expect(flashing).toContain('arrived')
    // A new turn clears the number: no flash for it.
    Field({ ...PROPS, flashSeq: 0 }, f.as)
    f.tick()
    expect(st().seen).toBe(0)
    expect(st().flashAt).toBe(31)
  })

  test('a fresh mount on a running turn adopts its jump number', () => {
    const f = fakeSurface(40, 3)
    Field({ ...PROPS, flashSeq: 7 }, f.as)
    f.tick()
    expect((f.surface.state as { seen: number; flashAt: number }).seen).toBe(7)
    expect((f.surface.state as { flashAt: number }).flashAt).toBe(-999)
  })
})
