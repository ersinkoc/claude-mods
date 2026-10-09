// Glyphfall's pure drawing: the rain as a cell frame for the terminal, the
// chip row, and one SVG for the desktop. No `$` here.
import { KZ, clip, fitText, hash, mix, noise, svg, svgText, textWidth, toolGlyph, toolName, xml } from './lib/kz.ts'

export type Tool = { id: string; at: number; end: number | null; name: string; detail: string; color: string; isError: boolean }
export type Seg = { s: string; c?: string; bg?: string; b?: boolean; d?: boolean }

/** Half-width katakana and a few symbols: each one cell wide. */
export const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789:.=*+<>¦╌'
export const FADE = '#4b5563'

const IN_MS = 450
const HOLD_MS = 1500
const MAX_HOLD_MS = 30_000
const FALL_ROWS_S = 9
const STAGGER_MS = 34

/** The text a tool's stream spells: its name, then a piece of its detail. */
export function wordOf(t: Pick<Tool, 'name' | 'detail'>, max: number): string {
  const name = toolName(t.name)
  const detail = t.detail.replace(/\s+/g, ' ').trim()
  const word = detail ? `${name} ${detail}` : name
  return word.length > max ? word.slice(0, Math.max(1, max)) : word
}

/** A glyph that changes now and then, per cell. */
export function glyphAt(x: number, y: number, now: number, salt = 0): string {
  const rate = 260 + Math.floor(noise(x, y + salt) * 900)
  // noise is below 1, so the index stays inside GLYPHS.
  const i = Math.floor(noise(x * 7 + salt, y * 13 + Math.floor(now / rate)) * GLYPHS.length)
  return GLYPHS.charAt(i)
}

/** Where a word's letter `j` hangs at `now`: rows from the top, -Infinity before it starts. */
export function letterY(t: Tool, j: number, now: number, mid: number): number {
  const age = now - t.at - j * STAGGER_MS
  if (age < 0) return -Infinity
  if (age < IN_MS) {
    const k = age / IN_MS
    return -1 + (mid + 1) * (1 - (1 - k) * (1 - k))
  }
  const holdUntil = t.end === null ? t.at + MAX_HOLD_MS : Math.max(t.at + IN_MS + HOLD_MS, t.end)
  const fallFrom = holdUntil + j * STAGGER_MS
  if (now < fallFrom) return mid
  return mid + ((now - fallFrom) / 1000) * FALL_ROWS_S
}

/** When a tool's word has left the band for good (Infinity while it runs). */
function goneAt(t: Tool): number {
  return t.end === null ? Infinity : Math.max(t.end, t.at + IN_MS + HOLD_MS) + 2500
}

/**
 * The first column of each tool's word, so words in flight together never
 * overlap. A word's place depends only on the words already in flight when it
 * started, so it never moves while it falls.
 */
export function placeWords(tools: readonly Tool[], cols: number, maxLen: number): Map<string, number> {
  const placed = new Map<string, number>()
  const spans: { t: Tool; x: number; len: number }[] = []
  for (const t of [...tools].sort((a, b) => a.at - b.at)) {
    const len = wordOf(t, maxLen).length
    const room = Math.max(1, cols - len)
    const busy = spans.filter(s => goneAt(s.t) >= t.at)
    const free = (x: number) => busy.every(s => x + len + 1 < s.x || x > s.x + s.len + 1)
    const want = hash(t.id) % room
    let x = want
    for (let k = 1; k < room && !free(x); k++) {
      const right = (want + k) % room
      if (free(right)) {
        x = right
        break
      }
    }
    placed.set(t.id, x)
    spans.push({ t, x, len })
  }
  return placed
}

type Cell = { ch: string; c: string; b?: boolean }

