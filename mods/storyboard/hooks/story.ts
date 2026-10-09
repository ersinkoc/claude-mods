// Storyboard's pure helpers: reading the model's chapter call, and drawing the
// phase rail and the chapter log. No `$` here (it may not cross an import).

import type { StoryChapter, StoryPhase } from '../types'
import { KZ, clip, fitText, fmtClock, svg, svgText, textWidth } from './lib/kz.ts'

export const PHASES: readonly StoryPhase[] = ['explore', 'plan', 'build', 'verify', 'ship']

export const PHASE_COLOR: Record<StoryPhase, string> = {
  explore: KZ.cyan,
  plan: KZ.violet,
  build: KZ.amber,
  verify: KZ.green,
  ship: KZ.magenta,
}

export const PHASE_GLYPH: Record<StoryPhase, string> = {
  explore: '⌕',
  plan: '✎',
  build: '⚒',
  verify: '✓',
  ship: '➚',
}

const SHORT: Record<StoryPhase, string> = { explore: 'expl', plan: 'plan', build: 'bld', verify: 'ver', ship: 'ship' }

export const isPhase = (v: unknown): v is StoryPhase => typeof v === 'string' && (PHASES as readonly string[]).includes(v)

/** The one system-prompt section: short on purpose (it rides every request). */
export const NUDGE =
  'On multi-step tasks, call mcp__storyboard__chapter when your phase changes (explore, plan, build, verify, ship): a 2-8 word title, step/steps when counted, an optional short note. It drives a progress band the user watches. Skip it for quick one-step answers.'

/** The input schema of the `chapter` tool, as the model reads it. */
export const CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What this chapter is about, 2-8 words.' },
    phase: { type: 'string', enum: [...PHASES] },
    step: { type: 'integer', minimum: 1, description: 'This step number, when the task has counted steps.' },
    steps: { type: 'integer', minimum: 1, description: 'How many steps the task has.' },
    note: { type: 'string', description: 'One short optional line of detail.' },
  },
  required: ['title', 'phase'],
  additionalProperties: false,
} as const

/** Reads the model's tool input into a chapter, or says what is wrong with it. */
export function parseChapter(input: Record<string, unknown>, at: number): StoryChapter | string {
  const title = typeof input.title === 'string' ? clip(input.title, 80) : ''
  if (!title) return 'title is required (a few words).'
  if (!isPhase(input.phase)) return `phase must be one of: ${PHASES.join(', ')}.`
  const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined)
  const steps = int(input.steps)
  let step = int(input.step)
  if (step !== undefined && steps !== undefined && step > steps) step = steps
  const note = typeof input.note === 'string' && input.note.trim() ? clip(input.note, 140) : undefined
  return { title, phase: input.phase, at, ...(step !== undefined ? { step } : {}), ...(steps !== undefined ? { steps } : {}), ...(note ? { note } : {}) }
}

export function stepText(c: StoryChapter): string {
  if (c.step !== undefined && c.steps !== undefined) return `${c.step}/${c.steps}`
  if (c.step !== undefined) return `step ${c.step}`
  return ''
}

/** Time spent in each phase, from the gaps between chapters. */
export function phaseTimes(log: readonly StoryChapter[], now: number): Record<StoryPhase, number> {
  const out: Record<StoryPhase, number> = { explore: 0, plan: 0, build: 0, verify: 0, ship: 0 }
  log.forEach((c, i) => {
    const end = log[i + 1]?.at ?? now
    out[c.phase] += Math.max(0, end - c.at)
  })
  return out
}

// ---------------------------------------------------------------------------
// Terminal: the rail as colored runs.

export type Run = { text: string; color?: string; bold?: boolean; dim?: boolean }

export function railRuns(phase: StoryPhase, cols: number): Run[] {
  const active = PHASES.indexOf(phase)
  const isShort = cols < 58
  const isTiny = cols < 34
  const link = isTiny ? '─' : isShort ? '──' : '───'
  const runs: Run[] = []
  PHASES.forEach((p, i) => {
    const label = isTiny ? '' : isShort ? SHORT[p] : p
    if (i < active) runs.push({ text: `● ${label}`.trimEnd(), color: PHASE_COLOR[p] })
    else if (i === active) runs.push({ text: `◉ ${label.toUpperCase()}`.trimEnd(), color: PHASE_COLOR[p], bold: true })
    else runs.push({ text: `○ ${label}`.trimEnd(), dim: true })
    if (i < PHASES.length - 1) runs.push(i < active ? { text: ` ${link} `, color: PHASE_COLOR[p] } : { text: ` ${link} `, dim: true })
  })
  return runs
}

// ---------------------------------------------------------------------------
// Desktop: the rail as one SVG, the active stage glowing with a comet in orbit.

