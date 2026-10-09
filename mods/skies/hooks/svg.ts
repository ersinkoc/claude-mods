// Skies' desktop scene: one SVG, a little animated sky behind a forecast pill.
// Every motion (drifting clouds, falling rain, lightning, twinkling stars, a
// turning sun, a rainbow drawing itself) is CSS, so nothing redraws for it.
import type { SkiesSnap, Weather } from '../types'
import { fitText, rng, svg, svgText, textWidth } from './lib/kz.ts'
import { forecast, WEATHER } from './climate.ts'

const H = 64

const SKY: Record<Weather, [string, string, number]> = {
  clear: ['#7dd3fc', '#fef3c7', 0.45],
  fair: ['#93c5fd', '#e0f2fe', 0.4],
  cloudy: ['#94a3b8', '#cbd5e1', 0.4],
  rain: ['#475569', '#64748b', 0.45],
  storm: ['#0f172a', '#334155', 0.7],
  fog: ['#9ca3af', '#e5e7eb', 0.45],
  night: ['#0b1026', '#312e81', 0.75],
  rainbow: ['#bae6fd', '#fef9c3', 0.45],
}

export const TONE: Record<Weather, string> = {
  clear: '#f59e0b',
  fair: '#38bdf8',
  cloudy: '#7c8ba1',
  rain: '#60a5fa',
  storm: '#a78bfa',
  fog: '#8b929c',
  night: '#8b7cf6',
  rainbow: '#f472b6',
}

const CSS = `
.pill{fill:#ffffff;opacity:.9}@media (prefers-color-scheme: dark){.pill{fill:#1c1c1b;opacity:.85}}
.sun{transform-box:fill-box;transform-origin:center;animation:sksun 14s linear infinite}@keyframes sksun{to{transform:rotate(360deg)}}
.glow{animation:skglow 3s ease-in-out infinite}@keyframes skglow{50%{opacity:.45}}
.drift{animation:skdrift linear infinite}@keyframes skdrift{from{transform:translateX(-140px)}to{transform:translateX(var(--w))}}
.fall{animation:skfall linear infinite}@keyframes skfall{from{transform:translate(0,-14px)}to{transform:translate(-6px,${H + 10}px)}}
.bolt{opacity:0;animation:skbolt 4.6s linear infinite}@keyframes skbolt{0%,90%{opacity:0}91%{opacity:1}92%{opacity:.2}93%{opacity:1}96%,100%{opacity:0}}
.flash{opacity:0;animation:skflash 4.6s linear infinite}@keyframes skflash{0%,90%{opacity:0}91%{opacity:.55}93%{opacity:.35}97%,100%{opacity:0}}
.tw{animation:sktw 2.4s ease-in-out infinite}@keyframes sktw{50%{opacity:.15}}
.fog{animation:skfog ease-in-out infinite alternate}@keyframes skfog{from{transform:translateX(-40px)}to{transform:translateX(40px)}}
.arc{stroke-dasharray:420;stroke-dashoffset:420;animation:skarc 2.2s cubic-bezier(.3,.7,.2,1) forwards,skglow 3s ease-in-out 2.2s infinite}@keyframes skarc{to{stroke-dashoffset:0}}
.bird{animation:skbird 26s linear infinite}@keyframes skbird{from{transform:translateX(-30px)}to{transform:translateX(var(--w))}}
.flap{transform-box:fill-box;transform-origin:center;animation:skflap .5s ease-in-out infinite alternate}@keyframes skflap{to{transform:scaleY(.4)}}
`

function cloud(x: number, y: number, s: number, fill: string, opacity: number): string {
  return `<g fill="${fill}" opacity="${opacity}"><circle cx="${x}" cy="${y + 4 * s}" r="${7 * s}"/><circle cx="${x + 11 * s}" cy="${y}" r="${10 * s}"/><circle cx="${x + 23 * s}" cy="${y + 4 * s}" r="${8 * s}"/><rect x="${x - 6 * s}" y="${y + 4 * s}" width="${36 * s}" height="${8 * s}" rx="${4 * s}"/></g>`
}

function sun(cx: number, cy: number): string {
  const rays: string[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    rays.push(`<line x1="${(cx + Math.cos(a) * 17).toFixed(1)}" y1="${(cy + Math.sin(a) * 17).toFixed(1)}" x2="${(cx + Math.cos(a) * (i % 2 ? 22 : 25)).toFixed(1)}" y2="${(cy + Math.sin(a) * (i % 2 ? 22 : 25)).toFixed(1)}" stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round"/>`)
  }
  return `<circle cx="${cx}" cy="${cy}" r="22" fill="#fde68a" opacity=".55" filter="url(#skb)" class="glow"/><g class="sun">${rays.join('')}</g><circle cx="${cx}" cy="${cy}" r="12" fill="#facc15"/><circle cx="${cx - 3.5}" cy="${cy - 3.5}" r="3.5" fill="#fef9c3" opacity=".8"/>`
}

