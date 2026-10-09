// Tempo's terminal band: one animated row drawn by the surface itself.
// A tomato (or a steaming cup on a break), the phase, a bar whose leading
// edge sizzles while a glint sweeps the filled part, the time left with a
// blinking colon, and today's tally. Counts down locally between redraws.
import type { ClientModule } from 'claude-code'

type P = {
  cols: number
  phase: 'work' | 'break' | 'long'
  remain: number
  total: number
  round: number
  today: number
  claude: boolean
}
type S = { f: number; since: number; seen: number }

const FRAME = 100
const TOMATO = ['#ef4444', '#f87171', '#fb923c', '#fbbf24']
const MINT = ['#2dd4bf', '#5eead4', '#99f6e4', '#ccfbf1']
const STEAM = ['  ', '° ', '°˚', ' ˚', '˚ ', ' °']

function clock(ms: number, blink: boolean): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}${blink ? ' ' : ':'}${String(s % 60).padStart(2, '0')}`
}

const TempoBand: ClientModule<P, S> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ f: 0, since: 0, seen: props.remain })
    surface.every(FRAME, () => {
      const s = surface.state ?? { f: 0, since: 0, seen: 0 }
      surface.setState({ f: s.f + 1, since: s.since + 1, seen: s.seen })
    })
  }
  const st = surface.state ?? { f: 0, since: 0, seen: props.remain }
  // New props from the hooks module: the countdown restarts from them.
  const since = st.seen === props.remain ? st.since : 0
  if (st.seen !== props.remain) surface.setState({ f: st.f, since: 0, seen: props.remain })

  const { Box, Text } = surface.elements
  const isWork = props.phase === 'work'
  const pal = isWork ? TOMATO : MINT
  const remain = Math.max(0, props.remain - since * FRAME)
  const ratio = props.total > 0 ? Math.max(0, Math.min(1, 1 - remain / props.total)) : 1
  const f = st.f

  const icon = isWork ? (remain < 60_000 && remain > 0 && f % 10 < 5 ? '⏰' : '🍅') : '☕'
  const steam = isWork ? '' : STEAM[Math.floor(f / 3) % STEAM.length] ?? ''
  const label = isWork ? `FOCUS ${props.round}` : props.phase === 'long' ? 'LONG BREAK' : 'BREAK'
  const time = clock(remain, f % 10 >= 5 && remain > 0)
  const tally = props.today > 0 ? ` 🍅×${props.today} today` : ''
  const note = !isWork && props.claude ? ` — Claude keeps going${'.'.repeat(1 + (Math.floor(f / 4) % 3))}` : ''

  const fixed = 2 + steam.length + 1 + label.length + 2 + 2 + time.length + tally.length + note.length + 1
  const width = Math.max(6, Math.min(48, (props.cols || 60) - fixed))
  const filled = ratio * width
  const full = Math.floor(filled)
  const glint = full > 2 ? Math.floor((f / 2) % (full + 8)) : -1

  // Runs of one color, so the row stays a handful of Text nodes.
  const runs: { color: string; text: string }[] = []
  const push = (color: string, ch: string) => {
    const last = runs[runs.length - 1]
    if (last && last.color === color) last.text += ch
    else runs.push({ color, text: ch })
  }
  for (let i = 0; i < width; i++) {
    if (i < full) {
      const d = Math.abs(i - glint)
      push(d === 0 ? pal[3] ?? '#fff' : d === 1 ? pal[2] ?? '#fff' : i % 2 ? pal[0] ?? '#f00' : pal[1] ?? '#f00', '█')
    } else if (i === full && ratio < 1) {
      const frac = filled - full
      const sizzle = ['░', '▒', '▓'][(f + i) % 3] ?? '▒'
      push(pal[1] ?? '#f00', frac > 0.5 ? '▓' : sizzle)
    } else {
      push('#4b5563', '·')
    }
  }

  return (
    <Box flexDirection="row">
      <Text wrap="truncate-end">
        <Text>{icon}</Text>
        {steam ? <Text color="#cbd5e1">{steam}</Text> : null}
        <Text bold color={pal[0]}> {label}</Text>
        <Text color="#6b7280"> ▕</Text>
        {runs.map((r, i) => <Text key={`r${i}`} color={r.color}>{r.text}</Text>)}
        <Text color="#6b7280">▏ </Text>
        <Text bold {...(remain < 60_000 ? { color: '#facc15' } : {})}>{time}</Text>
        {tally ? <Text color="#fca5a5">{tally}</Text> : null}
        {note ? <Text color="#5eead4" italic>{note}</Text> : null}
      </Text>
    </Box>
  )
}

export default TempoBand
