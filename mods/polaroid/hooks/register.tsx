import type { EngineInterface, Register } from 'claude-code'

import { clip, costOf, tokensOf } from './lib/kz.ts'
import { addTokens, buildHtml, buildMarkdown, emptyReport, familyOf, fileTouch, joinPath, reportStem } from './report.ts'
import type { ReportAgent, ReportData, ReportFile, ReportLimit } from './report.ts'

// The live collector. Module state starts over on a reload; session.start resets it.
let data: ReportData = emptyReport(0)
let openTurn: { index: number; prompt: string; startedAt: number; tools: number } | null = null
let agents = new Map<string, ReportAgent>()
let files = new Map<string, ReportFile>()
let limits = new Map<string, ReportLimit>()
let lastCtx = -1

const MAX_SERIES = 360
const MAX_COMMANDS = 200
const MAX_TURNS = 500

function reset(now: number): void {
  data = emptyReport(now)
  openTurn = null
  agents = new Map()
  files = new Map()
  limits = new Map()
  lastCtx = -1
}

function noteModel(model: string): void {
  if (!model) return
  if (!data.model) data.model = model
  if (!data.models.includes(model)) data.models.push(model)
}

function noteContext(at: number, percent: number | undefined, tokens: number | undefined, window: number): void {
  if (percent === undefined) return
  data.ctxWindow = window
  if (data.ctxPeakPercent === undefined || percent >= data.ctxPeakPercent) {
    data.ctxPeakPercent = percent
    data.ctxPeakTokens = tokens
  }
  if (Math.abs(percent - lastCtx) < 0.5) return
  lastCtx = percent
  data.ctxSeries.push([Math.max(0, at - data.startedAt), percent])
  // Keep the series bounded: drop every other point of the older half.
  if (data.ctxSeries.length > MAX_SERIES) {
    const half = Math.floor(data.ctxSeries.length / 2)
    data.ctxSeries = [...data.ctxSeries.slice(0, half).filter((_, i) => i % 2 === 0), ...data.ctxSeries.slice(half)]
  }
}

function noteLimits(rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): void {
  for (const l of rateLimits) {
    const prev = limits.get(l.kind)
    limits.set(l.kind, { kind: l.kind, percentUsed: l.percentUsed, peak: Math.max(prev?.peak ?? 0, l.percentUsed), resetsAt: l.resetsAt })
  }
}

/** Reads what the engine knows now and freezes the report at this moment. */
async function snapshot($: EngineInterface): Promise<ReportData> {
  const now = await $.clock.now()
  try {
    const usage = await $.session.usage()
    data.startedAt = Math.min(data.startedAt, usage.startedAt || data.startedAt)
    data.costUsd = usage.cost?.usd
    noteContext(now, usage.context.percent, usage.context.tokens, usage.context.window)
    noteLimits(usage.rateLimits)
  } catch {
    // Keep what the hooks collected.
  }
  try {
    const model = await $.session.model()
    noteModel(model)
    if (model) data.model = model
  } catch {
    // The first model seen stands.
  }
  try {
    data.version = (await $.session.version()).version
  } catch {
    // Unknown version.
  }
  try {
    data.root = await $.session.root()
  } catch {
    // No root known.
  }
  const turns = [...data.turns]
  if (openTurn) {
    turns.push({ index: openTurn.index, prompt: openTurn.prompt, startedAt: openTurn.startedAt, durationMs: now - openTurn.startedAt, tools: openTurn.tools, tokens: 0, usd: 0, reason: 'running' })
  }
  return {
    ...data,
    endedAt: now,
    turns,
    agents: [...agents.values()].map(a => (a.status === 'running' ? { ...a, durationMs: now - a.startedAt } : a)),
    files: [...files.values()],
    limits: [...limits.values()],
    families: { ...data.families },
    toolNames: { ...data.toolNames },
    commands: [...data.commands],
    ctxSeries: [...data.ctxSeries],
    models: [...data.models],
  }
}

