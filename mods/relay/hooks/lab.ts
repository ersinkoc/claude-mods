// Relay: pure helpers (no `$`): request stats, histogram, model mix and the
// desktop chart cards.
import type { RelayReq, RelaySnap } from '../types'
import { KZ, clamp01, fitText, fmtTokens, heat, modelName, svg, svgBar, svgText, xml } from './lib/kz.ts'

export const MAX_REQS = 300

export const emptySnap = (): RelaySnap => ({ reqs: [], total: 0, failed: 0 })

/** Bucket edges in seconds: <1, 1–2, 2–4, … 32–64, 64+. */
export const EDGES = [1, 2, 4, 8, 16, 32, 64] as const
export const BUCKET_LABELS = ['<1', '1', '2', '4', '8', '16', '32', '64+'] as const

const PALETTE = [KZ.violet, KZ.cyan, KZ.amber, KZ.green, KZ.magenta, KZ.blue, KZ.teal, KZ.lime]

type StepUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string } | null

/** One request from what `turn.step` gave: the timing and the response's usage. */
export function reqOf(
  at: number, end: number, first: number | undefined,
  step: { turnId: string; index: number; model: string; effort?: string | number },
  result: { stopReason: string | null; usage: StepUsage }, who: string,
): RelayReq {
  const u = result.usage
  const ms = Math.max(0, end - at)
  const ttft = first === undefined ? undefined : Math.max(0, first - at)
  const output = u?.output_tokens ?? 0
  const streamMs = ms - (ttft ?? 0)
  return {
    id: `${step.turnId}:${step.index}`,
    at,
    ms,
    ttft,
    model: u?.model || step.model,
    effort: step.effort === undefined ? undefined : String(step.effort),
    input: u?.input_tokens ?? 0,
    output,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    tps: u && output > 0 && streamMs >= 100 ? output / (streamMs / 1000) : undefined,
    stop: result.stopReason,
    who,
  }
}

export const isAnswered = (r: RelayReq): boolean => r.stop !== null

/** Share of the prompt the cache served: read / (input + read + write). */
export function cacheShare(r: RelayReq): number {
  const all = r.input + r.cacheRead + r.cacheWrite
  return all > 0 ? r.cacheRead / all : 0
}

export function percentile(sorted: readonly number[], q: number): number | undefined {
  if (!sorted.length) return undefined
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

/** The histogram bucket of a request's latency: the first edge it is under, else the last bucket. */
export function bucketOf(r: RelayReq): number {
  const i = EDGES.findIndex(e => r.ms / 1000 < e)
  return i < 0 ? EDGES.length : i
}

export type Stats = {
  n: number
  p50?: number
  p95?: number
  avgTps?: number
  avgTtft?: number
  cache: number
  tokensIn: number
  tokensOut: number
  hist: number[]
  mix: { model: string; n: number; color: string }[]
  slowest: RelayReq[]
}

export function statsOf(s: RelaySnap): Stats {
  const ok = s.reqs.filter(isAnswered)
  const ms = ok.map(r => r.ms).sort((a, b) => a - b)
  const tps = ok.map(r => r.tps).filter((v): v is number => v !== undefined)
  const ttft = ok.map(r => r.ttft).filter((v): v is number => v !== undefined)
  const prompt = ok.reduce((n, r) => n + r.input + r.cacheRead + r.cacheWrite, 0)
  const read = ok.reduce((n, r) => n + r.cacheRead, 0)
  const buckets = ok.map(bucketOf)
  const hist = Array.from({ length: EDGES.length + 1 }, (_, k) => buckets.filter(b => b === k).length)
  const byModel = new Map<string, number>()
  for (const r of s.reqs) byModel.set(modelName(r.model), (byModel.get(modelName(r.model)) ?? 0) + 1)
  const mix = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, n], i) => ({ model, n, color: PALETTE[i % PALETTE.length]! }))
  return {
    n: s.reqs.length,
    p50: percentile(ms, 0.5),
    p95: percentile(ms, 0.95),
    avgTps: tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : undefined,
    avgTtft: ttft.length ? ttft.reduce((a, b) => a + b, 0) / ttft.length : undefined,
    cache: prompt > 0 ? read / prompt : 0,
    tokensIn: ok.reduce((n, r) => n + r.input + r.cacheRead + r.cacheWrite, 0),
    tokensOut: ok.reduce((n, r) => n + r.output, 0),
    hist,
    mix,
    slowest: [...ok].sort((a, b) => b.ms - a.ms).slice(0, 5),
  }
}

export function mixColor(stats: Stats, model: string): string {
  return stats.mix.find(m => m.model === modelName(model))?.color ?? KZ.mist
}

