// thermal's pure core: heat with decay, the directory tree, its flattening
// for the terminal, and a squarified treemap for the desktop. No `$` here.

import type { ThermalFile, ThermalMetric } from '../types'
import { KZ, mix } from './lib/kz.ts'

export const HALF_LIFE_MS = 10 * 60_000
export const WEIGHTS = { read: 1, search: 0.5, edit: 3, write: 4 } as const
export type HitKind = keyof typeof WEIGHTS

export function decayed(heat: number, at: number, now: number): number {
  return heat * Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE_MS)
}

/** Records one touch on a file (a fresh record when absent). */
export function hit(prev: ThermalFile | undefined, path: string, kind: HitKind, now: number): ThermalFile {
  const f: ThermalFile = prev ? { ...prev } : { path, reads: 0, edits: 0, writes: 0, searches: 0, heat: 0, heatAt: now, lastAt: now }
  if (kind === 'read') f.reads++
  else if (kind === 'edit') f.edits++
  else if (kind === 'write') f.writes++
  else f.searches++
  f.heat = decayed(f.heat, f.heatAt, now) + WEIGHTS[kind]
  f.heatAt = now
  f.lastAt = now
  return f
}

// ---------------------------------------------------------------------------
// Paths.

function norm(p: string): string {
  let s = p.trim().replace(/\\/g, '/')
  const msys = /^\/([a-zA-Z])\//.exec(s)
  if (msys) s = `${msys[1]}:/${s.slice(3)}`
  return s.replace(/\/+$/, '')
}

const isAbs = (p: string) => /^([a-zA-Z]:)?\//.test(p)
const isWinPath = (p: string) => /^[a-zA-Z]:\//.test(p)

export const OUTSIDE = '↗ outside'

/** The tree path of `file` as seen from `cwd`: relative inside it, grouped under OUTSIDE when not. */
export function treePath(cwd: string, file: string): string {
  const c = norm(cwd)
  let f = norm(file)
  if (!isAbs(f)) f = `${c}/${f.replace(/^\.\//, '')}`
  const fold = isWinPath(c) ? (s: string) => s.toLowerCase() : (s: string) => s
  if (fold(f) === fold(c)) return '.'
  if (c && fold(f).startsWith(fold(c) + '/')) {
    // Resolve ./ and ../ inside the cwd.
    const out: string[] = []
    for (const seg of f.slice(c.length + 1).split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') out.pop()
      else out.push(seg)
    }
    return out.join('/') || '.'
  }
  const i = f.lastIndexOf('/')
  return `${OUTSIDE}/${i > 0 ? f.slice(0, i) : '/'}/${f.slice(i + 1)}`.replace(/\/\/+/g, '/')
}

// ---------------------------------------------------------------------------
// The tree.

export type Stats = { reads: number; edits: number; writes: number; searches: number; heat: number; lastAt: number }
export type TreeNode = { name: string; path: string; children: TreeNode[]; stats: Stats; hasSelf: boolean }

const zero = (): Stats => ({ reads: 0, edits: 0, writes: 0, searches: 0, heat: 0, lastAt: 0 })

function add(a: Stats, b: Stats): void {
  a.reads += b.reads
  a.edits += b.edits
  a.writes += b.writes
  a.searches += b.searches
  a.heat += b.heat
  a.lastAt = Math.max(a.lastAt, b.lastAt)
}

export function metricOf(s: Stats, m: ThermalMetric): number {
  if (m === 'reads') return s.reads + s.searches
  if (m === 'edits') return s.edits + s.writes
  return s.heat
}

/**
 * Builds the directory tree: folders aggregate their children, a path that
 * was touched itself and has children keeps its own share too; chains of
 * single folders fold into one node (`src/lib`), as an editor's tree does.
 */
export function buildTree(files: readonly ThermalFile[], now: number): TreeNode {
  type Raw = { name: string; kids: Map<string, Raw>; self?: Stats }
  const root: Raw = { name: '.', kids: new Map() }
  for (const f of files) {
    let at = root
    if (f.path !== '.') {
      for (const seg of f.path.split('/')) {
        let next = at.kids.get(seg)
        if (!next) {
          next = { name: seg, kids: new Map() }
          at.kids.set(seg, next)
        }
        at = next
      }
    }
    const s: Stats = { reads: f.reads, edits: f.edits, writes: f.writes, searches: f.searches, heat: decayed(f.heat, f.heatAt, now), lastAt: f.lastAt }
    if (at.self) add(at.self, s)
    else at.self = s
  }
  const make = (r: Raw, path: string): TreeNode => {
    const children = [...r.kids.values()].map(k => make(k, path ? `${path}/${k.name}` : k.name))
    const stats = zero()
    if (r.self) add(stats, r.self)
    for (const c of children) add(stats, c.stats)
    let node: TreeNode = { name: r.name, path, children, stats, hasSelf: r.self !== undefined }
    // Fold a folder holding exactly one folder and nothing of its own.
    while (!node.hasSelf && node.children.length === 1 && node.children[0]!.children.length > 0 && node.path !== '') {
      const only = node.children[0]!
      node = { ...only, name: `${node.name}/${only.name}` }
    }
    return node
  }
  return make(root, '')
}

