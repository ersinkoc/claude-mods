// Verdict's views: the chips per runner, the desktop SVG band and the pane's
// header card. Pure: no `$` here.
import type { VerdictRun } from '../types'
import { KZ, fitText, svg, svgText, textWidth } from './lib/kz.ts'
import { chipText, health } from './parse.ts'

export type Chip = {
  runner: string
  text: string
  ok: boolean
  /** The runner's last runs, oldest first: health 0..1 and whether each passed. */
  spark: { h: number; ok: boolean }[]
  failures: string[]
  at: number
}

export const SPARK_RUNS = 10

/** One chip per runner seen since `since`, the most recent first; sparklines span all history. */
export function chipsOf(runs: readonly VerdictRun[], since: number): Chip[] {
  const byRunner = new Map<string, VerdictRun[]>()
  for (const r of runs) {
    const list = byRunner.get(r.runner) ?? []
    list.push(r)
    byRunner.set(r.runner, list)
  }
  const chips: Chip[] = []
  for (const [runner, list] of byRunner) {
    const last = list[list.length - 1]
    if (!last || last.at < since) continue
    chips.push({
      runner,
      text: chipText(last),
      ok: last.ok,
      spark: list.slice(-SPARK_RUNS).map(r => ({ h: health(r), ok: r.ok })),
      failures: last.ok ? [] : last.failures,
      at: last.at,
    })
  }
  return chips.sort((a, b) => b.at - a.at)
}

const BARS = '▁▂▃▄▅▆▇█'
export function sparkBars(spark: readonly { h: number; ok: boolean }[]): { s: string; ok: boolean }[] {
  return spark.map(p => ({ s: BARS[Math.max(0, Math.min(7, Math.round(p.h * 7)))] ?? '▁', ok: p.ok }))
}

/** The failures to cycle through on the band: the failing chips', newest first. */
export function failureLines(chips: readonly Chip[]): string[] {
  return chips.flatMap(c => c.failures.map(f => `${c.runner}: ${f}`)).slice(0, 12)
}

// ---------------------------------------------------------------------------
// Desktop band: pills with sparklines; failing ones pulse red; a second line
// cycles through the failing tests by CSS.

export function bandSvg(chips: readonly Chip[], W: number, withFailures: boolean): { source: string; height: number } {
  const fails = withFailures ? failureLines(chips).slice(0, 6) : []
  const H = fails.length ? 54 : 30
  const parts: string[] = []
  const css = `
.pz{animation:pz 1.4s ease-in-out infinite}@keyframes pz{0%,100%{stroke-opacity:.95;stroke-width:1.6}50%{stroke-opacity:.25;stroke-width:4}}
.bk{animation:bk 1.4s ease-in-out infinite}@keyframes bk{50%{opacity:.3}}
.cy{opacity:0;animation:cy ${Math.max(1, fails.length) * 3}s linear infinite}@keyframes cy{0%{opacity:0}${(2 / Math.max(1, fails.length)).toFixed(1)}%{opacity:1}${(100 / Math.max(1, fails.length) - 2).toFixed(1)}%{opacity:1}${(100 / Math.max(1, fails.length)).toFixed(1)}%{opacity:0}100%{opacity:0}}`
  let x = 0
  let hidden = 0
  for (const c of chips) {
    const tw = textWidth(c.text, 12)
    const sw = c.spark.length * 4
    const w = 14 + tw + 8 + sw + 12
    if (x + w > W) {
      hidden++
      continue
    }
    const color = c.ok ? KZ.green : KZ.red
    parts.push(`<rect class="p" x="${x + 1}" y="2" width="${w - 2}" height="26" rx="13"/>`)
    parts.push(`<rect x="${x + 1}" y="2" width="${w - 2}" height="26" rx="13" fill="none" stroke="${color}" stroke-opacity="${c.ok ? 0.45 : 0.9}" class="${c.ok ? '' : 'pz'}"/>`)
    parts.push(`<circle cx="${x + 12}" cy="15" r="3.5" fill="${color}" class="${c.ok ? '' : 'bk'}"/>`)
    parts.push(svgText(x + 20, 19.5, c.text.replace(/^[✓✗] /, ''), { size: 12, weight: 650, fill: c.ok ? undefined : KZ.red, cls: 't' }))
    let bx = x + 20 + tw - textWidth('✓ ', 12) + 8
    for (const p of c.spark) {
      const bh = 3 + p.h * 13
      parts.push(`<rect x="${bx.toFixed(1)}" y="${(22 - bh).toFixed(1)}" width="3" height="${bh.toFixed(1)}" rx="1" fill="${p.ok ? KZ.green : KZ.red}" opacity="${p.ok ? 0.75 : 0.95}"/>`)
      bx += 4
    }
    x += w + 6
  }
  if (hidden > 0) parts.push(svgText(Math.min(x + 4, W - 40), 19.5, `+${hidden}`, { cls: 'm', size: 11 }))
  fails.forEach((f, i) => {
    parts.push(`<g class="cy" style="animation-delay:${i * 3}s">${svgText(14, 46, fitText(`↳ ${f}`, 11.5, W - 20), { size: 11.5, fill: '#ef4444', mono: true })}</g>`)
  })
  return { source: svg(W, H, parts.join(''), css), height: H }
}

