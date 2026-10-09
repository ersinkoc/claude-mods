import type { EngineInterface, Register } from 'claude-code'

import { toolDetail } from './lib/kz.ts'
import { GIT_HEAD, GIT_STATUS, parseGitStatus } from './lib/probe.ts'
import { buildSegments, parseSegments, scrolls, windowAt } from './ticker.ts'
import type { SegmentName, TickerData, TickerGit } from './ticker.ts'

const TICK_MS = 1000
const GIT_MS = 10_000
/** Characters the line moves per tick while it scrolls. */
const SCROLL_STEP = 2
const STORE_KEY = 'enabled'

let live: TickerData = { limits: [], now: 0 }
let isEnabled = true
let order: SegmentName[] = []
let width = 110
let tick = 0
let lastText: string | undefined
let gitAt = -Infinity
let isGitBusy = false

// ---------------------------------------------------------------------------
// The git probe, wrapped as bridge does: $.process.run in try/catch, the text
// handed to lib/probe.ts.

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number, cwd?: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, cwd ? { timeoutMs, cwd } : { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

async function readGit($: EngineInterface, cwd: string): Promise<TickerGit | undefined> {
  const status = await sh($, GIT_STATUS, 5000, cwd)
  if (status === undefined) return undefined
  const g = parseGitStatus(status, (await sh($, GIT_HEAD, 3000, cwd)) ?? '')
  return { branch: g.branch, ahead: g.ahead, behind: g.behind, dirty: g.staged + g.unstaged + g.untracked + g.conflicts }
}

async function refreshGit($: EngineInterface): Promise<void> {
  if (isGitBusy) return
  isGitBusy = true
  try {
    live.git = await readGit($, await $.session.cwd())
  } finally {
    isGitBusy = false
  }
}

// ---------------------------------------------------------------------------

/** One beat: read what moved, build the line, show it when it changed. */
async function beat($: EngineInterface): Promise<void> {
  if (!isEnabled) return
  const now = await $.clock.now()
  live.now = now
  try {
    const usage = await $.session.usage()
    live.ctxPercent = usage.context.percent
    live.limits = usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    live.costUsd = usage.cost?.usd
  } catch {
    // Kept as it was.
  }
  try {
    live.model = (await $.session.model()) || live.model
  } catch {
    // Kept as it was.
  }
  if (order.includes('git') && now - gitAt >= GIT_MS) {
    gitAt = now
    void refreshGit($).catch(() => undefined)
  }
  show($)
}

function show($: EngineInterface): void {
  if (!isEnabled) return
  const segments = buildSegments(live, order)
  const text = segments.length ? windowAt(segments, width, tick, SCROLL_STEP) : undefined
  if (segments.length && scrolls(segments, width)) tick++
  else tick = 0
  if (text === lastText) return
  lastText = text
  $.ui.status(text)
}

async function toggle($: EngineInterface): Promise<boolean> {
  isEnabled = !isEnabled
  await $.store.set(STORE_KEY, isEnabled)
  if (isEnabled) {
    lastText = undefined
    gitAt = -Infinity
    await beat($)
  } else {
    lastText = undefined
    $.ui.status(undefined)
  }
  return isEnabled
}

export const register: Register = (on, options) => {
  // The engine checks the options against plugin.json and fills in its
  // defaults: `segments` is always a string, `width` a finite number.
  order = parseSegments(String(options.segments))
  width = Math.max(20, Number(options.width))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = { limits: [], now: await $.clock.now() }
    tick = 0
    lastText = undefined
    gitAt = -Infinity
    isGitBusy = false
    try {
      isEnabled = (await $.store.get(STORE_KEY)) !== false
    } catch {
      isEnabled = true
    }
    await $.command.register({ name: 'marquee', description: 'KOZMOS: toggle the Marquee status-line ticker', immediate: true })
    $.clock.every(TICK_MS, () => void beat($).catch(() => undefined))
    await beat($).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'marquee' }, async $ => ({
    text: (await toggle($)) ? 'Marquee on.' : 'Marquee off.',
  }))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort !== undefined) live.effort = String(e.effort)
      // The engine never starts a step without a model name.
      live.model = e.model
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || !isEnabled) return next(e)
    const name = String(e.tool)
    const at = await $.clock.now()
    live.tool = { name, detail: toolDetail(name, e), startedAt: at }
    live.now = at
    show($)
    try {
      return await next(e)
    } finally {
      if (live.tool?.startedAt === at) live.tool = undefined
      // A Bash or an edit may have moved git: look again on the next beat.
      if (name === 'Bash' || name === 'PowerShell' || name === 'Edit' || name === 'Write') gitAt = -Infinity
      live.now = await $.clock.now()
      show($)
    }
  }).catch(($, e, next) => next(e))
}