/** The rain: `rows` lines of `cols` cells at `now`. */
export function rainFrame(tools: readonly Tool[], now: number, cols: number, rows: number): Seg[][] {
  const W = Math.max(4, Math.floor(cols))
  const H = Math.max(1, Math.floor(rows))
  const grid: (Cell | undefined)[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => undefined))
  const latest = tools[tools.length - 1]
  const tint = latest ? mix(latest.color, KZ.green, 0.5) : KZ.green
  const quiet = mix(tint, FADE, 0.5)

  // The quiet rain: a stream now and then per column, its period and speed its own.
  for (let x = 0; x < W; x++) {
    const period = 1800 + noise(x, 1) * 3400
    const shifted = now + noise(x, 2) * period
    const cycle = Math.floor(shifted / period)
    if (noise(x, cycle * 3 + 5) > 0.3) continue
    const speed = 5 + noise(x, cycle) * 9
    const head = ((shifted % period) / 1000) * speed - 1
    const len = 2 + noise(x, cycle + 9) * 4
    for (let y = 0; y < H; y++) {
      const d = head - y
      if (d < 0 || d >= len) continue
      grid[y]![x] = d < 1
        ? { ch: glyphAt(x, y, now), c: mix(tint, '#e5fff0', 0.25), b: true }
        : { ch: glyphAt(x, y, now, 3), c: mix(quiet, FADE, (d / len) * 0.8) }
    }
  }

  // The tools: each word falls as a wave across neighbouring columns, hangs
  // mid-band (as long as the tool runs), then drops out.
  const mid = Math.floor((H - 1) / 2)
  const maxLen = Math.min(28, W - 2)
  // Every tool has its place.
  const places = placeWords(tools, W, maxLen)
  for (const t of tools) {
    const word = wordOf(t, maxLen)
    const x0 = places.get(t.id)!
    const color = t.isError ? KZ.red : t.color
    for (let j = 0; j < word.length; j++) {
      const ch = word.charAt(j)
      const y = letterY(t, j, now, mid)
      if (!Number.isFinite(y) || y - 4 > H) continue
      const hy = Math.round(y)
      const x = x0 + j
      // The tail: glyphs above the head, fading.
      for (let d = 1; d <= 3; d++) {
        const line = grid[hy - d]
        if (line && x < W) line[x] = { ch: glyphAt(x, hy - d, now, 11), c: mix(color, FADE, 0.25 + d * 0.2) }
      }
      const line = grid[hy]
      if (line && x < W && ch !== ' ') line[x] = { ch, c: mix(color, '#ffffff', 0.18), b: true }
      else if (line && x < W) line[x] = undefined
    }
  }

  return grid.map(line => {
    const segs: Seg[] = []
    for (const cell of line) {
      const ch = cell?.ch ?? ' '
      const last = segs[segs.length - 1]
      if (last && last.c === cell?.c && last.b === cell?.b) last.s += ch
      else segs.push({ s: ch, c: cell?.c, b: cell?.b })
    }
    return segs
  })
}

/** The newest tools, newest first, as colored chips fitted to `cols`. */
export function chipLine(tools: readonly Tool[], now: number, cols: number): Seg[] {
  const segs: Seg[] = []
  let used = 0
  for (const t of [...tools].reverse().slice(0, 5)) {
    const name = toolName(t.name)
    const mark = t.isError ? '✖' : t.end === null ? '◐◓◑◒'.charAt(Math.floor(now / 150) % 4) : toolGlyph(t.name)
    const chip = ` ${mark} ${name} `
    const detail = t.detail ? ` ${clip(t.detail, 18)}` : ''
    if (used + chip.length + 1 > cols) break
    segs.push({ s: chip, c: '#0b0f14', bg: t.isError ? KZ.red : t.color, b: true })
    used += chip.length
    const room = Math.min(detail.length, cols - used - 2)
    if (room > 3) {
      segs.push({ s: detail.slice(0, room), d: true })
      used += room
    }
    segs.push({ s: '  ' })
    used += 2
  }
  return segs
}

