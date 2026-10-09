// Questline's desktop drawing: one SVG row of segments and a caption.
import type { QuestSnap } from '../types'
import { KZ, fitText, svg, svgText, textWidth } from './lib/kz.ts'
import { coarseSpan, progress } from './quests.ts'

const CSS = `
.qa{animation:qa 1.6s ease-in-out infinite}@keyframes qa{50%{opacity:.62}}
.qs{animation:qs 1.8s cubic-bezier(.4,0,.2,1) infinite}@keyframes qs{from{transform:translateX(-30px)}to{transform:translateX(var(--w))}}
.qw{animation:qw 3.2s ease-in-out infinite}@keyframes qw{from{transform:translateX(-60px)}60%,to{transform:translateX(var(--w))}}
`

export function questSvg(s: QuestSnap, width: number): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(260, width)
  const H = 30
  const { done, total, active } = progress(s.items)
  const allDone = total > 0 && done === total
  const n = s.items.length
  const gap = n > 24 ? 2 : 4
  const area = Math.min(W * 0.46, n * 38)
  const sw = Math.max(3, (area - gap * (n - 1)) / n)
  const y = 10
  const h = 10
  const p: string[] = []
  p.push(`<defs><linearGradient id="qsh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`)
  p.push(`<filter id="qg" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="2.2"/></filter>`)
  p.push(`<clipPath id="qall">`)
  s.items.forEach((_, i) => p.push(`<rect x="${(4 + i * (sw + gap)).toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${Math.min(5, sw / 2)}"/>`))
  p.push(`</clipPath></defs>`)
  s.items.forEach((q, i) => {
    const x = 4 + i * (sw + gap)
    const rx = Math.min(5, sw / 2)
    if (q.status === 'completed') {
      p.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${rx}" fill="${KZ.green}"/>`)
      if (sw >= 16) p.push(`<path d="M${(x + sw / 2 - 3).toFixed(1)} ${y + 5}l2 2 4-4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (q.status === 'in_progress') {
      p.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${rx}" fill="${KZ.violet}" filter="url(#qg)" class="qa"/>`)
      p.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${rx}" fill="${KZ.violet}" class="qa"/>`)
      p.push(`<clipPath id="qc${i}"><rect x="${x.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${rx}"/></clipPath>`)
      p.push(`<g clip-path="url(#qc${i})"><rect class="qs" style="--w:${(sw + 30).toFixed(0)}px" x="${x.toFixed(1)}" y="${y}" width="24" height="${h}" fill="url(#qsh)"/></g>`)
    } else {
      p.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="${rx}" class="k"/>`)
    }
  })
  const barEnd = 4 + n * (sw + gap) - gap
  if (allDone) p.push(`<g clip-path="url(#qall)"><rect class="qw" style="--w:${(barEnd + 60).toFixed(0)}px" x="0" y="${y}" width="50" height="${h}" fill="url(#qsh)"/></g>`)

  let tx = barEnd + 12
  const base = y + h - 1
  const put = (s: string, o: Parameters<typeof svgText>[3] & { size: number }) => {
    p.push(svgText(tx, base, s, o))
    tx += textWidth(s, o.size) + 6
  }
  if (allDone) {
    put('✓ Quest complete', { size: 12, weight: 700, fill: KZ.green })
    put(`${total}/${total}`, { cls: 's', size: 11.5, weight: 600 })
  } else {
    put(`${done}/${total}`, { size: 12.5, weight: 750 })
    if (active) {
      p.push(`<path d="M${tx} ${base - 9}l7 4.5-7 4.5z" fill="${KZ.violet}" class="qa"/>`)
      tx += 12
      const since = active.since !== undefined ? coarseSpan(s.now - active.since) : ''
      const room = W - tx - (since ? textWidth(since, 11) + 16 : 0) - 6
      put(fitText(active.active, 12, room), { size: 12, weight: 550 })
      if (since) put(`· ${since}`, { cls: 'm', size: 11 })
    } else put('waiting for the next task', { cls: 'm', size: 11.5 })
  }
  return { source: svg(W, H, p.join(''), CSS), width: W, height: H, alt: altOf(s) }
}

export function altOf(s: QuestSnap): string {
  const { done, total, active } = progress(s.items)
  if (total > 0 && done === total) return `Questline: all ${total} tasks done`
  return `Questline: ${done} of ${total} tasks done${active ? `; now: ${active.active}` : ''}`
}
