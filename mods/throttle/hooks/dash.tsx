// Throttle's terminal dashboard: a Client surface module animating at ~30 fps.
// Three braille dials (2 rows × 7 cells = 14 × 8 dots each) whose needles ease
// toward the latest reading and shiver while the engine runs, a counting
// odometer, warning lamps and a status word. No `$` here: the hooks module
// sends plain numbers as props.
import type { ClientModule, RenderElement } from 'claude-code'

import { mix } from './lib/kz.ts'

export type DashProps = {
  speed: number
  speedMax: number
  fuel: number | null
  temp: number | null
  odo: number | null
  engine: boolean
  fuelLow: boolean
  heat: boolean
  working: boolean
  agents: number
  idleSec: number
}

type DashState = { t: number; sp: number; fu: number; te: number; od: number }

type Run = { text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean }

const NEEDLE = '#ff5a4f'
const DIM_ARC = '#4b5563'
const LEFT = [0x01, 0x02, 0x04, 0x40]
const RIGHT = [0x08, 0x10, 0x20, 0x80]

const speedTint = (f: number): string => (f < 0.5 ? mix('#22d3ee', '#a78bfa', f * 2) : mix('#a78bfa', '#f472b6', (f - 0.5) * 2))
const fuelTint = (f: number): string => (f < 0.35 ? mix('#f87171', '#fb923c', f / 0.35) : mix('#facc15', '#4ade80', (f - 0.35) / 0.65))
const tempTint = (f: number): string => (f < 0.5 ? mix('#60a5fa', '#4ade80', f * 2) : f < 0.8 ? mix('#4ade80', '#fb923c', (f - 0.5) / 0.3) : mix('#fb923c', '#f87171', (f - 0.8) / 0.2))

/** A semicircular gauge in braille: two rows of seven cells. */
export function dialCells(v: number, tint: (f: number) => string): [Run[], Run[]] {
  const cols = 7
  const rows = 2
  const bits: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))
  const needle: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
  const lit: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => -1))
  const k = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  const cx = 6.5
  const cy = 7.4
  const r = 6.6
  // The arc spans x -0.1..13.1 and y 0.8..7.4, the needle less: every dot
  // rounds into the 14 × 8 grid, so the cells below always exist.
  const dot = (x: number, y: number, isNeedle: boolean, f: number) => {
    const dx = Math.round(x)
    const dy = Math.round(y)
    const cell = Math.floor(dx / 2)
    const row = Math.floor(dy / 4)
    const line = bits[row]!
    line[cell] = line[cell]! | (dx % 2 ? RIGHT : LEFT)[dy % 4]!
    if (isNeedle) needle[row]![cell] = true
    else if (f <= k + 1e-6) lit[row]![cell] = Math.max(lit[row]![cell]!, f)
  }
  for (let i = 0; i <= 48; i++) {
    const f = i / 48
    const a = Math.PI * (1 - f)
    dot(cx + r * Math.cos(a), cy - r * Math.sin(a), false, f)
  }
  const a = Math.PI * (1 - k)
  for (let t = 0; t <= 1.0001; t += 0.07) dot(cx + t * (r - 1.6) * Math.cos(a), cy - t * (r - 1.6) * Math.sin(a), true, 0)
  const row = (y: number): Run[] =>
    bits[y]!.map((b, x) => {
      const f = lit[y]![x]!
      return { text: b ? String.fromCharCode(0x2800 + b) : ' ', color: needle[y]![x] ? NEEDLE : f >= 0 ? tint(f) : DIM_ARC }
    })
  return [row(0), row(1)]
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function odo(usd: number): string {
  const cents = Math.max(0, Math.round(usd * 100)) % 1_000_000
  const s = String(cents).padStart(6, '0')
  return `${s.slice(0, 4)}.${s.slice(4)}`
}

const ease = (from: number, to: number, k: number): number => (Math.abs(to - from) < 0.002 ? to : from + (to - from) * k)

