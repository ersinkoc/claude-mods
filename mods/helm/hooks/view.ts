// Helm's pure view helpers: the command's arguments, the text answers and
// the desktop's SVG rows. No `$` here.

import type { HelmBackup } from '../types'
import { KZ, fitText, svg, svgBar, svgText, xml } from './lib/kz.ts'
import { SKIP_REASON, matchOf } from './profiles.ts'
import type { PlanItem, Profile } from './profiles.ts'

export type HelmAction =
  | { kind: 'toggle' }
  | { kind: 'open'; id: string }
  | { kind: 'apply'; id: string }
  | { kind: 'save'; name: string }
  | { kind: 'rm'; id: string }
  | { kind: 'undo' }
  | { kind: 'list' }
  | { kind: 'history' }
  | { kind: 'close' }
  | { kind: 'help'; reason: string }

export const USAGE = '/helm [<profile> | apply <profile> | save <name> | rm <name> | undo | list | history | close]'

/** `/helm <verb> <rest>` into an action; a lone word that is not a verb names a profile. */
export function parseArgs(args: string): HelmAction {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'toggle' }
  const gap = trimmed.search(/\s/)
  const verb = (gap < 0 ? trimmed : trimmed.slice(0, gap)).toLowerCase()
  const rest = gap < 0 ? '' : trimmed.slice(gap).trim()
  if (verb === 'apply' || verb === 'use') return rest ? { kind: 'apply', id: rest } : { kind: 'help', reason: `Usage: /helm apply <profile>` }
  if (verb === 'save') return rest ? { kind: 'save', name: rest } : { kind: 'help', reason: 'Usage: /helm save <name> (saves your current setup as a profile)' }
  if (verb === 'rm' || verb === 'remove' || verb === 'delete') return rest ? { kind: 'rm', id: rest } : { kind: 'help', reason: 'Usage: /helm rm <name>' }
  if (verb === 'undo') return { kind: 'undo' }
  if (verb === 'list' || verb === 'ls') return { kind: 'list' }
  if (verb === 'history' || verb === 'log') return { kind: 'history' }
  if (verb === 'close' || verb === 'off') return { kind: 'close' }
  if (verb === 'help') return { kind: 'help', reason: USAGE }
  return { kind: 'open', id: trimmed }
}

export const markOf = (p: PlanItem, isOff: boolean): string =>
  p.status === 'change' ? (isOff ? '○' : '●') : p.status === 'same' ? '✓' : '⊘'

/** One plan line as text: what changes and why, what is already set, or why it is skipped. */
export function lineText(p: PlanItem, isOff = false): string {
  if (p.status === 'change') return `${p.label}: ${p.from} → ${p.to}${isOff ? '  (left out)' : `  (${p.why})`}`
  if (p.status === 'same') return `${p.label}: ${p.to}`
  return `${p.label}: ${SKIP_REASON[p.status]}`
}

export function planText(profile: Profile, plan: readonly PlanItem[], off: readonly string[] = []): string {
  const lines = [`${profile.icon} ${profile.name}: ${profile.tagline}`]
  for (const p of plan) lines.push(`  ${markOf(p, off.includes(p.id))} ${lineText(p, off.includes(p.id))}`)
  const n = plan.filter(p => p.status === 'change' && !off.includes(p.id)).length
  lines.push(n === 0 ? '  already in force' : `/helm apply ${profile.id} makes ${n} change${n === 1 ? '' : 's'}`)
  return lines.join('\n')
}

export const meterText = (plan: readonly PlanItem[]): string => {
  const { same, of } = matchOf(plan)
  return of > 0 && same === of ? '✓ in force' : `${same}/${of}`
}

export function listText(rows: readonly { profile: Profile; plan: readonly PlanItem[] }[], suggested: string | null): string {
  const lines = ['Helm profiles']
  for (const { profile: p, plan } of rows) {
    const tag = suggested !== null && p.id === 'saver' ? `  ← suggested: ${suggested}` : ''
    lines.push(`  ${p.icon} ${p.id.padEnd(10)} ${meterText(plan).padEnd(10)} ${p.tagline}${tag}`)
  }
  lines.push(USAGE)
  return lines.join('\n')
}

export const changedCount = (b: HelmBackup): number => b.entries.length + (b.effort && !b.entries.some(e => e.layer === 'settings' && e.path.endsWith('.effortLevel')) ? 1 : 0)

/** One line on what an activation did. */
export function summary(b: HelmBackup): string {
  const n = changedCount(b)
  const head = n === 0 ? `${b.name}: already in place` : `${b.name} applied: ${n} setting${n === 1 ? '' : 's'} changed`
  const effort = b.effort ? ` (effort ${b.effort})` : ''
  return b.skipped.length === 0 ? `${head}${effort}` : `${head}${effort}, ${b.skipped.length} skipped`
}

export const clockOf = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function historyText(list: readonly HelmBackup[]): string {
  if (list.length === 0) return 'Helm history: nothing applied yet'
  return ['Helm history (newest first; /helm undo reverts the top one)', ...list.map(b => `  ${clockOf(b.at)}  ${b.icon} ${b.name}: ${changedCount(b)} changed${b.skipped.length ? `, ${b.skipped.length} skipped` : ''}`)].join('\n')
}