/** Children sorted hottest first by the metric, zero-valued ones dropped. */
export function ranked(node: TreeNode, m: ThermalMetric): TreeNode[] {
  return node.children.filter(c => metricOf(c.stats, m) > 0).sort((a, b) => metricOf(b.stats, m) - metricOf(a.stats, m) || a.name.localeCompare(b.name))
}

export type Row = { node: TreeNode; depth: number; isDir: boolean }

/** Depth-first rows, hottest first at every level, at most `limit` of them. */
export function flatten(root: TreeNode, m: ThermalMetric, limit: number): { rows: Row[]; hidden: number } {
  const rows: Row[] = []
  let total = 0
  const walk = (n: TreeNode, depth: number) => {
    for (const c of ranked(n, m)) {
      total++
      if (rows.length < limit) rows.push({ node: c, depth, isDir: c.children.length > 0 })
      walk(c, depth + 1)
    }
  }
  walk(root, 0)
  return { rows, hidden: Math.max(0, total - rows.length) }
}

// ---------------------------------------------------------------------------
// Color: a thermal ramp, cold indigo through violet and magenta to amber and yellow.

const RAMP: [number, string][] = [[0, '#3b4b9a'], [0.3, KZ.violet], [0.55, KZ.magenta], [0.8, KZ.amber], [1, KZ.yellow]]

export function thermal(t: number): string {
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  // The first stop at or past k (never the 0 stop): the last stop is 1, so one always is.
  const i = Math.max(1, RAMP.findIndex(([p]) => k <= p))
  const [p1, c1] = RAMP[i]!
  const [p0, c0] = RAMP[i - 1]!
  return mix(c0, c1, (k - p0) / (p1 - p0))
}

// ---------------------------------------------------------------------------
// Squarified treemap (Bruls, Huizing, van Wijk): lay rows of rectangles along
// the shorter side, adding an item to the row while that improves the row's
// worst aspect ratio, else freezing the row and starting the next.

export type Rect = { x: number; y: number; w: number; h: number }
export type Placed<T> = Rect & { item: T }

function worst(areas: readonly number[], side: number): number {
  if (!areas.length || side <= 0) return Infinity
  const s = areas.reduce((a, b) => a + b, 0)
  const hi = Math.max(...areas)
  const lo = Math.min(...areas)
  const s2 = s * s
  const w2 = side * side
  return Math.max((w2 * hi) / s2, s2 / (w2 * lo))
}

export function squarify<T>(items: readonly { value: number; item: T }[], rect: Rect): Placed<T>[] {
  const list = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  const total = list.reduce((a, b) => a + b.value, 0)
  if (!list.length || rect.w <= 0 || rect.h <= 0 || total <= 0) return []
  const scale = (rect.w * rect.h) / total
  const areas = list.map(i => i.value * scale)
  const out: Placed<T>[] = []
  let r = { ...rect }
  let row: number[] = []
  let rowStart = 0

  const layRow = (from: number, rowAreas: number[]) => {
    const s = rowAreas.reduce((a, b) => a + b, 0)
    if (r.w >= r.h) {
      // A column at the left, as wide as the row's area over the height.
      const cw = s / r.h
      let y = r.y
      rowAreas.forEach((a, k) => {
        const h = a / cw
        out.push({ x: r.x, y, w: cw, h, item: list[from + k]!.item })
        y += h
      })
      r = { x: r.x + cw, y: r.y, w: r.w - cw, h: r.h }
    } else {
      // A strip along the top.
      const rh = s / r.w
      let x = r.x
      rowAreas.forEach((a, k) => {
        const w = a / rh
        out.push({ x, y: r.y, w, h: rh, item: list[from + k]!.item })
        x += w
      })
      r = { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh }
    }
  }

  for (let i = 0; i < areas.length; i++) {
    const a = areas[i]!
    const side = Math.min(r.w, r.h)
    if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
      row.push(a)
    } else {
      layRow(rowStart, row)
      rowStart = i
      row = [a]
    }
  }
  // The list is not empty, so the last row holds at least its last item.
  layRow(rowStart, row)
  return out
}
