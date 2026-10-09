// Tidewater's pure core: how many lines an edit added and removed, the turn's
// files, the terminal wave frame and the desktop SVG. No `$` here.
import type { TideFile } from '../types'
import { KZ, baseName, clamp01, fitText, hash, mix, svg, svgText } from './lib/kz.ts'

export type Delta = { added: number; removed: number }
export type { TideFile }
export type Run = { s: string; c: string }

export function lines(text: string): string[] {
  if (!text) return []
  const ls = text.split(/\r?\n/)
  if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop()
  return ls
}

/**
 * Lines added and removed going from `before` to `after`: the common head and
 * tail are trimmed, and the middle is diffed by LCS when small enough (else
 * counted whole, which is what a rewrite of that size is anyway).
 */
export function lineDelta(before: string, after: string): Delta {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const ma = a.slice(head, a.length - tail)
  const mb = b.slice(head, b.length - tail)
  if (!ma.length || !mb.length || ma.length * mb.length > 250_000) return { added: mb.length, removed: ma.length }
  // LCS length, one row at a time (every index read is inside the zero-filled rows).
  let prev = new Array<number>(mb.length + 1).fill(0)
  for (let i = 1; i <= ma.length; i++) {
    const cur = new Array<number>(mb.length + 1).fill(0)
    for (let j = 1; j <= mb.length; j++) {
      cur[j] = ma[i - 1] === mb[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!)
    }
    prev = cur
  }
  const common = prev[mb.length]!
  return { added: mb.length - common, removed: ma.length - common }
}

type Hunk = { lines?: unknown }

/** Counts `+` and `-` lines of a tool's structuredPatch, or undefined when there is none. */
export function patchDelta(patch: unknown): Delta | undefined {
  if (!Array.isArray(patch)) return undefined
  let added = 0
  let removed = 0
  for (const h of patch as Hunk[]) {
    if (!h || !Array.isArray(h.lines)) return undefined
    for (const l of h.lines) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

const str = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined)

/**
 * What one Edit / MultiEdit / Write / NotebookEdit changed. The tool's own
 * result is read first (its structuredPatch, or the original file it reports);
 * failing that, the input: old_string vs new_string, or the written content.
 */
export function editDelta(tool: string, input: unknown, result: unknown): Delta {
  const e = (input ?? {}) as Record<string, unknown>
  const r = (result ?? {}) as Record<string, unknown>
  const fromPatch = patchDelta(r.structuredPatch)
  if (fromPatch && fromPatch.added + fromPatch.removed > 0) return fromPatch
  if (tool === 'Edit') {
    const d = lineDelta(str(e, 'old_string') ?? '', str(e, 'new_string') ?? '')
    if (e.replace_all === true && typeof r.originalFile === 'string') {
      const n = Math.max(1, (r.originalFile as string).split(str(e, 'old_string') || '\u0000').length - 1)
      return { added: d.added * n, removed: d.removed * n }
    }
    return d
  }
  if (tool === 'MultiEdit' && Array.isArray(e.edits)) {
    return (e.edits as Record<string, unknown>[]).reduce<Delta>((acc, ed) => {
      const d = lineDelta(str(ed, 'old_string') ?? '', str(ed, 'new_string') ?? '')
      return { added: acc.added + d.added, removed: acc.removed + d.removed }
    }, { added: 0, removed: 0 })
  }
  if (tool === 'Write') {
    const content = str(e, 'content') ?? ''
    return lineDelta(str(r, 'originalFile') ?? '', content)
  }
  if (tool === 'NotebookEdit') {
    const mode = str(e, 'edit_mode') ?? 'replace'
    const next = mode === 'delete' ? '' : str(e, 'new_source') ?? ''
    return lineDelta(str(r, 'old_source') ?? '', next)
  }
  return { added: 0, removed: 0 }
}

export const EDIT_TOOLS: readonly string[] = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

export function editPath(input: unknown): string | undefined {
  const e = (input ?? {}) as Record<string, unknown>
  return str(e, 'file_path') ?? str(e, 'notebook_path')
}

/** The turn's files with one more edit folded in (the most recent last). */
export function mergeEdit(files: readonly TideFile[], path: string, d: Delta, at: number): TideFile[] {
  const old = files.find(f => f.path === path)
  const rest = files.filter(f => f.path !== path)
  const merged: TideFile = old
    ? { ...old, added: old.added + d.added, removed: old.removed + d.removed, edits: old.edits + 1, at }
    : { path, name: baseName(path), added: d.added, removed: d.removed, edits: 1, at }
  return [...rest, merged]
}

export function totals(files: readonly TideFile[]): { added: number; removed: number; count: number } {
  return files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed, count: a.count + 1 }), { added: 0, removed: 0, count: 0 })
}