// ---------------------------------------------------------------- desktop rows

const MARK_COLOR = (p: PlanItem, color: string, isOff: boolean): string =>
  p.status === 'change' ? (isOff ? KZ.mist : color) : p.status === 'same' ? KZ.green : KZ.amber

export function headerSvg(W: number, facts: string, active: string | null, suggestion: string | null): string {
  const h = suggestion ? 64 : 46
  const body =
    `<rect class="p" x="0" y="0" width="${W}" height="${h}" rx="10"/>` +
    `<rect x="10" y="10" width="26" height="26" rx="7" fill="${KZ.clay}"/>` +
    svgText(23, 28, '⎈', { size: 16, weight: 700, anchor: 'middle', fill: KZ.ink }) +
    svgText(46, 22, 'HELM', { size: 13, weight: 800 }) +
    svgText(46, 37, fitText(facts, 11, W - 60), { cls: 's', size: 11, mono: true }) +
    (active ? svgText(W - 12, 22, fitText(`✓ ${active}`, 11, W / 2 - 40), { size: 11, weight: 600, anchor: 'end', fill: KZ.green }) : '') +
    (suggestion ? svgText(12, 56, fitText(`◔ Token saver suggested: ${suggestion}`, 11, W - 24), { size: 11, weight: 600, fill: KZ.amber }) : '')
  return svg(W, h, body)
}

export function cardSvg(W: number, p: Profile, plan: readonly PlanItem[], isOpen: boolean, isSuggested: boolean): string {
  const { same, of } = matchOf(plan)
  const isOn = of > 0 && same === of
  const H = 54
  const right = isOn ? '✓ in force' : `${same}/${of}`
  const body =
    `<rect class="p" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"${isOpen ? ` stroke="${p.color}" stroke-width="1.5"` : ''}/>` +
    `<rect x="10" y="12" width="30" height="30" rx="8" fill="${p.color}"/>` +
    svgText(25, 33, p.icon, { size: 16, weight: 700, anchor: 'middle', fill: KZ.ink }) +
    svgText(50, 24, fitText(p.name, 13, W - 170), { size: 13, weight: 700, fill: p.color }) +
    (isSuggested ? svgText(W - 12, 24, 'suggested', { size: 10, weight: 700, anchor: 'end', fill: KZ.amber }) : '') +
    svgText(50, 41, fitText(p.tagline, 11, W - 150), { cls: 's', size: 11 }) +
    svgBar(W - 92, 34, 50, 5, of === 0 ? 0 : same / of, p.color) +
    svgText(W - 12, isSuggested ? 40 : 30, right, { size: 10, weight: 600, anchor: 'end', fill: isOn ? KZ.green : undefined, cls: 'm' })
  return svg(W, H, body)
}

export function stepSvg(W: number, p: PlanItem, color: string, isOff: boolean): string {
  const H = 34
  const mark = markOf(p, isOff)
  const tone = MARK_COLOR(p, color, isOff)
  const labelW = Math.min(170, Math.max(90, W * 0.4))
  let detail: string
  if (p.status === 'change') {
    const from = fitText(p.from, 11, (W - labelW - 40) / 2)
    const fromW = Math.min((W - labelW - 40) / 2, from.length * 6.2)
    detail =
      svgText(labelW + 22, 14, from, { cls: 'm', size: 11 }) +
      `<line x1="${labelW + 22}" y1="10" x2="${labelW + 22 + fromW}" y2="10" stroke="${KZ.mist}" stroke-width="1"/>` +
      svgText(labelW + 28 + fromW, 14, fitText(`→ ${p.to}`, 11, W - labelW - fromW - 36), { size: 11, weight: 700, fill: isOff ? KZ.mist : color })
  } else {
    detail = svgText(labelW + 22, 14, fitText(p.status === 'same' ? p.to : SKIP_REASON[p.status], 11, W - labelW - 30), { cls: 'm', size: 11 })
  }
  const why = p.status === 'change' ? (isOff ? 'left out of this activation' : p.why) : ''
  const body =
    svgText(8, 14, mark, { size: 12, weight: 700, fill: tone }) +
    svgText(22, 14, fitText(p.label, 12, labelW - 4), { size: 12, weight: p.status === 'change' ? 600 : 400, cls: p.status === 'change' && !isOff ? 't' : 's' }) +
    detail +
    (why ? svgText(22, 29, fitText(why, 10, W - 30), { cls: 'm', size: 10 }) : '')
  return svg(W, why ? H : 20, body)
}

export function historySvg(W: number, b: HelmBackup, color: string): string {
  const body =
    `<circle cx="9" cy="10" r="4" fill="${xml(color)}"/>` +
    svgText(20, 14, clockOf(b.at), { cls: 'm', size: 11, mono: true }) +
    svgText(62, 14, fitText(`${b.icon} ${b.name}`, 12, W - 170), { size: 12, weight: 600 }) +
    svgText(W - 8, 14, `${changedCount(b)} changed${b.skipped.length ? ` · ${b.skipped.length} skipped` : ''}`, { cls: 's', size: 11, anchor: 'end' })
  return svg(W, 20, body)
}