/** 420ms, 4.2s, 1m07s. */
export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export const fmtTps = (v: number | undefined): string => (v === undefined ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)}`)

export function clockOf(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Latency color: green under 2 s, red at a minute. */
export const latencyHeat = (ms: number): string => heat(Math.log2(Math.max(1, ms / 1000)) / 6)

export function stopColor(stop: string | null): string {
  if (stop === null) return KZ.red
  if (stop === 'end_turn') return KZ.green
  if (stop === 'tool_use') return KZ.cyan
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return KZ.amber
  if (stop === 'refusal') return KZ.red
  return KZ.mist
}

export const stopLabel = (stop: string | null): string => (stop === null ? 'no response' : stop.replace(/_/g, ' '))

/** Vertical bars from eighth blocks: `rows` strings, bottom row last, one char per value. */
export function vbars(values: readonly number[], rows: number): string[] {
  const top = Math.max(1, ...values)
  const out: string[] = []
  for (let r = rows - 1; r >= 0; r--) {
    out.push(values.map(v => {
      const level = (v / top) * rows * 8 - r * 8
      return v > 0 && r === 0 && level < 1 ? '▁' : ' ▁▂▃▄▅▆▇█'.charAt(Math.max(0, Math.min(8, Math.round(level))))
    }).join(''))
  }
  return out
}

// ---------------------------------------------------------------------------
// Desktop cards: each one Svg.

const card = (W: number, H: number, title: string, right = ''): string =>
  `<rect class="p" width="${W}" height="${H}" rx="12"/>` +
  svgText(12, 19, title, { cls: 's', size: 10, weight: 700 }) +
  (right ? svgText(W - 12, 19, right, { cls: 'm', size: 10, anchor: 'end' }) : '')

export function headerSvg(s: RelaySnap, st: Stats, W: number): { source: string; height: number } {
  const H = 112
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${KZ.violet}" stop-opacity=".18"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity=".05"/></linearGradient></defs>`)
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#rg)"/>`)
  // Relay glyph: two nodes and a travelling packet.
  parts.push(`<line x1="16" y1="28" x2="40" y2="28" stroke="${KZ.violet}" stroke-width="2" stroke-dasharray="3 3"/><circle cx="14" cy="28" r="4" fill="${KZ.violet}"/><circle cx="42" cy="28" r="4" fill="${KZ.cyan}"/>`)
  parts.push(`<circle r="2.4" fill="#fff" cy="28"><animate attributeName="cx" from="16" to="40" dur="1.4s" repeatCount="indefinite"/></circle>`)
  parts.push(svgText(54, 26, 'RELAY', { size: 13, weight: 800 }))
  parts.push(svgText(54, 40, `${s.total} requests · ${fmtTokens(st.tokensIn)} in · ${fmtTokens(st.tokensOut)} out`, { cls: 'm', size: 10.5 }))
  const tiles: [string, string, string][] = [
    ['P50', fmtMs(st.p50), st.p50 === undefined ? KZ.mist : latencyHeat(st.p50)],
    ['P95', fmtMs(st.p95), st.p95 === undefined ? KZ.mist : latencyHeat(st.p95)],
    ['TOK/S', fmtTps(st.avgTps), KZ.cyan],
    ['TTFT', fmtMs(st.avgTtft), KZ.violet],
    ['CACHE', `${Math.round(st.cache * 100)}%`, KZ.teal],
  ]
  const tw = (W - 28 - 4 * 5) / 5
  tiles.forEach(([k, v, c], i) => {
    const x = 14 + i * (tw + 5)
    parts.push(`<rect class="k" x="${x}" y="54" width="${tw}" height="44" rx="9" opacity=".7"/>`)
    parts.push(svgText(x + tw / 2, 69, k, { cls: 's', size: 8.5, weight: 650, anchor: 'middle' }))
    parts.push(svgText(x + tw / 2, 88, v, { size: 13, weight: 750, anchor: 'middle', fill: c }))
  })
  return { source: svg(W, H, parts.join('')), height: H }
}