export function bandAlt(chips: readonly Chip[]): string {
  return chips.map(c => c.text).join(' · ')
}

// ---------------------------------------------------------------------------
// Pane header: one tile per runner with its last ten runs as bars.

export function paneCard(chips: readonly Chip[], W: number): { source: string; height: number } {
  if (!chips.length) {
    const body = `<rect class="p" width="${W}" height="56" rx="12"/>${svgText(16, 25, 'No runs yet', { size: 14, weight: 650 })}${svgText(16, 43, 'Tests, type checks, lints and builds Claude runs land here.', { cls: 's', size: 11 })}`
    return { source: svg(W, 56, body), height: 56 }
  }
  const cols = W >= 520 ? 3 : W >= 340 ? 2 : 1
  const tw = (W - (cols - 1) * 8) / cols
  const th = 64
  const rows = Math.ceil(chips.length / cols)
  const H = rows * (th + 8) - 8
  const parts: string[] = []
  const css = `.pz{animation:pz 1.4s ease-in-out infinite}@keyframes pz{50%{stroke-opacity:.2}}`
  chips.forEach((c, i) => {
    const x = (i % cols) * (tw + 8)
    const y = Math.floor(i / cols) * (th + 8)
    const color = c.ok ? KZ.green : KZ.red
    parts.push(`<rect class="p" x="${x}" y="${y}" width="${tw}" height="${th}" rx="12"/>`)
    parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${tw - 1}" height="${th - 1}" rx="12" fill="none" stroke="${color}" stroke-opacity=".8" class="${c.ok ? '' : 'pz'}"/>`)
    parts.push(svgText(x + 12, y + 20, c.runner.toUpperCase(), { cls: 's', size: 10, weight: 700 }))
    parts.push(svgText(x + 12, y + 42, fitText(c.text, 14, tw - 24), { size: 14, weight: 700, fill: color }))
    const n = c.spark.length
    c.spark.forEach((p, j) => {
      const bh = 3 + p.h * 14
      parts.push(`<rect x="${(x + tw - 12 - (n - j) * 6).toFixed(1)}" y="${(y + 56 - bh).toFixed(1)}" width="4" height="${bh.toFixed(1)}" rx="1.5" fill="${p.ok ? KZ.green : KZ.red}" opacity=".85"/>`)
    })
  })
  return { source: svg(W, H, parts.join(''), css), height: H }
}

export function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

/** One run in words, for the pane: `142 passed · 3 failed · 2 skipped`. */
export function runSummary(r: VerdictRun): string {
  const bits: string[] = []
  if (r.kind === 'test') {
    if (r.pass || r.parsed) bits.push(`${r.pass} passed`)
    if (r.fail) bits.push(`${r.fail} failed`)
    if (r.skip) bits.push(`${r.skip} skipped`)
    if (r.errors) bits.push(`${r.errors} ${r.errors === 1 ? 'error' : 'errors'}`)
    if (!bits.length) bits.push(r.ok ? 'passed' : 'failed')
  } else {
    bits.push(r.ok && !r.errors ? (r.kind === 'build' ? 'built' : '0 errors') : `${r.errors || 1} ${r.errors === 1 || !r.errors ? 'error' : 'errors'}`)
    if (r.warnings) bits.push(`${r.warnings} ${r.warnings === 1 ? 'warning' : 'warnings'}`)
  }
  return bits.join(' · ')
}