function railMarkup(phase: StoryPhase, x0: number, x1: number, cy: number, labelY: number, uid: string): { body: string; css: string } {
  const active = PHASES.indexOf(phase)
  const gap = (x1 - x0) / (PHASES.length - 1)
  const xs = PHASES.map((_, i) => x0 + i * gap)
  const parts: string[] = []
  // The track, then the stretch already travelled in a gradient of the phases passed.
  parts.push(`<line class="ln" x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke-width="3" stroke-linecap="round"/>`)
  const stops = PHASES.slice(0, active + 1).map((p, i) => `<stop offset="${active === 0 ? 0 : i / active}" stop-color="${PHASE_COLOR[p]}"/>`).join('')
  parts.push(`<defs><linearGradient id="trail${uid}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
<filter id="glow${uid}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="tail${uid}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${PHASE_COLOR[phase]}" stop-opacity="0"/></radialGradient></defs>`)
  const ax = xs[active]!
  if (active > 0) parts.push(`<line x1="${x0}" y1="${cy}" x2="${ax}" y2="${cy}" stroke="url(#trail${uid})" stroke-width="3" stroke-linecap="round"/>`)
  PHASES.forEach((p, i) => {
    const x = xs[i]!
    const c = PHASE_COLOR[p]
    if (i < active) {
      parts.push(`<circle cx="${x}" cy="${cy}" r="5.5" fill="${c}"/>`)
      parts.push(`<path d="M${x - 2.4} ${cy}l1.7 1.8 3.2-3.4" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (i === active) {
      parts.push(`<circle class="halo" cx="${x}" cy="${cy}" r="9" fill="none" stroke="${c}" stroke-width="2"/>`)
      parts.push(`<circle cx="${x}" cy="${cy}" r="7.5" fill="${c}" filter="url(#glow${uid})" class="pulse"/>`)
      parts.push(`<circle cx="${x}" cy="${cy}" r="3" fill="#fff" opacity=".9"/>`)
      // The comet: a bright head and a fading tail, orbiting the active stage.
      parts.push(`<g class="orb${uid}"><path d="M${x} ${cy - 14}A14 14 0 0 0 ${(x - 14 * Math.sin(1.1)).toFixed(2)} ${(cy - 14 * Math.cos(1.1)).toFixed(2)}" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55"/><circle cx="${x}" cy="${cy - 14}" r="4" fill="url(#tail${uid})"/><circle cx="${x}" cy="${cy - 14}" r="2.1" fill="#fff"/></g>`)
    } else {
      parts.push(`<circle cx="${x}" cy="${cy}" r="5" class="p" stroke="${c}" stroke-opacity=".55" stroke-width="1.6"/>`)
    }
    parts.push(svgText(x, labelY, p, i === active ? { size: 10.5, weight: 750, anchor: 'middle', fill: c } : { cls: i < active ? 's' : 'm', size: 10, weight: 550, anchor: 'middle' }))
  })
  const css = `.orb${uid}{transform-box:view-box;transform-origin:${ax}px ${cy}px;animation:orb${uid} 2.6s linear infinite}@keyframes orb${uid}{to{transform:rotate(360deg)}}
.halo{transform-box:fill-box;transform-origin:center;animation:halo 2.2s ease-out infinite}@keyframes halo{0%{transform:scale(.7);opacity:.85}100%{transform:scale(2);opacity:0}}`
  return { body: parts.join(''), css }
}

/** The band: the chapter on the left, the rail on the right (stacked when narrow). */
export function bandSvg(c: StoryChapter, W: number): { source: string; height: number } {
  const isWide = W >= 560
  const H = isWide ? 60 : 92
  const color = PHASE_COLOR[c.phase]
  const textW = isWide ? Math.max(170, Math.min(W * 0.42, 360)) : W - 24
  const parts: string[] = []
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`)
  parts.push(`<rect x="0" y="0" width="4" height="${H}" rx="2" fill="${color}"/>`)
  const step = stepText(c)
  const label = `CHAPTER · ${c.phase.toUpperCase()}${step ? ` · ${step}` : ''}`
  parts.push(svgText(16, 18, label, { size: 9.5, weight: 700, fill: color }))
  parts.push(svgText(16, 36, fitText(c.title, 14, textW - 16), { size: 14, weight: 680 }))
  if (c.note) parts.push(svgText(16, 51, fitText(c.note, 11, textW - 16), { cls: 's', size: 11 }))
  const rail = isWide ? railMarkup(c.phase, textW + 28, W - 34, 24, 49, 'b') : railMarkup(c.phase, 34, W - 34, 70, 88, 'b')
  // A small step meter after the label, when the model counts steps.
  if (c.step !== undefined && c.steps !== undefined && c.steps > 0) {
    const n = Math.min(c.steps, 12)
    const done = Math.round((c.step / c.steps) * n)
    const mx = 16 + textWidth(label, 9.5) + 10
    for (let i = 0; i < n; i++) parts.push(`<rect x="${mx + i * 8}" y="12.5" width="6" height="4" rx="2" ${i < done ? `fill="${color}"` : 'class="k"'}/>`)
  }
  return { source: svg(W, H, parts.join('') + rail.body, rail.css), height: H }
}

/** The log pane's header: the current rail, or a quiet placeholder. */
export function headerSvg(c: StoryChapter | null, count: number, W: number): string {
  const H = 78
  const parts = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`]
  parts.push(svgText(14, 20, 'STORYBOARD', { size: 10, weight: 750, fill: KZ.violet }))
  parts.push(svgText(W - 14, 20, `${count} chapter${count === 1 ? '' : 's'}`, { cls: 'm', size: 10.5, anchor: 'end' }))
  if (!c) {
    parts.push(svgText(W / 2, 52, 'No chapters yet: Claude marks them on multi-step tasks.', { cls: 's', size: 11.5, anchor: 'middle' }))
    return svg(W, H, parts.join(''))
  }
  const rail = railMarkup(c.phase, 34, W - 34, 44, 68, 'h')
  return svg(W, H, parts.join('') + rail.body, rail.css)
}

/** Time per phase as one stacked bar with a legend. */
export function timesSvg(times: Record<StoryPhase, number>, W: number): string {
  const total = PHASES.reduce((s, p) => s + times[p], 0)
  const H = 54
  const parts = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`]
  parts.push(svgText(14, 18, 'TIME PER PHASE', { cls: 's', size: 9.5, weight: 700 }))
  const bw = W - 28
  let x = 14
  parts.push(`<rect class="k" x="14" y="25" width="${bw}" height="8" rx="4"/>`)
  if (total > 0) {
    parts.push(`<clipPath id="tc"><rect x="14" y="25" width="${bw}" height="8" rx="4"/></clipPath><g clip-path="url(#tc)">`)
    for (const p of PHASES) {
      const w = (times[p] / total) * bw
      if (w > 0) parts.push(`<rect x="${x.toFixed(1)}" y="25" width="${w.toFixed(1)}" height="8" fill="${PHASE_COLOR[p]}"/>`)
      x += w
    }
    parts.push('</g>')
  }
  const slot = bw / PHASES.length
  PHASES.forEach((p, i) => {
    const lx = 14 + i * slot
    parts.push(`<circle cx="${lx + 4}" cy="45" r="3.5" fill="${PHASE_COLOR[p]}"/>`)
    parts.push(svgText(lx + 11, 48.5, fitText(`${p} ${times[p] ? fmtClock(times[p]) : '—'}`, 9.5, slot - 14), { cls: 'm', size: 9.5 }))
  })
  return svg(W, H, parts.join(''))
}

/** One chapter of the log as a timeline row. */
export function chapterRowSvg(c: StoryChapter, W: number, startedAt: number, isCurrent: boolean, isLast: boolean): string {
  const H = c.note ? 50 : 36
  const color = PHASE_COLOR[c.phase]
  const parts: string[] = []
  parts.push(`<line class="ln" x1="16" y1="0" x2="16" y2="${isLast ? 18 : H}" stroke-width="2"/>`)
  parts.push(`<circle cx="16" cy="18" r="${isCurrent ? 6 : 4.5}" fill="${color}" class="${isCurrent ? 'pulse' : ''}"/>`)
  parts.push(svgText(30, 22, fmtClock(c.at - startedAt), { cls: 'm', size: 10.5, mono: true }))
  const chip = c.phase
  const chipW = chip.length * 6.4 + 14
  parts.push(`<rect x="76" y="9" width="${chipW}" height="17" rx="8.5" fill="${color}" opacity=".18"/>`)
  parts.push(svgText(76 + chipW / 2, 21.5, chip, { size: 10, weight: 650, anchor: 'middle', fill: color }))
  const step = stepText(c)
  const tx = 84 + chipW
  parts.push(svgText(tx, 22, fitText(c.title, 13, W - tx - (step ? 50 : 12)), { size: 13, weight: isCurrent ? 700 : 560 }))
  if (step) parts.push(svgText(W - 10, 22, step, { cls: 's', size: 10.5, anchor: 'end', mono: true }))
  if (c.note) parts.push(svgText(tx, 40, fitText(c.note, 11, W - tx - 12), { cls: 's', size: 11 }))
  return svg(W, H, parts.join(''))
}

export function chapterAlt(c: StoryChapter): string {
  const step = stepText(c)
  return `Chapter: ${c.title}; phase ${c.phase}${step ? `, ${step}` : ''}${c.note ? `; ${c.note}` : ''}`
}
