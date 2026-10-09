import { describe, expect, test } from 'claude-code/testing'

import { HALF_LIFE_MS, OUTSIDE, WEIGHTS, buildTree, decayed, flatten, hit, metricOf, ranked, squarify, thermal, treePath } from '../hooks/heatmap.ts'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('heat', () => {
  test('heat halves every half-life and never warms when the clock goes back', async () => {
    expect(near(decayed(8, 0, 2 * HALF_LIFE_MS), 2)).toBe(true)
    expect(decayed(8, 1000, 0)).toBe(8)
  })

  test('each kind of touch counts and weighs its own', async () => {
    let f = hit(undefined, 'a.ts', 'read', 0)
    f = hit(f, 'a.ts', 'search', 0)
    f = hit(f, 'a.ts', 'edit', 0)
    f = hit(f, 'a.ts', 'write', HALF_LIFE_MS)
    expect([f.reads, f.searches, f.edits, f.writes]).toEqual([1, 1, 1, 1])
    expect(near(f.heat, (WEIGHTS.read + WEIGHTS.search + WEIGHTS.edit) / 2 + WEIGHTS.write)).toBe(true)
    expect([f.heatAt, f.lastAt]).toEqual([HALF_LIFE_MS, HALF_LIFE_MS])
    const prev = hit(undefined, 'b.ts', 'read', 0)
    hit(prev, 'b.ts', 'read', 5)
    expect(prev.reads).toBe(1)
  })

  test('metricOf: heat, reads with searches, edits with writes', async () => {
    const s = { reads: 2, searches: 3, edits: 4, writes: 5, heat: 1.5, lastAt: 0 }
    expect([metricOf(s, 'heat'), metricOf(s, 'reads'), metricOf(s, 'edits')]).toEqual([1.5, 5, 9])
  })
})

describe('paths', () => {
  test('inside the cwd: relative, with ./ and ../ resolved, case folded only on Windows', async () => {
    expect(treePath('/work', '/work/src/a.ts')).toBe('src/a.ts')
    expect(treePath('/work/', './lib/b.ts')).toBe('lib/b.ts')
    expect(treePath('C:\\Code', 'c:\\code\\src\\..\\x.ts')).toBe('x.ts')
    expect(treePath('/Work', '/work/a.ts')).toBe(`${OUTSIDE}/work/a.ts`)
    expect(treePath('/c/Code', 'C:/code/a.ts')).toBe('a.ts')
    expect(treePath('/work', '/work//a//b.ts')).toBe('a/b.ts')
  })

  test('the cwd itself, or a path that resolves back to it, is "."', async () => {
    expect(treePath('/work', '/work')).toBe('.')
    expect(treePath('/work', '/work/')).toBe('.')
    expect(treePath('/work', '/work/src/..')).toBe('.')
  })

  test('outside the cwd: grouped under the outside folder, a root file under "/"', async () => {
    expect(treePath('/work', '/etc/hosts')).toBe(`${OUTSIDE}/etc/hosts`)
    expect(treePath('/work', '/hosts')).toBe(`${OUTSIDE}/hosts`)
    expect(treePath('', 'a.ts')).toBe(`${OUTSIDE}/a.ts`)
    expect(treePath('D:/proj', 'E:/data/x.csv')).toBe(`${OUTSIDE}/E:/data/x.csv`)
  })
})

