// Heartline's pure drawing: the waveform, its braille frame for the terminal
// and its glowing SVG for the desktop. No `$` here.
import { KZ, clamp01, heat, mix, noise, svg, svgText } from './lib/kz.ts'

export type Beat = { at: number; k: 't' | 's' | 'f'; c: string }
export type Seg = { s: string; c: string; b?: boolean }

/** One braille dot column of the terminal trace covers this many ms. */
export const DOT_MS = 200
/** What the old part of the trace fades toward. */
export const FADE = '#5b6470'

/** The shape each beat stamps on the trace: [dot offset, amplitude -1..1]. */
const SHAPES: Record<Beat['k'], readonly (readonly [number, number])[]> = {
  // A QRS complex and its T wave: dip, spike, undershoot, slow bump.
  t: [[-1, -0.16], [0, 1], [1, -0.46], [2, 0.05], [4, 0.12], [5, 0.19], [6, 0.11]],
  // A P wave: a soft blip for each model request.
  s: [[-1, 0.1], [0, 0.3], [1, 0.12]],
  // A failure: the spike inverted, deeper, with a rebound.
  f: [[-1, 0.12], [0, -1], [1, 0.38], [2, -0.06]],
}

/** The trace's own color: green at an empty context, red at a full one. */
export function traceColor(ctx: number | null): string {
  return heat(clamp01((ctx ?? 0) / 100) * 1.05)
}

/** Samples the last `n` dot columns ending at `now`: amplitude and color per column. */
export function sampleTrace(beats: readonly Beat[], now: number, n: number): { amp: number[]; col: (string | undefined)[] } {
  const amp: number[] = Array.from({ length: n }, () => 0)
  const col: (string | undefined)[] = Array.from({ length: n }, () => undefined)
  for (const b of beats) {
    const at = n - 1 - Math.round((now - b.at) / DOT_MS)
    if (at < -8 || at > n + 2) continue
    for (const [o, a] of SHAPES[b.k]) {
      const i = at + o
      if (i < 0 || i >= n) continue
      if (Math.abs(a) > Math.abs(amp[i] as number)) {
        amp[i] = a
        col[i] = b.k === 'f' ? KZ.red : b.c
      }
    }
  }
  return { amp, col }
}

const LEFT = [0x01, 0x02, 0x04, 0x40]
const RIGHT = [0x08, 0x10, 0x20, 0x80]

/**
 * The trace as `rows` lines of braille, `cols` cells wide, newest on the
 * right. `breath` (0..1) dims the idle line; the oldest part fades out.
 */
export function traceFrame(beats: readonly Beat[], now: number, cols: number, rows: number, ctx: number | null, breath = 0): Seg[][] {
  const w = Math.max(1, Math.floor(cols))
  const h = Math.max(1, Math.floor(rows))
  const n = w * 2
  const { amp, col } = sampleTrace(beats, now, n)
  const dots = h * 4
  // The baseline sits inside a cell (never on a cell edge, where it would
  // split across two rows); spikes get the room above it, dips the room below.
  const base0 = h === 1 ? 2 : h === 2 ? 5 : 7
  const up = base0
  const down = dots - 1 - base0
  // A live line: now and then a one-dot tremor, seeded by absolute time so it scrolls.
  const head = Math.floor(now / DOT_MS)
  const ys = amp.map((a, i) => {
    const v = Math.max(-1, Math.min(1, a))
    if (v === 0) return noise(head - (n - 1 - i), 7) > 0.92 ? base0 - 1 : base0
    return Math.round(v > 0 ? base0 - v * up : base0 - v * down)
  })
  const bits: number[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => 0))
  for (let i = 0; i < n; i++) {
    const y = ys[i] as number
    const prev = i > 0 ? (ys[i - 1] as number) : y
    const lo = Math.min(y, prev)
    const hi = Math.max(y, prev)
    const cell = Math.floor(i / 2)
    const table = i % 2 === 0 ? LEFT : RIGHT
    for (let d = Math.max(0, lo); d <= Math.min(dots - 1, hi); d++) {
      const r = bits[Math.floor(d / 4)] as number[]
      r[cell] = (r[cell] as number) | (table[d % 4] as number)
    }
  }
  const base = mix(traceColor(ctx), FADE, breath)
  const colors: string[] = []
  for (let x = 0; x < w; x++) {
    const a = Math.abs(amp[x * 2] as number) >= Math.abs(amp[x * 2 + 1] as number) ? x * 2 : x * 2 + 1
    // A column has a color exactly where it has a beat: the stronger dot's, else the line's.
    const c = col[a] ?? base
    // Phosphor decay: the left third fades toward the grid.
    const age = 1 - x / Math.max(1, w - 1)
    colors.push(mix(c, FADE, Math.max(0, age - 0.35) * 0.9))
  }
  return bits.map(r => {
    const segs: Seg[] = []
    for (let x = 0; x < w; x++) {
      const ch = String.fromCharCode(0x2800 + (r[x] as number))
      const c = colors[x] as string
      const isPen = x === w - 1
      const last = segs[segs.length - 1]
      if (last && last.c === c && !isPen && !last.b) last.s += ch
      else segs.push({ s: ch, c, b: isPen || undefined })
    }
    return segs
  })
}