export function histogramSvg(st: Stats, W: number): { source: string; height: number } {
  const H = 118
  const parts = [card(W, H, 'LATENCY', `${st.hist.reduce((a, b) => a + b, 0)} answered`)]
  const top = Math.max(1, ...st.hist)
  const gx = 12
  const gw = W - 24
  const bw = gw / st.hist.length
  const base = 92
  const gh = 62
  st.hist.forEach((n, i) => {
    const hgt = n ? Math.max(3, (n / top) * gh) : 0
    const c = heat(i / (st.hist.length - 1))
    parts.push(`<rect class="k" x="${(gx + i * bw + 2).toFixed(1)}" y="${base - gh}" width="${(bw - 4).toFixed(1)}" height="${gh}" rx="4" opacity=".45"/>`)
    if (hgt) parts.push(`<rect x="${(gx + i * bw + 2).toFixed(1)}" y="${(base - hgt).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${hgt.toFixed(1)}" rx="4" fill="${c}"><title>${n} requests</title></rect>`)
    if (n) parts.push(svgText(gx + i * bw + bw / 2, base - hgt - 3, String(n), { size: 9, weight: 700, anchor: 'middle', fill: c }))
    parts.push(svgText(gx + i * bw + bw / 2, base + 13, `${BUCKET_LABELS[i]!}${i === 0 ? 's' : ''}`, { cls: 'm', size: 9, anchor: 'middle' }))
  })
  return { source: svg(W, H, parts.join('')), height: H }
}

export function throughputSvg(reqs: readonly RelayReq[], W: number): { source: string; height: number } {
  const H = 110
  const vals = reqs.map(r => r.tps).filter((v): v is number => v !== undefined).slice(-120)
  const top = Math.max(1, ...vals)
  const parts = [card(W, H, 'TOKENS / SEC', vals.length ? `max ${fmtTps(top)}` : 'waiting for a response')]
  const gx = 12
  const gw = W - 24
  const gy = 30
  const gh = 64
  parts.push(`<line class="ln" x1="${gx}" y1="${gy + gh}" x2="${gx + gw}" y2="${gy + gh}" stroke-width="1"/>`)
  parts.push(`<line class="ln" x1="${gx}" y1="${gy + gh / 2}" x2="${gx + gw}" y2="${gy + gh / 2}" stroke-width="1" stroke-dasharray="2 4"/>`)
  if (vals.length >= 2) {
    const step = gw / (vals.length - 1)
    const xy = vals.map((v, i) => `${(gx + i * step).toFixed(1)},${(gy + gh - (v / top) * gh).toFixed(1)}`)
    parts.push(`<defs><linearGradient id="tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity="0"/></linearGradient></defs>`)
    parts.push(`<path d="M${xy.join('L')}L${gx + gw},${gy + gh}L${gx},${gy + gh}Z" fill="url(#tp)"/>`)
    parts.push(`<path d="M${xy.join('L')}" fill="none" stroke="${KZ.cyan}" stroke-width="1.8" stroke-linejoin="round"/>`)
    const last = xy[xy.length - 1]!.split(',')
    parts.push(`<circle cx="${last[0]}" cy="${last[1]}" r="3.2" fill="${KZ.cyan}" class="pulse"/>`)
  } else if (vals.length === 1) {
    parts.push(`<circle cx="${gx + gw}" cy="${gy + gh - gh}" r="3" fill="${KZ.cyan}"/>`)
  }
  parts.push(svgText(gx, H - 4, vals.length ? `last ${vals.length} requests` : '', { cls: 'm', size: 8.5 }))
  return { source: svg(W, H, parts.join('')), height: H }
}

export function mixSvg(st: Stats, W: number): { source: string; height: number } {
  const rows = Math.max(1, Math.ceil(st.mix.length / 2))
  const H = 56 + rows * 16
  const parts = [card(W, H, 'MODEL MIX', `${st.mix.length} model${st.mix.length === 1 ? '' : 's'}`)]
  let x = 12
  const bw = W - 24
  if (st.n) {
    for (const m of st.mix) {
      const w = (m.n / st.n) * bw
      parts.push(`<rect x="${x.toFixed(1)}" y="28" width="${Math.max(1, w - 2).toFixed(1)}" height="12" rx="4" fill="${m.color}"/>`)
      x += w
    }
  } else {
    parts.push(`<rect class="k" x="12" y="28" width="${bw}" height="12" rx="4"/>`)
  }
  st.mix.forEach((m, i) => {
    const cx = 12 + (i % 2) * (bw / 2)
    const cy = 58 + Math.floor(i / 2) * 16
    parts.push(`<circle cx="${cx + 4}" cy="${cy - 4}" r="4" fill="${m.color}"/>`)
    parts.push(svgText(cx + 13, cy, fitText(`${m.model} · ${m.n} · ${Math.round((m.n / Math.max(1, st.n)) * 100)}%`, 10.5, bw / 2 - 18), { size: 10.5 }))
  })
  return { source: svg(W, H, parts.join('')), height: H }
}

