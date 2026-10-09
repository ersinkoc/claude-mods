import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HaloSnap } from '../types'
import type { LineProps } from './line.tsx'
import { moodOf, WAITING_TOOLS } from './mood.ts'
import type { SpinnerMode, StreamPhase } from './mood.ts'
import { haloSvg } from './svg.ts'

const snapAtom = atom({ plugin: 'halo', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'halo', key: 'isHidden' } as const, false)

// The facts the mood is computed from. Module variables start over on a reload.
//
// The spinner's mode comes from a `ui.render` hook on the Spinner, and a render
// hook must not write state. So that hook only stores the mode in a module
// variable (`spinner`) and passes the drawing on untouched; a 400 ms timer and
// every tool and turn event recompute the mood and publish it to $.state when
// it changed. The model's own stream (turn.step chunks) is the first source;
// the spinner fills in where no stream is in flight (the desktop's own words
// for a step, a request the engine retries).
let isWorking = false
let phase: StreamPhase | undefined
let spinner: { mode: SpinnerMode; at: number } | undefined
const running = new Map<number, { tool: string; at: number }>()
let toolSeq = 0
let failedAt: number | undefined
let published = ''

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const tools = [...running.values()].sort((a, b) => b.at - a.at)
  const mood = moodOf({
    now,
    isWorking,
    tool: tools.find(t => !WAITING_TOOLS.includes(t.tool))?.tool,
    isWaiting: tools.some(t => WAITING_TOOLS.includes(t.tool)),
    failedAt,
    phase,
    spinner,
  })
  const key = `${mood.mood}|${mood.color}|${mood.label}`
  if (key === published) return
  published = key
  const snap: HaloSnap = { ...mood, since: now }
  await update($, snapAtom, () => snap)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session only.
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  try {
    const v = await $.store.get('isHidden')
    if (typeof v === 'boolean') await update($, hiddenAtom, () => v)
  } catch {
    // Nothing stored.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    isWorking = false
    phase = undefined
    spinner = undefined
    running.clear()
    failedAt = undefined
    published = ''
    await $.command.register({ name: 'halo', description: 'KOZMOS: show or hide the Halo mood line above the prompt', immediate: true })
    await loadHidden($)
    await publish($)
    $.clock.every(400, () => void publish($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'halo' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Halo hidden. /halo brings it back.' : 'Halo shown.' }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    phase = undefined
    await publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      phase = undefined
      spinner = undefined
      await publish($)
    }
    return next(e)
  })

  // The main loop's request as it streams: requesting until the first chunk,
  // then thinking, writing or calling a tool by the chunk's kind.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    phase = 'requesting'
    void publish($).catch(() => undefined)
    const stream = next(e)
    try {
      let item = await stream.next()
      while (!item.done) {
        const c = item.value
        const now: StreamPhase | undefined = c.kind === 'thinking' ? 'thinking' : c.kind === 'text' ? 'responding' : c.kind === 'tool' || c.kind === 'input' ? 'tool-input' : undefined
        if (now && now !== phase) {
          phase = now
          void publish($).catch(() => undefined)
        }
        yield c
        item = await stream.next()
      }
      return item.value
    } finally {
      phase = undefined
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = ++toolSeq
    running.set(id, { tool: String(e.tool), at: await $.clock.now() })
    await publish($)
    try {
      const ran = await next(e)
      if (ran.isError === true || ran.deny !== undefined) failedAt = await $.clock.now()
      return ran
    } finally {
      running.delete(id)
      // The 400 ms timer ends the red flash once ERROR_MS has passed.
      void publish($).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  // Reads the spinner's mode and draws nothing of its own.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    spinner = { mode: e.props.mode, at: await $.clock.now() }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap) return drawn
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)

    if (e.surface === 'terminal') {
      const { Box, Button, Client } = $.ui.resolve(e)
      const props: LineProps = { mood: snap.mood, color: snap.color, label: snap.label }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="halo" flexDirection="row">
            <Client key="halo-line" module="./line.tsx" width={cols} height={1} props={props} />
            <Button key="halo-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    if ('Svg' in ui) {
      const { Box, Button, Svg } = ui
      const pic = haloSvg(snap, cols * 8 - 8, await $.clock.now())
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="halo" flexDirection="row">
            <Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
            <Button key="halo-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }
    return drawn
  })
}
