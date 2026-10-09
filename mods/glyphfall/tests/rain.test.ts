import { describe, expect, test } from 'claude-code/testing'

import { GLYPHS, chipLine, glyphAt, letterY, placeWords, rainAlt, rainFrame, rainSvg, wordOf } from '../hooks/rain.ts'
import type { Seg, Tool } from '../hooks/rain.ts'

const tool = (o: Partial<Tool>): Tool => ({ id: 'tu1', at: 0, end: null, name: 'Bash', detail: 'npm test', color: '#4ade80', isError: false, ...o })
const textOf = (segs: readonly Seg[]): string => segs.map(s => s.s).join('')

describe('words and letters', () => {
  test('a word is cut to the room it has, never to nothing', async () => {
    expect(wordOf(tool({ detail: '  npm   run  build ' }), 40)).toBe('Bash npm run build')
    expect(wordOf(tool({}), 6)).toBe('Bash n')
    expect(wordOf(tool({}), 0)).toBe('B')
  })

  test('glyphs come from the set and change with time', async () => {
    const seen = new Set<string>()
    for (let now = 0; now < 20_000; now += 250) seen.add(glyphAt(3, 1, now))
    expect([...seen].every(g => GLYPHS.includes(g))).toBe(true)
    expect(seen.size).toBeGreaterThan(3)
  })

  test('a letter eases in from above the band before it hangs', async () => {
    const t = tool({})
    expect(letterY(t, 0, 0, 2)).toBe(-1)
    const y = letterY(t, 0, 200, 2)
    expect(y).toBeGreaterThan(-1)
    expect(y).toBeLessThan(2)
    // A running tool hangs for at most 30 s, then falls anyway.
    expect(letterY(t, 0, 29_000, 2)).toBe(2)
    expect(letterY(t, 0, 31_000, 2)).toBe(2 + 9)
  })

  test('words in flight together take free columns; a finished one frees its place', async () => {
    const a = tool({ id: 'a', at: 0, detail: '' })
    const b = tool({ id: 'b', at: 10, detail: '' })
    const placed = placeWords([b, a], 40, 20)
    const xa = placed.get('a')!
    const xb = placed.get('b')!
    expect(Math.abs(xa - xb)).toBeGreaterThan(4)
    // Long gone: the next word may take any column.
    const c = tool({ id: 'c', at: 100_000, detail: '' })
    const later = placeWords([{ ...a, end: 100 }, c], 40, 20)
    expect(later.get('c')).toBeDefined()
    // No room left anywhere: the word keeps the column it wanted.
    const crowd = Array.from({ length: 6 }, (_, i) => tool({ id: `t${i}`, at: i, detail: 'a fairly long detail' }))
    expect(placeWords(crowd, 30, 28).size).toBe(6)
  })
})

describe('the terminal rain', () => {
  test('no tools: the quiet rain alone, every row full width', async () => {
    const frame = rainFrame([], 5000, 40, 3)
    expect(frame).toHaveLength(3)
    for (const row of frame) expect(textOf(row).length).toBe(40)
    // Never narrower than 4 columns or shorter than one row.
    const tiny = rainFrame([], 0, 1, 0)
    expect(tiny).toHaveLength(1)
    expect(textOf(tiny[0]!).length).toBe(4)
  })

  test('a failed tool hangs red; a word wider than the band is cut; its spaces stay blank', async () => {
    const bad = tool({ id: 'x', isError: true, end: 1000, detail: 'a b' })
    const frame = rainFrame([bad], 1500, 12, 5)
    const mid = frame[2]!
    expect(textOf(mid)).toContain('Bash a b')
    expect(mid.find(s => s.s.includes('Bash'))?.c).toBe('#f98b8b')
    // Long gone below the band: nothing of it is drawn.
    const gone = rainFrame([bad], 60_000, 12, 5)
    expect(gone.map(textOf).join('')).not.toContain('Bash')
    // Still dropping in: the head is above the band, the tail not yet drawn.
    expect(rainFrame([tool({ at: 1000 })], 1000, 30, 3).map(textOf).join('')).not.toContain('B')
  })

  test('chips: newest first, a spinner while running, ✖ when failed, cut to the width', async () => {
    const tools = [
      tool({ id: 'a', name: 'Read', detail: 'a.ts', end: 5 }),
      tool({ id: 'b', name: 'Glob', detail: '', end: 5 }),
      tool({ id: 'c', name: 'Edit', detail: 'b.ts', end: 5, isError: true }),
      tool({ id: 'd', name: 'Bash', detail: 'npm test --coverage', end: null }),
    ]
    const wide = chipLine(tools, 300, 200)
    const text = textOf(wide)
    // The detail is clipped to 18 characters; a chip with no detail has none.
    expect(text).toBe(' ◑ Bash  npm test --covera…   ✖ Edit  b.ts   ⌕ Glob    ◉ Read  a.ts  ')
    expect(wide.find(s => s.s === ' ✖ Edit ')?.bg).toBe('#f87171')
    // Room for the first chip but not its detail; then nothing more.
    const narrow = textOf(chipLine(tools, 0, 12))
    expect(narrow).toBe(' ◐ Bash   ')
    expect(chipLine(tools, 0, 4)).toEqual([])
  })
})

describe('the desktop rain', () => {
  test('no tools: the quiet rain and an empty chip panel', async () => {
    const src = rainSvg([], 0, 300, 76)
    expect(src).toContain('class="gfcol"')
    expect(src).not.toContain('class="gfin"')
    expect(rainAlt([])).toBe('Tool rain.')
  })

  test('words drop in while running, fall out when done, and failures read red', async () => {
    const tools = [
      tool({ id: 'a', name: 'Read', detail: 'a.ts', at: 0, end: 4000 }),
      tool({ id: 'b', name: 'Edit', detail: '', at: 4500, end: 4600, isError: true }),
      tool({ id: 'c', name: 'Bash', detail: 'npm test', at: 4800, end: null }),
    ]
    const src = rainSvg(tools, 5000, 900, 96)
    expect(src).toContain('class="gfout"')
    expect(src).toContain('class="gfin"')
    expect(src).toContain('class="gfhead"')
    expect(src).toContain('stop-color="#f87171"')
    expect(src).toContain('>✖<')
    expect(src).toContain('class="pulse"')
    expect(rainAlt(tools)).toBe('Tool rain. Latest tools: Bash npm test (running); Edit (failed); Read a.ts.')
    // A narrow band: the chips that do not fit are left out.
    const narrow = rainSvg(tools, 5000, 200, 76)
    expect(narrow).toContain('Bash · npm test')
    expect(narrow).not.toContain('>Read · a.ts<')
  })
})
