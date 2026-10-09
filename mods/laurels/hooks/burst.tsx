// Laurels' terminal burst: one row that celebrates an unlock for six seconds.
// A trophy that hops, the badge glyph, its name in a travelling shimmer,
// the cheer, and confetti drifting through the rest of the row.
import type { ClientModule } from 'claude-code'

type P = { cols: number; name: string; glyph: string; color: string; cheer: string; more: number }
type S = { f: number }

const CONFETTI = ['✦', '✧', '·', '*', '⋆', '˚', '•', '✶']
const HUES = ['#f472b6', '#facc15', '#4ade80', '#22d3ee', '#a78bfa', '#fb923c']
const HOP = ['🏆', '🏆', '✨', '🏆']

function hash(n: number): number {
  const s = Math.sin(n * 91.3458) * 47453.5453
  return s - Math.floor(s)
}

/** Mixes two #rrggbb colors. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  const c = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')
  return `#${c(0)}${c(1)}${c(2)}`
}

const Burst: ClientModule<P, S> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ f: 0 })
    surface.every(60, () => surface.setState({ f: (surface.state?.f ?? 0) + 1 }))
  }
  const f = surface.state?.f ?? 0
  const { Box, Text } = surface.elements
  const base = /^#[0-9a-f]{6}$/i.test(props.color) ? props.color : '#facc15'

  const head = `${HOP[Math.floor(f / 4) % HOP.length]} `
  const label = ' UNLOCKED '
  const name = props.name
  const tail = ` — ${props.cheer}${props.more > 0 ? `  (+${props.more} more)` : ''} `
  const used = 3 + label.length + 3 + name.length + tail.length
  const room = Math.max(0, (props.cols || 60) - used)

  // A shimmer crest walks along the name, wrapping.
  const crest = (f * 0.6) % (name.length + 6)
  const letters = Array.from(name).map((ch, i) => {
    const d = Math.abs(i - crest)
    const glow = d < 2.5 ? 1 - d / 2.5 : 0
    return <Text key={`n${i}`} bold color={mix(base, '#ffffff', glow * 0.85)}>{ch}</Text>
  })

  // Confetti drifting right to left over the spare cells.
  const field: { ch: string; color: string }[] = []
  for (let x = 0; x < room; x++) {
    const seed = Math.floor((x + f * 0.5) / 1) + 7
    const r = hash(seed)
    const on = r < 0.28
    // hash() is in [0, 1): both picks are in range.
    field.push(on ? { ch: CONFETTI[Math.floor(hash(seed + 3) * CONFETTI.length)]!, color: HUES[Math.floor(hash(seed + 5) * HUES.length)]! } : { ch: ' ', color: '#000000' })
  }
  const runs: { color: string; text: string }[] = []
  for (const c of field) {
    const last = runs[runs.length - 1]
    if (last && (last.color === c.color || c.ch === ' ')) last.text += c.ch
    else runs.push({ color: c.color, text: c.ch })
  }

  const sparkle = CONFETTI[f % CONFETTI.length]
  return (
    <Box flexDirection="row">
      <Text wrap="truncate-end">
        <Text>{head}</Text>
        <Text backgroundColor={base} color="#111111" bold>{label}</Text>
        <Text color={base}> {props.glyph} </Text>
        {letters}
        <Text color="#d1d5db">{tail}</Text>
        {runs.map((r, i) => <Text key={`c${i}`} color={r.color}>{r.text}</Text>)}
        <Text color={HUES[f % HUES.length]}>{room > 0 ? '' : sparkle}</Text>
      </Text>
    </Box>
  )
}

export default Burst
