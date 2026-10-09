// Aurora's pure drawing: curtains of light as a cell frame for the terminal
// and as one blurred, animated SVG for the desktop. No `$` here.
import { hue, mix, noise, pips, svg } from './lib/kz.ts'

export type Seg = { s: string; c?: string; b?: boolean; d?: boolean }
export type Mode = 'idle' | 'requesting' | 'thinking' | 'responding' | 'tool-input' | 'tool-use'

export const FADE = '#4b5563'

/** Effort as intensity: low is gentle, max is wild; a numeric budget on a log scale. */
export function levelOf(effort: string | number | null | undefined): number {
  if (typeof effort === 'number') return Math.max(0.2, Math.min(1, Math.log10(Math.max(1, effort)) / 5))
  switch (effort) {
    case 'low': return 0.25
    case 'medium': return 0.45
    case 'high': return 0.65
    case 'xhigh': return 0.85
    case 'max': return 1
    default: return 0.5
  }
}

/** Whether the band has something to show in this mode. */
export function isLit(mode: Mode): boolean {
  return mode === 'thinking' || mode === 'responding'
}

/**
 * The curtain at column `x`: it hangs from `top` down to its bright lower edge
 * `edge` (both 0..1 of the band's height, from the bottom), with a shimmer
 * `ray` (0..1) and a hue at its edge.
 */
export function curtain(x: number, t: number, level: number, mode: Mode): { edge: number; top: number; ray: number; hu: number } {
  if (mode !== 'thinking') {
    // Responding: one slow, calm ribbon in cyan.
    const edge = 0.3 + 0.14 * Math.sin(x * 0.09 + t * 0.7) + 0.04 * Math.sin(x * 0.23 - t * 0.4)
    return { edge, top: edge + 0.32, ray: 0.5, hu: 0.52 + 0.02 * Math.sin(x * 0.05 + t * 0.2) }
  }
  const sp = 0.45 + level * 1.9
  const a = 0.1 + level * 0.18
  const wave = 0.55 * Math.sin(x * 0.11 + t * 0.9 * sp)
    + 0.3 * Math.sin(x * 0.27 - t * 1.7 * sp + 1.3)
    + 0.15 * Math.sin(x * 0.53 + t * 3.1 * sp + 4.1)
  const edge = 0.24 - level * 0.12 + a * wave
  const ray = 0.5 + 0.5 * Math.sin(x * 1.31 + t * 4 * sp + noise(x, 3) * 6)
  const top = edge + 0.4 + level * 0.45 + 0.18 * Math.sin(x * 0.19 + t * 0.6 * sp) + 0.12 * level * (ray - 0.5)
  const hu = 0.35 + 0.07 * Math.sin(x * 0.035 + t * 0.3) + level * 0.06 * Math.sin(x * 0.12 - t * 0.8)
  return { edge: Math.max(0.02, edge), top: Math.min(1.1, top), ray, hu }
}

const LOWER = ' ▁▂▃▄▅▆▇█'

/** The cell's glyph for the part of [lo, hi] (eighths of this cell, 0..8) the curtain covers. */
function glyphFor(lo: number, hi: number, depth: number, ray: number, isWild: boolean): string {
  if (hi - lo >= 8) {
    // Wholly inside: solid near the edge, thinning upward into rays.
    if (depth < 0.3) return '█'
    if (depth < 0.55) return isWild && ray < 0.25 ? '▒' : '▓'
    if (depth < 0.8) return ray < 0.35 ? '░' : '▒'
    return ray < 0.5 ? ' ' : '░'
  }
  if (lo <= 0) return LOWER.charAt(Math.max(1, Math.round(hi))) // the top of the curtain, from the cell's bottom
  if (hi >= 8) return lo >= 5 ? '▔' : lo >= 2 ? '▀' : '█' // the lower edge, from the cell's top
  return '━'
}

/** The lights: `rows` lines of `cols` cells at `t` seconds. */
export function auroraFrame(t: number, cols: number, rows: number, level: number, mode: Mode): Seg[][] {
  const W = Math.max(1, Math.floor(cols))
  const H = Math.max(1, Math.floor(rows))
  const total = H * 8
  const lines: Seg[][] = []
  const at = Array.from({ length: W }, (_, x) => curtain(x, t, level, mode))
  for (let y = 0; y < H; y++) {
    const fromBottom = H - 1 - y
    const segs: Seg[] = []
    for (let x = 0; x < W; x++) {
      const { edge, top, ray, hu } = at[x]!
      const e = edge * total - fromBottom * 8
      const tp = top * total - fromBottom * 8
      const lo = Math.max(0, Math.round(e))
      const hi = Math.min(8, Math.round(tp))
      let ch = ' '
      let c: string | undefined
      if (hi > lo) {
        const mid = ((lo + hi) / 2 + fromBottom * 8) / total
        const depth = Math.max(0, Math.min(1, (mid - edge) / Math.max(0.05, top - edge)))
        ch = glyphFor(lo, hi, depth, ray, mode === 'thinking' && level > 0.6)
        // Green at the edge, violet and rose above it, as the real thing.
        const hh = mode === 'thinking' ? hu + depth * (0.28 + level * 0.24) : hu + depth * 0.05
        const lum = 0.55 + 0.12 * (1 - depth) + 0.08 * ray * (mode === 'thinking' ? level : 0.2)
        c = mix(hue(hh, 0.85, lum), FADE, depth * 0.45)
      } else if (e > 8 && noise(x, y + 17) > 0.965 && Math.sin(t * 2.2 + x * 1.7) > -0.2) {
        // Sky under the curtain: a few stars.
        ch = noise(x, y + 3) > 0.5 ? '·' : '✦'
        c = mix('#cbd5e1', FADE, 0.35)
      } else if (hi <= 0 && noise(x, y + 29) > 0.975 && Math.sin(t * 1.7 + x) > 0) {
        ch = '·'
        c = mix('#cbd5e1', FADE, 0.45)
      }
      if (ch === ' ') c = undefined
      const last = segs[segs.length - 1]
      if (last && last.c === c) last.s += ch
      else segs.push({ s: ch, c })
    }
    lines.push(segs)
  }
  return lines
}