/** Beats per minute as the heart's period in ms; a slow 1.5 s when quiet. */
export function beatPeriod(bpm: number): number {
  return bpm > 0 ? Math.max(300, Math.min(1500, 60_000 / Math.max(bpm, 40))) : 1500
}

export type EkgInput = { beats: readonly Beat[]; now: number; bpm: number; rpm: number; ctx: number | null; isWorking: boolean }

/** The desktop drawing: a monitor screen with a glowing trace that scrolls left, and a readout. */
export function ekgSvg(s: EkgInput, W: number, H: number): string {
  const RW = 118 // readout
  const x0 = 0
  const x1 = W - RW - 10 // the pen
  const span = 60_000
  const pxMs = (x1 - x0) / span
  const mid = H / 2
  const A = H * 0.4
  const scrollMs = 15_000
  const dist = pxMs * scrollMs
  const base = traceColor(s.ctx)
  const idle = !s.beats.some(b => s.now - b.at < 8000)

  // The trace as one amplitude field sampled every pixel: each beat's shape
  // (offsets in steps of `u` px) is laid on it, the strongest wins where two meet.
  const u = 3.2
  const from = Math.floor(x0 - 20)
  const to = Math.ceil(x1 + dist + 40)
  const amp = new Map<number, { a: number; c: string }>()
  const stamp = (bx: number, b: Beat) => {
    const shape = SHAPES[b.k]
    const c = b.k === 'f' ? KZ.red : b.c
    for (let k = 0; k + 1 < shape.length; k++) {
      const p = shape[k] as readonly [number, number]
      const q = shape[k + 1] as readonly [number, number]
      const xa = bx + p[0] * u
      // Offsets rise strictly within a shape, so xb > xa.
      const xb = bx + q[0] * u
      for (let x = Math.ceil(xa); x <= Math.floor(xb); x++) {
        const f = (x - xa) / (xb - xa)
        const v = p[1] + (q[1] - p[1]) * f
        const cur = amp.get(x)
        if (!cur || Math.abs(v) > Math.abs(cur.a)) amp.set(x, { a: v, c })
      }
    }
  }
  for (const b of s.beats) {
    if (s.now - b.at > span + 4000) continue
    stamp(x1 - (s.now - b.at) * pxMs, b)
  }
  const pts: string[] = []
  const overlays: string[] = []
  let run: { c: string; pts: string[] } | undefined
  const flush = () => {
    if (run && run.pts.length > 1) overlays.push(`<polyline points="${run.pts.join(' ')}" stroke="${run.c}" class="hlbeat"/>`)
    run = undefined
  }
  let lastFlat = false
  for (let x = from; x <= to; x++) {
    const hit = amp.get(x)
    const y = mid - (hit?.a ?? 0) * A
    const pt = `${x},${y.toFixed(1)}`
    // Flat stretches need only their ends.
    const isFlat = !hit && !amp.get(x + 1)
    if (!(isFlat && lastFlat) || x === to) pts.push(pt)
    lastFlat = isFlat
    if (hit) {
      if (!run || run.c !== hit.c) {
        flush()
        run = { c: hit.c, pts: [`${x - 1},${mid}`] }
      }
      run.pts.push(pt)
    } else if (run) {
      run.pts.push(pt)
      flush()
    }
  }
  flush()
  const line = pts.join(' ')

  const period = beatPeriod(s.bpm) / 1000
  // Redraws keep the beat's phase: start each loop where the clock says it is.
  const beatDelay = `animation-delay:-${((s.now % (period * 1000)) / 1000).toFixed(2)}s`
  const ctxTxt = s.ctx === null ? '—' : `${Math.round(s.ctx)}%`
  const css = `
.hlscr{fill:#0a0f14}@media (prefers-color-scheme: dark){.hlscr{fill:#05080b}}
.hlgrid{stroke:${base};stroke-opacity:.09;stroke-width:1}
.hlgrid2{stroke:${base};stroke-opacity:.2;stroke-width:1}
.hlmove{animation:hlmove ${scrollMs / 1000}s linear forwards}
@keyframes hlmove{to{transform:translateX(-${dist.toFixed(1)}px)}}
.hltrace{fill:none;stroke:${base};stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.hlbeat{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.hlbreath{animation:hlbr 4.2s ease-in-out infinite}@keyframes hlbr{50%{opacity:.38}}
.hlpen{animation:hlpen ${Math.max(0.6, period).toFixed(2)}s ease-out infinite}@keyframes hlpen{0%{r:5;opacity:1}60%{r:2.6;opacity:.75}100%{r:2.6;opacity:.75}}
.hlheart{transform-box:fill-box;transform-origin:center;animation:hlbeat ${period.toFixed(2)}s ease-out infinite}
@keyframes hlbeat{0%{transform:scale(1.32)}18%{transform:scale(.92)}30%{transform:scale(1.12)}55%,100%{transform:scale(1)}}
`
  const grid: string[] = []
  for (let gx = x0; gx < x1 + dist + 40; gx += 12) grid.push(`<path class="${Math.round((gx - x0) / 12) % 5 === 0 ? 'hlgrid2' : 'hlgrid'}" d="M${gx} 0V${H}"/>`)
  for (let gy = mid % 12; gy < H; gy += 12) grid.push(`<path class="hlgrid" d="M${x0} ${gy.toFixed(1)}H${x1 + dist + 40}"/>`)

  const body = [
    `<defs>`,
    `<filter id="hlGlow" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<linearGradient id="hlFadeG" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".55"/><stop offset=".8" stop-color="#fff" stop-opacity="1"/></linearGradient>`,
    `<mask id="hlFade"><rect x="${x0}" y="0" width="${x1 - x0 + 6}" height="${H}" fill="url(#hlFadeG)"/></mask>`,
    `<linearGradient id="hlBloom" x1="0" x2="1"><stop offset="0" stop-color="${base}" stop-opacity="0"/><stop offset="1" stop-color="${base}" stop-opacity=".16"/></linearGradient>`,
    `<clipPath id="hlClip"><rect x="${x0}" y="0" width="${x1 - x0 + 6}" height="${H}" rx="10"/></clipPath>`,
    `</defs>`,
    `<rect class="hlscr" x="${x0}" y="0" width="${x1 - x0 + 6}" height="${H}" rx="10"/>`,
    `<g clip-path="url(#hlClip)">`,
    `<rect x="${x1 - 90}" y="0" width="96" height="${H}" fill="url(#hlBloom)"/>`,
    `<g mask="url(#hlFade)"><g class="hlmove">`,
    grid.join(''),
    `<g filter="url(#hlGlow)"><polyline points="${line}" class="hltrace${idle ? ' hlbreath' : ''}"/>${overlays.join('')}</g>`,
    `</g></g>`,
    `<circle cx="${x1}" cy="${mid}" r="3" fill="${base}" filter="url(#hlGlow)" class="hlpen" style="${beatDelay}"/>`,
    `</g>`,
    // Readout, on the theme's own panel.
    `<rect class="p" x="${W - RW}" y="0" width="${RW}" height="${H}" rx="10"/>`,
    `<text x="${W - RW + 14}" y="${mid - 4}" font-size="17" fill="${s.bpm > 0 ? KZ.red : KZ.mist}" class="hlheart" style="${beatDelay}" font-family="sans-serif">♥</text>`,
    svgText(W - RW + 34, mid - 5, `${s.bpm}`, { size: 17, weight: 700 }),
    svgText(W - RW + 36 + `${s.bpm}`.length * 10, mid - 5, 'bpm', { cls: 's', size: 11 }),
    svgText(W - RW + 14, mid + 15, `ctx ${ctxTxt}`, { size: 11.5, weight: 650, fill: base }),
    svgText(W - 10, mid + 15, `${s.rpm} req/m`, { cls: 'm', size: 10, anchor: 'end' }),
  ].join('')
  return svg(W, H, body, css)
}

/** What a screen reader hears for the band. */
export function ekgAlt(s: EkgInput): string {
  return (`Session heartline: ${s.bpm} tool calls and ${s.rpm} model requests in the last minute; context ${s.ctx === null ? 'unknown' : Math.round(s.ctx) + '%'}${s.isWorking ? '; working' : ''}.`)
}
