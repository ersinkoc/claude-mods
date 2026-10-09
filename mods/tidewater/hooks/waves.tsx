// Tidewater's terminal scene: rolling wave bars per file at ~30 fps, green
// swells for added lines, red ebbs for removed ones, and the chip row. A file
// that was just edited surges, then settles. No `$` here.
import type { ClientModule } from 'claude-code'

import { chipRow, tideFrame } from './tide.ts'
import type { TideFile } from './tide.ts'

export type WavesProps = { cols: number; rows: number; files: TideFile[]; newest: string }
type S = { t: number; edits: Record<string, number>; surgeAt: Record<string, number> }

const FRAME = 33
const SURGE = 45

let latest: WavesProps = { cols: 0, rows: 0, files: [], newest: '' }

const Waves: ClientModule<WavesProps, S> = (props, surface) => {
  latest = props
  if (surface.state === undefined) {
    const edits: Record<string, number> = {}
    for (const f of props.files) edits[f.path] = f.edits
    surface.setState({ t: 0, edits, surgeAt: {} })
    surface.every(FRAME, () => {
      const s = surface.state
      if (!s) return
      let edits = s.edits
      let surgeAt = s.surgeAt
      for (const f of latest.files) {
        if ((edits[f.path] ?? 0) !== f.edits) {
          edits = { ...edits, [f.path]: f.edits }
          surgeAt = { ...surgeAt, [f.path]: s.t }
        }
      }
      surface.setState({ t: s.t + 1, edits, surgeAt })
    })
  }
  const s = surface.state ?? { t: 0, edits: {}, surgeAt: {} }
  const cols = Math.max(10, surface.columns || props.cols)
  const surge: Record<string, number> = {}
  for (const [p, at] of Object.entries(s.surgeAt)) surge[p] = Math.max(0, 1 - (s.t - at) / SURGE)
  const waves = tideFrame(props.files, cols, props.rows >= 3 ? 3 : 2, s.t, surge)
  const chips = chipRow(props.files, cols, props.newest, s.t)

  const { Box, Text } = surface.elements
  return (
    <Box flexDirection="column">
      {waves.map((runs, y) => (
        <Text key={`w${y}`} wrap="truncate-end">
          {runs.map((r, i) => (r.c ? <Text key={`c${i}`} color={r.c}>{r.s}</Text> : r.s))}
        </Text>
      ))}
      <Text key="chips" wrap="truncate-end">
        {chips.map((r, i) => (r.c ? <Text key={`k${i}`} color={r.c}>{r.s}</Text> : r.s))}
      </Text>
    </Box>
  )
}

export default Waves
