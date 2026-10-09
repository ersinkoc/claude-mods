import { describe, expect, test } from 'claude-code/testing'

import { KZ, mix } from '../hooks/lib/kz.ts'
import { DIM, agentColor, fieldFrame, legendAgents, legendLines, orreryAlt, orrerySvg, planetGlyph } from '../hooks/sky.ts'
import type { Agent, Seg } from '../hooks/sky.ts'

const agent = (o: Partial<Agent>): Agent => ({
  id: 'a', desc: 'Explore auth', type: 'Explore', model: 'haiku', order: 0, status: 'run',
  start: 0, end: null, tps: 0, tokens: 0, angle: 0, omega: 1, ...o,
})

const text = (rows: Seg[][]): string => rows.flat().map(s => s.s).join('')
const segOf = (rows: Seg[][], ch: string): Seg | undefined => rows.flat().find(s => s.s.includes(ch))

describe('glyphs and colors', () => {
  test('each kind of agent has its planet', () => {
    expect(planetGlyph('Explore')).toBe('◍')
    expect(planetGlyph('code-search')).toBe('◍')
    expect(planetGlyph('Plan')).toBe('◆')
    expect(planetGlyph('architect')).toBe('◆')
    expect(planetGlyph('code-reviewer')).toBe('◈')
    expect(planetGlyph('security-audit')).toBe('◈')
    expect(planetGlyph('general-purpose')).toBe('●')
  })

  test('colors cycle through the palette, both ways', () => {
    expect(agentColor(0)).toBe(KZ.violet)
    expect(agentColor(8)).toBe(KZ.violet)
    expect(agentColor(-1)).toBe(agentColor(7))
  })
})

describe('legend order', () => {
  test('running agents by spawn order, then finished ones by end, an unknown end last', () => {
    const list = legendAgents([
      agent({ id: 'r2', order: 3 }),
      agent({ id: 'd0', status: 'done', end: null, order: 0 }),
      agent({ id: 'r1', order: 1 }),
      agent({ id: 'd1', status: 'done', end: 50, order: 2 }),
      agent({ id: 'd2', status: 'done', end: null, order: 4 }),
    ], 5)
    expect(list.map(a => a.id)).toEqual(['r1', 'r2', 'd1', 'd0', 'd2'])
    expect(legendAgents([agent({}), agent({ id: 'b' })], 1)).toHaveLength(1)
  })
})

describe('field', () => {
  test('an idle sun is still; finished planets settle on the outer ring', () => {
    const f = fieldFrame([agent({ status: 'done', end: 10 })], 0, 9000, 30, 5, 0, false)
    expect(text(f)).toContain('✺')
    expect(text(f)).not.toMatch(/[✶✷✸✹]/)
    expect(segOf(f, '✺')?.c).toBe(KZ.amber)
    expect(segOf(f, '•')?.c).toBe(mix(agentColor(0), DIM, 0.55))
  })

  test('a failed planet flashes while fresh, then fades', () => {
    const failed = (end: number | null, t: number) => segOf(fieldFrame([agent({ status: 'fail', end })], 0, t, 30, 5, 0, false), '✖')
    // Fresh, on beat: bright red and bold.
    expect(failed(0, 100)).toMatchObject({ c: KZ.red, b: true })
    // Fresh, off beat.
    expect(failed(0, 200)).toMatchObject({ c: mix(KZ.red, DIM, 0.6), b: false })
    // An unknown end counts from zero; long ago, it fades.
    expect(failed(null, 5000)).toMatchObject({ c: mix(KZ.red, DIM, 0.55), b: false })
  })

  test('several running planets share the lanes, a still one included', () => {
    const f = fieldFrame([
      agent({ id: 'b', order: 1, type: 'Plan', omega: 0 }),
      agent({ id: 'a', order: 0 }),
    ], 0, 0, 40, 6, 120, true)
    expect(f).toHaveLength(6)
    expect(text(f)).toContain('◆')
    expect(text(f)).toContain('◍')
  })

  test('a planet whose angle is not a number is left out, the frame still whole', () => {
    const f = fieldFrame([agent({ angle: Number.NaN })], 0, 0, 30, 5, 0, true)
    expect(f).toHaveLength(5)
    for (const row of f) expect(row.map(s => s.s).join('').length).toBe(30)
    expect(text(f)).not.toContain('◍')
  })
})

describe('legend lines', () => {
  test('nothing orbiting reads dim; failed and done agents get their marks', () => {
    const lines = legendLines([
      agent({ id: 'f', status: 'fail', end: 1000, order: 1, desc: '' , type: 'Plan' }),
      agent({ id: 'd', status: 'done', end: 500, order: 2 }),
    ], 2000, 60, 5)
    const [head, first, second] = lines
    expect(head?.[1]).toEqual({ s: '0 orbiting', c: undefined, d: true })
    expect(head?.[3]).toEqual({ s: ' · 1 failed', c: KZ.red })
    expect(first?.[0]).toEqual({ s: '✖ ', c: KZ.red, b: false })
    // No description: the type stands in.
    expect(first?.[1]?.s.trim()).toBe('Plan')
    expect(first?.[1]?.d).toBe(true)
    expect(first?.[2]?.s).toBe('  Plan · 0:01')
    expect(second?.[0]).toEqual({ s: '✓ ', c: mix(agentColor(2), DIM, 0.5), b: false })
  })

  test('a running agent under one token a second shows no rate', () => {
    const [, line] = legendLines([agent({ tps: 0.4 })], 3000, 60, 3)
    expect(line?.[0]).toEqual({ s: '◍ ', c: agentColor(0), b: true })
    expect(line?.[2]?.s).toBe('  Explore · 0:03')
  })
})

describe('desktop drawing', () => {
  test('finished planets, fresh and old failures, two lanes and the legend marks', () => {
    const agents = [
      agent({ id: 'r1', order: 0, desc: '' }),
      agent({ id: 'r2', order: 1, desc: 'Plan the move', type: 'Plan' }),
      agent({ id: 'd', order: 2, status: 'done', end: 9000 }),
      agent({ id: 'f', order: 3, status: 'fail', end: 9500, desc: 'Broken' }),
    ]
    const src = orrerySvg(agents, 10_000, 0, false, 760, 112)
    expect(src).toContain('class="orflash"')
    expect(src).toContain('r="2.2"')
    expect(src.match(/class="orring"/g)).toHaveLength(2)
    expect(src).toContain('2 orbiting · 1 done · 1 failed')
    expect(src).toContain('>✓<')
    // The legend names the nameless by type.
    expect(src).toContain('>Explore<')
    const old = orrerySvg([agent({ status: 'fail', end: null })], 10_000, 0, false, 760, 112)
    expect(old).not.toContain('class="orflash"')
    expect(old).toContain('opacity="0.45"')
  })

  test('the alt text names running agents, by type when nameless', () => {
    expect(orreryAlt([agent({ desc: '' }), agent({ id: 'b', desc: 'Read docs' }), agent({ id: 'c', status: 'done' })]))
      .toBe('Subagent orrery: 2 running (Explore, Read docs), 1 done, 0 failed.')
    expect(orreryAlt([])).toBe('Subagent orrery: 0 running, 0 done, 0 failed.')
  })
})
