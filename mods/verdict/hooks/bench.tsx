// Verdict's terminal band: result chips with sparklines; a failing chip's
// beacon and text pulse red, and a second row types out the failing tests one
// after another. ~30 fps on the surface; no `$` here.
import type { ClientModule, RenderElement } from 'claude-code'

import { KZ, mix } from './lib/kz.ts'
import { sparkBars } from './view.ts'
import type { Chip } from './view.ts'

export type BenchProps = { cols: number; rows: number; chips: Chip[]; failures: string[] }
type S = { t: number }

const FRAME = 33
const DWELL = 75

const Bench: ClientModule<BenchProps, S> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0 })
    surface.every(FRAME, () => surface.setState({ t: (surface.state?.t ?? 0) + 1 }))
  }
  const t = surface.state?.t ?? 0
  const cols = Math.max(10, surface.columns || props.cols)
  const pulse = (Math.sin(t / 4.5) + 1) / 2
  const { Box, Text } = surface.elements

  // Row 1: the chips, as many as fit.
  const nodes: RenderElement[] = []
  let used = 0
  let hidden = 0
  props.chips.forEach((c, i) => {
    const bars = sparkBars(c.spark)
    const len = c.text.length + 1 + bars.length + (i ? 3 : 0)
    if (used + len > cols - 4) {
      hidden++
      return
    }
    used += len
    if (i) nodes.push(<Text key={`sep${i}`} dimColor> · </Text>)
    const color = c.ok ? KZ.green : mix('#f87171', '#fee2e2', pulse * 0.75)
    const beacon = c.ok ? '' : pulse > 0.5 ? '◉' : '○'
    nodes.push(
      <Text key={`c${i}`} color={color} bold={!c.ok}>
        {beacon ? c.text.replace(/^✗/, beacon) : c.text}
      </Text>,
    )
    nodes.push(<Text key={`s${i}`}> </Text>)
    bars.forEach((b, j) => {
      const isLast = j === bars.length - 1
      nodes.push(
        <Text key={`b${i}-${j}`} color={b.ok ? (isLast ? KZ.green : '#16a34a') : isLast ? color : '#dc2626'}>
          {b.s}
        </Text>,
      )
    })
  })
  if (hidden) nodes.push(<Text key="more" dimColor>{`  +${hidden}`}</Text>)

  // Row 2: the failing tests, typed out one at a time.
  let detail: RenderElement | null = null
  if (props.rows >= 2 && props.failures.length) {
    const n = props.failures.length
    const k = Math.floor(t / DWELL) % n
    const line = props.failures[k] ?? ''
    const shown = Math.min(line.length, Math.floor(((t % DWELL) + 1) * 3))
    const head = n > 1 ? `${k + 1}/${n} ` : ''
    const room = Math.max(4, cols - 4 - head.length)
    const text = line.slice(0, shown)
    const clipped = text.length > room ? text.slice(0, room - 1) + '…' : text
    detail = (
      <Text key="fail" wrap="truncate-end">
        <Text color="#ef4444">{'  ↳ '}</Text>
        <Text dimColor>{head}</Text>
        <Text color="#fca5a5">{clipped}</Text>
        <Text color="#fca5a5">{shown < line.length && t % 8 < 4 ? '▌' : ''}</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column">
      <Text key="chips" wrap="truncate-end">{nodes}</Text>
      {detail}
    </Box>
  )
}

export default Bench
