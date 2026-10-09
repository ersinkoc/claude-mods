// Launchpad's pure helpers: ranking, argument parsing and the desktop tiles.
// No `$` here (it may not cross an import).

import type { LaunchpadData, PadCount } from '../types'
import { KZ, clip, fitText, fmtSpan, hash, hue, svg, svgText, textWidth } from './lib/kz.ts'

export const MAX_SAVED = 24
export const MAX_FREQUENT = 8
export const MAX_PROMPT = 2000

export type Tile = { name: string; count: number; at: number; description: string }

/** Commands this mod never offers to launch: itself. */
const SKIP = new Set(['launchpad'])

export function cleanName(s: string): string {
  return s.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? ''
}

/** Adds one run of `name` at `at` to the counts. */
export function bump(counts: Record<string, PadCount>, name: string, at: number): Record<string, PadCount> {
  const prev = counts[name]
  return { ...counts, [name]: { n: (prev?.n ?? 0) + 1, at } }
}

const tileOf = (d: LaunchpadData, name: string): Tile => ({
  name,
  count: d.counts[name]?.n ?? 0,
  at: d.counts[name]?.at ?? 0,
  description: d.known[name] ?? '',
})

const isAvailable = (d: LaunchpadData, name: string): boolean => !SKIP.has(name) && (!d.hasList || name in d.known)

export function pinnedTiles(d: LaunchpadData): Tile[] {
  return d.pinned.filter(n => !SKIP.has(n)).map(n => tileOf(d, n))
}

/** The most-run commands, pinned ones left out, ties broken by recency. */
export function frequentTiles(d: LaunchpadData, max = MAX_FREQUENT): Tile[] {
  return Object.keys(d.counts)
    .filter(n => !d.pinned.includes(n) && isAvailable(d, n))
    .map(n => tileOf(d, n))
    .sort((a, b) => b.count - a.count || b.at - a.at || a.name.localeCompare(b.name))
    .slice(0, max)
}

export type PadAction =
  | { kind: 'toggle' }
  | { kind: 'list' }
  | { kind: 'save'; text: string }
  | { kind: 'rm'; index: number }
  | { kind: 'pin'; name: string }
  | { kind: 'unpin'; name: string }
  | { kind: 'forget' }
  | { kind: 'help'; reason: string }

/** `/launchpad <verb> <rest>` into an action. */
export function parseArgs(args: string): PadAction {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'toggle' }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(trimmed)
  const verb = (m?.[1] ?? '').toLowerCase()
  const rest = (m?.[2] ?? '').trim()
  if (verb === 'list' || verb === 'ls') return { kind: 'list' }
  if (verb === 'save' || verb === 'add') return rest ? { kind: 'save', text: rest.slice(0, MAX_PROMPT) } : { kind: 'help', reason: 'Usage: /launchpad save <prompt text>' }
  if (verb === 'rm' || verb === 'remove' || verb === 'del') {
    const n = Number(rest)
    return Number.isInteger(n) && n >= 1 ? { kind: 'rm', index: n - 1 } : { kind: 'help', reason: 'Usage: /launchpad rm <number> (see /launchpad list)' }
  }
  if (verb === 'pin' || verb === 'unpin') {
    const name = cleanName(rest)
    if (!name) return { kind: 'help', reason: `Usage: /launchpad ${verb} <command>` }
    return verb === 'pin' ? { kind: 'pin', name } : { kind: 'unpin', name }
  }
  if (verb === 'forget' || verb === 'reset') return { kind: 'forget' }
  return { kind: 'help', reason: `Unknown: ${verb}. Try save <text>, rm <n>, pin <cmd>, unpin <cmd>, list, forget.` }
}

export function listText(d: LaunchpadData): string {
  const pinned = pinnedTiles(d)
  const frequent = frequentTiles(d)
  const lines = ['Launchpad']
  lines.push('Pinned:', ...(pinned.length ? pinned.map(t => `  ★ /${t.name}${t.count ? ` ×${t.count}` : ''}`) : ['  (none: /launchpad pin <command>)']))
  lines.push('Frequent:', ...(frequent.length ? frequent.map(t => `  ▶ /${t.name} ×${t.count}`) : ['  (none yet: run some slash commands)']))
  lines.push('Saved:', ...(d.saved.length ? d.saved.map((s, i) => `  ${i + 1}. ${clip(s, 90)}`) : ['  (none: /launchpad save <prompt>)']))
  return lines.join('\n')
}

/** A stable accent per command name. */
export function accentOf(name: string): string {
  return hue((hash(name) % 1000) / 1000, 0.8, 0.62)
}

export function agoText(at: number, now: number): string {
  return at > 0 ? `${fmtSpan(now - at)} ago` : 'never run'
}