export function skySvg(s: SkiesSnap, width: number): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(280, width)
  const r = rng(W * 31 + s.weather.length)
  const p: string[] = []
  const [top, bottom, alpha] = SKY[s.weather]
  p.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`)
  p.push(`<filter id="skb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>`)
  p.push(`<filter id="skf" x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>`)
  p.push(`<clipPath id="skc"><rect x="0" y="0" width="${W}" height="${H}" rx="12"/></clipPath></defs>`)
  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`)
  p.push(`<g clip-path="url(#skc)"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)" opacity="${alpha}"/>`)

  const drift = (body: string, dur: number, delay: number) => `<g class="drift" style="--w:${W + 20}px;animation-duration:${dur.toFixed(1)}s;animation-delay:-${delay.toFixed(1)}s">${body}</g>`
  const clouds = (n: number, fill: string, opacity: number, size: number, speed: number) => {
    for (let i = 0; i < n; i++) {
      const dur = (W + 160) / (speed * (0.7 + r() * 0.6))
      p.push(drift(cloud(0, 10 + r() * 22, size * (0.8 + r() * 0.5), fill, opacity), dur, r() * dur))
    }
  }
  const rain = (n: number, color: string) => {
    for (let i = 0; i < n; i++) {
      const x = r() * (W + 40)
      const dur = 0.55 + r() * 0.35
      p.push(`<line class="fall" x1="${x.toFixed(1)}" y1="0" x2="${(x - 2.5).toFixed(1)}" y2="9" stroke="${color}" stroke-width="1.4" stroke-linecap="round" opacity=".8" style="animation-duration:${dur.toFixed(2)}s;animation-delay:-${(r() * dur).toFixed(2)}s"/>`)
    }
  }
  const sx = W - 64

  switch (s.weather) {
    case 'clear':
      p.push(sun(sx, 30))
      for (let i = 0; i < 2; i++) p.push(`<g class="bird" style="--w:${W + 30}px;animation-delay:-${(i * 11 + 4).toFixed(0)}s"><path class="flap" d="M0 ${16 + i * 9}q4-4 8 0q4-4 8 0" stroke="#64748b" stroke-width="1.5" fill="none"/></g>`)
      break
    case 'fair':
      p.push(sun(sx, 28))
      clouds(Math.max(2, Math.floor(W / 260)), '#ffffff', 0.9, 1, 9)
      break
    case 'cloudy':
      clouds(Math.max(4, Math.floor(W / 120)), '#94a3b8', 0.85, 1.1, 8)
      clouds(Math.max(3, Math.floor(W / 180)), '#e2e8f0', 0.95, 0.9, 12)
      break
    case 'rain':
      clouds(Math.max(6, Math.floor(W / 80)), '#64748b', 0.95, 1.2, 7)
      rain(Math.floor(W / 9), '#93c5fd')
      break
    case 'storm': {
      p.push(`<rect class="flash" x="0" y="0" width="${W}" height="${H}" fill="#e0e7ff"/>`)
      clouds(Math.max(8, Math.floor(W / 60)), '#334155', 0.97, 1.3, 14)
      rain(Math.floor(W / 5), '#bfdbfe')
      const bx = W * (0.45 + r() * 0.35)
      p.push(`<path class="bolt" d="M${bx} 8l-9 22h8l-6 24 18-30h-9l7-16z" fill="#fde047" stroke="#fef9c3" stroke-width="1"/>`)
      p.push(`<path class="bolt" d="M${bx} 8l-9 22h8l-6 24 18-30h-9l7-16z" fill="#fde047" filter="url(#skb)"/>`)
      break
    }
    case 'fog':
      for (let i = 0; i < 5; i++) {
        p.push(`<rect class="fog" x="${(i * W) / 5 - 60}" y="${8 + (i % 3) * 16}" width="${W / 2.2}" height="14" rx="7" fill="#e5e7eb" opacity=".85" filter="url(#skf)" style="animation-duration:${(6 + i * 1.7).toFixed(1)}s"/>`)
      }
      break
    case 'night': {
      for (let i = 0; i < Math.floor(W / 14); i++) {
        const x = r() * W
        const y = 4 + r() * (H - 10)
        p.push(`<circle class="tw" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + r() * 1.1).toFixed(2)}" fill="#fef9c3" style="animation-delay:-${(r() * 2.4).toFixed(2)}s;animation-duration:${(1.8 + r() * 2).toFixed(2)}s"/>`)
      }
      p.push(`<defs><mask id="moon"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><circle cx="${sx + 7}" cy="24" r="13" fill="#000"/></mask></defs>`)
      p.push(`<circle cx="${sx}" cy="30" r="20" fill="#fef3c7" opacity=".25" filter="url(#skb)"/><circle cx="${sx}" cy="30" r="14" fill="#fef3c7" mask="url(#moon)"/>`)
      break
    }
    case 'rainbow': {
      const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa']
      const cx = W * 0.62
      colors.forEach((c, i) => {
        const rr = 74 - i * 5
        p.push(`<path class="arc" d="M${cx - rr} ${H + 22}A${rr} ${rr} 0 0 1 ${cx + rr} ${H + 22}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9" style="animation-delay:${(i * 0.08).toFixed(2)}s,${(2.2 + i * 0.08).toFixed(2)}s"/>`)
      })
      p.push(sun(sx + 26, 22))
      clouds(2, '#ffffff', 0.9, 0.9, 6)
      break
    }
  }
  p.push(`</g>`)

  // The forecast pill.
  const w = WEATHER[s.weather]
  const line = forecast(s)
  const rest = line.slice(line.indexOf(' · ') + 3)
  const pillW = Math.min(W - 16, Math.max(textWidth(w.name, 14) + 70, textWidth(rest, 10.5) + 66))
  p.push(`<rect class="pill" x="8" y="9" width="${pillW.toFixed(1)}" height="${H - 18}" rx="10"/>`)
  p.push(`<text x="18" y="42" font-size="24">${w.icon}</text>`)
  p.push(svgText(52, 29, w.name, { size: 14, weight: 750, fill: TONE[s.weather] }))
  p.push(svgText(52, 45, fitText(rest, 10.5, pillW - 52), { cls: 's', size: 10.5 }))
  return { source: svg(W, H, p.join(''), CSS), width: W, height: H, alt: `Skies: ${line}` }
}
