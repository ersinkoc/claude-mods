// Blackbox's desktop drawing: the recording as one SVG. Between redraws the
// compositor keeps it moving: the now cursor glides to the end of the axis
// and every running bar grows with it, at exactly the axis' pace.
import type { BlackboxSnap } from '../types'
import { KZ, fitText, svg, svgText, textWidth, toolColor, toolName, xml } from './lib/kz.ts'
import { axisSpan, axisTicks, fmtAxis, fmtElapsed, laneLabel, levels, MAIN, pickLanes } from './timeline.ts'

const CSS = `
.grid{stroke:#e4e2dc}.trk{fill:#ebe9e4}
@media (prefers-color-scheme: dark){.grid{stroke:#323230}.trk{fill:#2a2a28}}
.rec{animation:bbr 1s steps(2,jump-none) infinite}@keyframes bbr{50%{opacity:.15}}
.live{animation:bbl 1.2s ease-in-out infinite}@keyframes bbl{50%{opacity:.55}}
`

export const DESKTOP_LANES = 5

export function recorderSvg(snap: BlackboxSnap, width: number): { source: string; width: number; height: number; alt: string } {
  const { turn, isLive, now } = snap
  const W = Math.max(320, width)
  const { lanes, hidden } = pickLanes(turn, DESKTOP_LANES)
  const labelW = Math.min(150, Math.max(92, W * 0.16))
  const stripX = labelW + 10
  const stripW = W - stripX - 12
  const top = 24
  const laneH = 19
  const H = top + lanes.length * laneH + 8
  const end = turn.endedAt ?? now
  const elapsed = Math.max(0, end - turn.startedAt)
  const span = axisSpan(elapsed, isLive)
  const xOf = (t: number) => stripX + Math.max(0, Math.min(1, (t - turn.startedAt) / span)) * stripW
  const remaining = Math.max(0.05, (span - elapsed) / 1000)
  const css: string[] = [CSS]
  const p: string[] = []

  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="10"/>`)
  p.push(`<defs><filter id="bbg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter></defs>`)
  // Header: recorder light and clock, then the axis labels.
  if (isLive) {
    p.push(`<circle class="rec" cx="14" cy="13" r="4" fill="${KZ.red}"/>`)
    p.push(svgText(24, 17, `REC ${fmtElapsed(elapsed)}`, { size: 11, weight: 750, fill: KZ.red }))
  } else {
    p.push(`<rect x="10" y="9" width="8" height="8" rx="1.5" class="m" fill="#8e8e8a"/>`)
    p.push(svgText(24, 17, `LAST TURN ${fmtElapsed(elapsed)}`, { cls: 's', size: 10.5, weight: 700 }))
  }
  const tools = turn.bars.length
  const sub = `${tools} tool${tools === 1 ? '' : 's'}${hidden ? ` · +${hidden}` : ''}`
  const headW = 24 + textWidth(isLive ? `REC ${fmtElapsed(elapsed)}` : `LAST TURN ${fmtElapsed(elapsed)}`, 11) + 8
  if (headW + textWidth(sub, 9.5) < labelW + 2) p.push(svgText(labelW + 2, 17, sub, { cls: 'm', size: 9.5, anchor: 'end' }))
  for (const t of axisTicks(span, Math.max(2, Math.floor(stripW / 64)))) {
    const x = stripX + (t / span) * stripW
    p.push(`<line class="grid" x1="${x.toFixed(1)}" y1="${top - 3}" x2="${x.toFixed(1)}" y2="${H - 6}" stroke-width="1" stroke-dasharray="2 3"/>`)
    p.push(svgText(Math.min(x + 3, W - 14), 16, fmtAxis(t), { cls: 'm', size: 9, anchor: x > W - 30 ? 'end' : 'start' }))
  }

  const body: string[] = []
  lanes.forEach((lane, i) => {
    const y = top + i * laneH
    const color = lane === MAIN ? KZ.cyan : KZ.violet
    body.push(`<rect x="8" y="${y + 3}" width="3" height="${laneH - 6}" rx="1.5" fill="${color}"/>`)
    body.push(svgText(16, y + laneH - 5, fitText(laneLabel(turn, lane), 10.5, labelW - 18), { cls: lane === MAIN ? 't' : 's', size: 10.5, weight: lane === MAIN ? 650 : 500 }))
    body.push(`<rect class="trk" x="${stripX}" y="${y + laneH / 2 - 1}" width="${stripW}" height="2" rx="1"/>`)
    for (const t of turn.ticks) {
      if (t.lane !== lane) continue
      const x = xOf(t.at).toFixed(1)
      body.push(`<line x1="${x}" y1="${y + 1.5}" x2="${x}" y2="${y + laneH - 1.5}" stroke="${KZ.violet}" stroke-width="1" opacity=".55"/>`)
    }
    let n = 0
    const mine = turn.bars.filter(b => b.lane === lane)
    const lv = levels(mine, end)
    for (const b of mine) {
      const m = lv.get(b)
      const bh = m?.overlaps ? (laneH - 6) / 2 - 0.5 : laneH - 6
      const by = y + 3 + (m?.overlaps && m.level === 1 ? bh + 1 : 0)
      const x0 = xOf(b.s)
      const isRunning = b.e === null && isLive
      const x1 = xOf(b.e ?? end)
      const w = Math.max(2.5, x1 - x0)
      const c = b.isError ? KZ.red : toolColor(b.tool)
      const tip = `<title>${xml(toolName(b.tool))} · ${b.e === null ? 'running' : `${((b.e - b.s) / 1000).toFixed(1)}s`}${b.isError ? ' · failed' : ''}</title>`
      if (isRunning) {
        const full = Math.max(w, stripX + stripW - x0)
        css.push(`@keyframes g${n}${i}{from{transform:scaleX(${(w / full).toFixed(4)})}to{transform:scaleX(1)}}`)
        body.push(`<rect x="${x0.toFixed(1)}" y="${by}" width="${full.toFixed(1)}" height="${bh}" rx="${Math.min(2.5, bh / 2)}" fill="${c}" filter="url(#bbg)" opacity=".55" style="transform-box:fill-box;transform-origin:left center;animation:g${n}${i} ${remaining.toFixed(2)}s linear both"/>`)
        body.push(`<rect class="live" x="${x0.toFixed(1)}" y="${by}" width="${full.toFixed(1)}" height="${bh}" rx="${Math.min(2.5, bh / 2)}" fill="${c}" style="transform-box:fill-box;transform-origin:left center;animation:g${n}${i} ${remaining.toFixed(2)}s linear both,bbl 1.2s ease-in-out infinite">${tip}</rect>`)
      } else {
        body.push(`<rect x="${x0.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${bh}" rx="${Math.min(2.5, bh / 2)}" fill="${c}"${b.isError ? ` stroke="${KZ.red}" stroke-width="1.2" fill-opacity=".45"` : ''}>${tip}</rect>`)
      }
      n++
    }
  })
  p.push(isLive ? body.join('') : `<g opacity=".42">${body.join('')}</g>`)

  if (isLive) {
    const x = xOf(now)
    css.push(`@keyframes cur{from{transform:translateX(0)}to{transform:translateX(${(stripX + stripW - x).toFixed(1)}px)}}`)
    p.push(`<g style="animation:cur ${remaining.toFixed(2)}s linear both">`)
    p.push(`<line x1="${x.toFixed(1)}" y1="${top - 2}" x2="${x.toFixed(1)}" y2="${H - 5}" stroke="${KZ.magenta}" stroke-width="3" opacity=".35" filter="url(#bbg)"/>`)
    p.push(`<line x1="${x.toFixed(1)}" y1="${top - 2}" x2="${x.toFixed(1)}" y2="${H - 5}" stroke="${KZ.magenta}" stroke-width="1.4"/>`)
    p.push(`<path d="M${(x - 4).toFixed(1)} ${top - 6}h8l-4 5z" fill="${KZ.magenta}"/>`)
    p.push(`</g>`)
  }
  return { source: svg(W, H, p.join(''), css.join('')), width: W, height: H, alt: altOf(snap) }
}

export function altOf(snap: BlackboxSnap): string {
  const { turn, isLive, now } = snap
  const elapsed = (turn.endedAt ?? now) - turn.startedAt
  const agents = turn.lanes.length - 1
  const failed = turn.bars.filter(b => b.isError).length
  return `Blackbox: ${isLive ? 'recording' : 'last turn'} ${fmtElapsed(elapsed)}, ${turn.bars.length} tool calls${failed ? ` (${failed} failed)` : ''}, ${turn.ticks.length} model requests, ${agents} subagent${agents === 1 ? '' : 's'}`
}
