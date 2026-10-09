// Halo's terminal line: a Client surface module that paints one row of ━ at
// ~30 fps, every cell its own color, in a pattern per mood.
import type { ClientModule, RenderElement } from 'claude-code'

import type { HaloMood } from '../types'
import { mix, noise } from './lib/kz.ts'

export type LineProps = { mood: HaloMood; color: string; label: string }

type LineState = { t: number; moodT: number; mood: HaloMood }

/** A gray that reads on dark and light terminals alike: the line's "off". */
const OFF = '#4b5563'

let latest: LineProps = { mood: 'idle', color: '#60a5fa', label: '' }

/** The color of cell `x` of `w` at frame `t` (`m` frames into the mood). */
export function cellColor(p: LineProps, x: number, w: number, t: number, m: number): string {
  const c = p.color
  switch (p.mood) {
    case 'idle': {
      // Slow breathing with a faint swell drifting along.
      const breath = 0.45 + 0.3 * Math.sin(t * 0.045)
      const swell = 0.12 * Math.sin(x * 0.06 - t * 0.02)
      return mix(OFF, c, Math.max(0, Math.min(1, breath + swell)))
    }
    case 'flow': {
      // Bands of violet streaming right.
      const k = 0.5 + 0.5 * Math.sin((x - t * 0.9) * 0.11)
      return mix(mix(c, '#5b21b6', 0.55), mix(c, '#f5f3ff', 0.45), k)
    }
    case 'think': {
      // A magenta field with sparks that come and go.
      const base = 0.55 + 0.15 * Math.sin(x * 0.2 + t * 0.07)
      const spark = noise(x, Math.floor(t / 3)) > 0.9 ? 1 : 0
      return spark ? mix(c, '#fff0fa', 0.7) : mix(OFF, c, base)
    }
    case 'tool': {
      // A comet of the tool's color racing left to right.
      const head = (t * 1.6) % (w + 30)
      const d = head - x
      const tail = d >= 0 ? Math.exp(-d / 10) : 0
      return mix(mix(OFF, c, 0.3), mix(c, '#ffffff', 0.35), tail)
    }
    case 'error': {
      // A hard red strobe that settles over four seconds.
      const fade = Math.max(0, 1 - m / 120)
      const strobe = Math.floor(m / 4) % 2 === 0 ? 1 : 0.35
      return mix(mix(OFF, c, 0.45), c, fade * strobe + (1 - fade) * 0.4)
    }
    case 'wait': {
      // An amber blink, once a second, with a soft edge.
      const phase = (t % 30) / 30
      const on = phase < 0.55 ? 1 : phase < 0.65 ? 1 - (phase - 0.55) * 10 : 0.15
      return mix(OFF, c, on)
    }
  }
}

const Line: ClientModule<LineProps, LineState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0, moodT: 0, mood: props.mood })
    surface.every(33, () => {
      const s = surface.state
      if (!s) return
      const isNew = latest.mood !== s.mood
      surface.setState({ t: s.t + 1, moodT: isNew ? 0 : s.moodT + 1, mood: latest.mood })
    })
  }
  latest = props
  const st = surface.state ?? { t: 0, moodT: 0, mood: props.mood }
  const { Text } = surface.elements
  const w = Math.max(4, surface.columns || 80)
  const label = props.label ? ` ${props.label} ` : ''
  const lead = label ? 2 : 0
  const parts: RenderElement[] = []
  let run = ''
  let runColor = ''
  const flush = (key: string) => {
    if (run) parts.push(<Text key={key} color={runColor}>{run}</Text>)
    run = ''
  }
  for (let x = 0; x < w; x++) {
    if (label && x === lead) {
      flush(`r${x}`)
      parts.push(<Text key="label" color={cellColor(props, x, w, st.t, st.moodT)} bold>{label}</Text>)
      x += label.length - 1
      continue
    }
    const color = cellColor(props, x, w, st.t, st.moodT)
    if (color !== runColor) flush(`r${x}`)
    runColor = color
    run += '━'
  }
  flush('end')
  return <Text wrap="truncate-end">{parts}</Text>
}

export default Line
