import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CompassSnap } from '../types'
import { fmtSpan, untilReset } from './lib/kz.ts'
import { GIT_STATUS, parseGitStatus } from './lib/probe.ts'

const blank = (): CompassSnap => ({ agentsRunning: 0, isRepo: false, changedFiles: 0, edits: 0, idleMin: 0, now: 0 })
const snapAtom = atom({ plugin: 'compass', key: 'snap' } as const, blank())
const onAtom = atom({ plugin: 'compass', key: 'isOn' } as const, true)

const LIMIT_AT = 90
const CTX_AT = 80
const DRAFT_IDLE_MIN = 3
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

let live: CompassSnap = blank()
let lastActivity = 0
let tick = 0
let lastPublished = ''

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number, cwd?: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, cwd ? { timeoutMs, cwd } : { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  live.idleMin = Math.floor((now - lastActivity) / 60_000)
  live.now = Math.floor(now / 60_000) * 60_000
  const key = JSON.stringify(live)
  if (key === lastPublished) return
  lastPublished = key
  const snap: CompassSnap = { ...live, fiveHour: live.fiveHour ? { ...live.fiveHour } : undefined }
  await update($, snapAtom, () => snap)
}

async function sample($: EngineInterface): Promise<void> {
  tick++
  try {
    const u = await $.session.usage()
    const five = u.rateLimits.find(l => l.kind === 'five_hour')
    live.fiveHour = five ? { percent: five.percentUsed, resetsAt: five.resetsAt } : undefined
    live.ctxPercent = u.context.percent
  } catch {
    // Keep the last reading.
  }
  try {
    const agents = await $.agent.list()
    live.agentsRunning = agents.filter(a => a.status === 'running' || a.status === 'pending').length
  } catch {
    // Keep the last count.
  }
  // Git every 10 s (each fifth 2 s tick), once this session has edited a file:
  // until then the commit hint cannot apply and no process is spawned.
  if (live.edits > 0 && tick % 5 === 1) {
    const out = await sh($, GIT_STATUS, 5000, await $.session.cwd())
    if (out === undefined) {
      live.isRepo = false
      live.changedFiles = 0
    } else {
      const g = parseGitStatus(out)
      live.isRepo = g.isRepo
      live.changedFiles = g.staged + g.unstaged + g.untracked + g.conflicts
    }
  }
  await publish($)
}

/** The one hint worth the line now, or undefined to leave the engine's. */
function pickHint(s: CompassSnap, isDraft: boolean, isWorking: boolean): string | undefined {
  if (s.fiveHour && s.fiveHour.percent >= LIMIT_AT) {
    const left = untilReset({ kind: 'five_hour', percentUsed: s.fiveHour.percent, resetsAt: s.fiveHour.resetsAt }, s.now)
    const pct = Math.round(s.fiveHour.percent)
    return left !== undefined ? `5h ${pct}% — resets in ${fmtSpan(left)}` : `5h ${pct}% used`
  }
  if (s.ctxPercent !== undefined && s.ctxPercent >= CTX_AT) return `ctx ${Math.round(s.ctxPercent)}% — /compact soon`
  if (s.agentsRunning > 0) return `◈ ${s.agentsRunning} agent${s.agentsRunning === 1 ? '' : 's'} working`
  if (!isWorking && s.edits > 0 && s.isRepo && s.changedFiles > 0) return `✎ ${s.changedFiles} file${s.changedFiles === 1 ? '' : 's'} changed — commit?`
  if (!isWorking && isDraft && s.idleMin >= DRAFT_IDLE_MIN) return `⏎ draft waiting ${s.idleMin}m — enter sends it`
  return undefined
}

async function setOn($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, onAtom, () => isOn)
  await $.store.set('isOn', isOn)
}

async function touch($: EngineInterface): Promise<void> {
  lastActivity = await $.clock.now()
  await publish($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank()
    tick = 0
    lastPublished = ''
    lastActivity = await $.clock.now()
    await $.command.register({ name: 'compass', description: 'KOZMOS: toggle the contextual hint under the prompt (/compass on|off)', argumentHint: '[on|off]', immediate: true })
    try {
      const stored = await $.store.get('isOn')
      await update($, onAtom, () => stored !== false)
    } catch {
      // Default on.
    }
    await sample($).catch(() => undefined)
    $.clock.every(2000, () => void sample($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'compass' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, onAtom))
    await setOn($, isOn)
    const s = await read($, snapAtom)
    const now = pickHint(s, false, false)
    return { text: isOn ? `Compass on.${now ? ` Now: ${now}` : ' Nothing to flag right now.'}` : 'Compass off: the hint line is the engine’s.' }
  })

  on('turn.start', async ($, e, next) => {
    void touch($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) void touch($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDIT_TOOLS.includes(String(e.tool)) && ran.deny === undefined && ran.isError !== true) {
      const isFirst = live.edits === 0
      live.edits++
      // The first edit probes git on the next tick rather than 10 s later.
      if (isFirst) tick = 0
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const p = e.props
    if (!(await read($, onAtom))) return next(e)
    const hint = pickHint(await read($, snapAtom), p.isDraft === true, p.isWorking === true)
    if (!hint) return next(e)
    if (e.surface === 'terminal') {
      // The terminal keeps its own line (its pills stay live) and draws `tail` dim after it.
      const tail = p.tail ? `${p.tail} · ${hint}` : `· ${hint}`
      return next({ ...e, props: { ...p, tail } })
    }
    // Other surfaces draw no tail yet: the hint leads the line.
    return next({ ...e, props: { ...p, hint: p.hint ? `${hint} · ${p.hint}` : hint } })
  })
}
