// marquee's pure core: the segments of the line and the scrolling window
// over them. No `$` here, so the tests drive it directly.

import { clip, fmtClock, fmtSpan, fmtUsd, limitLabel, modelName, toolName } from './lib/kz.ts'

export type TickerLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type TickerGit = { branch: string; ahead: number; behind: number; dirty: number }
export type TickerTool = { name: string; detail: string; startedAt: number }

export type TickerData = {
  model?: string
  effort?: string
  ctxPercent?: number
  limits: TickerLimit[]
  costUsd?: number
  git?: TickerGit
  tool?: TickerTool
  now: number
}

export const SEGMENTS = ['model', 'ctx', 'limits', 'cost', 'git', 'tool'] as const
export type SegmentName = (typeof SEGMENTS)[number]
export const DEFAULT_SEGMENTS = SEGMENTS.join(',')

/** Between segments. */
export const SEP = ' │ '
/** Between two laps of a scrolling line. */
export const GAP = '   ◆   '

/** `"model, git ,bogus,ctx"` → `['model', 'git', 'ctx']`: known names, in order, once each. */
export function parseSegments(spec: string | undefined): SegmentName[] {
  const out: SegmentName[] = []
  for (const raw of (spec ?? DEFAULT_SEGMENTS).split(',')) {
    const name = raw.trim().toLowerCase() as SegmentName
    if ((SEGMENTS as readonly string[]).includes(name) && !out.includes(name)) out.push(name)
  }
  return out
}

const pct = (n: number) => `${Math.round(n)}%`

/** The text of each chosen segment, in order, the empty ones left out; `limits` gives one per window. */
export function buildSegments(d: TickerData, order: readonly SegmentName[]): string[] {
  const out: string[] = []
  for (const name of order) {
    if (name === 'model') {
      if (d.model) out.push(`◆ ${modelName(d.model)}${d.effort ? `·${d.effort}` : ''}`)
    } else if (name === 'ctx') {
      if (d.ctxPercent !== undefined && Number.isFinite(d.ctxPercent)) out.push(`ctx ${pct(d.ctxPercent)}`)
    } else if (name === 'limits') {
      for (const l of d.limits) {
        const t = l.resetsAt ? Date.parse(l.resetsAt) : NaN
        const reset = l.kind === 'five_hour' && Number.isFinite(t) ? ` ↻${fmtSpan(Math.max(0, t - d.now))}` : ''
        out.push(`${limitLabel(l.kind)} ${pct(l.percentUsed)}${reset}`)
      }
    } else if (name === 'cost') {
      if (d.costUsd !== undefined) out.push(fmtUsd(d.costUsd))
    } else if (name === 'git') {
      const g = d.git
      if (g && g.branch) {
        const bits = [g.ahead ? `↑${g.ahead}` : '', g.behind ? `↓${g.behind}` : '', g.dirty ? `●${g.dirty}` : ''].filter(Boolean)
        out.push(`⎇ ${g.branch}${bits.length ? ' ' + bits.join(' ') : ''}`)
      }
    } else if (name === 'tool') {
      const t = d.tool
      if (t) out.push(`▶ ${toolName(t.name)}${t.detail ? ' ' + clip(t.detail, 28) : ''} ${fmtClock(d.now - t.startedAt)}`)
    }
  }
  return out
}

export function compose(segments: readonly string[]): string {
  return segments.join(SEP)
}

/**
 * The line to show at `tick`: the whole line when it fits in `width`
 * characters, else a `width`-wide window rotating over the loop of the
 * segments and GAP, `step` characters per tick.
 */
export function windowAt(segments: readonly string[], width: number, tick: number, step = 1): string {
  const text = compose(segments)
  const chars = Array.from(text)
  const w = Math.max(8, Math.floor(width))
  if (chars.length <= w) return text
  const loop = [...chars, ...Array.from(GAP)]
  const off = (((tick * step) % loop.length) + loop.length) % loop.length
  let out = ''
  for (let i = 0; i < w; i++) out += loop[(off + i) % loop.length]
  return out
}

/** Whether the line scrolls at this width. */
export function scrolls(segments: readonly string[], width: number): boolean {
  return Array.from(compose(segments)).length > Math.max(8, Math.floor(width))
}
