// Skies' terminal scene: a Client surface module. Three rows of sky drawn as
// half-block pixels (6 pixels tall) with glyphs on top (rain, stars, bolts,
// fog), animated at ~25 fps, and the forecast line under it.
import type { ClientModule, RenderElement } from 'claude-code'

import type { Weather } from '../types'
import { mix, noise } from './lib/kz.ts'

export type SceneProps = { weather: Weather; forecast: string; tone: string }

type SceneState = { t: number }
type Glyph = { ch: string; color: string }

const ROWS = 3
const PX = ROWS * 2
const RAINBOW = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa']

/** The sky as pixels and glyphs: pure, so the tests can look at a frame. */
export function frame(weather: Weather, w: number, t: number): { px: (string | undefined)[]; glyphs: (Glyph | undefined)[] } {
  const px: (string | undefined)[] = new Array(w * PX).fill(undefined)
  const glyphs: (Glyph | undefined)[] = new Array(w * ROWS).fill(undefined)
  const setPx = (x: number, y: number, c: string | undefined) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi >= 0 && xi < w && yi >= 0 && yi < PX) px[yi * w + xi] = c
  }
  const disc = (cx: number, cy: number, r: number, c: string | undefined) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPx(x, y, c)
    }
  }
  const glyph = (x: number, row: number, ch: string, color: string) => {
    const xi = Math.round(x)
    if (xi >= 0 && xi < w && row >= 0 && row < ROWS) glyphs[row * w + xi] = { ch, color }
  }
  const cloud = (x: number, y: number, c: string) => {
    disc(x, y + 1, 1.5, c)
    disc(x + 2.4, y, 2.1, c)
    disc(x + 5, y + 1, 1.7, c)
    for (let i = -1; i <= 6; i++) setPx(x + i, y + 2, c)
  }
  const clouds = (n: number, c: string, speed: number, top = 0) => {
    for (let i = 0; i < n; i++) {
      const span = w + 14
      const x = ((((i + noise(i, 7) * 0.6) / n) * span + t * speed) % span) - 8
      cloud(x, top + (i % 2) * 0.8, c)
    }
  }
  const sun = (cx: number, cy: number) => {
    const spin = t * 0.035
    for (let k = 0; k < 8; k++) {
      const a = spin + (k * Math.PI) / 4
      const flick = 0.5 + 0.5 * Math.sin(t * 0.2 + k)
      for (const d of [3.3, 4.1]) setPx(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, mix('#fb923c', '#fde68a', flick))
    }
    disc(cx, cy, 2.1, '#facc15')
    setPx(cx - 0.6, cy - 0.8, '#fef9c3')
  }
  const rain = (density: number, color: string) => {
    for (let x = 0; x < w; x++) {
      if (noise(x, 11) > density) continue
      const speed = 0.18 + noise(x, 5) * 0.12
      const pos = (t * speed + noise(x, 9) * 4) % 2
      const row = Math.floor(pos) + 1
      // Drops fall below the clouds, never through them.
      if (row < ROWS && !px[row * 2 * w + x] && !px[(row * 2 + 1) * w + x]) glyph(x, row, pos % 1 < 0.5 ? '╵' : '│', color)
    }
  }

  switch (weather) {
    case 'clear': {
      sun(5, 2.6)
      for (let i = 0; i < Math.max(1, Math.floor(w / 40)); i++) {
        const x = (noise(i, 2) * w + t * 0.12) % (w + 4)
        glyph(x, i % 2, Math.floor(t / 6 + i) % 2 ? 'v' : '˅', '#9ca3af')
      }
      break
    }
    case 'fair':
      sun(5, 2.6)
      clouds(Math.max(2, Math.floor(w / 30)), '#cbd5e1', 0.05)
      break
    case 'cloudy':
      clouds(Math.max(4, Math.floor(w / 14)), '#94a3b8', 0.06)
      clouds(Math.max(2, Math.floor(w / 26)), '#cbd5e1', 0.09, 1)
      break
    case 'rain':
      clouds(Math.max(6, Math.floor(w / 9)), '#64748b', 0.05)
      rain(0.22, '#60a5fa')
      break
    case 'storm': {
      const strike = t % 70 < 5 && noise(Math.floor(t / 70), 1) > 0.25
      const flash = strike && t % 70 < 2
      clouds(Math.max(8, Math.floor(w / 7)), flash ? '#e5e7eb' : '#475569', 0.09)
      rain(0.36, '#93c5fd')
      if (strike) {
        const x = 6 + Math.floor(noise(Math.floor(t / 70), 4) * Math.max(1, w - 12))
        glyph(x, 1, '╲', '#fde047')
        glyph(x + 1, 1, '_', '#fde047')
        glyph(x + 1, 2, '╱', '#fde047')
      }
      break
    }
    case 'fog':
      for (let row = 0; row < ROWS; row++) {
        for (let x = 0; x < w; x++) {
          const n = noise(Math.floor((x + t * (0.08 + row * 0.05)) / 3), row + 20)
          if (n > 0.35) glyph(x, row, n > 0.75 ? '▒' : '░', mix('#9ca3af', '#e5e7eb', n))
        }
      }
      break
    case 'night': {
      for (let row = 0; row < ROWS; row++) {
        for (let x = 0; x < w; x++) {
          const n = noise(x, row + 40)
          if (n < 0.93) continue
          const tw = 0.5 + 0.5 * Math.sin(t * 0.08 + n * 50)
          glyph(x, row, n > 0.985 ? '✦' : tw > 0.7 ? '+' : '·', mix('#475569', '#fef9c3', tw))
        }
      }
      const mx = Math.max(10, w - 9)
      disc(mx, 2.6, 2.3, '#fef3c7')
      disc(mx + 1.2, 1.9, 2.0, undefined)
      break
    }
    case 'rainbow': {
      const cx = w * 0.5
      const rx = Math.max(8, w * 0.36)
      for (let x = 0; x < w; x++) {
        const u = (x - cx) / rx
        if (Math.abs(u) >= 1) continue
        const h = PX * Math.sqrt(1 - u * u)
        for (let b = 0; b < RAINBOW.length; b++) {
          const y = Math.floor(PX - h) + b
          const shimmer = 0.25 * (0.5 + 0.5 * Math.sin(t * 0.15 - x * 0.18))
          if (y >= 0 && y < PX) setPx(x, y, mix(RAINBOW[b] ?? '#fff', '#ffffff', shimmer))
        }
      }
      clouds(2, '#cbd5e1', 0.03)
      sun(4, 2.6)
      for (let i = 0; i < 4; i++) if (Math.floor(t / 4 + i * 3) % 7 === 0) glyph(cx + (noise(i, Math.floor(t / 28)) - 0.5) * rx * 1.6, i % 2, '✧', '#fef9c3')
      break
    }
  }
  return { px, glyphs }
}