/** `+128 −42 · 6 files` */
export function totalsLine(files: readonly TideFile[]): string {
  const t = totals(files)
  return `+${t.added} −${t.removed} · ${t.count} ${t.count === 1 ? 'file' : 'files'}`
}

/** 0..1, log-scaled so a 3-line fix still makes a ripple beside a 300-line rewrite. */
export function level(n: number, max: number): number {
  if (n <= 0) return 0
  return Math.max(0.18, clamp01(Math.log1p(n) / Math.log1p(Math.max(n, max))))
}

const CHIP = [KZ.cyan, KZ.violet, KZ.blue, KZ.magenta, KZ.teal, KZ.yellow, KZ.amber, KZ.lime]
export function chipColor(path: string): string {
  return CHIP[hash(path) % CHIP.length]!
}

const SEA = ['#14532d', '#15803d', '#22c55e', '#4ade80', '#86efac', '#dcfce7']
const EBB = ['#7f1d1d', '#b91c1c', '#ef4444', '#f87171', '#fca5a5']
const RISE = ' ▁▂▃▄▅▆▇█'
const SINK = [' ', '▔', '▔', '▀', '▀', '▀', '█', '█', '█']

/** Columns per file: by the size of its change, at least 4 each; those that do not fit fold into "more". */
export function layout(files: readonly TideFile[], cols: number): { file: TideFile; x: number; w: number }[] {
  const shown = [...files].reverse().slice(0, Math.max(1, Math.floor(cols / 5))).reverse()
  const weights = shown.map(f => Math.sqrt(f.added + f.removed + 1))
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const free = Math.max(shown.length * 4, cols - (shown.length - 1))
  const widths = weights.map(w => Math.max(4, Math.floor((w / sum) * free)))
  let over = widths.reduce((a, b) => a + b, 0) + shown.length - 1 - cols
  for (let i = widths.length - 1; over > 0 && i >= 0; i--) {
    const take = Math.min(over, widths[i]! - 4)
    widths[i] = widths[i]! - take
    over -= take
  }
  let x = 0
  return shown.map((file, i) => {
    const w = widths[i]!
    const out = { file, x, w }
    x += w + 1
    return out
  })
}

/** `surge[path]` is 0..1, a fresh edit's swell that fades. */
export function tideFrame(files: readonly TideFile[], cols: number, rows: number, t: number, surge: Readonly<Record<string, number>> = {}): Run[][] {
  const W = Math.max(8, Math.floor(cols))
  const segs = layout(files, W)
  const maxA = Math.max(1, ...files.map(f => f.added))
  const maxR = Math.max(1, ...files.map(f => f.removed))
  const isTall = rows >= 3
  const rowSea: Run[] = []
  const rowEbb: Run[] = []
  const push = (row: Run[], s: string, c: string) => {
    const last = row[row.length - 1]
    if (last && (last.c === c || s === ' ')) last.s += s
    else row.push({ s, c })
  }
  let x = 0
  for (const seg of segs) {
    while (x < seg.x) {
      push(rowSea, ' ', '')
      if (isTall) push(rowEbb, ' ', '')
      x++
    }
    const f = seg.file
    const boost = 1 + 0.5 * (surge[f.path] ?? 0)
    const la = level(f.added, maxA)
    const lr = level(f.removed, maxR)
    const phase = (hash(f.path) % 628) / 100
    // On a single row, removals take the right end of the segment as an undertow.
    const split = isTall ? seg.w : Math.round(seg.w * (f.added + 0.01) / (f.added + f.removed + 0.02))
    for (let i = 0; i < seg.w; i++) {
      const swell = 0.6 + 0.4 * Math.sin(i * 0.62 - t * 0.21 + phase) * Math.cos(i * 0.17 + t * 0.05)
      const ebb = 0.6 + 0.4 * Math.sin(i * 0.55 + t * 0.16 + phase * 1.7)
      if (i < split) {
        const h = Math.round(clamp01(la * boost * swell) * 8)
        const crest = h >= 7 && (i + Math.floor(t / 3)) % 4 === 0
        push(rowSea, RISE.charAt(h), crest ? SEA[5]! : SEA[Math.min(4, Math.max(0, Math.floor(h / 2)))]!)
      } else {
        const d = Math.round(clamp01(lr * boost * ebb) * 8)
        push(rowSea, SINK[d]!, EBB[Math.min(4, Math.floor(d / 2))]!)
      }
      if (isTall) {
        const d = Math.round(clamp01(lr * boost * ebb) * 8)
        push(rowEbb, SINK[d]!, EBB[Math.min(4, Math.floor(d / 2))]!)
      }
      x++
    }
  }
  while (x < W) {
    push(rowSea, ' ', '')
    if (isTall) push(rowEbb, ' ', '')
    x++
  }
  const out = [rowSea]
  if (isTall) out.push(rowEbb)
  return out
}

