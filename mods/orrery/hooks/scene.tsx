// Orrery's terminal scene: planets on dotted orbits around a flickering sun,
// redrawn at 30 fps, and the legend beside it. Runs in the drawing surface.
import type { ClientModule } from 'claude-code'

import { fieldFrame, legendLines } from './sky.ts'
import type { Agent, Seg } from './sky.ts'

type P = { agents: Agent[]; now: number; sunTps: number; isWorking: boolean; width: number; rows: number }
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
  const width = surface.columns > 0 ? surface.columns : props.width
  const rows = Math.max(3, props.rows)
  const fieldW = Math.max(16, Math.min(64, Math.round(width * 0.42)))
  const legendW = Math.max(10, width - fieldW - 3)
  const field = fieldFrame(props.agents, props.now, now, fieldW, rows, props.sunTps, props.isWorking)
  const legend = legendLines(props.agents, now, legendW, rows)
  const line = (segs: readonly Seg[], key: string) => (
    <Text key={key} wrap="truncate-end">
      {segs.map((g, i) => (
        <Text key={`s${i}`} color={g.c} bold={g.b} dimColor={g.d}>{g.s}</Text>
      ))}
    </Text>
  )

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={fieldW} flexShrink={0}>
        {field.map((segs, y) => line(segs, `f${y}`))}
      </Box>
      <Box flexDirection="column" width={3} flexShrink={0}>
        {field.map((_, y) => <Text key={`g${y}`} dimColor> │</Text>)}
      </Box>
      <Box flexDirection="column" width={legendW} flexShrink={0}>
        {legend.map((segs, y) => line(segs, `l${y}`))}
      </Box>
    </Box>
  )
}

export default Scene