const Scene: ClientModule<SceneProps, SceneState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0 })
    surface.every(40, () => surface.setState({ t: (surface.state?.t ?? 0) + 1 }))
  }
  const { Box, Text } = surface.elements
  const w = Math.max(10, surface.columns || 80)
  const t = surface.state?.t ?? 0
  // A short band gets the forecast line alone.
  const isCompact = surface.rows > 0 && surface.rows < ROWS + 1
  const { px, glyphs } = frame(props.weather, w, t)
  const rows: RenderElement[] = []
  for (let row = 0; row < (isCompact ? 0 : ROWS); row++) {
    const parts: RenderElement[] = []
    let run = ''
    let style = ''
    let fg: string | undefined
    let bg: string | undefined
    const flush = (k: string) => {
      if (run) parts.push(<Text key={k} color={fg} backgroundColor={bg}>{run}</Text>)
      run = ''
    }
    for (let x = 0; x < w; x++) {
      const g = glyphs[row * w + x]
      const top = px[row * 2 * w + x]
      const bot = px[(row * 2 + 1) * w + x]
      let ch = ' '
      let f: string | undefined
      let b: string | undefined
      if (g) {
        ch = g.ch
        f = g.color
        b = top && bot ? bot : undefined
      } else if (top && bot) {
        ch = top === bot ? '█' : '▀'
        f = top
        b = top === bot ? undefined : bot
      } else if (top) {
        ch = '▀'
        f = top
      } else if (bot) {
        ch = '▄'
        f = bot
      }
      const s = `${f ?? ''}|${b ?? ''}`
      if (s !== style) {
        flush(`c${x}`)
        style = s
        fg = f
        bg = b
      }
      run += ch
    }
    flush('end')
    rows.push(<Text key={`r${row}`} wrap="truncate-end">{parts}</Text>)
  }
  const cut = props.forecast.indexOf(' · ')
  const head = cut < 0 ? props.forecast : props.forecast.slice(0, cut)
  const rest = cut < 0 ? '' : props.forecast.slice(cut)
  rows.push(
    <Text key="forecast" wrap="truncate-end">
      <Text key="h" color={props.tone} bold>{head}</Text>
      <Text key="r" dimColor>{rest}</Text>
    </Text>,
  )
  return <Box flexDirection="column">{rows}</Box>
}

export default Scene
