import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ThrottleSnap } from '../types'
import type { DashProps } from './dash.tsx'
import { CHARS_PER_TOKEN, fuelLeft, lamps, prune, speedScale, tokensPerSec } from './model.ts'
import type { Span } from './model.ts'
import { dashSvg } from './svg.ts'

const snapAtom = atom({ plugin: 'throttle', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'throttle', key: 'isHidden' } as const, false)

const SHOW_AFTER_MS = 60_000
const AGENT_RECENT_MS = 5_000

// ---------------------------------------------------------------------------
// The live collector. Module variables start over on a reload; session.start
// fills them again. The band draws only from the published snapshot.

type Flight = { agentId?: string; first: number; chars: number }

let spans: Span[] = []
const flights = new Map<number, Flight>()
let flightSeq = 0
let isMainWorking = false
let lastActiveAt = 0
let failedAt: number | undefined
let agentSeen = new Map<string, number>()
let peaks: { at: number; v: number }[] = []
let fuel: number | null = null
let temp: number | null = null
let odo: number | null = null
let published: ThrottleSnap | null = null
let publishedKey = ''

function reset(): void {
  spans = []
  flights.clear()
  isMainWorking = false
  lastActiveAt = 0
  failedAt = undefined
  agentSeen = new Map()
  peaks = []
  fuel = temp = odo = null
  published = null
  publishedKey = ''
}

async function readUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    fuel = fuelLeft(u.rateLimits)
    temp = u.context.percent ?? null
    odo = u.cost?.usd ?? null
  } catch {
    // Keep the last reading.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const live: Span[] = [...spans]
  for (const f of flights.values()) if (f.first > 0 && f.chars > 0) live.push({ s: f.first, e: now, tok: f.chars / CHARS_PER_TOKEN })
  const speed = Math.round(tokensPerSec(live, now))
  peaks = [...peaks.filter(p => now - p.at < 60_000), { at: now, v: speed }]
  const agents = [...agentSeen.values()].filter(at => now - at < AGENT_RECENT_MS).length
  const inFlightAgents = new Set([...flights.values()].map(f => f.agentId).filter(Boolean)).size
  const isWorking = isMainWorking || flights.size > 0 || agents > 0
  if (isWorking) lastActiveAt = now
  const isVisible = lastActiveAt > 0 && (isWorking || now - lastActiveAt < SHOW_AFTER_MS)
  const next: ThrottleSnap = {
    isVisible,
    isWorking,
    speed,
    speedPrev: published?.speed ?? 0,
    speedMax: speedScale(Math.max(...peaks.map(p => p.v))),
    fuel: fuel === null ? null : Math.round(fuel),
    fuelPrev: published?.fuel ?? null,
    temp: temp === null ? null : Math.round(temp),
    tempPrev: published?.temp ?? null,
    odo: odo === null ? null : Math.round(odo * 100) / 100,
    odoPrev: published?.odo ?? null,
    lamps: lamps(now, failedAt, fuel, temp),
    agents: Math.max(agents, inFlightAgents),
    idleMs: isWorking ? 0 : Math.round((now - lastActiveAt) / 1000) * 1000,
  }
  // Compare without the previous readings, so a still dashboard never redraws.
  const key = JSON.stringify({ ...next, speedPrev: 0, fuelPrev: 0, tempPrev: 0, odoPrev: 0 })
  if (key === publishedKey) return
  publishedKey = key
  published = next
  await update($, snapAtom, () => next)
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  spans = prune(spans, now)
  // The figures only matter while the band shows (or is about to).
  if (published?.isVisible || isMainWorking || flights.size > 0) await readUsage($)
  await publish($)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // The band still hides for this session.
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

async function markActive($: EngineInterface): Promise<void> {
  lastActiveAt = await $.clock.now()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    reset()
    await $.command.register({ name: 'throttle', description: 'KOZMOS: show or hide the Throttle dashboard above the prompt', immediate: true })
    await loadHidden($)
    await readUsage($)
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'throttle' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Throttle hidden. /throttle brings it back.' : 'Throttle shown: it appears while Claude works and for a minute after.' }
  })

  on('turn.start', async ($, e, next) => {
    isMainWorking = true
    await markActive($)
    void publish($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isMainWorking = false
      await markActive($)
      void tick($).catch(() => undefined)
    }
    return next(e)
  })

  // Every model request, main loop and agents: the streamed characters give a
  // live estimate, the response's usage the exact count once it ends.
  on('turn.step', async function* ($, e, next) {
    const id = ++flightSeq
    const flight: Flight = { agentId: e.agentId, first: 0, chars: 0 }
    flights.set(id, flight)
    const stream = next(e)
    try {
      let item = await stream.next()
      while (!item.done) {
        const c = item.value
        const n = c.kind === 'text' || c.kind === 'thinking' ? c.text.length : c.kind === 'input' ? c.json.length : 0
        if (n > 0) {
          if (flight.first === 0) flight.first = await $.clock.now()
          flight.chars += n
          if (e.agentId !== undefined) agentSeen.set(e.agentId, flight.first)
        }
        yield c
        item = await stream.next()
      }
      const result = item.value
      const end = await $.clock.now()
      const tok = result.usage?.output_tokens ?? flight.chars / CHARS_PER_TOKEN
      if (tok > 0) spans.push({ s: flight.first || end - 1000, e: end, tok })
      if (e.agentId !== undefined) agentSeen.set(e.agentId, end)
      lastActiveAt = end
      return result
    } finally {
      flights.delete(id)
    }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError === true || ran.deny !== undefined) {
      failedAt = await $.clock.now()
      void publish($).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || !snap.isVisible) return drawn
    const cols = Math.max(20, e.props.bodyColumns || 80)

    if (e.surface === 'terminal') {
      const { Box, Button, Client } = $.ui.resolve(e)
      const props: DashProps = {
        speed: snap.speed,
        speedMax: snap.speedMax,
        fuel: snap.fuel,
        temp: snap.temp,
        odo: snap.odo,
        engine: snap.lamps.engine,
        fuelLow: snap.lamps.fuel,
        heat: snap.lamps.heat,
        working: snap.isWorking,
        agents: snap.agents,
        idleSec: Math.round(snap.idleMs / 1000),
      }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="throttle" flexDirection="row">
            <Client key="throttle-dash" module="./dash.tsx" width={cols - 3} height={2} props={props} />
            <Button key="throttle-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    // Every other surface draws SVG.
    const { Box, Button, Svg } = $.ui.resolve(e)
    const pic = dashSvg(snap, Math.max(240, (cols - 3) * 8 - 8))
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="throttle" flexDirection="row">
          <Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
          <Button key="throttle-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
        </Box>
      </Box>
    )
  })
}