async function shoot($: EngineInterface, format: 'html' | 'md'): Promise<string> {
  const report = await snapshot($)
  const now = report.endedAt
  const root = report.root || (await $.session.cwd())
  const path = joinPath(root, '.kozmos', 'reports', `${reportStem(now)}.${format}`)
  await $.fs.write(path, format === 'html' ? buildHtml(report, now) : buildMarkdown(report, now))
  let copied = false
  try {
    copied = (await $.ui.copy({ text: path })).isCopied === true
  } catch {
    copied = false
  }
  return `Polaroid ${format === 'html' ? 'report' : 'Markdown'} saved: ${path}${copied ? '\n(path copied to the clipboard)' : ''}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    reset(await $.clock.now())
    await $.command.register({
      name: 'polaroid',
      description: 'KOZMOS: snapshot this session as a self-contained HTML report in .kozmos/reports (/polaroid md for Markdown)',
      argumentHint: '[md]',
      immediate: true,
    })
    return started
  })

  on('command.run', { command: 'polaroid' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const format = arg === 'md' || arg === 'markdown' ? 'md' : 'html'
    try {
      return { text: await shoot($, format) }
    } catch (err) {
      return { text: `Polaroid could not write the report: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('command.run', async ($, e, next) => {
    if (e.command !== 'polaroid' && data.commands.length < MAX_COMMANDS) {
      data.commands.push({ name: e.command, args: clip(e.args, 120), at: await $.clock.now() })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    const prompt = clip(e.text, 200)
    if (!data.title && prompt) data.title = clip(prompt, 80)
    openTurn = { index: data.turns.length + 1, prompt, startedAt: at, tools: 0 }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    noteModel(e.model)
    const r = yield* next(e)
    if (r.usage) {
      data.tokens = addTokens(data.tokens, r.usage)
      data.requests++
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    const usd = e.usage ? costOf(e.usage.model, e.usage) : 0
    const tokens = e.usage ? tokensOf(e.usage) : 0
    if (e.agentId === undefined) {
      if (openTurn && data.turns.length < MAX_TURNS) {
        data.turns.push({ index: openTurn.index, prompt: openTurn.prompt, startedAt: openTurn.startedAt, durationMs: e.durationMs, tools: openTurn.tools, tokens, usd, reason: e.reason })
      }
      openTurn = null
    } else {
      const a = agents.get(e.agentId)
      if (a) {
        a.durationMs = Math.max(a.durationMs, at - a.startedAt)
        a.tokens += tokens
        a.usd += usd
        a.status = e.reason === 'answer' ? 'done' : 'failed'
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const at = await $.clock.now()
    const r = await next(e)
    if (r.deny === undefined && r.agentId) {
      agents.set(r.agentId, { id: r.agentId, type: e.subagentType, description: clip(e.description, 80), model: r.model, startedAt: at, durationMs: 0, tokens: 0, usd: 0, status: 'running' })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const fam = familyOf(tool)
    data.families[fam] = (data.families[fam] ?? 0) + 1
    data.toolNames[tool] = (data.toolNames[tool] ?? 0) + 1
    if (e.agentId === undefined && openTurn) openTurn.tools++
    const touch = fileTouch(tool, e as unknown as Record<string, unknown>)
    if (touch) {
      const f = files.get(touch.path) ?? { path: touch.path, reads: 0, edits: 0, writes: 0 }
      f[touch.kind]++
      files.set(touch.path, f)
    }
    const ran = await next(e)
    if (ran.isError === true || ran.deny !== undefined) data.toolErrors++
    return ran
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const at = await $.clock.now()
    noteContext(at, e.context.percent, e.context.tokens, e.context.window)
    noteLimits(e.rateLimits)
    if (e.cost) data.costUsd = e.cost.usd
    return next(e)
  })
}
