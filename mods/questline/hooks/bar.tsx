// Questline's terminal bar: a Client surface module. The running segment
// breathes and a highlight runs through it; the elapsed clock ticks locally
// from the last published figure, so the hooks module publishes only changes.
import type { ClientModule, RenderElement } from 'claude-code'

import { mix } from './lib/kz.ts'
import { segments } from './quests.ts'

export type BarProps = {
  /** One letter per quest: d done, a active, p pending. */
  marks: string
  done: number
  total: number
  activeText: string
  /** How long the active quest had run when published; -1 for none. */
  activeMs: number
  allDone: boolean
}

type BarState = { t: number; base: number; at: number }

const GREEN = '#4ade80'
const VIOLET = '#a78bfa'
const PALE = '#ede9fe'
const GRAY = '#6b7280'

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

let latest: BarProps = { marks: '', done: 0, total: 0, activeText: '', activeMs: -1, allDone: false }

const Bar: ClientModule<BarProps, BarState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0, base: props.activeMs, at: 0 })
    surface.every(40, () => {
      const s = surface.state
      if (!s) return
      // A new figure from the hooks restarts the local count from it.
      const isNew = latest.activeMs !== s.base
      surface.setState({ t: s.t + 1, base: latest.activeMs, at: isNew ? s.t + 1 : s.at })
    })
  }
  latest = props
  const st = surface.state ?? { t: 0, base: props.activeMs, at: 0 }
  const { Box, Text } = surface.elements
  const cols = surface.columns || 80
  const t = st.t
  const budget = Math.max(6, Math.min(48, Math.floor(cols * 0.4)))
  const { width, gap } = segments(props.marks.length, budget)

  type Run = { s: string; c: string }
  const runs: Run[] = []
  const push = (s: string, c: string) => {
    const last = runs[runs.length - 1]
    if (last && last.c === c) last.s += s
    else runs.push({ s, c })
  }
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.16)
  const wave = (t * 0.6) % (props.marks.length * (width + gap) + 24)
  let x = 0
  for (const m of props.marks) {
    for (let i = 0; i < width; i++, x++) {
      if (m === 'd') {
        // Once all is done a bright wave rolls across the bar now and then.
        const glow = props.allDone ? Math.max(0, 1 - Math.abs(x - wave) / 3) : 0
        push('█', glow > 0 ? mix(GREEN, '#f0fdf4', glow * 0.8) : GREEN)
      } else if (m === 'a') {
        const sweep = Math.floor(t / 3) % Math.max(1, width + 2) - 1
        push('█', i === sweep ? PALE : mix('#7c3aed', VIOLET, breathe))
      } else push('░', GRAY)
    }
    if (gap) {
      push(' ', GRAY)
      x++
    }
  }
  const elapsed = props.activeMs >= 0 ? props.activeMs + Math.max(0, t - st.at) * 40 : -1
  const line: RenderElement[] = runs.map((r, i) => <Text key={`s${i}`} color={r.c}>{r.s}</Text>)
  if (props.allDone) {
    line.push(<Text key="done" color={GREEN} bold> ✓ {props.total}/{props.total} quest complete</Text>)
  } else {
    line.push(<Text key="n" bold> {props.done}/{props.total}</Text>)
    if (props.activeText) {
      line.push(<Text key="sep" dimColor> · </Text>)
      line.push(<Text key="go" color={mix('#7c3aed', VIOLET, breathe)}>▶ </Text>)
      line.push(<Text key="what">{props.activeText}</Text>)
      if (elapsed >= 0) line.push(<Text key="el" dimColor> · {clock(elapsed)}</Text>)
    } else line.push(<Text key="idle" dimColor> · waiting for the next task</Text>)
  }
  return (
    <Box flexDirection="row">
      <Text wrap="truncate-end">{line}</Text>
    </Box>
  )
}

export default Bar