// ---------------------------------------------------------------------------
// Desktop tiles: one SVG card per row, its Buttons beside it.

export function sectionSvg(label: string, sub: string, color: string, W: number): string {
  const H = 26
  const body = `<rect x="0" y="8" width="3" height="14" rx="1.5" fill="${color}"/>
${svgText(10, 20, label.toUpperCase(), { size: 10.5, weight: 760, fill: color })}
${svgText(16 + textWidth(label.toUpperCase(), 10.5) + 6, 20, sub, { cls: 'm', size: 10.5 })}`
  return svg(W, H, body)
}

export function commandCardSvg(t: Tile, W: number, now: number, maxCount: number, isPinned: boolean): string {
  const H = 56
  const c = isPinned ? KZ.yellow : accentOf(t.name)
  const initial = (t.name.replace(/[^a-z0-9]/gi, '').charAt(0) || '/').toUpperCase()
  const parts = [
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".22"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`,
    `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`,
    `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="url(#g)"/>`,
    `<circle cx="28" cy="28" r="16" fill="${c}" opacity=".9"/>`,
    svgText(28, 33.5, initial, { size: 15, weight: 800, anchor: 'middle', fill: '#14111f' }),
  ]
  if (isPinned) parts.push(`<path d="M44 10l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="${KZ.yellow}"/>`)
  const right = t.count ? `×${t.count}` : ''
  parts.push(svgText(54, 25, fitText(`/${t.name}`, 15, W - 54 - 60), { size: 15, weight: 700, mono: true }))
  parts.push(svgText(54, 43, fitText(t.description || agoText(t.at, now), 11, W - 54 - (right ? 66 : 14)), { cls: 's', size: 11 }))
  if (right) {
    parts.push(svgText(W - 12, 25, right, { size: 13, weight: 700, anchor: 'end', fill: c }))
    const bw = 44
    const ratio = maxCount > 0 ? t.count / maxCount : 0
    parts.push(`<rect class="k" x="${W - 12 - bw}" y="${H - 11}" width="${bw}" height="3" rx="1.5"/><rect x="${W - 12 - bw}" y="${H - 11}" width="${Math.max(3, bw * ratio)}" height="3" rx="1.5" fill="${c}"/>`)
  }
  return svg(W, H, parts.join(''))
}

export function promptCardSvg(text: string, index: number, W: number): string {
  const H = 56
  const c = KZ.cyan
  const one = text.replace(/\s+/g, ' ').trim()
  // Two lines, cut by width.
  const lineW = W - 56 - 12
  const first = fitText(one, 12, lineW)
  const restText = first.endsWith('…') ? one.slice(first.length - 1) : ''
  const second = restText ? fitText(restText, 12, lineW) : ''
  const parts = [
    `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`,
    `<rect x="0" y="0" width="4" height="${H}" rx="2" fill="${c}"/>`,
    `<rect x="14" y="12" width="30" height="30" rx="9" fill="${c}" opacity=".16"/>`,
    svgText(29, 33, String(index + 1), { size: 14, weight: 800, anchor: 'middle', fill: c }),
    svgText(56, 25, first, { size: 12, weight: 560 }),
  ]
  if (second) parts.push(svgText(56, 42, second, { cls: 's', size: 12 }))
  return svg(W, H, parts.join(''))
}

export function bannerSvg(W: number, runs: number, kinds: number, saved: number): string {
  const H = 64
  const css = `.rk{transform-box:fill-box;transform-origin:center;animation:rk 3s ease-in-out infinite}@keyframes rk{50%{transform:translateY(-3px)}}
.fl{animation:fl .5s ease-in-out infinite alternate}@keyframes fl{to{opacity:.4}}`
  const body = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${KZ.violet}" stop-opacity=".28"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity=".08"/></linearGradient></defs>
<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>
<g transform="translate(30 32)"><g class="rk"><path d="M0-15c6 4 8 11 6 18h-12c-2-7 0-14 6-18z" fill="${KZ.violet}"/><circle cx="0" cy="-3" r="3" fill="#fff"/><path d="M-6 3l-5 6 5-1zM6 3l5 6-5-1z" fill="${KZ.magenta}"/><path class="fl" d="M-4 6l4 9 4-9z" fill="${KZ.amber}"/></g></g>
${svgText(56, 30, 'LAUNCHPAD', { size: 17, weight: 800, fill: KZ.violet })}
${svgText(56, 48, `${runs} run${runs === 1 ? '' : 's'} learned · ${kinds} command${kinds === 1 ? '' : 's'} · ${saved} saved prompt${saved === 1 ? '' : 's'}`, { cls: 's', size: 11 })}`
  return svg(W, H, body, css)
}
