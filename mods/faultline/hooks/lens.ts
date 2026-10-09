// Faultline: pure helpers (no `$`): error signatures, grouping, the severity
// strip and the desktop drawings.
import type { Fault, FaultKind, FaultlineSnap } from '../types'
import { KZ, clip, fitText, mix, svg, svgText, toolName } from './lib/kz.ts'

export const MAX_FAULTS = 300
export const MAX_TEXT = 1500
export const WINDOW_MS = 10 * 60_000
export const BUCKETS = 20
export const BUCKET_MS = WINDOW_MS / BUCKETS

export const emptySnap = (now = 0): FaultlineSnap => ({ faults: [], total: 0, hits: [], now })

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const NOISE = /^(?:exit code:?\s*-?\d+|error:?|<\/?[a-z_-]+>)$/i
const LOUD = /error|fail|fatal|not found|cannot|can't|unable|denied|refused|rejected|exception|no such|invalid|timed? ?out|killed|panic|missing|unexpected|forbidden|unauthori[sz]ed|overloaded|rate.?limit/i
export const DENIED = /doesn't want to proceed|did not want to proceed|user (?:rejected|denied|declined)|was rejected|permission .*denied|denied by|blocked by|not allowed/i

/** The line of an error text that says what went wrong. */
export function tellingLine(text: string): string {
  const lines = text
    .replace(ANSI, '')
    .replace(/<\/?(?:tool_use_error|error|stderr|stdout)>/gi, '\n')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !NOISE.test(l))
  return lines.find(l => LOUD.test(l)) ?? lines[0] ?? 'unknown error'
}

