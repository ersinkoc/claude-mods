// Warpdrive's pure core: the token-rate meter, the star physics, the terminal
// frame (rows of colored runs) and the desktop SVG. No `$` here.
import { clamp01, fmtSpan, mix, noise, svg, svgText, xml } from './lib/kz.ts'

/** Output tokens per second that count as full hyperspace. */
export const TOP_RATE = 160
/** The window the live rate is measured over. */
export const RATE_WINDOW = 3000
/** How long the band stays after a jump. */
export const SHOW_AFTER = 5000

export type Star = { a: number; d: number; z: number }
export type Run = { s: string; c: string }

/** 0 (drift) .. 1 (hyperspace) from tokens per second; a square root so small rates still move. */
export function warpSpeed(rate: number): number {
  return clamp01(Math.sqrt(Math.max(0, rate) / TOP_RATE))
}

/** WARP 1.0 .. 9.9 */
export function warpFactor(speed: number): string {
  return (1 + clamp01(speed) * 8.9).toFixed(1)
}

/** 18400 → 18.4k, 950 → 950, 2_300_000 → 2.3M */
export function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return `${Math.round(n)}`
}

export function arrivalLine(durationMs: number, tokens: number, isAborted = false): string {
  return `⇢ ${isAborted ? 'dropped out' : 'arrived'} · ${fmtSpan(durationMs)} · ${fmtTok(tokens)} tok`
}

/** Output tokens over a sliding window: tokens per second now. */
export class RateMeter {
  private samples: { at: number; tok: number }[] = []

  add(at: number, tok: number): void {
    if (tok > 0) this.samples.push({ at, tok })
  }

  rate(now: number, windowMs = RATE_WINDOW): number {
    this.samples = this.samples.filter(s => now - s.at < windowMs)
    const sum = this.samples.reduce((a, s) => a + s.tok, 0)
    return sum / (windowMs / 1000)
  }

  reset(): void {
    this.samples = []
  }
}

// ---------------------------------------------------------------------------
// Stars. `d` is the distance from the center (0..1 = the edge), `z` the depth
// (1 = near: brighter, faster, longer streaks), `a` the heading.

export function spawnStar(r: () => number, anywhere: boolean): Star {
  return { a: r() * Math.PI * 2, d: anywhere ? 0.05 + r() * 0.95 : 0.01 + r() * 0.12, z: r() }
}

export function seedStars(n: number, r: () => number): Star[] {
  return Array.from({ length: n }, () => spawnStar(r, true))
}

/** One frame of flight: stars accelerate outward (perspective) and respawn near the center. */
export function stepStars(stars: readonly Star[], speed: number, r: () => number): Star[] {
  return stars.map(s => {
    const v = (0.004 + speed * 0.06) * (0.35 + s.z) * (0.25 + s.d)
    const d = s.d + v
    return d > 1.1 ? spawnStar(r, false) : { a: s.a, d, z: s.z }
  })
}

const FAR = '#3f4a8f'
const MID = '#818cf8'
const NEAR = '#e0e7ff'
const HYPER = '#67e8f9'
const DEEP = '#1e1b4b'
const GOLD = '#fde68a'

export function depthColor(z: number, speed: number): string {
  const base = z < 0.5 ? mix(FAR, MID, z / 0.5) : mix(MID, NEAR, (z - 0.5) / 0.5)
  return mix(base, HYPER, clamp01(speed) * 0.55 * z)
}

type Cell = { ch: string; c: string; z: number }

/**
 * The star field as `rows` rows of colored runs, `cols` cells wide. `flash`
 * is the jump flash's progress 0..1 (or < 0 for none); `hud` a line written
 * on the last row; `label` a line centered on the middle row.
 */
