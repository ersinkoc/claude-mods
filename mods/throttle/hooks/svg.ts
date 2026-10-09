// Throttle's desktop drawing: one SVG row. Pure: snapshot in, markup out.
// The SVG is redrawn on each published snapshot, so motion is keyframed from
// the previous reading (`*Prev`) to the new one: the needles sweep, the arcs
// fill, the odometer wheels roll, all in the compositor.
import type { ThrottleSnap } from '../types'
import { KZ, svg, svgText } from './lib/kz.ts'
import { odoDigits } from './model.ts'

const H = 80
const MIN_W = 540
const SWEEP = 240
const START = 150

const CSS = `
.tk{stroke:#e2e0da}.tick{stroke:#b9b7b0}.well{fill:#ecebe6}.wtx{fill:#1f1f1f}
@media (prefers-color-scheme: dark){.tk{stroke:#30302e}.tick{stroke:#5a5a56}.well{fill:#121212}.wtx{fill:#f2f2f2}}
.blink{animation:tb 1s steps(2,jump-none) infinite}@keyframes tb{50%{opacity:.25}}
.glow{filter:url(#glow)}
`

const rad = (deg: number) => (deg * Math.PI) / 180
const pt = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))] as const
const f1 = (n: number) => n.toFixed(1)

type DialSpec = {
  id: string
  cx: number
  value: number | null
  prev: number | null
  max: number
  text: string
  unit: string
  stops: [number, string][]
  isAlarm: boolean
  isShaking: boolean
}

function dial(d: DialSpec, cy: number, css: string[]): string {
  const r = 29
  const L = (r * rad(SWEEP))
  const v = d.value === null ? 0 : Math.max(0, Math.min(1, d.value / d.max))
  const pv = d.prev === null ? v : Math.max(0, Math.min(1, d.prev / d.max))
  const [x0, y0] = pt(d.cx, cy, r, START)
  const [x1, y1] = pt(d.cx, cy, r, START + SWEEP)
  const arc = `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 1 1 ${f1(x1)} ${f1(y1)}`
  const out: string[] = []
  out.push(`<defs><linearGradient id="g${d.id}" x1="0" y1="0" x2="1" y2="0">${d.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`)
  out.push(`<circle class="p" cx="${d.cx}" cy="${cy}" r="${r + 7}"/>`)
  out.push(`<path d="${arc}" class="tk" stroke-width="5" fill="none" stroke-linecap="round"/>`)
  for (let i = 0; i <= 12; i++) {
    const a = START + (SWEEP * i) / 12
    const [ax, ay] = pt(d.cx, cy, r - 6, a)
    const [bx, by] = pt(d.cx, cy, r - (i % 3 === 0 ? 11 : 8.5), a)
    out.push(`<line class="tick" x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}" stroke-width="${i % 3 === 0 ? 1.4 : 0.8}"/>`)
  }
  if (d.value !== null) {
    css.push(`@keyframes a${d.id}{from{stroke-dashoffset:${f1(L * (1 - pv))}}to{stroke-dashoffset:${f1(L * (1 - v))}}}`)
    out.push(`<path d="${arc}" stroke="url(#g${d.id})" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${f1(L)} ${f1(L + 10)}" stroke-dashoffset="${f1(L * (1 - v))}" class="glow" style="animation:a${d.id} .9s cubic-bezier(.2,.8,.2,1) both"/>`)
    const from = START + SWEEP * pv
    const to = START + SWEEP * v
    css.push(`@keyframes n${d.id}{from{transform:rotate(${f1(from)}deg)}to{transform:rotate(${f1(to)}deg)}}`)
    css.push(`@keyframes s${d.id}{from{transform:rotate(-1.4deg)}to{transform:rotate(1.4deg)}}`)
    const origin = `transform-box:view-box;transform-origin:${d.cx}px ${cy}px`
    out.push(`<g style="${origin};animation:n${d.id} .9s cubic-bezier(.25,1.4,.4,1) both"><g style="${origin}${d.isShaking ? `;animation:s${d.id} .11s ease-in-out infinite alternate` : ''}">`)
    out.push(`<line x1="${d.cx - 6}" y1="${cy}" x2="${d.cx + r - 4}" y2="${cy}" stroke="${KZ.red}" stroke-width="2.2" stroke-linecap="round"/>`)
    out.push(`</g></g>`)
  }
  out.push(`<circle cx="${d.cx}" cy="${cy}" r="3.6" fill="${KZ.red}"/><circle cx="${d.cx}" cy="${cy}" r="1.5" class="p"/>`)
  out.push(svgText(d.cx, cy + 17, d.text, { size: 13, weight: 750, anchor: 'middle', fill: d.isAlarm ? KZ.red : undefined }))
  out.push(svgText(d.cx, cy + 28, d.unit, { cls: 'm', size: 8.5, weight: 600, anchor: 'middle' }))
  return out.join('')
}

