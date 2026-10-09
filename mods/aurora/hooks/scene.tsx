// Aurora's terminal scene: curtains of light at 30 fps with their label.
// Runs in the drawing surface; no `$` here.
import type { ClientModule } from 'claude-code'

import { auroraFrame, labelLines } from './lights.ts'
import type { Mode, Seg } from './lights.ts'

type P = { mode: Mode; effort: string | null; level: number; now: number; since: number; width: number; rows: number }
type S = { t: number; sig: number; at: number }

const FRAME = 33
const LABEL = 20

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
  const width = Math.max(20, surface.columns > 0 ? surface.columns : props.width)
  const rows = Math.max(2, Math.min(3, props.rows))
  const skyW = width - LABEL
  const secs = (now - props.since) / 1000
  const line = (segs: readonly Seg[], key: string) => (
    <Text key={key} wrap="truncate-end">
      {segs.map((g, i) => (
        <Text key={`s${i}`} color={g.c} bold={g.b} dimColor={g.d}>{g.s}</Text>
      ))}
    </Text>
  )
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={skyW} flexShrink={0}>
        {auroraFrame(now / 1000, skyW, rows, props.level, props.mode).map((segs, y) => line(segs, `a${y}`))}
      </Box>
      <Box flexDirection="column" width={LABEL} flexShrink={0}>
        {labelLines(props.mode, props.effort, secs, props.level, rows, now / 1000).map((segs, y) => line(segs, `l${y}`))}
      </Box>
    </Box>
  )
}

export default Scene
