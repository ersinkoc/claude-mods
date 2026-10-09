// Glyphfall's terminal scene: the rain at 30 fps over the chip row.
// Runs in the drawing surface; no `$` here.
import type { ClientModule } from 'claude-code'

import { chipLine, rainFrame } from './rain.ts'
import type { Seg, Tool } from './rain.ts'

type P = { tools: Tool[]; now: number; width: number; rows: number }
type S = { t: number; sig: number; at: number }

const FRAME = 33

const Scene: ClientModule<P, S> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.setState({ t: 0, sig: props.now, at: 0 })
    surface.every(FRAME, () => {
      const c = surface.state
      if (c) surface.setState({ ...c, t: c.t + 1 })
    })
  } else if (s.sig !== props.now) {
    surface.setState({ ...s, sig: props.now, at: s.t })
  }
  const t = s?.t ?? 0
  const at = s && s.sig === props.now ? s.at : t
  const now = props.now + (t - at) * FRAME

  const { Box, Text } = surface.elements
  const cols = Math.max(10, surface.columns > 0 ? surface.columns : props.width)
  const rainRows = Math.max(1, props.rows - 1)
  const line = (segs: readonly Seg[], key: string) => (
    <Text key={key} wrap="truncate-end">
      {segs.map((g, i) => (
        <Text key={`s${i}`} color={g.c} backgroundColor={g.bg} bold={g.b} dimColor={g.d}>{g.s}</Text>
      ))}
    </Text>
  )
  return (
    <Box flexDirection="column">
      {rainFrame(props.tools, now, cols, rainRows).map((segs, y) => line(segs, `r${y}`))}
      {line(chipLine(props.tools, now, cols), 'chips')}
    </Box>
  )
}

export default Scene