/** The odometer: seven wheels; the ones that changed roll up from the old digit. */
function odometer(x: number, y: number, usd: number, prevUsd: number | null, css: string[]): string {
  const now = odoDigits(usd)
  const was = odoDigits(prevUsd ?? usd)
  const out: string[] = []
  const wh = 22
  const ww = 13
  out.push(`<rect class="p" x="${x - 6}" y="${y - 8}" width="${7 * (ww + 2) + 20}" height="${wh + 30}" rx="9"/>`)
  out.push(`<defs><clipPath id="odo"><rect x="${x}" y="${y}" width="${7 * (ww + 2) + 8}" height="${wh}" rx="4"/></clipPath></defs>`)
  let cx = x
  let wheel = 0
  for (let i = 0; i < now.length; i++) {
    const ch = now[i] ?? '0'
    if (ch === '.') {
      out.push(svgText(cx + 2, y + wh - 5, '.', { cls: 's', size: 14, weight: 700, anchor: 'middle' }))
      cx += 6
      continue
    }
    const isCents = i > 4
    out.push(`<rect x="${cx}" y="${y}" width="${ww}" height="${wh}" rx="3" ${isCents ? `fill="${KZ.red}" opacity=".9"` : 'class="well"'}/>`)
    const old = was[i] ?? ch
    const cls = isCents ? '' : 'wtx'
    const fill = isCents ? '#fff' : undefined
    const digit = (dy: number, s: string) =>
      `<text ${fill ? `fill="${fill}"` : `class="${cls}"`} x="${cx + ww / 2}" y="${y + wh - 6 + dy}" font-family="ui-monospace,Consolas,monospace" font-size="14" font-weight="700" text-anchor="middle">${s}</text>`
    if (old !== ch) {
      css.push(`@keyframes w${wheel}{from{transform:translateY(${wh}px)}to{transform:translateY(0)}}`)
      out.push(`<g clip-path="url(#odo)"><g style="animation:w${wheel} .7s cubic-bezier(.3,1.3,.5,1) both">${digit(-wh, old)}${digit(0, ch)}</g></g>`)
    } else out.push(`<g clip-path="url(#odo)">${digit(0, ch)}</g>`)
    cx += ww + 2
    wheel++
  }
  out.push(svgText(x, y - 1 + wh + 16, 'ODOMETER · SESSION $', { cls: 'm', size: 8, weight: 650 }))
  return out.join('')
}

