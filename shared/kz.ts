// KOZMOS shared kit. Source of truth: shared/kz.ts at the bundle root.
// `node scripts/sync-shared.mjs` copies it into every mod as hooks/lib/kz.ts,
// because a hooks module may only import files inside its own plugin.
// Edit the root copy, never a mod's copy.

// ---------------------------------------------------------------------------
// Palette: one neon family across every KOZMOS mod.

export const KZ = {
  violet: '#a78bfa',
  magenta: '#f472b6',
  cyan: '#22d3ee',
  teal: '#2dd4bf',
  green: '#4ade80',
  lime: '#a3e635',
  yellow: '#facc15',
  amber: '#fb923c',
  red: '#f87171',
  blue: '#60a5fa',
  clay: '#d97757',
  ink: '#1f1e1d',
  mist: '#9ca3af',
} as const

/** Tool families, colored the same in every mod. */
export function toolColor(tool: string): string {
  const t = String(tool)
  if (t === 'Bash' || t === 'PowerShell') return KZ.green
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit' || t === 'MultiEdit') return KZ.yellow
  if (t === 'Read' || t === 'Glob' || t === 'Grep' || t === 'LSP') return KZ.blue
  if (t === 'Agent' || t === 'Task' || t === 'Workflow') return KZ.violet
  if (t.startsWith('Web')) return KZ.cyan
  if (t.startsWith('Todo') || t.startsWith('Task')) return KZ.teal
  if (t.startsWith('mcp__')) return KZ.magenta
  return KZ.mist
}

/** A short glyph per tool family. */
export function toolGlyph(tool: string): string {
  const t = String(tool)
  if (t === 'Bash' || t === 'PowerShell') return '$'
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') return '✎'
  if (t === 'Read') return '◉'
  if (t === 'Glob' || t === 'Grep') return '⌕'
  if (t === 'Agent') return '◈'
  if (t.startsWith('Web')) return '◍'
  if (t.startsWith('Todo') || t.startsWith('Task')) return '☑'
  if (t.startsWith('mcp__')) return '⬡'
  return '•'
}

// ---------------------------------------------------------------------------
// Colors.

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const k = clamp01(t)
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
}

/** Green at 0, yellow at 0.6, red at 1: the heat of a gauge. */
export function heat(t: number): string {
  const k = clamp01(t)
  return k < 0.6 ? mix(KZ.green, KZ.yellow, k / 0.6) : mix(KZ.yellow, KZ.red, (k - 0.6) / 0.4)
}

/** A smooth rainbow for hues 0..1 (for auroras, plasma and the like). */
export function hue(h: number, s = 0.75, l = 0.6): string {
  const k = ((h % 1) + 1) % 1
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const x = (n + k * 12) % 12
    return l - a * Math.max(-1, Math.min(x - 3, 9 - x, 1))
  }
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

export function hexToInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (r << 16) | (g << 8) | b
}

// ---------------------------------------------------------------------------
// Numbers and text.

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return `${Math.round(n)}`
}

export function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '$—'
  if (usd < 0.01 && usd > 0) return '<$0.01'
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`
}

/** 0:42, 3:07, 1:02:33. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 42s, 7m, 2h41m, 3d4h: compact durations for countdowns. */
export function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

export function fmtPct(p: number | undefined): string {
  return p === undefined || !Number.isFinite(p) ? '—' : `${Math.round(p)}%`
}

export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, Math.max(1, max - 1)) + '…' : one
}

export function padEnd(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

export function padStart(s: string, n: number): string {
  return s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`. */
export function modelName(id: string | undefined): string {
  if (!id) return '—'
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  if (!m) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const fam = m[1] ?? ''
  return `${fam.charAt(0).toUpperCase()}${fam.slice(1).toLowerCase()} ${m[2]}${m[3] ? '.' + m[3] : ''}`
}

/** Last path segment, either slash. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** A stable small hash for seeding. */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic 0..1 noise from two ints. */
export function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** A seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Text gauges for the terminal.

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A smooth bar with eighth blocks: `█████▍    `. */
export function bar(ratio: number, width: number, empty = '░'): string {
  const w = Math.max(1, Math.floor(width))
  const exact = clamp01(ratio) * w
  const full = Math.floor(exact)
  const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ''
  const used = full + (part ? 1 : 0)
  return '█'.repeat(full) + part + empty.repeat(Math.max(0, w - used))
}

/** A segmented gauge: `▰▰▰▱▱▱`. */
export function pips(ratio: number, width: number, on = '▰', off = '▱'): string {
  const w = Math.max(1, Math.floor(width))
  const n = Math.round(clamp01(ratio) * w)
  return on.repeat(n) + off.repeat(w - n)
}

const SPARK = '▁▂▃▄▅▆▇█'

/** A sparkline of the last `width` values, scaled to their own max (or `max`). */
export function sparkline(values: readonly number[], width: number, max?: number): string {
  const tail = values.slice(-Math.max(1, width))
  const top = max ?? Math.max(1e-9, ...tail)
  const line = tail.map(v => SPARK[Math.min(7, Math.max(0, Math.round((v / top) * 7)))] ?? '▁').join('')
  return line.padStart(width, ' ')
}