/** Masks what varies between two instances of one error: URLs, paths, ids, numbers. */
export function mask(line: string): string {
  return line
    .replace(/\bhttps?:\/\/\S+/gi, '<url>')
    .replace(/\b[A-Za-z]:[\\/][^\s'"`:;,)\]]*/g, '<path>')
    .replace(/(^|[\s'"`(=:])(?:~|\.{1,2})?(?:\/[^\s'"`:;,)\]]+)+/g, '$1<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/gi, '<id>')
    .replace(/\d+(?:\.\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The signature of one failure: its group key and the masked line shown for the group. */
export function signatureOf(tool: string, text: string): { sig: string; head: string } {
  const exit = /exit code:?\s*(-?\d+)/i.exec(text)
  const head = clip(`${exit && tool !== 'api' ? 'exit # · ' : ''}${mask(tellingLine(text))}`, 120)
  return { sig: `${tool}|${head}`, head }
}

export type FaultEvent = { tool: string; kind: FaultKind; text: string; at: number; who: string; detail?: string }

/** Folds one failure into the snapshot: a new signature, or one more of a known one. */
export function addFault(s: FaultlineSnap, ev: FaultEvent): Fault {
  const { sig, head } = signatureOf(ev.tool, ev.text)
  const known = s.faults.find(f => f.sig === sig)
  let f: Fault
  if (known) {
    f = { ...known, count: known.count + 1, last: ev.at, agents: known.agents.includes(ev.who) ? known.agents : [...known.agents, ev.who].slice(-5) }
  } else {
    const text = ev.text.replace(ANSI, '').trim() || head
    f = {
      sig, tool: ev.tool, kind: ev.kind, head, detail: ev.detail, firstText: text.slice(0, MAX_TEXT), isTruncated: text.length > MAX_TEXT,
      count: 1, first: ev.at, last: ev.at, agents: [ev.who],
    }
  }
  s.faults = [f, ...s.faults.filter(x => x.sig !== sig)].slice(0, MAX_FAULTS)
  s.total++
  s.hits = [...s.hits.filter(t => t > ev.at - WINDOW_MS), ev.at].slice(-300)
  s.now = Math.max(s.now, ev.at)
  return f
}

/** Failures per 30 s over the last 10 minutes, oldest first. */
export function buckets(hits: readonly number[], now: number): number[] {
  const out = Array.from({ length: BUCKETS }, () => 0)
  for (const t of hits) {
    const age = now - t
    if (age < 0 || age >= WINDOW_MS) continue
    const i = BUCKETS - 1 - Math.floor(age / BUCKET_MS)
    out[i] = (out[i] ?? 0) + 1
  }
  return out
}

/** Red by intensity: a dark ember at 0, full red at 1. */
export function ember(k: number): string {
  return k <= 0 ? '#4b5563' : mix('#7f1d1d', KZ.red, Math.min(1, k))
}

export function kindColor(k: FaultKind): string {
  return k === 'denied' ? KZ.amber : k === 'api' ? KZ.magenta : k === 'turn' ? KZ.violet : KZ.red
}

export function kindLabel(f: Fault): string {
  return f.kind === 'denied' ? 'denied' : f.kind === 'api' ? 'API' : f.kind === 'turn' ? 'turn' : toolName(f.tool)
}

export function clockOf(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function recentCount(s: FaultlineSnap): number {
  return s.hits.filter(t => t > s.now - WINDOW_MS).length
}

export function agentsOf(s: FaultlineSnap): number {
  return new Set(s.faults.flatMap(f => f.agents)).size
}

/** What the copy button puts on the clipboard. */
export function copyText(f: Fault): string {
  return [
    `${kindLabel(f)} — ${f.count}× (first ${clockOf(f.first)}, last ${clockOf(f.last)}; ${f.agents.join(', ')})`,
    f.detail ? `on: ${f.detail}` : '',
    '',
    f.firstText + (f.isTruncated ? '\n…' : ''),
  ].filter((l, i) => l || i === 2).join('\n')
}

/** The lines of the first error shown folded (`few`) or unfolded. */
export function textLines(f: Fault, isOpen: boolean): string[] {
  const lines = f.firstText.split(/\r?\n/).filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1))
  const keep = isOpen ? 40 : 3
  const out = lines.slice(0, keep)
  if (lines.length > keep || (isOpen && f.isTruncated)) out.push('…')
  return out
}

// ---------------------------------------------------------------------------
// Desktop drawings.

export function headerSvg(s: FaultlineSnap, W: number): { source: string; height: number } {
  const H = 128
  const parts: string[] = []
  const recent = recentCount(s)
  const b = buckets(s.hits, s.now)
  const top = Math.max(1, ...b)
  parts.push(`<defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${KZ.red}" stop-opacity="${recent ? 0.2 : 0.08}"/><stop offset="1" stop-color="${KZ.amber}" stop-opacity=".03"/></linearGradient></defs>`)
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#fg)"/>`)
  // The fault-line glyph: a jagged crack.
  parts.push(`<path d="M16 16 L26 28 L20 31 L32 44" fill="none" stroke="${recent ? KZ.red : KZ.mist}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="${recent ? 'pulse' : ''}"/>`)
  parts.push(svgText(44, 27, 'FAULTLINE', { size: 13, weight: 800 }))
  parts.push(svgText(44, 41, recent ? `${recent} failure${recent === 1 ? '' : 's'} in the last 10 min` : 'quiet for the last 10 min', { cls: 'm', size: 10.5 }))
  parts.push(svgText(W - 14, 27, String(s.total), { size: 20, weight: 800, anchor: 'end', fill: s.total ? KZ.red : KZ.mist }))
  parts.push(svgText(W - 14, 41, 'failures', { cls: 'm', size: 9.5, anchor: 'end' }))
  // Severity strip.
  const gx = 14
  const gw = W - 28
  const cw = gw / BUCKETS
  b.forEach((n, i) => {
    const k = n / top
    parts.push(`<rect x="${(gx + i * cw + 1).toFixed(1)}" y="56" width="${(cw - 2).toFixed(1)}" height="22" rx="4" ${n ? `fill="${ember(k)}"` : 'class="k"'}><title>${n} in ${30 * (BUCKETS - i)}–${30 * (BUCKETS - i - 1)} s ago</title></rect>`)
  })
  parts.push(svgText(gx, 90, '10 min ago', { cls: 'm', size: 8.5 }))
  parts.push(svgText(gx + gw, 90, 'now', { cls: 'm', size: 8.5, anchor: 'end' }))
  const chips: [string, string][] = [
    [`${s.faults.length} signatures`, KZ.mist],
    [`${agentsOf(s)} agents`, KZ.violet],
    [`${s.faults.filter(f => f.kind === 'denied').length} denied`, KZ.amber],
  ]
  let cx = gx
  for (const [t, c] of chips) {
    const w = t.length * 6 + 16
    parts.push(`<rect x="${cx}" y="100" width="${w}" height="18" rx="9" fill="${c}" opacity=".16"/>`)
    parts.push(svgText(cx + w / 2, 113, t, { size: 10, weight: 600, anchor: 'middle', fill: c }))
    cx += w + 6
  }
  return { source: svg(W, H, parts.join('')), height: H }
}

export function faultSvg(f: Fault, W: number, maxCount: number, isOpen: boolean): { source: string; height: number } {
  const lines = isOpen ? [] : textLines(f, false).slice(0, 2)
  const H = 58 + lines.length * 14 + (lines.length ? 6 : 0)
  const c = kindColor(f.kind)
  const k = f.count / Math.max(1, maxCount)
  const parts: string[] = []
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="12"/>`)
  parts.push(`<rect width="4" height="${H}" rx="2" fill="${c}"/>`)
  // Count badge, redder with more hits.
  const label = f.count > 999 ? '999+' : `${f.count}×`
  const bw = Math.max(30, label.length * 7.5 + 10)
  parts.push(`<rect x="12" y="10" width="${bw}" height="20" rx="10" fill="${ember(0.25 + k * 0.75)}"/>`)
  parts.push(svgText(12 + bw / 2, 24, label, { size: 11, weight: 800, anchor: 'middle', fill: '#fff' }))
  const kl = kindLabel(f)
  const kw = Math.min(120, kl.length * 6.4 + 14)
  parts.push(`<rect x="${18 + bw}" y="10" width="${kw}" height="20" rx="6" fill="${c}" opacity=".16"/>`)
  parts.push(svgText(18 + bw + kw / 2, 24, fitText(kl, 10.5, kw - 8), { size: 10.5, weight: 700, anchor: 'middle', fill: c }))
  parts.push(svgText(W - 12, 24, clockOf(f.last), { cls: 'm', size: 10, anchor: 'end' }))
  parts.push(svgText(14, 46, fitText(f.head, 11.5, W - 26), { size: 11.5, weight: 600 }))
  const meta = [`first ${clockOf(f.first)}`, f.agents.join(', '), f.detail ?? ''].filter(Boolean).join(' · ')
  parts.push(svgText(14, 60 - 2, fitText(meta, 9.5, W - 26), { cls: 'm', size: 9.5 }))
  lines.forEach((l, i) => {
    parts.push(svgText(14, 76 + i * 14, fitText(l, 10, W - 26), { cls: 's', size: 10, mono: true }))
  })
  return { source: svg(W, H, parts.join('')), height: H }
}

export function altOf(f: Fault): string {
  return `${f.count} times ${kindLabel(f)}: ${f.head}; first ${clockOf(f.first)}, last ${clockOf(f.last)}; ${f.agents.join(', ')}`
}
