// Thrift's terminal coin: a Client surface module that spins a gold coin
// edge-on and back, about eight frames a second. No `$` here.
import type { ClientModule } from 'claude-code'

export type CoinProps = { isOn: boolean }

type CoinState = { f: number }

/** The coin seen turning: face, narrowing, edge, widening, the other face. */
export const FRAMES: readonly [string, string][] = [
  ['●', '#facc15'],
  ['◗', '#fbbf24'],
  ['▐', '#f59e0b'],
  ['│', '#d97706'],
  ['▌', '#f59e0b'],
  ['◖', '#fbbf24'],
]

const Coin: ClientModule<CoinProps, CoinState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ f: 0 })
    surface.every(125, () => surface.setState({ f: ((surface.state?.f ?? 0) + 1) % FRAMES.length }))
  }
  const { Text } = surface.elements
  const [ch, color] = FRAMES[surface.state?.f ?? 0] ?? FRAMES[0] ?? ['●', '#facc15']
  return <Text bold color={props.isOn ? color : '#9ca3af'}>{ch}</Text>
}

export default Coin