/** Braille line graph, 2 samples per cell, `rows` cells tall. */
export function brailleGraph(values: readonly number[], width: number, rows: number, max?: number): string[] {
  const samples = values.slice(-(width * 2))
  const top = max ?? Math.max(1e-9, ...samples)
  const dotsTall = rows * 4
  const grid: number[][] = Array.from({ length: rows }, () => Array.from({ length: width }, () => 0))
  const offset = width * 2 - samples.length
  // Dot bits per column, from the bottom row of a cell up.
  const LEFT = [0x40, 0x04, 0x02, 0x01]
  const RIGHT = [0x80, 0x20, 0x10, 0x08]
  samples.forEach((v, i) => {
    const x = offset + i
    const col = Math.floor(x / 2)
    const isRight = x % 2 === 1
    const h = Math.round(clamp01(v / top) * (dotsTall - 1))
    for (let d = 0; d <= h; d++) {
      const row = rows - 1 - Math.floor(d / 4)
      const bits = isRight ? RIGHT : LEFT
      const cellRow = grid[row]
      if (cellRow && col >= 0 && col < width) cellRow[col] = (cellRow[col] ?? 0) | (bits[d % 4] ?? 0)
    }
  })
  return grid.map(r => r.map(b => String.fromCharCode(0x2800 + b)).join(''))
}

// ---------------------------------------------------------------------------
// Raster: a grid of colored cells, packed as the engine wants it.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '='
  }
  return out
}

/** The terminal's own default color, for a cell's foreground or background. */
export const DEFAULT_COLOR = 0x01000000

export class Canvas {
  readonly cols: number
  readonly rows: number
  private readonly words: Uint32Array

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.min(512, Math.floor(cols)))
    this.rows = Math.max(1, Math.min(256, Math.floor(rows)))
    this.words = new Uint32Array(this.cols * this.rows * 3)
    this.clear()
  }

  clear(bg: number = DEFAULT_COLOR): void {
    for (let i = 0; i < this.cols * this.rows; i++) {
      this.words[i * 3] = 0x20
      this.words[i * 3 + 1] = DEFAULT_COLOR
      this.words[i * 3 + 2] = bg
    }
  }

  /** Puts one width-1 character; colors are '#rrggbb' or a packed int. */
  set(x: number, y: number, ch: string, fg?: string | number, bg?: string | number): void {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return
    const i = (cy * this.cols + cx) * 3
    const code = ch.codePointAt(0) ?? 0x20
    this.words[i] = code > 0xffff || code < 0x20 ? 0x20 : code
    if (fg !== undefined) this.words[i + 1] = typeof fg === 'number' ? fg : hexToInt(fg)
    if (bg !== undefined) this.words[i + 2] = typeof bg === 'number' ? bg : hexToInt(bg)
  }

  /** Writes a string left to right, clipped to the canvas. */
  text(x: number, y: number, s: string, fg?: string | number, bg?: string | number): void {
    let cx = x
    for (const ch of s) {
      this.set(cx, y, ch, fg, bg)
      cx++
    }
  }

  /** Paints a cell's background only, keeping its character. */
  paint(x: number, y: number, bg: string | number): void {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return
    this.words[(cy * this.cols + cx) * 3 + 2] = typeof bg === 'number' ? bg : hexToInt(bg)
  }

  /** Two vertical pixels per cell with the upper-half block: `py` is in half-cells. */
  pixel(x: number, py: number, color: string): void {
    const cx = Math.floor(x)
    const cy = Math.floor(py / 2)
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return
    const i = (cy * this.cols + cx) * 3
    const c = hexToInt(color)
    const isTop = Math.floor(py) % 2 === 0
    if (this.words[i] !== 0x2580) {
      this.words[i] = 0x2580
      this.words[i + 1] = DEFAULT_COLOR
      this.words[i + 2] = DEFAULT_COLOR
    }
    if (isTop) this.words[i + 1] = c
    else this.words[i + 2] = c
  }

  /** The `cells` prop of a Raster. */
  encode(): string {
    return toBase64(new Uint8Array(this.words.buffer))
  }
}

// ---------------------------------------------------------------------------
// SVG for the desktop: one drawing per row (the desktop wraps siblings).

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif"
export const MONO = "ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace"

export function xml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Theme-aware classes every KOZMOS drawing shares: t text, s secondary, m muted, k track, p panel. */
export const SVG_BASE_CSS = `
.t{fill:#1f1f1f}.s{fill:#5f5f5c}.m{fill:#8e8e8a}.k{fill:#e7e5e0}.p{fill:#f5f4f1}.ln{stroke:#e1dfda}
@media (prefers-color-scheme: dark){.t{fill:#ededed}.s{fill:#b4b4b0}.m{fill:#7c7c78}.k{fill:#2d2d2b}.p{fill:#232322}.ln{stroke:#363634}}
.pulse{animation:kzp 1.6s ease-in-out infinite}@keyframes kzp{50%{opacity:.35}}
.spin{transform-box:fill-box;transform-origin:center;animation:kzs 2s linear infinite}@keyframes kzs{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
`