function lamp(kind: 'engine' | 'fuel' | 'heat', x: number, y: number, isOn: boolean, color: string, isBlinking: boolean): string {
  const paint = isOn ? `fill="${color}"` : 'class="m" opacity=".35"'
  const stroke = isOn ? `stroke="${color}"` : 'class="m" stroke="#8e8e8a" opacity=".35"'
  let icon = ''
  if (kind === 'engine') {
    icon = `<path ${paint} d="M${x - 9} ${y - 3}h3v-3h4v-2h6v2h3l2 3h2v-2h2v9h-2v-2h-2l-2 4h-11l-2-3h-3z"/>`
  } else if (kind === 'fuel') {
    icon = `<rect ${paint} x="${x - 7}" y="${y - 8}" width="9" height="15" rx="1.5"/><rect x="${x - 5}" y="${y - 6}" width="5" height="4" rx=".6" fill="${isOn ? '#111' : 'none'}" opacity=".55"/>` +
      `<path ${stroke} fill="none" stroke-width="1.6" stroke-linecap="round" d="M${x + 2} ${y - 3}h3v7a1.5 1.5 0 0 0 3 0v-8l-3-3"/>`
  } else {
    icon = `<path ${stroke} fill="none" stroke-width="2.2" stroke-linecap="round" d="M${x} ${y - 9}v10"/><circle ${paint} cx="${x}" cy="${y + 3}" r="3.6"/>` +
      `<path ${stroke} fill="none" stroke-width="1.3" stroke-linecap="round" d="M${x - 9} ${y + 8}q2-2 4 0t4 0M${x + 1} ${y + 8}q2-2 4 0t4 0"/>`
  }
  const label = kind === 'engine' ? 'ENG' : kind === 'fuel' ? 'FUEL' : 'HOT'
  return `<g class="${isOn ? `glow${isBlinking ? ' blink' : ''}` : ''}">${icon}</g>` + svgText(x, y + 22, label, { size: 8, weight: 700, anchor: 'middle', ...(isOn ? { fill: color } : { cls: 'm' }) })
}

function road(x: number, w: number, s: ThrottleSnap, css: string[]): string {
  const y = 16
  const h = 54
  const out: string[] = []
  out.push(`<rect class="p" x="${x}" y="${y - 8}" width="${w}" height="${h + 12}" rx="12"/>`)
  out.push(`<defs><clipPath id="rd"><rect x="${x}" y="${y - 8}" width="${w}" height="${h + 12}" rx="12"/></clipPath></defs>`)
  const ly = y + h - 18
  const moving = s.isWorking && s.speed > 0.5
  const pps = 30 + Math.min(600, s.speed * 2.2)
  const dur = (40 / pps).toFixed(2)
  css.push(`@keyframes rd{to{stroke-dashoffset:-40}}@keyframes rk{to{transform:translateX(-120px)}}@keyframes bob{50%{transform:translateY(-1.2px)}}@keyframes wh{to{transform:rotate(360deg)}}`)
  out.push(`<g clip-path="url(#rd)">`)
  // Distant hills drift slower than the road: parallax.
  const hills: string[] = []
  for (let hx = x - 120; hx < x + w + 240; hx += 120) hills.push(`M${hx} ${ly - 6}q30-22 60 -4t60 0`)
  out.push(`<path d="${hills.join('')}" class="tk" stroke-width="1.4" fill="none" style="${moving ? `animation:rk ${(120 / (pps * 0.18)).toFixed(1)}s linear infinite` : ''}"/>`)
  out.push(`<line x1="${x}" y1="${ly + 11}" x2="${x + w}" y2="${ly + 11}" class="tk" stroke-width="5"/>`)
  out.push(`<line x1="${x}" y1="${ly + 11}" x2="${x + w}" y2="${ly + 11}" stroke="${KZ.mist}" stroke-width="2" stroke-dasharray="22 18" style="${moving ? `animation:rd ${dur}s linear infinite` : ''}"/>`)
  out.push(`</g>`)
  // The car: a little coupe that bobs while it drives.
  const carX = x + Math.min(w - 60, Math.max(18, 18 + (w - 90) * Math.min(1, s.speed / Math.max(1, s.speedMax))))
  const body = s.lamps.engine ? KZ.amber : KZ.violet
  out.push(`<g style="${moving ? 'animation:bob .35s ease-in-out infinite' : ''}">`)
  out.push(`<path fill="${body}" d="M${carX} ${ly + 6}v-6q0-3 3-3h6l6-6h14l7 6h7q3 0 3 3v6z"/>`)
  out.push(`<path fill="#bfe9ff" opacity=".85" d="M${carX + 11} ${ly - 4}l4-4h5v4zM${carX + 22} ${ly - 4}v-4h5l4 4z"/>`)
  for (const wx of [carX + 9, carX + 32]) {
    out.push(`<g style="transform-box:fill-box;transform-origin:center;${moving ? 'animation:wh .5s linear infinite' : ''}"><circle cx="${wx}" cy="${ly + 6}" r="4.2" fill="#2b2b2b"/><line x1="${wx - 3}" y1="${ly + 6}" x2="${wx + 3}" y2="${ly + 6}" stroke="#aaa" stroke-width="1"/></g>`)
  }
  if (moving) out.push(`<path d="M${carX - 4} ${ly + 3}h-10M${carX - 3} ${ly}h-6" stroke="${KZ.mist}" stroke-width="1.2" stroke-linecap="round" class="pulse"/>`)
  out.push(`</g>`)
  const status = s.isWorking
    ? s.agents > 0 ? `◈ ${s.agents} agent${s.agents === 1 ? '' : 's'} on the road` : 'engine running'
    : `coasting · ${Math.round(s.idleMs / 1000)}s`
  out.push(svgText(x + 12, y + 6, status, { size: 10.5, weight: 650, ...(s.isWorking ? { fill: KZ.green } : { cls: 's' }) }))
  return out.join('')
}

