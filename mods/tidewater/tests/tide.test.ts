import { describe, expect, test } from 'claude-code/testing'

import { EDIT_TOOLS, chipColor, chipRow, editDelta, editPath, layout, level, lineDelta, lines, patchDelta, tideAlt, tideFrame, tideSvg, totals, totalsLine } from '../hooks/tide.ts'
import type { TideFile } from '../hooks/tide.ts'

const file = (path: string, added: number, removed: number, edits = 1): TideFile => ({ path, name: path.split('/').pop() ?? path, added, removed, edits, at: 0 })
const text = (runs: { s: string }[]): string => runs.map(r => r.s).join('')

describe('counting lines', () => {
  test('lines: none for empty text, a trailing newline is not a line, CRLF splits too', async () => {
    expect(lines('')).toEqual([])
    expect(lines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(lines('\n')).toEqual([''])
  })

  test('lineDelta: whole sides when one middle is empty; LCS otherwise; huge middles counted whole', async () => {
    expect(lineDelta('a\nb\nc', '')).toEqual({ added: 0, removed: 3 })
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 })
    expect(lineDelta('x\na\ny', 'a\nz')).toEqual({ added: 1, removed: 2 })
    const big = (tag: string) => Array.from({ length: 600 }, (_, i) => `${tag}${i}`).join('\n')
    expect(lineDelta(big('a'), big('b'))).toEqual({ added: 600, removed: 600 })
  })

  test('patchDelta: not a list, a hunk without lines, and non-string lines', async () => {
    expect(patchDelta('patch')).toBeUndefined()
    expect(patchDelta([null])).toBeUndefined()
    expect(patchDelta([{ lines: 'x' }])).toBeUndefined()
    expect(patchDelta([{ lines: ['+a', 7, ' b', '-c', null] }])).toEqual({ added: 1, removed: 1 })
    expect(patchDelta([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('editDelta', () => {
  test('a non-empty structuredPatch wins over the input', async () => {
    expect(editDelta('Edit', { old_string: 'a', new_string: 'b' }, { structuredPatch: [{ lines: ['+x', '+y', '+z'] }] })).toEqual({ added: 3, removed: 0 })
  })

  test('Edit: missing strings are empty; replace_all multiplies by the matches in the original file', async () => {
    expect(editDelta('Edit', {}, undefined)).toEqual({ added: 0, removed: 0 })
    expect(editDelta('Edit', undefined, { structuredPatch: [] })).toEqual({ added: 0, removed: 0 })
    expect(editDelta('Edit', { old_string: 'a', new_string: 'b\nc', replace_all: true }, { originalFile: 'a1 a2 a3' })).toEqual({ added: 6, removed: 3 })
    expect(editDelta('Edit', { old_string: 'zz', new_string: 'b', replace_all: true }, { originalFile: 'none here' })).toEqual({ added: 1, removed: 1 })
    expect(editDelta('Edit', { new_string: 'b', replace_all: true }, { originalFile: 'text' })).toEqual({ added: 1, removed: 0 })
    expect(editDelta('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, {})).toEqual({ added: 1, removed: 1 })
  })

  test('MultiEdit sums its edits; without an edit list it counts nothing', async () => {
    expect(editDelta('MultiEdit', { edits: [{ new_string: 'x\ny' }, { old_string: 'q' }] }, {})).toEqual({ added: 2, removed: 1 })
    expect(editDelta('MultiEdit', {}, {})).toEqual({ added: 0, removed: 0 })
  })

  test('Write against the original file, or against nothing', async () => {
    expect(editDelta('Write', {}, { originalFile: 'a\nb' })).toEqual({ added: 0, removed: 2 })
    expect(editDelta('Write', { content: 'a' }, null)).toEqual({ added: 1, removed: 0 })
  })

  test('NotebookEdit: replace by default, insert, delete', async () => {
    expect(editDelta('NotebookEdit', { new_source: 'x' }, {})).toEqual({ added: 1, removed: 0 })
    expect(editDelta('NotebookEdit', { edit_mode: 'insert', new_source: 'x\ny' }, { old_source: 'z' })).toEqual({ added: 2, removed: 1 })
    expect(editDelta('NotebookEdit', { edit_mode: 'delete', new_source: 'ignored' }, { old_source: 'a\nb' })).toEqual({ added: 0, removed: 2 })
    expect(editDelta('NotebookEdit', { edit_mode: 'replace' }, {})).toEqual({ added: 0, removed: 0 })
  })

  test('any other tool changes nothing; editPath reads file_path or notebook_path', async () => {
    expect(editDelta('Read', { file_path: 'x' }, {})).toEqual({ added: 0, removed: 0 })
    expect(EDIT_TOOLS).toEqual(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
    expect(editPath({ file_path: '/a.ts' })).toBe('/a.ts')
    expect(editPath({ notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
    expect(editPath({ file_path: 3 })).toBeUndefined()
    expect(editPath(undefined)).toBeUndefined()
  })
})

describe('totals and levels', () => {
  test('one file or many', async () => {
    expect(totalsLine([file('/a', 1, 2)])).toBe('+1 −2 · 1 file')
    expect(totalsLine([])).toBe('+0 −0 · 0 files')
    expect(totals([file('/a', 1, 2), file('/b', 3, 0)])).toEqual({ added: 4, removed: 2, count: 2 })
    expect(tideAlt([file('/w/a.ts', 1, 2), file('/w/b.ts', 3, 0)])).toBe('This turn: +4 −2 · 2 files. a.ts +1 −2, b.ts +3 −0')
  })

  test('level: none for nothing, a floor for a ripple, log-scaled up to 1', async () => {
    expect(level(0, 10)).toBe(0)
    expect(level(1, 1000)).toBe(0.18)
    expect(level(300, 300)).toBe(1)
    expect(level(500, 300)).toBe(1)
  })

  test('chip colors are stable per path', async () => {
    expect(chipColor('/w/a.ts')).toBe(chipColor('/w/a.ts'))
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(chipColor)).size).toBeGreaterThan(1)
  })
})

describe('the terminal frame', () => {
  test('layout: sized by change, 4 columns at least, newest kept when they do not all fit', async () => {
    const files = [file('/a', 900, 0), ...Array.from({ length: 5 }, (_, i) => file(`/s${i}`, 0, 0))]
    const segs = layout(files, 40)
    expect(segs.map(s => s.w)).toEqual([15, 4, 4, 4, 4, 4])
    expect(segs.reduce((a, s) => a + s.w + 1, -1)).toBe(40)
    const few = layout(files, 12)
    expect(few.map(s => s.file.path)).toEqual(['/s3', '/s4'])
    expect(few.map(s => s.x)).toEqual([0, 6])
    expect(layout([], 30)).toEqual([])
    // Even one 4-column file does not fit 3 columns: it keeps its 4.
    expect(layout([file('/a', 1, 0)], 3).map(s => s.w)).toEqual([4])
  })

  test('one row: swell and undertow share it; three rows: swell above, ebb below; both fill the width', async () => {
    const files = [file('/w/a.ts', 30, 10), file('/w/b.ts', 0, 8), file('/w/c.ts', 5, 0)]
    for (const rows of [2, 3]) {
      const frame = tideFrame(files, 60, rows, 7, { '/w/a.ts': 1 })
      expect(frame.length).toBe(rows >= 3 ? 2 : 1)
      for (const r of frame) expect([...text(r)].length).toBe(60)
    }
    const flat = tideFrame(files, 60, 2, 7)[0]!
    expect(flat.some(r => /[▔▀█]/.test(r.s) && r.c.startsWith('#'))).toBe(true)
    expect(tideFrame([], 3, 3, 0).map(r => text(r))).toEqual(['        ', '        '])
  })

  test('a full swell crests every fourth column', async () => {
    const big = [file('/w/a.ts', 500, 0)]
    const seen = new Set<string>()
    for (let t = 0; t < 40; t++) for (const r of tideFrame(big, 40, 3, t, { '/w/a.ts': 1 })[0]!) seen.add(r.c)
    expect(seen.has('#dcfce7')).toBe(true)
  })
})

describe('the chip row', () => {
  test('totals, then one chip per file, the newest blinking', async () => {
    const files = [file('/w/a.ts', 1, 0), file('/w/b.ts', 2, 3)]
    expect(text(chipRow(files, 200, '/w/b.ts', 0))).toBe('≋ +3 −3 · 2 files  ● a.ts +1−0  ◉ b.ts +2−3')
    expect(text(chipRow(files, 200, '/w/b.ts', 8))).toBe('≋ +3 −3 · 2 files  ● a.ts +1−0  ● b.ts +2−3')
    expect(text(chipRow([files[0]!], 200, undefined, 0))).toBe('≋ +1 −0 · 1 file  ● a.ts +1−0')
  })

  test('the newest chips that fit whole, then "+N more" for the rest', async () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`/w/f${i}.ts`, i, 0))
    expect(text(chipRow(files, 60, undefined, 0))).toBe('≋ +15 −0 · 6 files  ● f4.ts +4−0  ● f5.ts +5−0  +4 more')
    expect(text(chipRow(files, 300, undefined, 0))).toBe('≋ +15 −0 · 6 files' + files.map(f => `  ● ${f.name} +${f.added}−0`).join(''))
    const many = Array.from({ length: 30 }, (_, i) => file(`/w/g${i}.ts`, 1, 0))
    const row = text(chipRow(many, 140, undefined, 0))
    expect(row).toMatch(/ {2}● g29\.ts \+1−0 {2}\+\d+ more$/)
    expect([...row].length).toBeLessThanOrEqual(140)
  })

  test('too narrow: the newest chip is trimmed with an ellipsis, then nothing more', async () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`/w/f${i}.ts`, i, 0))
    expect(text(chipRow(files, 25, undefined, 0))).toBe('≋ +15 −0 · 6 files  ● f5…')
    const cut = text(chipRow(files, 14, undefined, 0))
    expect(cut).toBe('≋ +15 −0 · 6 …')
  })
})

describe('the desktop svg', () => {
  test('a pool per file with swell and ebb, the newest outlined; one file says "file"', async () => {
    const one = tideSvg([file('/w/a.ts', 3, 2)], 400, 84, 1000)
    expect(one).toMatch(/1 file this turn/)
    expect(one).toMatch(/class="swl"/)
    expect(one).toMatch(/class="ebb"/)
    expect(one).toMatch(/stroke-opacity="0.9"[^>]*class="hi"/)
    expect(one).not.toMatch(/ more</)
  })

  test('no swell for a pure removal, no ebb for a pure addition', async () => {
    const src = tideSvg([file('/w/gone.ts', 0, 9), file('/w/new.ts', 4, 0)], 600, 68, 0)
    expect(src.match(/class="swl"/g)?.length).toBe(2)
    expect(src.match(/class="ebb"/g)?.length).toBe(2)
    expect(src).toMatch(/2 files this turn/)
    expect(src).toMatch(/stroke-opacity="0.3"[^>]*class=""/)
  })

  test('pools that do not fit fold into "+N more"', async () => {
    const files = Array.from({ length: 9 }, (_, i) => file(`/w/f${i}.ts`, i + 1, 0))
    const src = tideSvg(files, 400, 84, 0)
    expect(src).toMatch(/>\+6 more</)
    expect(src).toMatch(/f8\.ts/)
    expect(src).not.toMatch(/f0\.ts/)
  })
})