export function warpFrame(stars: readonly Star[], cols: number, rows: number, speed: number, flash: number, hud: string, label: string): Run[][] {
  const W = Math.max(1, Math.floor(cols))
  const H = Math.max(1, Math.floor(rows))
  const grid: (Cell | undefined)[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => undefined))
  const put = (x: number, y: number, ch: string, c: string, z: number) => {
    const cx = Math.round(x)
    const cy = Math.round(y)
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return
    const row = grid[cy]
    if (!row) return
    const old = row[cx]
    if (!old || old.z <= z) row[cx] = { ch, c, z }
  }
  const cx = (W - 1) / 2
  const cy = (H - 1) / 2
  const rx = W / 2 + 1
  const ry = H / 2 + 0.6
  const sp = clamp01(speed)

  for (const s of stars) {
    const ux = Math.cos(s.a) * rx
    const uy = Math.sin(s.a) * ry
    const x = cx + ux * s.d
    const y = cy + uy * s.d
    const color = depthColor(s.z, sp)
    const len = sp * 16 * (0.3 + s.z) * (0.2 + s.d)
    // Streak glyph by the heading on the cell grid.
    const slope = Math.abs(uy) / Math.max(1e-6, Math.abs(ux))
    const streak = slope < 0.35 ? (sp > 0.65 && s.z > 0.5 ? '═' : '─') : slope > 2.5 ? '│' : ux * uy > 0 ? '╲' : '╱'
    if (len >= 1) {
      const norm = Math.hypot(ux, uy) || 1
      const dx = ux / norm
      const dy = uy / norm
      const n = Math.min(24, Math.ceil(len))
      for (let k = n; k >= 1; k--) {
        const fade = k / (n + 1)
        put(x - dx * k, y - dy * k, streak, mix(color, DEEP, fade * 0.75), s.z - 0.01 * k)
      }
    }
    const head = s.z < 0.35 ? '·' : s.z < 0.7 ? '∙' : '•'
    put(x, y, len >= 3 && s.z > 0.6 ? '•' : head, s.d < 0.08 ? mix(color, DEEP, 0.5) : color, s.z + 0.5)
  }

  // The jump flash: a ring of light racing out of the center.
  if (flash >= 0 && flash <= 1) {
    const r = flash * 1.25
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const e = Math.hypot((xx - cx) / rx, (yy - cy) / ry)
        const band = Math.abs(e - r)
        if (band < 0.045) put(xx, yy, (xx + yy) % 3 === 0 ? '✦' : flash < 0.5 ? '*' : '·', mix('#ffffff', GOLD, flash), 9)
        else if (e < r && (xx + yy * 3) % 5 === 0) put(xx, yy, '·', mix(GOLD, DEEP, flash), 2)
      }
    }
  }

  const write = (y: number, x0: number, text: string, c: string) => {
    let x = x0
    for (const ch of text) {
      if (x >= 0 && x < W) {
        const row = grid[y]
        if (row) row[x] = { ch, c, z: 99 }
      }
      x++
    }
  }
  if (label) {
    const line = ` ${label} `
    const len = [...line].length
    write(Math.round(cy), Math.max(0, Math.floor((W - len) / 2)), line, GOLD)
  }
  if (hud) write(H - 1, 1, hud, '#a5b4fc')

  return grid.map(row => {
    const runs: Run[] = []
    for (const cell of row) {
      const ch = cell?.ch ?? ' '
      const c = cell?.c ?? ''
      const last = runs[runs.length - 1]
      if (last && (last.c === c || ch === ' ')) last.s += ch
      else runs.push({ s: ch, c })
    }
    return runs
  })
}

export function hudLine(speed: number, rate: number, tokens: number, elapsedMs: number): string {
  return `▸ WARP ${warpFactor(speed)} │ ${Math.round(rate)} tok/s │ ${fmtTok(tokens)} tok │ ${fmtSpan(elapsedMs)}`
}

// ---------------------------------------------------------------------------
// Desktop: one SVG. Stars fly out of the center by CSS keyframes; each star's
// delay is taken from the clock, so a redraw resumes the flight where it was.

export type WarpView = {
  now: number
  speed: number
  rate: number
  tokens: number
  elapsedMs: number
  isWorking: boolean
  label: string
  flashSeq: number
}

const STARS = 72

