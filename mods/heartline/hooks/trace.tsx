// Heartline's terminal scene: a braille EKG that scrolls left at 30 fps,
// with a beating heart readout. Runs in the drawing surface; no `$` here.
import type { ClientModule } from 'claude-code'

import { FADE, beatPeriod, traceFrame } from './ekg.ts'
import type { Beat } from './ekg.ts'
import { KZ, heat, mix } from './lib/kz.ts'

type P = { beats: Beat[]; now: number; bpm: number; rpm: number; ctx: number | null; width: number; rows: number }
/** t: frames drawn; sig: the props clock last seen; at: the frame it arrived on. */
type S = { t: number; sig: number; at: number }

const FRAME = 33
const READOUT = 12

const Trace: ClientModule<P, S> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.setState({ t: 0, sig: props.now, at: 0 })
    surface.every(FRAME, () => {
      // Set just above, before the first tick.
      const c = surface.state as S
      surface.setState({ ...c, t: c.t + 1 })
    })
  } else if (s.sig !== props.now) {
    surface.setState({ ...s, sig: props.now, at: s.t })
  }
  const t = s?.t ?? 0
  const at = s && s.sig === props.now ? s.at : t
  // The hooks module publishes its clock now and then; between, frames count.
  const now = props.now + (t - at) * FRAME

  const { Box, Text } = surface.elements
  const width = surface.columns > 0 ? surface.columns : props.width
  const rows = Math.max(2, Math.min(3, props.rows))
  const cols = Math.max(8, width - READOUT)
  const quiet = !props.beats.some(b => now - b.at < 8000)
  const breath = quiet ? 0.2 + 0.3 * (0.5 + 0.5 * Math.sin((now / 4200) * Math.PI * 2)) : 0
  const frame = traceFrame(props.beats, now, cols, rows, props.ctx, breath)

  const period = beatPeriod(props.bpm)
  const phase = (now % period) / period
  const lub = phase < 0.12 || (phase > 0.24 && phase < 0.32)
  const heart = props.bpm > 0 ? (lub ? KZ.red : mix(KZ.red, FADE, 0.45)) : mix(KZ.magenta, FADE, 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(now / 700)))
  const ctxTxt = props.ctx === null ? '—' : `${Math.round(props.ctx)}%`

  const readout = [
    <Text key="r0" wrap="truncate-end">
      <Text color={heart} bold={lub}>{lub && props.bpm > 0 ? ' ♥ ' : ' ♡ '}</Text>
      <Text bold>{String(props.bpm)}</Text>
      <Text dimColor> bpm</Text>
    </Text>,
    <Text key="r1" wrap="truncate-end">
      <Text dimColor>   ctx </Text>
      <Text color={props.ctx === null ? FADE : heat(props.ctx / 100)} bold>{ctxTxt}</Text>
    </Text>,
    <Text key="r2" wrap="truncate-end">
      <Text dimColor>   {String(props.rpm)} req/m</Text>
    </Text>,
  ].slice(0, rows)

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={cols} flexShrink={0}>
        {frame.map((segs, y) => (
          <Text key={`l${y}`} wrap="truncate-end">
            {segs.map((g, i) => (
              <Text key={`s${i}`} color={g.c} bold={g.b}>{g.s}</Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" width={READOUT} flexShrink={0}>
        {readout}
      </Box>
    </Box>
  )
}

export default Trace