/** The chip row: totals, then `● name +a −r` per file, newest last; trimmed to `cols`. */
export function chipRow(files: readonly TideFile[], cols: number, newest: string | undefined, t: number): Run[] {
  const runs: Run[] = []
  const t0 = totals(files)
  let used = 0
  const add = (s: string, c: string) => {
    if (used >= cols) return
    const room = cols - used
    const cut = [...s].length > room ? [...s].slice(0, Math.max(0, room - 1)).join('') + '…' : s
    used += [...cut].length
    runs.push({ s: cut, c })
  }
  add('≋ ', mix(KZ.cyan, KZ.teal, (Math.sin(t / 9) + 1) / 2))
  add(`+${t0.added}`, KZ.green)
  add(' ', '')
  add(`−${t0.removed}`, KZ.red)
  add(` · ${t0.count} ${t0.count === 1 ? 'file' : 'files'}`, KZ.mist)
  // The newest chips that fit whole beside a "+N more" for the rest; the newest
  // always (trimmed if need be).
  const chipW = (f: TideFile) => [...`  ● ${f.name} +${f.added}−${f.removed}`].length
  const shown: TideFile[] = []
  let room = cols - used
  for (const f of [...files].reverse()) {
    const rest = files.length - shown.length - 1
    if (shown.length && chipW(f) + (rest > 0 ? `  +${rest} more`.length : 0) > room) break
    shown.unshift(f)
    room -= chipW(f)
  }
  const hidden = files.length - shown.length
  for (const f of shown) {
    add('  ', '')
    const isNew = f.path === newest
    add(isNew && t % 16 < 8 ? '◉ ' : '● ', chipColor(f.path))
    add(f.name, isNew ? '#e5e7eb' : '#cbd5e1')
    add(` +${f.added}`, KZ.green)
    add(`−${f.removed}`, KZ.red)
  }
  if (hidden > 0) add(`  +${hidden} more`, KZ.mist)
  return runs
}

// ---------------------------------------------------------------------------
// Desktop: one SVG. A totals panel, then a tide pool per file: green swell
// rising above the waterline, red ebb sinking below it, both rolling by CSS.