describe('the tree', () => {
  test('folders aggregate; single-folder chains fold; a touched folder keeps its own share', async () => {
    const files = [
      hit(undefined, 'src/a/b/c.ts', 'edit', 0),
      hit(undefined, 'src/z.ts', 'write', 0),
      hit(undefined, 'src', 'search', 0),
      hit(undefined, '.', 'search', 0),
    ]
    const root = buildTree(files, 0)
    expect(root.hasSelf).toBe(true)
    expect(root.stats.searches).toBe(2)
    const src = root.children[0]!
    expect([src.name, src.hasSelf, src.stats.edits, src.stats.writes]).toEqual(['src', true, 1, 1])
    expect(src.children.map(c => c.name)).toEqual(['a/b', 'z.ts'])
    expect(src.children[0]!.path).toBe('src/a/b')
  })

  test('the same path twice adds up', async () => {
    const root = buildTree([hit(undefined, 'a.ts', 'read', 0), hit(undefined, 'a.ts', 'read', 100)], 100)
    expect(root.children[0]!.stats.reads).toBe(2)
    expect(root.children[0]!.stats.lastAt).toBe(100)
  })

  test('ranked: hottest first, ties by name, zeros dropped; flatten caps rows and counts the rest', async () => {
    const root = buildTree([
      hit(undefined, 'b.ts', 'read', 0),
      hit(undefined, 'a.ts', 'read', 0),
      hit(undefined, 'w.ts', 'write', 0),
      hit(undefined, 'd/x.ts', 'edit', 0),
    ], 0)
    expect(ranked(root, 'heat').map(n => n.name)).toEqual(['w.ts', 'd', 'a.ts', 'b.ts'])
    expect(ranked(root, 'reads').map(n => n.name)).toEqual(['a.ts', 'b.ts'])
    const { rows, hidden } = flatten(root, 'heat', 3)
    expect(rows.map(r => [r.node.name, r.depth, r.isDir])).toEqual([['w.ts', 0, false], ['d', 0, true], ['x.ts', 1, false]])
    expect(hidden).toBe(2)
    expect(flatten(root, 'edits', 10).hidden).toBe(0)
  })
})

describe('color and layout', () => {
  test('thermal: cold to hot along the ramp, clamped, NaN as cold', async () => {
    expect(thermal(0)).toBe('#3b4b9a')
    expect(thermal(-3)).toBe(thermal(0))
    expect(thermal(Number.NaN)).toBe(thermal(0))
    expect(thermal(9)).toBe(thermal(1))
    expect(thermal(1)).toMatch(/^#[0-9a-f]{6}$/i)
    expect(new Set([0, 0.2, 0.4, 0.7, 0.9, 1].map(thermal)).size).toBe(6)
  })

  test('squarify fills the rect without overlap, in a column or a strip', async () => {
    for (const rect of [{ x: 0, y: 0, w: 6, h: 4 }, { x: 10, y: 5, w: 3, h: 9 }]) {
      const rects = squarify([6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ value, item: i })), rect)
      expect(rects.length).toBe(7)
      expect(Math.abs(rects.reduce((a, r) => a + r.w * r.h, 0) - rect.w * rect.h) < 1e-6).toBe(true)
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(rect.x - 1e-9)
        expect(r.x + r.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-6)
        expect(r.y + r.h).toBeLessThanOrEqual(rect.y + rect.h + 1e-6)
      }
    }
  })

  test('squarify: nothing to lay out gives nothing', async () => {
    const one = [{ value: 1, item: 'a' }]
    expect(squarify([], { x: 0, y: 0, w: 5, h: 5 })).toEqual([])
    expect(squarify([{ value: 0, item: 'z' }, { value: -2, item: 'n' }], { x: 0, y: 0, w: 5, h: 5 })).toEqual([])
    expect(squarify(one, { x: 0, y: 0, w: 0, h: 5 })).toEqual([])
    expect(squarify(one, { x: 0, y: 0, w: 5, h: 0 })).toEqual([])
    expect(squarify(one, { x: 1, y: 2, w: 5, h: 5 })).toEqual([{ x: 1, y: 2, w: 5, h: 5, item: 'a' }])
  })

  test('squarify: a value that dwarfs the rest leaves no room, and the rest still get placed', async () => {
    const rects = squarify([1e17, 1, 1].map((value, i) => ({ value, item: i })), { x: 0, y: 0, w: 1, h: 1 })
    expect(rects.map(r => r.item)).toEqual([0, 1, 2])
    expect(rects[0]!.w).toBe(1)
  })
})
