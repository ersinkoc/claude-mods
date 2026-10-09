// Lofi's pure parts: moods, the hour that picks one, the equalizer frame and
// the desktop SVG. No `$` here.
import type { LofiMood } from '../types'
import { mix, svg, svgText } from './lib/kz.ts'

export type { LofiMood }

export const MOODS: readonly LofiMood[] = ['focus', 'deep', 'night', 'sunny']

/** Tempo of each loop (as synthesized by tools/make-loops.mjs). */
export const BPM: Record<LofiMood, number> = { focus: 78, deep: 68, night: 62, sunny: 86 }

/** Two colors per mood: the low and the high end of the equalizer. */
export const TINT: Record<LofiMood, [string, string]> = {
  focus: ['#7c3aed', '#22d3ee'],
  deep: ['#1e40af', '#818cf8'],
  night: ['#6d28d9', '#f472b6'],
  sunny: ['#f97316', '#fde047'],
}

export function isMood(x: unknown): x is LofiMood {
  return typeof x === 'string' && (MOODS as readonly string[]).includes(x)
}

/** auto: sunny 06–11, focus 11–18, deep 18–22, night 22–06. */
export function moodForHour(hour: number): LofiMood {
  if (hour >= 6 && hour < 11) return 'sunny'
  if (hour >= 11 && hour < 18) return 'focus'
  if (hour >= 18 && hour < 22) return 'deep'
  return 'night'
}

export function resolveMood(setting: string, hour: number): LofiMood {
  return isMood(setting) ? setting : moodForHour(hour)
}

export function assetOf(mood: LofiMood): string {
  return `sounds/${mood}.wav`
}

/** 0..100 → the engine's linear gain (0..4); 40 → about half. */
export function gainOf(volume: number): number {
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 40
  return Math.round((v / 100) * 1.25 * 100) / 100
}

const BARS = ' ▁▂▃▄▅▆▇█'

/** Equalizer heights 0..1 for `n` bands at frame `t` (30 fps): a beat bump over drifting sines. */
export function eqLevels(n: number, t: number, bpm: number): number[] {
  const beat = (t / 30) * (bpm / 60)
  const bump = Math.exp(-(beat % 1) * 5)
  return Array.from({ length: n }, (_, i) => {
    const low = 1 - i / Math.max(1, n - 1)
    const wave = 0.35 + 0.25 * Math.sin(t * 0.11 + i * 1.7) + 0.2 * Math.sin(t * 0.23 + i * 0.6)
    return Math.max(0.05, Math.min(1, wave + bump * (0.25 + 0.35 * low)))
  })
}

export function eqBars(levels: readonly number[], mood: LofiMood): { s: string; c: string }[] {
  const [lo, hi] = TINT[mood]
  return levels.map(v => ({ s: BARS[Math.max(1, Math.round(v * 8))] ?? '▁', c: mix(lo, hi, v) }))
}

/** One row: a pill with the note, `lofi · mood`, and bars dancing by CSS at the loop's tempo. */
export function lofiSvg(mood: LofiMood, W: number, now: number, since: number): string {
  const H = 30
  const [lo, hi] = TINT[mood]
  const beat = 60 / BPM[mood]
  const n = 16
  const label = `lofi · ${mood}`
  const pillW = 128 + n * 6
  const x0 = 116
  const t = (now - since) / 1000
  const bars: string[] = []
  for (let i = 0; i < n; i++) {
    const dur = beat * (i % 3 === 0 ? 1 : i % 3 === 1 ? 0.5 : 2)
    const delay = -((t + i * 0.137) % dur)
    bars.push(`<rect class="eq" x="${x0 + i * 6}" y="6" width="4" height="18" rx="2" fill="url(#lfG)" style="animation-duration:${dur.toFixed(3)}s;animation-delay:${delay.toFixed(3)}s"/>`)
  }
  const css = `
.eq{transform-box:fill-box;transform-origin:50% 100%;animation:eq ease-in-out infinite alternate}
@keyframes eq{0%{transform:scaleY(.18)}55%{transform:scaleY(1)}100%{transform:scaleY(.4)}}
.nt{animation:nt ${(beat * 2).toFixed(2)}s ease-in-out infinite}@keyframes nt{50%{transform:translateY(-2px)}}
.rim{stroke:${lo};stroke-opacity:.35}`
  const body = `<defs><linearGradient id="lfG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${lo}"/><stop offset="1" stop-color="${hi}"/></linearGradient></defs>
<rect class="p" x="0" y="1" width="${Math.min(W, pillW)}" height="28" rx="14"/>
<rect class="rim" x=".5" y="1.5" width="${Math.min(W, pillW) - 1}" height="27" rx="13.5" fill="none"/>
<g class="nt">${svgText(12, 20, '♪', { size: 15, weight: 700, fill: hi })}</g>
${svgText(30, 19.5, label, { size: 12, weight: 650 })}
${bars.join('')}`
  return svg(W, H, body, css)
}