export function cacheSvg(reqs: readonly RelayReq[], W: number): { source: string; height: number } {
  const H = 88
  const last = reqs.filter(isAnswered).slice(-60)
  const parts = [card(W, H, 'CACHE-READ SHARE PER REQUEST', last.length ? `last ${last.length}` : '')]
  const gx = 12
  const gw = W - 24
  const gy = 28
  const gh = 46
  const bw = Math.min(14, gw / Math.max(1, last.length))
  last.forEach((r, i) => {
    const k = cacheShare(r)
    const hgt = Math.max(1.5, k * gh)
    const x = gx + gw - (last.length - i) * bw
    parts.push(`<rect class="k" x="${(x + 0.5).toFixed(1)}" y="${gy}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${gh}" rx="2" opacity=".5"/>`)
    parts.push(`<rect x="${(x + 0.5).toFixed(1)}" y="${(gy + gh - hgt).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${hgt.toFixed(1)}" rx="2" fill="${KZ.teal}" opacity="${(0.45 + k * 0.55).toFixed(2)}"><title>${Math.round(k * 100)}% read from cache</title></rect>`)
  })
  if (!last.length) parts.push(svgText(W / 2, gy + 28, 'no answered requests yet', { cls: 'm', size: 10.5, anchor: 'middle' }))
  return { source: svg(W, H, parts.join('')), height: H }
}

export function slowestSvg(st: Stats, W: number): { source: string; height: number } {
  const H = 32 + Math.max(1, st.slowest.length) * 22
  const parts = [card(W, H, 'SLOWEST 5')]
  const top = Math.max(1, ...st.slowest.map(r => r.ms))
  st.slowest.forEach((r, i) => {
    const y = 34 + i * 22
    parts.push(svgText(12, y + 9, `${i + 1}`, { cls: 'm', size: 10, weight: 700 }))
    parts.push(svgText(26, y + 9, fitText(`${modelName(r.model)}${r.effort ? ` · ${r.effort}` : ''} · ${r.who}`, 10.5, W * 0.48), { size: 10.5, weight: 600, fill: mixColor(st, r.model) }))
    parts.push(svgBar(W * 0.55, y + 2, W * 0.45 - 70, 7, clamp01(r.ms / top), latencyHeat(r.ms)))
    parts.push(svgText(W - 12, y + 9, fmtMs(r.ms), { size: 10.5, weight: 700, anchor: 'end' }))
    parts.push(svgText(26, y + 19, fitText(`${fmtTokens(r.input + r.cacheRead + r.cacheWrite)} in → ${fmtTokens(r.output)} out · ${stopLabel(r.stop)} · ${clockOf(r.at)}`, 9, W - 40), { cls: 'm', size: 9 }))
  })
  if (!st.slowest.length) parts.push(svgText(W / 2, 46, 'nothing timed yet', { cls: 'm', size: 10.5, anchor: 'middle' }))
  return { source: svg(W, H, parts.join('')), height: H }
}

export function recentSvg(reqs: readonly RelayReq[], all: Stats, W: number, count: number): { source: string; height: number } {
  const rows = reqs.slice(-count).reverse()
  const H = 30 + Math.max(1, rows.length) * 30
  const parts = [card(W, H, 'RECENT REQUESTS')]
  rows.forEach((r, i) => {
    const y = 30 + i * 30
    if (i) parts.push(`<line class="ln" x1="12" y1="${y - 2}" x2="${W - 12}" y2="${y - 2}" stroke-width="1"/>`)
    parts.push(`<circle cx="16" cy="${y + 9}" r="3.5" fill="${stopColor(r.stop)}"><title>${xml(stopLabel(r.stop))}</title></circle>`)
    parts.push(svgText(26, y + 12, fitText(`${modelName(r.model)}${r.effort ? ` · ${r.effort}` : ''}`, 11, W * 0.42), { size: 11, weight: 650, fill: mixColor(all, r.model) }))
    parts.push(svgText(W - 12, y + 12, `${fmtMs(r.ms)}${r.tps !== undefined ? ` · ${fmtTps(r.tps)} t/s` : ''}`, { size: 11, weight: 700, anchor: 'end', fill: latencyHeat(r.ms) }))
    const meta = `${clockOf(r.at)} · in ${fmtTokens(r.input)} · cache ${fmtTokens(r.cacheRead)}/${fmtTokens(r.cacheWrite)} · out ${fmtTokens(r.output)} · ${stopLabel(r.stop)} · ${r.who}`
    parts.push(svgText(26, y + 24, fitText(meta, 9, W - 38), { cls: 'm', size: 9 }))
  })
  if (!rows.length) parts.push(svgText(W / 2, 48, 'no model requests yet', { cls: 'm', size: 10.5, anchor: 'middle' }))
  return { source: svg(W, H, parts.join('')), height: H }
}