/** The label beside the lights: `thinking · xhigh · 12s` over two or three lines. */
export function labelLines(mode: Mode, effort: string | null, secs: number, level: number, rows: number, t: number): Seg[][] {
  const color = mode === 'thinking' ? hue(0.36 + 0.1 * Math.sin(t * 0.8), 0.8, 0.58) : hue(0.5, 0.75, 0.55)
  const star = '✧✦✶✦'.charAt(Math.floor(t * (2 + level * 4)) % 4)
  const word = mode === 'thinking' ? 'thinking' : 'responding'
  const time = `${Math.max(0, Math.floor(secs))}s`
  const bar: Seg = { s: pips(level, 5), c: color }
  if (rows <= 2) {
    return [
      [{ s: `${star} `, c: color, b: true }, { s: word, c: color, b: true }, { s: ` · ${time}`, d: true }],
      [{ s: `  ${effort ?? 'effort —'} `, d: true }, bar],
    ]
  }
  return [
    [{ s: `${star} `, c: color, b: true }, { s: word, c: color, b: true }],
    [{ s: `  ${effort ?? '—'} · ${time}`, d: true }],
    [{ s: '  ', d: true }, bar],
  ]
}

/** The desktop drawing: a night sky with blurred curtains drifting, flaring and breathing. */
export function auroraSvg(mode: Mode, effort: string | null, level: number, secs: number, now: number, W: number, H: number): string {
  const LW = 150
  const SW = W - LW - 8
  const isThink = mode === 'thinking'
  const layers = isThink
    ? [
        { hu: 0.36, amp: 0.18, wl: 260, dur: 26, y: 0.42, op: 0.9 },
        { hu: 0.46, amp: 0.22, wl: 340, dur: 34, y: 0.5, op: 0.7 },
        { hu: 0.74, amp: 0.2, wl: 220, dur: 21, y: 0.32, op: 0.55 },
        { hu: 0.88, amp: 0.16, wl: 300, dur: 41, y: 0.26, op: 0.4 },
      ].slice(0, level >= 0.6 ? 4 : 3)
    : [{ hu: 0.53, amp: 0.12, wl: 420, dur: 40, y: 0.5, op: 0.8 }]
  const sp = isThink ? 0.45 + level * 1.9 : 0.6
  const parts: string[] = []
  const css: string[] = [
    `.ausky{fill:url(#auSky)}`,
    `@keyframes audrift{to{transform:translateX(var(--d))}}`,
    `@keyframes auflare{0%,100%{transform:scaleY(1)}50%{transform:scaleY(var(--f))}}`,
    `@keyframes aubreath{0%,100%{opacity:var(--o)}50%{opacity:calc(var(--o) * .55)}}`,
    `.auflare{transform-box:fill-box;transform-origin:50% 100%}`,
    `.autw{animation:autw 2.6s ease-in-out infinite}@keyframes autw{50%{opacity:.1}}`,
    `.austar{transform-box:fill-box;transform-origin:center;animation:austar ${Math.max(0.6, 3 - level * 2).toFixed(2)}s linear infinite}@keyframes austar{to{transform:rotate(360deg)}}`,
  ]
  parts.push(`<defs>`,
    `<linearGradient id="auSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617"/><stop offset="1" stop-color="#0b1a2a"/></linearGradient>`,
    `<filter id="auBlur" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="${isThink ? (4 + level * 3).toFixed(1) : 6}"/></filter>`,
    `<clipPath id="auClip"><rect x="0" y="0" width="${SW}" height="${H}" rx="12"/></clipPath>`)
  layers.forEach((l, i) => {
    const c = hue(l.hu, 0.85, 0.58)
    parts.push(`<linearGradient id="auL${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hue(l.hu + 0.3, 0.8, 0.6)}" stop-opacity="0"/><stop offset=".45" stop-color="${hue(l.hu + 0.12, 0.85, 0.6)}" stop-opacity=".22"/><stop offset=".82" stop-color="${c}" stop-opacity=".7"/><stop offset=".95" stop-color="${hue(l.hu - 0.03, 0.9, 0.66)}" stop-opacity="1"/><stop offset="1" stop-color="${hue(l.hu - 0.05, 0.9, 0.72)}" stop-opacity=".6"/></linearGradient>`)
  })
  parts.push(`</defs>`)
  parts.push(`<rect class="ausky" x="0" y="0" width="${SW}" height="${H}" rx="12"/>`)
  parts.push(`<g clip-path="url(#auClip)">`)
  for (let i = 0; i < Math.round(SW / 14); i++) {
    const sx = noise(i, 11) * SW
    const sy = noise(i, 12) * H * 0.7
    parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(0.4 + noise(i, 13) * 0.7).toFixed(2)}" fill="#e2e8f0" opacity="${(0.3 + noise(i, 14) * 0.5).toFixed(2)}"${noise(i, 15) > 0.6 ? ` class="autw" style="animation-delay:-${(noise(i, 16) * 2.6).toFixed(2)}s"` : ''}/>`)
  }
  // Each layer: a band whose lower edge is a sum of sines, one wavelength wider
  // than the sky so a drift by one wavelength loops without a seam.
  layers.forEach((l, i) => {
    const wl = l.wl
    // A band: its lower edge a sum of sines, its upper edge the same lifted by
    // a height that swells along it (curtains are taller where they fold).
    const lower: string[] = []
    const upper: string[] = []
    const yBase = H * (1 - l.y)
    const band = H * (isThink ? 0.45 + level * 0.3 : 0.4)
    for (let x = -wl; x <= SW + wl; x += 8) {
      const k = (x / wl) * Math.PI * 2
      const y = yBase - H * l.amp * (Math.sin(k) + 0.35 * Math.sin(2 * k + i) + 0.2 * Math.sin(3 * k + 2 * i))
      lower.push(`${x},${y.toFixed(1)}`)
      upper.unshift(`${x},${(y - band * (0.75 + 0.25 * Math.sin(2 * k + 1.7 * i))).toFixed(1)}`)
    }
    const top = `M${lower.join(' L')} L${upper.join(' L')} Z`
    const drift = Math.max(4, l.dur / sp)
    const flare = Math.max(1.6, 5.2 - level * 3) / (isThink ? 1 : 0.5)
    const breath = Math.max(1.4, 4 - level * 2.2)
    const phase = (s: number) => `-${((now / 1000) % s).toFixed(2)}s`
    const dir = i % 2 === 0 ? -wl : wl
    parts.push(
      `<g style="--d:${dir}px;animation:audrift ${drift.toFixed(2)}s linear infinite;animation-delay:${phase(drift)}">`,
      `<g class="auflare" style="--f:${(1 + (isThink ? 0.12 + level * 0.3 : 0.06)).toFixed(2)};animation:auflare ${flare.toFixed(2)}s ease-in-out infinite;animation-delay:${phase(flare)}">`,
      `<path d="${top}" transform="translate(0 ${(H * 0.15).toFixed(1)})" fill="url(#auL${i})" filter="url(#auBlur)" style="--o:${l.op};animation:aubreath ${breath.toFixed(2)}s ease-in-out infinite;animation-delay:${phase(breath + i)}"/>`,
      `</g></g>`,
    )
  })
  parts.push(`</g>`)

  // Label, on the theme's panel.
  const LX = SW + 8
  const c = isThink ? hue(0.38, 0.8, 0.5) : hue(0.53, 0.8, 0.45)
  parts.push(`<rect class="p" x="${LX}" y="0" width="${LW}" height="${H}" rx="12"/>`)
  parts.push(`<text x="${LX + 18}" y="${H / 2 - 4}" font-size="14" fill="${c}" class="austar" font-family="sans-serif">✦</text>`)
  parts.push(`<text x="${LX + 34}" y="${H / 2 - 4}" font-size="13" font-weight="700" fill="${c}" font-family="-apple-system,'Segoe UI',sans-serif">${isThink ? 'thinking' : 'responding'}</text>`)
  parts.push(`<text class="s" x="${LX + 34}" y="${H / 2 + 13}" font-size="11" font-family="-apple-system,'Segoe UI',sans-serif" font-variant-numeric="tabular-nums">${effort ?? 'effort —'} · ${Math.max(0, Math.floor(secs))}s</text>`)
  for (let i = 0; i < 5; i++) parts.push(`<rect x="${LX + 34 + i * 11}" y="${H / 2 + 20}" width="8" height="3" rx="1.5" fill="${c}" opacity="${i < Math.round(level * 5) ? 0.95 : 0.2}"/>`)
  return svg(W, H, parts.join(''), css.join('\n'))
}

export function auroraAlt(mode: Mode, effort: string | null, secs: number): string {
  return `Aurora: the model is ${mode === 'thinking' ? 'thinking' : 'responding'}${effort ? ` at ${effort} effort` : ''}, ${Math.floor(secs)} seconds.`
}