const Dash: ClientModule<DashProps, DashState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0, sp: 0, fu: (props.fuel ?? 0) / 100, te: (props.temp ?? 0) / 100, od: props.odo ?? 0 })
    surface.every(33, () => {
      const s = surface.state
      if (!s) return
      const p = latest
      surface.setState({
        t: s.t + 1,
        sp: ease(s.sp, Math.min(1, p.speed / Math.max(1, p.speedMax)), 0.16),
        fu: ease(s.fu, (p.fuel ?? 0) / 100, 0.1),
        te: ease(s.te, (p.temp ?? 0) / 100, 0.1),
        od: Math.abs((p.odo ?? 0) - s.od) < 0.004 ? (p.odo ?? 0) : s.od + ((p.odo ?? 0) - s.od) * 0.12,
      })
    })
  }
  latest = props
  const st = surface.state ?? { t: 0, sp: 0, fu: 0, te: 0, od: 0 }
  const { Box, Text } = surface.elements
  const width = surface.columns || 80
  const t = st.t
  const shiver = props.working && props.speed > 0.5 ? Math.sin(t * 0.9) * 0.012 + Math.sin(t * 2.7) * 0.006 : 0
  const blink = Math.floor(t / 15) % 2 === 0

  const top: Run[] = []
  const bottom: Run[] = []
  let used = 0
  const add = (w: number, a: Run[], b: Run[]): boolean => {
    if (used + w > width) return false
    top.push(...a)
    bottom.push(...b)
    used += w
    return true
  }
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
  const gauge = (v: number, tint: (f: number) => string, value: string, valueColor: string, label: string): void => {
    const [r1, r2] = dialCells(v, tint)
    add(15, [...r1, { text: ' ' }, { text: pad(value, 6), color: valueColor, bold: true }, { text: ' ' }], [...r2, { text: ' ' }, { text: pad(label, 6), dim: true }, { text: ' ' }])
  }

  const spd = Math.max(0, Math.min(1, st.sp + shiver))
  gauge(spd, speedTint, String(Math.round(props.speed)), speedTint(st.sp), `tok/s`)
  if (props.fuel !== null) gauge(st.fu, fuelTint, `${Math.round(props.fuel)}%`, props.fuelLow ? '#f87171' : fuelTint(st.fu), 'fuel')
  if (props.temp !== null) gauge(st.te, tempTint, `${Math.round(props.temp)}%`, props.heat ? '#f87171' : tempTint(st.te), 'ctx')
  if (props.odo !== null) {
    const d = odo(st.od)
    add(11, [
      { text: '$', color: '#facc15', bold: true },
      { text: d.slice(0, 4), color: '#f3f4f6', bg: '#1f2937', bold: true },
      { text: '.', color: '#9ca3af', bg: '#1f2937' },
      { text: d.slice(5), color: '#fff1f2', bg: '#9f1239', bold: true },
      { text: '  ' },
    ], [{ text: pad('odometer', 11), dim: true }])
  }
  const lamp = (label: string, on: boolean, color: string, flash: boolean): Run =>
    on && (!flash || blink) ? { text: ` ${label} `, color: '#111111', bg: color, bold: true } : { text: ` ${label} `, color: on ? color : '#6b7280', dim: !on }
  const lamps = [lamp('ENG', props.engine, '#fb923c', false), lamp('FUEL', props.fuelLow, '#fb923c', true), lamp('HOT', props.heat, '#f87171', true)]
  // The status sits under the lamps, 17 cells: `◈ 12 on the road` fits, the desktop's longer words would not.
  const status: Run = props.working
    ? { text: props.agents > 0 ? `◈ ${props.agents} on the road` : '● engine running', color: '#4ade80' }
    : { text: `○ coasting ${clock(props.idleSec)}`, dim: true }
  add(17, [...lamps, { text: ' ' }], [{ ...status, text: pad(status.text, 17) }])

  const line = (runs: Run[], key: string): RenderElement => {
    const merged: Run[] = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (last && last.color === r.color && last.bg === r.bg && last.bold === r.bold && last.dim === r.dim) last.text += r.text
      else merged.push({ ...r })
    }
    return (
      <Text key={key} wrap="truncate-end">
        {merged.map((r, i) => (
          <Text key={String(i)} color={r.color} backgroundColor={r.bg} bold={r.bold} dimColor={r.dim}>{r.text}</Text>
        ))}
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {line(top, 'a')}
      {line(bottom, 'b')}
    </Box>
  )
}

let latest: DashProps = { speed: 0, speedMax: 100, fuel: null, temp: null, odo: null, engine: false, fuelLow: false, heat: false, working: false, agents: 0, idleSec: 0 }

export default Dash