export function svg(width: number, height: number, body: string, css = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${SVG_BASE_CSS}${css}</style>${body}</svg>`
}

/** Rough width of UI text in px, for fitting labels. */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%MWmw]/.test(ch) ? 0.72 : 0.56) * size
  return w
}

export function fitText(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

/** A rounded progress bar as SVG markup. */
export function svgBar(x: number, y: number, w: number, h: number, ratio: number, color: string): string {
  const fw = Math.max(0, Math.min(w, w * clamp01(ratio)))
  return `<rect class="k" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>` +
    (fw > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(h, fw)}" height="${h}" rx="${h / 2}" fill="${color}"/>` : '')
}

/** SVG text helper. */
export function svgText(x: number, y: number, s: string, opts: { cls?: string; size?: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string; mono?: boolean } = {}): string {
  const { cls = 't', size = 12, weight = 400, anchor = 'start', fill, mono = false } = opts
  return `<text ${fill ? `fill="${fill}"` : `class="${cls}"`} x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-variant-numeric="tabular-nums">${xml(s)}</text>`
}

/** Pixel width a desktop pane or band gives a drawing for `columns` reported columns. */
export function pxOf(columns: number | undefined, fallback = 60, slack = 8): number {
  return Math.max(200, Math.min(1600, (columns || fallback) * 8 - slack))
}

// ---------------------------------------------------------------------------
// Prices, USD per million tokens: input, output, cache read, cache write (5 min).
// Anthropic first-party rates as of 2026-10. Used only where the engine reports
// tokens and not money (a subagent's own spend); the session total comes from
// $.session.usage().cost, which is the engine's.

const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/i, [10, 50, 0.25, 12.5]],
  [/opus-5-5/i, [4, 20, 0.2, 5]],
  [/opus/i, [5, 25, 0.5, 6.25]],
  [/sonnet-5/i, [2, 10, 0.2, 2.5]],
  [/sonnet/i, [3, 15, 0.3, 3.75]],
  [/haiku-5/i, [0.1, 0.5, 0.01, 0.125]],
  [/haiku/i, [1, 5, 0.1, 1.25]],
]

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function priceOf(model: string): [number, number, number, number] {
  return PRICES.find(([re]) => re.test(model))?.[1] ?? [4, 20, 0.2, 5]
}

export function costOf(model: string, u: Usage | null | undefined): number {
  if (!u) return 0
  const [i, o, r, w] = priceOf(model)
  return ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_read_input_tokens ?? 0) * r + (u.cache_creation_input_tokens ?? 0) * w) / 1e6
}

export function tokensOf(u: Usage | null | undefined): number {
  if (!u) return 0
  return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

/** The context a request filled: everything it read plus what it wrote. */
export function contextOf(u: Usage | null | undefined): number {
  return tokensOf(u)
}

export function windowOf(model: string): number {
  return /haiku-4/i.test(model) ? 200_000 : 1_000_000
}

// ---------------------------------------------------------------------------
// Rate limits.

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return '$'
  return kind.replace(/_/g, ' ')
}

/** Milliseconds until a window resets, or undefined. */
export function untilReset(l: Limit, now: number): number | undefined {
  if (!l.resetsAt) return undefined
  const t = Date.parse(l.resetsAt)
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined
}

/** The length of a window in ms, for burn-rate math. */
export function windowMs(kind: string): number | undefined {
  if (kind === 'five_hour') return 5 * 3600_000
  if (kind === 'seven_day') return 7 * 24 * 3600_000
  return undefined
}

// ---------------------------------------------------------------------------
// Tool calls, described in a few words.

/** What a tool call is about: the command, the file, the pattern, the agent's task. */
export function toolDetail(tool: string, input: unknown): string {
  const e = (input ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const t = String(tool)
  if (t === 'Bash' || t === 'PowerShell') return clip(s('description') || s('command'), 60)
  if (s('file_path')) return baseName(s('file_path'))
  if (s('notebook_path')) return baseName(s('notebook_path'))
  if (t === 'Agent') return clip(s('description') || s('subagent_type'), 60)
  if (s('pattern')) return clip(s('pattern'), 60)
  if (s('url')) return clip(s('url').replace(/^https?:\/\//, ''), 60)
  if (s('query')) return clip(s('query'), 60)
  if (s('subject')) return clip(s('subject'), 60)
  if (Array.isArray(e.todos)) return `${(e.todos as unknown[]).length} todos`
  if (t.startsWith('mcp__')) return t.split('__').slice(1).join(' · ')
  return ''
}

/** `mcp__server__tool` → `server·tool`; built-ins unchanged. */
export function toolName(tool: string): string {
  const t = String(tool)
  return t.startsWith('mcp__') ? t.split('__').slice(1).join('·') : t
}
