import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { OrbitAgent, OrbitStatus, OrrerySnap } from '../types'
import { pxOf } from './lib/kz.ts'
import { omegaOf, orreryAlt, orrerySvg } from './sky.ts'

const snapAtom = atom({ plugin: 'orrery', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'orrery', key: 'isHidden' } as const, false)

/** After the last agent finishes, the band lingers this long. */
const LINGER_MS = 5 * 60_000
/** Tokens per second are measured over this window. */
const RATE_MS = 20_000
const TAU = Math.PI * 2

type Sample = { at: number; n: number }
type Rec = OrbitAgent & { samples: Sample[] }

// Live collector; the band draws from the snapshot published to $.state.
let agents = new Map<string, Rec>()
let nextOrder = 0
let sun: Sample[] = []
let isWorking = false
let lastEnd = 0
let lastTick = 0
let ticks = 0
let lastKey = ''

function statusOf(s: AgentStatus): OrbitStatus {
  if (s === 'failed' || s === 'killed') return 'fail'
  if (s === 'completed' || s === 'idle') return 'done'
  return 'run'
}

function addAgent(id: string, desc: string, type: string, model: string, at: number): Rec {
  const known = agents.get(id)
  if (known) {
    known.desc ||= desc
    known.type = known.type === 'agent' && type ? type : known.type
    known.model ||= model
    return known
  }
  const order = nextOrder++
  const rec: Rec = {
    id, desc, type: type || 'agent', model, order, status: 'run', start: at, end: null,
    tps: 0, tokens: 0, angle: (order * 2.39996) % TAU, omega: omegaOf(0), samples: [],
  }
  agents.set(id, rec)
  return rec
}

function finish(rec: Rec, status: OrbitStatus, at: number): void {
  if (rec.status !== 'run' || status === 'run') return
  rec.status = status
  rec.end = at
  rec.tps = 0
  lastEnd = at
}

function rate(samples: readonly Sample[], now: number): number {
  return samples.filter(s => now - s.at < RATE_MS).reduce((n, s) => n + s.n, 0) / (RATE_MS / 1000)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; the session still honours it.
  }
}

async function reconcile($: EngineInterface, now: number): Promise<void> {
  try {
    for (const info of await $.agent.list()) {
      const status = statusOf(info.status)
      const rec = agents.get(info.id) ?? (status === 'run' ? addAgent(info.id, info.description, info.type, '', now) : undefined)
      if (!rec) continue
      rec.desc ||= info.description
      if (rec.type === 'agent' && info.type) rec.type = info.type
      finish(rec, status, now)
    }
  } catch {
    // The roster is not readable now; the hooks still track spawns.
  }
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const dt = lastTick ? Math.min(5000, now - lastTick) : 0
  lastTick = now
  ticks++
  const hasRunning = [...agents.values()].some(a => a.status === 'run')
  if (hasRunning ? ticks % 2 === 0 : ticks % 10 === 0) await reconcile($, now)
  for (const a of agents.values()) {
    a.samples = a.samples.filter(s => now - s.at < RATE_MS)
    if (a.status !== 'run') continue
    a.tps = rate(a.samples, now)
    a.omega = omegaOf(a.tps)
    a.angle = (a.angle + (a.omega * dt) / 1000) % TAU
  }
  sun = sun.filter(s => now - s.at < RATE_MS)
  await publish($, now)
}

async function publish($: EngineInterface, at?: number): Promise<void> {
  const now = at ?? (await $.clock.now())
  // Keep the running and the latest dozen finished.
  const all = [...agents.values()].sort((a, b) => a.order - b.order)
  const finished = all.filter(a => a.status !== 'run').slice(-12)
  const list = all.filter(a => a.status === 'run' || finished.includes(a))
  const snap: OrrerySnap = {
    now,
    agents: list.map(({ samples: _, ...a }) => ({ ...a, angle: Math.round(a.angle * 1000) / 1000, tps: Math.round(a.tps * 10) / 10 })),
    sunTps: Math.round(rate(sun, now)),
    isWorking,
    lastEnd,
  }
  const isMoving = list.some(a => a.status === 'run' || (a.status === 'fail' && a.end !== null && now - a.end < 5000))
  const isShown = list.length > 0 && (list.some(a => a.status === 'run') || now - lastEnd < LINGER_MS)
  const key = JSON.stringify({ ...snap, now: isMoving ? now : 0, isShown })
  if (key === lastKey) return
  await update($, snapAtom, () => snap)
  // Noted once written, so a refused write is tried again on the next tick.
  lastKey = key
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    agents = new Map()
    nextOrder = 0
    sun = []
    isWorking = false
    lastEnd = 0
    lastTick = 0
    ticks = 0
    lastKey = ''
    await $.command.register({ name: 'orrery', description: 'KOZMOS: show or hide the Orrery of subagents above the prompt', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // Fresh store.
    }
    await reconcile($, await $.clock.now())
    await publish($).catch(() => undefined)
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'orrery' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Orrery hidden.' : 'Orrery shown.' }
  })

  // A new planet: the spawn tells its task, type and model; the result its id.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if ('agentId' in r && typeof r.agentId === 'string') {
      addAgent(r.agentId, e.description, e.subagentType, r.model || e.model || '', await $.clock.now())
      void publish($).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    isWorking = true
    void publish($).catch(() => undefined)
    return next(e)
  })

  // Each model request's output tokens set its loop's speed (the sun's on the main loop).
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      const n = r.usage?.output_tokens ?? 0
      if (n > 0) {
        const at = await $.clock.now()
        if (e.agentId === undefined) sun.push({ at, n })
        else {
          const rec = agents.get(e.agentId) ?? addAgent(e.agentId, '', 'agent', e.model, at)
          rec.samples.push({ at, n })
          rec.tokens += n
          rec.model ||= e.model
        }
      }
    } catch {
      // A step without usage counts nothing.
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined) isWorking = false
    else {
      const rec = agents.get(e.agentId)
      if (rec) finish(rec, e.reason === 'answer' ? 'done' : 'fail', at)
    }
    void publish($, at).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || snap.agents.length === 0) return drawn
    const hasRunning = snap.agents.some(a => a.status === 'run')
    if (!hasRunning && snap.now - snap.lastEnd >= LINGER_MS) return drawn

    const { Box, Button } = $.ui.resolve(e)
    const hide = <Button key="orrery-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(e.props.bodyColumns)
      const H = e.props.maxRows >= 10 ? 112 : 92
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row">
            <Svg source={orrerySvg(snap.agents, snap.now, snap.sunTps, snap.isWorking, W, H)} alt={orreryAlt(snap.agents)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    const { Client } = $.ui.resolve(e)
    const cols = Math.max(40, e.props.bodyColumns || 80)
    const rows = e.props.maxRows >= 12 ? 5 : 4
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client
            key="orrery"
            module="./scene.tsx"
            width={cols - 2}
            height={rows}
            props={{ agents: snap.agents, now: snap.now, sunTps: snap.sunTps, isWorking: snap.isWorking, width: cols - 2, rows }}
          />
          {hide}
        </Box>
      </Box>
    )
  })
}
