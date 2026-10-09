// Warpdrive's terminal scene: a star field at ~30 fps. Stars stream out of the
// center; their speed and streak length ease toward the live token rate the
// hooks module sends. A new jump (flashSeq) fires a ring of light. No `$` here.
import type { ClientModule } from 'claude-code'

import { rng } from './lib/kz.ts'
import { hudLine, seedStars, stepStars, warpFrame } from './warp.ts'
import type { Star } from './warp.ts'

export type FieldProps = {
  cols: number
  rows: number
  speed: number
  rate: number
  tokens: number
  elapsedMs: number
  isWorking: boolean
  label: string
  flashSeq: number
}

type S = { t: number; stars: Star[]; sp: number; seen: number; flashAt: number }

const FRAME = 33
const FLASH_FRAMES = 22

const Field: ClientModule<FieldProps, S> = (props, surface) => {
  const cols = Math.max(8, surface.columns || props.cols)
  const rows = Math.max(1, surface.rows || props.rows)
  if (surface.state === undefined) {
    const count = Math.max(16, Math.min(140, Math.round((props.cols * props.rows) / 4.5)))
    surface.setState({ t: 0, stars: seedStars(count, rng(7)), sp: props.speed, seen: props.label ? 0 : props.flashSeq, flashAt: -999 })
    surface.every(FRAME, () => {
      const s = surface.state
      if (!s) return
      const p = latest
      // Ease toward the target speed: engines spool, they do not jump.
      const target = p.isWorking ? p.speed : 0
      const sp = s.sp + (target - s.sp) * 0.08
      // A jump burst: a moment of extra thrust as the ring goes out.
      const burst = s.t - s.flashAt < FLASH_FRAMES ? 0.6 * (1 - (s.t - s.flashAt) / FLASH_FRAMES) : 0
      let { seen, flashAt } = s
      if (p.flashSeq !== seen) {
        seen = p.flashSeq
        flashAt = p.flashSeq > 0 ? s.t : flashAt
      }
      surface.setState({ t: s.t + 1, stars: stepStars(s.stars, Math.min(1, sp + burst), rng(1000 + s.t)), sp, seen, flashAt })
    })
  }
  latest = props
  const s = surface.state ?? { t: 0, stars: [], sp: 0, seen: 0, flashAt: -999 }
  const age = s.t - s.flashAt
  const flash = age >= 0 && age <= FLASH_FRAMES ? age / FLASH_FRAMES : -1
  const hud = props.isWorking ? hudLine(s.sp, props.rate, props.tokens, props.elapsedMs) : ''
  const frame = warpFrame(s.stars, cols, rows, s.sp, flash, hud, props.label)

  const { Box, Text } = surface.elements
  return (
    <Box flexDirection="column">
      {frame.map((runs, y) => (
        <Text key={`r${y}`} wrap="truncate-end">
          {runs.map((r, i) => (r.c ? <Text key={`c${i}`} color={r.c}>{r.s}</Text> : r.s))}
        </Text>
      ))}
    </Box>
  )
}

/** The props the timer reads: the last ones drawn with. */
let latest: FieldProps = { cols: 0, rows: 0, speed: 0, rate: 0, tokens: 0, elapsedMs: 0, isWorking: false, label: '', flashSeq: 0 }

export default Field
