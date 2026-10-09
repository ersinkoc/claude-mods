// Lofi's terminal band: one row, a bobbing note, `lofi · mood` and an
// equalizer that bumps on the loop's beat. ~30 fps on the surface; no `$`.
import type { ClientModule } from 'claude-code'

import { BPM, TINT, eqBars, eqLevels, isMood } from './mood.ts'

export type EqProps = { mood: string; bands: number }
type S = { t: number }

const Eq: ClientModule<EqProps, S> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0 })
    surface.every(33, () => surface.setState({ t: (surface.state?.t ?? 0) + 1 }))
  }
  const t = surface.state?.t ?? 0
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