/** The desktop drawing: rain columns falling by CSS, tool words dropping in, chips below. */
export function rainSvg(tools: readonly Tool[], now: number, W: number, H: number): string {
  const CH = 11 // column pitch
  const chipH = 26
  const RH = H - chipH - 4
  const cols = Math.floor((W - 8) / CH)
  const parts: string[] = []
  const latest = tools[tools.length - 1]
  const tint = latest ? mix(latest.color, KZ.green, 0.5) : KZ.green
  const css = [
    `.gfscr{fill:#060a0d}@media (prefers-color-scheme: dark){.gfscr{fill:#030507}}`,
    `.gfcol{animation:gffall linear infinite}@keyframes gffall{from{transform:translateY(-${RH + 20}px)}to{transform:translateY(${RH + 20}px)}}`,
    `.gfin{animation:gfin .45s cubic-bezier(.2,.8,.3,1) both}@keyframes gfin{from{transform:translateY(-${RH / 2 + 14}px);opacity:0}to{transform:none;opacity:1}}`,
    `.gfout{animation:gfout .9s ease-in both}@keyframes gfout{from{transform:none;opacity:1}to{transform:translateY(${RH}px);opacity:0}}`,
    `.gfhead{animation:gfh 1.2s ease-in-out infinite}@keyframes gfh{50%{opacity:.7}}`,
  ]
  parts.push(`<defs><filter id="gfGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<clipPath id="gfClip"><rect x="0" y="0" width="${W}" height="${RH}" rx="10"/></clipPath></defs>`)
  parts.push(`<rect class="gfscr" x="0" y="0" width="${W}" height="${RH}" rx="10"/>`)
  parts.push(`<g clip-path="url(#gfClip)" font-family="ui-monospace,'Cascadia Code',Consolas,monospace" font-size="12">`)

  // The quiet rain: a third of the columns, each a falling streak of glyphs.
  for (let c = 0; c < cols; c++) {
    if (noise(c, 41) > 0.5) continue
    const n = 4 + Math.floor(noise(c, 42) * 6)
    const dur = 2.4 + noise(c, 43) * 3.6
    const x = 6 + c * CH
    const spans: string[] = []
    for (let i = 0; i < n; i++) {
      const isHead = i === n - 1
      const op = isHead ? 1 : 0.2 + (i / n) * 0.65
      spans.push(`<tspan x="${x}" dy="13" fill="${isHead ? mix(tint, '#ffffff', 0.45) : tint}" fill-opacity="${op.toFixed(2)}">${xml(glyphAt(c, i, 0, 5))}</tspan>`)
    }
    parts.push(`<g class="gfcol" style="animation-duration:${dur.toFixed(2)}s;animation-delay:-${((now / 1000 + noise(c, 44) * dur) % dur).toFixed(2)}s"><text y="0">${spans.join('')}</text></g>`)
  }

  // The tools: letters drop in, hang while the tool runs, fall when it ends.
  const midY = RH / 2 + 4
  const maxLen = Math.min(30, cols - 2)
  const places = placeWords(tools, cols, maxLen)
  const recent = tools.filter(t => t.end === null || now - t.end < 2500)
  // One falling-light gradient per tool color in flight.
  const grads = [...new Set(recent.map(t => (t.isError ? KZ.red : t.color)))]
  parts.push(`<defs>${grads.map((c, i) => `<linearGradient id="gfT${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".8" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity=".05"/></linearGradient>`).join('')}</defs>`)
  for (const t of recent) {
    const word = wordOf(t, maxLen)
    const x0 = 6 + places.get(t.id)! * CH
    const color = t.isError ? KZ.red : t.color
    const end = t.end
    for (let j = 0; j < word.length; j++) {
      const ch = word.charAt(j)
      if (ch === ' ') continue
      const isOut = end !== null && now - t.at > IN_MS + HOLD_MS
      const delay = isOut ? (j * STAGGER_MS - Math.max(0, now - Math.max(end, t.at + IN_MS + HOLD_MS))) / 1000 : (j * STAGGER_MS - (now - t.at)) / 1000
      const x = x0 + j * CH
      parts.push(`<g class="${isOut ? 'gfout' : 'gfin'}" style="animation-delay:${delay.toFixed(2)}s">`,
        `<rect x="${x - 1}" y="${midY - 46}" width="${CH - 2}" height="50" rx="2" fill="url(#gfT${grads.indexOf(color)})"/>`,
        `<text x="${x}" y="${midY - 26}" fill="${color}" fill-opacity=".45">${xml(glyphAt(j, 1, now, 7))}</text>`,
        `<text x="${x}" y="${midY - 13}" fill="${color}" fill-opacity=".7">${xml(glyphAt(j, 2, now, 7))}</text>`,
        `<text x="${x}" y="${midY}" fill="${mix(color, '#ffffff', 0.35)}" font-size="13" font-weight="700" filter="url(#gfGlow)"${t.end === null ? ' class="gfhead"' : ''}>${xml(ch)}</text>`,
        `</g>`)
    }
  }
  parts.push(`</g>`)

  // The chips: the last five tools, newest first, on the theme's panel.
  const cy = RH + 4
  parts.push(`<rect class="p" x="0" y="${cy}" width="${W}" height="${chipH}" rx="9"/>`)
  let cx = 8
  for (const t of [...tools].reverse().slice(0, 5)) {
    const color = t.isError ? KZ.red : t.color
    const label = `${toolName(t.name)}${t.detail ? ' · ' + t.detail : ''}`
    const text = fitText(label, 11, 190)
    const w = textWidth(text, 11) + 30
    if (cx + w > W - 8) break
    parts.push(`<rect x="${cx}" y="${cy + 4}" width="${w.toFixed(1)}" height="${chipH - 8}" rx="${(chipH - 8) / 2}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".5"/>`)
    parts.push(`<circle cx="${cx + 11}" cy="${cy + chipH / 2}" r="3.6" fill="${color}"${t.end === null ? ' class="pulse"' : ''}/>`)
    if (t.isError) parts.push(svgText(cx + 11, cy + chipH / 2 + 3.5, '✖', { size: 9, anchor: 'middle', fill: '#fff', weight: 700 }))
    parts.push(svgText(cx + 20, cy + chipH / 2 + 4, text, { size: 11, weight: 550 }))
    cx += w + 6
  }
  return svg(W, H, parts.join(''), css.join('\n'))
}

export function rainAlt(tools: readonly Tool[]): string {
  const last = [...tools].reverse().slice(0, 5).map(t => `${toolName(t.name)}${t.detail ? ' ' + t.detail : ''}${t.isError ? ' (failed)' : t.end === null ? ' (running)' : ''}`)
  return last.length ? `Tool rain. Latest tools: ${last.join('; ')}.` : 'Tool rain.'
}