function wavePath(w: number, period: number, mid: number, amp: number, up: boolean): string {
  const pts: string[] = []
  const span = w + period
  for (let x = 0; x <= span; x += 3) {
    const y = mid + (up ? -1 : 1) * amp * (0.78 + 0.22 * Math.sin((2 * Math.PI * x) / period))
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return `M0,${mid}L${pts.join('L')}L${span.toFixed(1)},${mid}Z`
}

export function tideSvg(files: readonly TideFile[], W: number, H: number, now: number): string {
  const t0 = totals(files)
  const PANEL = 116
  const gap = 8
  const avail = W - PANEL - gap
  const maxCards = Math.max(1, Math.floor((avail + gap) / (84 + gap)))
  const shown = [...files].reverse().slice(0, maxCards).reverse()
  const cw = Math.min(170, (avail - gap * (shown.length - 1)) / shown.length)
  const maxA = Math.max(1, ...files.map(f => f.added))
  const maxR = Math.max(1, ...files.map(f => f.removed))
  const newest = files[files.length - 1]?.path
  const sec = now / 1000
  const parts: string[] = []
  const css = `
.swl{animation:swl 3.2s linear infinite}@keyframes swl{to{transform:translateX(-48px)}}
.ebb{animation:ebb 4.4s linear infinite}@keyframes ebb{to{transform:translateX(-40px)}}
.bob{animation:bob 2.6s ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1.5px)}}
.wl{stroke:#94a3b8;stroke-opacity:.35}
.hi{animation:hi 1.8s ease-in-out infinite}@keyframes hi{50%{stroke-opacity:.25}}`

  // Totals.
  parts.push(`<rect class="p" x="0" y="0" width="${PANEL}" height="${H}" rx="12"/>`)
  parts.push(svgText(12, 17, '≋ TIDEWATER', { cls: 'm', size: 9.5, weight: 700 }))
  parts.push(svgText(12, H / 2 + 6, `+${t0.added}`, { size: 19, weight: 800, fill: KZ.green }))
  parts.push(svgText(PANEL - 10, H / 2 + 6, `−${t0.removed}`, { size: 15, weight: 750, fill: KZ.red, anchor: 'end' }))
  parts.push(svgText(12, H - 10, `${t0.count} ${t0.count === 1 ? 'file' : 'files'} this turn`, { cls: 's', size: 10.5 }))

  const top = 4
  const poolH = H - 22
  const mid = top + poolH / 2
  shown.forEach((f, i) => {
    const x = PANEL + gap + i * (cw + gap)
    const id = `twc${i}`
    const ha = (poolH / 2 - 3) * level(f.added, maxA)
    const hr = (poolH / 2 - 3) * level(f.removed, maxR)
    const isNew = f.path === newest
    const c = chipColor(f.path)
    const dSwl = -((sec + (hash(f.path) % 97) / 10) % 3.2)
    const dEbb = -((sec + (hash(f.path) % 89) / 10) % 4.4)
    parts.push(`<defs><clipPath id="${id}"><rect x="${x.toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${poolH}" rx="9"/></clipPath></defs>`)
    parts.push(`<rect class="p" x="${x.toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${poolH}" rx="9"/>`)
    parts.push(`<g clip-path="url(#${id})">`)
    if (ha > 0) {
      parts.push(`<g transform="translate(${x.toFixed(1)} 0)"><g class="bob"><path class="swl" style="animation-delay:${dSwl.toFixed(2)}s" d="${wavePath(cw, 48, mid, ha, true)}" fill="${KZ.green}" fill-opacity=".55"/>`)
      parts.push(`<path class="swl" style="animation-delay:${(dSwl - 1.1).toFixed(2)}s;animation-duration:2.3s" d="${wavePath(cw, 48, mid, ha * 0.7, true)}" fill="#86efac" fill-opacity=".55"/></g></g>`)
    }
    if (hr > 0) {
      parts.push(`<g transform="translate(${x.toFixed(1)} 0)"><path class="ebb" style="animation-delay:${dEbb.toFixed(2)}s" d="${wavePath(cw, 40, mid, hr, false)}" fill="${KZ.red}" fill-opacity=".5"/>`)
      parts.push(`<path class="ebb" style="animation-delay:${(dEbb - 1.7).toFixed(2)}s;animation-duration:3.1s" d="${wavePath(cw, 40, mid, hr * 0.65, false)}" fill="#fca5a5" fill-opacity=".45"/></g>`)
    }
    parts.push(`<line class="wl" x1="${x.toFixed(1)}" x2="${(x + cw).toFixed(1)}" y1="${mid}" y2="${mid}" stroke-dasharray="3 3"/></g>`)
    parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${poolH}" rx="9" fill="none" stroke="${c}" stroke-opacity="${isNew ? 0.9 : 0.3}" stroke-width="${isNew ? 1.6 : 1}" class="${isNew ? 'hi' : ''}"/>`)
    parts.push(svgText(x + 6, top + 13, `+${f.added}`, { size: 10.5, weight: 700, fill: KZ.green }))
    parts.push(svgText(x + cw - 6, top + poolH - 6, `−${f.removed}`, { size: 10.5, weight: 700, fill: KZ.red, anchor: 'end' }))
    parts.push(`<circle cx="${(x + 6).toFixed(1)}" cy="${H - 8}" r="3" fill="${c}"/>`)
    parts.push(svgText(x + 13, H - 4.5, fitText(f.name, 10.5, cw - 16), { cls: isNew ? 't' : 's', size: 10.5, weight: isNew ? 650 : 500, mono: true }))
  })
  if (files.length > shown.length) parts.push(svgText(W - 4, 14, `+${files.length - shown.length} more`, { cls: 'm', size: 9.5, anchor: 'end' }))
  return svg(W, H, parts.join(''), css)
}

export function tideAlt(files: readonly TideFile[]): string {
  return `This turn: ${totalsLine(files)}. ${files.map(f => `${f.name} +${f.added} −${f.removed}`).join(', ')}`
}
