// Clawdling on the terminal: the pixel crab in half blocks, animated by the
// surface at 8 fps, with its name, level, XP bar and a typed-out quip beside it.
import type { ClientModule } from 'claude-code'

import { STAGE_W, crabFrame, frameRuns } from './sprite.ts'
import type { Acc, Mood } from './sprite.ts'

type P = {
  cols: number
  mood: Mood
  name: string
  level: number
  into: number
  need: number
  quip: string
  acc: Acc
  icons: string
  status: string
}
type S = { f: number; quip: string; typed: number }

const SHELL = '#f05a3c'

const Crab: ClientModule<P, S> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ f: 0, quip: props.quip, typed: 0 })
    surface.every(125, () => {
      const s = surface.state
      if (s) surface.setState({ f: s.f + 1, quip: s.quip, typed: s.typed + 2 })
    })
  }
  const st = surface.state ?? { f: 0, quip: props.quip, typed: 0 }
  const typed = st.quip === props.quip ? st.typed : 0
  if (st.quip !== props.quip) surface.setState({ f: st.f, quip: props.quip, typed: 0 })

  const { Box, Text } = surface.elements
  const rows = frameRuns(crabFrame({ mood: props.mood, f: st.f, acc: props.acc }))
  const sideW = Math.max(0, (props.cols || 80) - STAGE_W - 2)

  const ratio = props.need > 0 ? Math.max(0, Math.min(1, props.into / props.need)) : 0
  const barW = Math.max(6, Math.min(24, sideW - 16))
  const fill = Math.round(ratio * barW)
  const quip = props.quip.slice(0, Math.min(props.quip.length, typed))
  const caret = typed < props.quip.length && st.f % 2 === 0 ? '▌' : ''

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={STAGE_W} flexShrink={0}>
        {rows.map((runs, r) => (
          <Text key={`row${r}`}>
            {runs.map((run, i) => (
              <Text key={`c${i}`} {...(run.fg ? { color: run.fg } : {})} {...(run.bg ? { backgroundColor: run.bg } : {})}>{run.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
      {sideW >= 12 ? (
        <Box flexDirection="column" marginLeft={2} width={sideW}>
          <Text wrap="truncate-end">
            <Text bold color={SHELL}>{props.name}</Text>
            <Text color="#fbbf24" bold> Lv {props.level}</Text>
            {props.icons ? <Text> {props.icons}</Text> : null}
          </Text>
          <Text wrap="truncate-end">
            <Text color="#fb923c">{'▰'.repeat(fill)}</Text>
            <Text color="#4b5563">{'▱'.repeat(barW - fill)}</Text>
            <Text dimColor> {props.into}/{props.need} XP</Text>
          </Text>
          <Text wrap="truncate-end" italic>“{quip}{caret}”</Text>
          <Text wrap="truncate-end" dimColor>{props.status}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export default Crab