export function dashSvg(s: ThrottleSnap, width: number): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(MIN_W, width)
  const css: string[] = [CSS]
  const parts: string[] = []
  parts.push(`<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`)
  const cy = 38
  const dials: DialSpec[] = [
    { id: 'sp', cx: 40, value: s.speed, prev: s.speedPrev, max: s.speedMax, text: String(Math.round(s.speed)), unit: `TOK/S · ${s.speedMax}`, stops: [[0, KZ.cyan], [0.5, KZ.violet], [1, KZ.magenta]], isAlarm: false, isShaking: s.isWorking && s.speed > 0.5 },
  ]
  if (s.fuel !== null) dials.push({ id: 'fu', cx: 0, value: s.fuel, prev: s.fuelPrev, max: 100, text: `${Math.round(s.fuel)}%`, unit: '5H FUEL', stops: [[0, KZ.red], [0.3, KZ.amber], [0.6, KZ.yellow], [1, KZ.green]], isAlarm: s.lamps.fuel, isShaking: false })
  if (s.temp !== null) dials.push({ id: 'te', cx: 0, value: s.temp, prev: s.tempPrev, max: 100, text: `${Math.round(s.temp)}%`, unit: 'CTX TEMP', stops: [[0, KZ.blue], [0.5, KZ.green], [0.8, KZ.amber], [1, KZ.red]], isAlarm: s.lamps.heat, isShaking: false })
  dials.forEach((d, i) => {
    d.cx = 40 + i * 84
    parts.push(dial(d, cy, css))
  })
  let x = 40 + dials.length * 84 - 30
  if (s.odo !== null) {
    parts.push(odometer(x + 6, 22, s.odo, s.odoPrev, css))
    x += 7 * 15 + 30
  }
  const lx = x + 14
  parts.push(lamp('engine', lx, 34, s.lamps.engine, KZ.amber, false))
  parts.push(lamp('fuel', lx + 34, 34, s.lamps.fuel, KZ.amber, true))
  parts.push(lamp('heat', lx + 64, 34, s.lamps.heat, KZ.red, true))
  x = lx + 84
  if (W - x > 110) parts.push(road(x, W - x - 2, s, css))
  const scale = Math.min(1, width / W)
  return { source: svg(W, H, parts.join(''), css.join('')), width: Math.round(W * scale), height: Math.round(H * scale), alt: altOf(s) }
}

export function altOf(s: ThrottleSnap): string {
  const bits = [`${Math.round(s.speed)} output tokens per second`]
  if (s.fuel !== null) bits.push(`${Math.round(s.fuel)}% of the 5-hour limit left`)
  if (s.temp !== null) bits.push(`context ${Math.round(s.temp)}%`)
  if (s.odo !== null) bits.push(`session $${s.odo.toFixed(2)}`)
  const lit = [s.lamps.engine && 'check engine (a tool failed)', s.lamps.fuel && 'low fuel', s.lamps.heat && 'overheating'].filter(Boolean)
  if (lit.length) bits.push(`warnings: ${lit.join(', ')}`)
  return `Throttle: ${bits.join('; ')}`
}