export function warpSvg(v: WarpView, W: number, H: number): string {
  const q = Math.round(clamp01(v.speed) * 6) / 6
  const cx = W / 2
  const cy = H / 2
  const k = (H / W) * 1.6
  const reach = W / 2 + 40
  const base = 7.5 - q * 6.9
  const t = v.now / 1000
  const stars: string[] = []
  for (let i = 0; i < STARS; i++) {
    const ang = noise(i, 1) * 360
    const z = noise(i, 2)
    const dur = base / (0.45 + z)
    const delay = -((t + noise(i, 3) * dur) % dur)
    const len = (2 + q * 70 * (0.35 + z)).toFixed(1)
    const h = (0.9 + z * 1.5).toFixed(2)
    const c = depthColor(z, q)
    stars.push(`<g transform="rotate(${ang.toFixed(1)})"><rect class="w" x="0" y="${(-Number(h) / 2).toFixed(2)}" width="${len}" height="${h}" rx="${(Number(h) / 2).toFixed(2)}" fill="${c}" style="animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s"/></g>`)
  }
  const css = `
.g0{stop-color:#1b1a4a}.g1{stop-color:#0e1238}.edge{stroke:#c7c9f5}
@media (prefers-color-scheme: dark){.g0{stop-color:#0b0d26}.g1{stop-color:#02030a}.edge{stroke:#26284a}}
.w{transform-box:fill-box;transform-origin:0 50%;animation:fly linear infinite}
@keyframes fly{0%{transform:translateX(3px) scaleX(.04);opacity:0}12%{opacity:1}100%{transform:translateX(${reach.toFixed(0)}px) scaleX(1);opacity:1}}
.core{animation:core ${(2.6 - q * 2).toFixed(2)}s ease-in-out infinite}@keyframes core{50%{opacity:.45}}
.fl{animation:fl 1.2s ease-out forwards}@keyframes fl{0%{opacity:.9}100%{opacity:0}}
.ring{transform-box:fill-box;transform-origin:center;animation:ring 1.3s cubic-bezier(.2,.7,.3,1) forwards}@keyframes ring{0%{transform:scale(.1);opacity:1}100%{transform:scale(16);opacity:0}}
.lbl{animation:lbl 5s ease-out forwards}@keyframes lbl{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:.25}}`
  const glow = `<radialGradient id="wdCore" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${mix('#a5b4fc', HYPER, q)}" stop-opacity="${(0.35 + q * 0.45).toFixed(2)}"/><stop offset="1" stop-color="#a5b4fc" stop-opacity="0"/></radialGradient>`
  const parts = [
    `<defs><linearGradient id="wdSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient>${glow}<clipPath id="wdClip"><rect width="${W}" height="${H}" rx="10"/></clipPath><filter id="wdGlow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>`,
    `<g clip-path="url(#wdClip)">`,
    `<rect width="${W}" height="${H}" fill="url(#wdSky)"/>`,
    `<ellipse class="core" cx="${cx}" cy="${cy}" rx="${(40 + q * 120).toFixed(0)}" ry="${(H * 0.45).toFixed(0)}" fill="url(#wdCore)"/>`,
    `<g transform="translate(${cx} ${cy}) scale(1 ${k.toFixed(3)})">${stars.join('')}</g>`,
  ]
  if (v.label && v.flashSeq > 0) {
    parts.push(`<rect class="fl" width="${W}" height="${H}" fill="#fff8e1"/>`)
    parts.push(`<circle class="ring" cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${GOLD}" stroke-width="1.4"/>`)
  }
  parts.push(`</g><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" class="edge" stroke-opacity=".5"/>`)
  if (v.isWorking) {
    parts.push(svgText(12, 18, `WARP ${warpFactor(v.speed)}`, { size: 11.5, weight: 800, fill: HYPER }))
    parts.push(svgText(W - 12, 18, `${Math.round(v.rate)} tok/s · ${fmtTok(v.tokens)} tok · ${fmtSpan(v.elapsedMs)}`, { size: 11, weight: 600, anchor: 'end', fill: '#c7d2fe', mono: true }))
    const meter = Math.max(0, Math.min(1, v.speed))
    parts.push(`<rect x="12" y="${H - 9}" width="${(W - 24).toFixed(0)}" height="2" rx="1" fill="#ffffff" opacity=".12"/>`)
    parts.push(`<rect x="12" y="${H - 9}" width="${((W - 24) * meter).toFixed(0)}" height="2" rx="1" fill="${mix('#818cf8', HYPER, meter)}"/>`)
  }
  if (v.label) {
    parts.push(`<g class="lbl"><text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="-apple-system,'Segoe UI',Inter,sans-serif" font-size="14" font-weight="700" fill="${GOLD}" filter="url(#wdGlow)" opacity=".7">${xml(v.label)}</text>`)
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="-apple-system,'Segoe UI',Inter,sans-serif" font-size="14" font-weight="700" fill="#fffbeb">${xml(v.label)}</text></g>`)
  }
  return svg(W, H, parts.join(''), css)
}

export function warpAlt(v: WarpView): string {
  if (v.label) return v.label
  return `Warp ${warpFactor(v.speed)}: ${Math.round(v.rate)} output tokens per second, ${fmtTok(v.tokens)} this turn`
}
