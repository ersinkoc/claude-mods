// Lofi's terminal band: one row, a bobbing note, `lofi · mood` and an
// equalizer that bumps on the loop's beat. ~30 fps on the surface; no `$`.
import type { ClientModule, ClientSurface } from 'claude-code'

import { BPM, TINT, eqBars, eqLevels, isMood } from './mood.ts'

export type EqProps = { mood: string; bands: number }
type S = { t: number }

/** The first frame: state at 0 and a ~30 fps tick that counts frames. */
function start(surface: ClientSurface<S>): S {
  let frame = 0
  surface.setState({ t: frame })
  surface.every(33, () => surface.setState({ t: ++frame }))
  return { t: frame }
}

const Eq: ClientModule<EqProps, S> = (props, surface) => {
  const { t } = surface.state ?? start(surface)
  const mood = isMood(props.mood) ? props.mood : 'focus'
  const bpm = BPM[mood]
  const beat = Math.floor((t / 30) * (bpm / 60))
  const bars = eqBars(eqLevels(Math.max(4, props.bands), t, bpm), mood)
  const [, hi] = TINT[mood]
  const { Text } = surface.elements
  return (
    <Text wrap="truncate-end">
      <Text color={hi} bold>{beat % 2 ? '♫' : '♪'}</Text>
      <Text> lofi</Text>
      <Text dimColor> · </Text>
      <Text color={hi}>{mood}</Text>
      <Text>  </Text>
      {bars.map((b, i) => (
        <Text key={`b${i}`} color={b.c}>{b.s}</Text>
      ))}
    </Text>
  )
}

export default Eq
