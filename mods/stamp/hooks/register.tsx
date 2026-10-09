import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderNode } from 'claude-code'

import type { StampChip, StampReceipt } from '../types'
import { KZ, costOf, fmtPct, fmtTokens, fmtUsd, pxOf, svg, svgText, textWidth, toolColor, toolGlyph } from './lib/kz.ts'

// How a TurnDuration line finds its turn
// ---------------------------------------
// The line's props carry no turn id: only the sampled word and `durationMs`.
// Every main-loop turn.complete appends a receipt, in order of completion,
// holding the same wall-clock `durationMs` the engine formats on that line.
// A line takes the receipt whose duration is closest to its own within a small
// tolerance (1.5 s or 3 %), the most recent one winning a tie, so two turns of
// equal length resolve to the later (the one drawn last). A line with no such
// receipt (a resumed transcript, a turn from before the mod loaded) keeps the
// engine's own text. The match needs no write while drawing, which a render
// hook may not do, and survives a reload: the receipts live in $.state.

const receiptsAtom = atom({ plugin: 'stamp', key: 'receipts' } as const, [])
const onAtom = atom({ plugin: 'stamp', key: 'isOn' } as const, true)
const KEEP = 120

type Pending = {
  turnId: string
  startedAt: number
  startCost?: number
  startCtx?: number
  tools: number
  families: Record<string, StampChip>
  /** The main loop's requests summed; undefined until one reports usage. */
  steps?: ModelUsage
  model: string
}

let current: Pending | undefined

const FAMILY_ORDER = ['shell', 'edit', 'read', 'search', 'agent', 'web', 'task', 'mcp', 'other']

function familyOf(tool: string): string {
  if (tool === 'Bash' || tool === 'PowerShell') return 'shell'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit') return 'edit'
  if (tool === 'Read') return 'read'
  if (tool === 'Glob' || tool === 'Grep' || tool === 'LSP') return 'search'
  if (tool === 'Agent' || tool === 'Task' || tool === 'Workflow') return 'agent'
  if (tool.startsWith('Web')) return 'web'
  if (tool.startsWith('Todo') || tool.startsWith('Task')) return 'task'
  if (tool.startsWith('mcp__')) return 'mcp'
  return 'other'
}

/** 42s, 1m 4s, 1h 2m: the way the engine's own line reads. */
function fmtTurn(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** The receipt a TurnDuration line of `durationMs` belongs to, or undefined. */
function matchReceipt(receipts: readonly StampReceipt[], durationMs: number): StampReceipt | undefined {
  const tolerance = Math.max(1500, durationMs * 0.03)
  let best: StampReceipt | undefined
  let bestDiff = Infinity
  for (const r of receipts) {
    const diff = Math.abs(r.durationMs - durationMs)
    if (diff <= tolerance && diff <= bestDiff) {
      best = r
      bestDiff = diff
    }
  }
  return best
}

type Seg = { text: string; kind: 'lead' | 'strong' | 'dim' | 'chip' | 'cost' | 'ctx'; color?: string }

/** The receipt as a list of segments both surfaces draw. */
function segments(r: StampReceipt, durationMs: number): Seg[] {
  const out: Seg[] = [{ text: '⏱ ', kind: 'lead', color: KZ.violet }, { text: fmtTurn(durationMs), kind: 'strong' }]
  if (r.tools > 0) {
    out.push({ text: ` · ${r.tools} tool${r.tools === 1 ? '' : 's'}`, kind: 'dim' })
    for (const c of r.chips) out.push({ text: `${toolGlyph(c.tool)}${c.n}`, kind: 'chip', color: toolColor(c.tool) })
  }
  if (r.inTokens !== undefined && r.outTokens !== undefined) {
    out.push({ text: ` · ↑${fmtTokens(r.inTokens)} ↓${fmtTokens(r.outTokens)} tok`, kind: 'dim' })
  }
  if (r.costUsd !== undefined) out.push({ text: ` · ${fmtUsd(r.costUsd)}`, kind: 'cost', color: KZ.yellow })
  if (r.ctxPercent !== undefined) {
    const d = r.ctxDelta !== undefined && Math.abs(r.ctxDelta) >= 1 ? ` (${r.ctxDelta > 0 ? '+' : ''}${Math.round(r.ctxDelta)}%)` : ''
    const color = r.ctxPercent >= 80 ? KZ.red : r.ctxPercent >= 60 ? KZ.amber : KZ.cyan
    out.push({ text: ` · ctx ${fmtPct(r.ctxPercent)}${d}`, kind: 'ctx', color })
  }
  if (r.reason === 'aborted') out.push({ text: ' · interrupted', kind: 'ctx', color: KZ.amber })
  else if (r.reason === 'error' || r.reason === 'refusal') out.push({ text: ` · ${r.reason}`, kind: 'ctx', color: KZ.red })
  return out
}

const NO_USAGE: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function sumUsage(a: ModelUsage | undefined, b: ModelUsage | null): ModelUsage | undefined {
  if (!b) return a
  const base = a ?? NO_USAGE
  return {
    input_tokens: base.input_tokens + b.input_tokens,
    output_tokens: base.output_tokens + b.output_tokens,
    cache_read_input_tokens: base.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: base.cache_creation_input_tokens + b.cache_creation_input_tokens,
  }
}

async function startTurn($: EngineInterface, turnId: string): Promise<void> {
  const p: Pending = { turnId, startedAt: await $.clock.now(), tools: 0, families: {}, model: '' }
  current = p
  try {
    const u = await $.session.usage()
    p.startCost = u.cost?.usd
    p.startCtx = u.context.percent
  } catch {
    // No figures at the start: the receipt leaves cost and the context change out.
  }
}

async function finishTurn(
  $: EngineInterface,
  e: { turnId: string; durationMs: number; reason: string; usage?: ModelUsage & { model: string } },
): Promise<void> {
  const p = current?.turnId === e.turnId ? current : undefined
  if (p) current = undefined
  const usage: ModelUsage | undefined = e.usage ?? p?.steps
  const model = e.usage?.model ?? p?.model ?? ''
  let endCost: number | undefined
  let ctx: number | undefined
  try {
    const u = await $.session.usage()
    endCost = u.cost?.usd
    ctx = u.context.percent
  } catch {
    // Keep what the turn's own usage says.
  }
  const delta = endCost !== undefined && p?.startCost !== undefined ? endCost - p.startCost : undefined
  const costUsd = delta !== undefined && delta >= 0 ? delta : usage ? costOf(model, usage) : undefined
  const chips = p
    ? FAMILY_ORDER.map(f => p.families[f]).filter((c): c is StampChip => c !== undefined)
    : []
  const receipt: StampReceipt = {
    turnId: e.turnId,
    durationMs: e.durationMs,
    endedAt: await $.clock.now(),
    reason: e.reason,
    tools: p?.tools ?? 0,
    chips,
    inTokens: usage ? usage.input_tokens + usage.cache_creation_input_tokens : undefined,
    outTokens: usage?.output_tokens,
    cacheRead: usage?.cache_read_input_tokens,
    costUsd,
    ctxPercent: ctx,
    ctxDelta: ctx !== undefined && p?.startCtx !== undefined ? ctx - p.startCtx : undefined,
  }
  await update($, receiptsAtom, prev => [...prev.filter(r => r.turnId !== receipt.turnId), receipt].slice(-KEEP))
}

async function setOn($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, onAtom, () => isOn)
  await $.store.set('isOn', isOn)
}

function lastText(r: StampReceipt | undefined): string {
  if (!r) return 'no turn finished yet'
  // A chip reads after a space, as the terminal draws it (` $2`).
  return segments(r, r.durationMs).map(s => (s.kind === 'chip' ? ' ' : '') + s.text).join('').replace(/\s+/g, ' ').trim()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    current = undefined
    await $.command.register({ name: 'stamp', description: 'KOZMOS: toggle the turn receipt (/stamp on|off|last)', argumentHint: '[on|off|last]', immediate: true })
    try {
      const stored = await $.store.get('isOn')
      await update($, onAtom, () => stored !== false)
    } catch {
      // Default on.
    }
    return started
  })

  on('command.run', { command: 'stamp' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'last') {
      const list = await read($, receiptsAtom)
      return { text: `Last turn: ${lastText(list[list.length - 1])}` }
    }
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, onAtom))
    await setOn($, isOn)
    return { text: isOn ? 'Stamp on: each finished turn closes with a receipt.' : 'Stamp off: the engine draws its own closing line.' }
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($, e.turnId).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined && current && current.turnId === e.turnId) {
      current.steps = sumUsage(current.steps, r.usage)
      current.model = r.usage?.model ?? e.model
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && current) {
      const tool = String(e.tool)
      const fam = familyOf(tool)
      current.tools++
      const c = current.families[fam]
      current.families[fam] = c ? { ...c, n: c.n + 1 } : { family: fam, tool, n: 1 }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) void finishTurn($, e).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, onAtom))) return next(e)
    const receipt = matchReceipt(await read($, receiptsAtom), e.props.durationMs)
    if (!receipt) return next(e)
    const segs = segments(receipt, e.props.durationMs)
    const ui = $.ui.resolve(e)
    const alt = `${e.props.word} for ${lastText({ ...receipt, durationMs: e.props.durationMs })}`

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.viewport?.columns, 90)
      const { source, width } = receiptSvg(segs, W)
      return <Svg source={source} alt={alt} width={width} height={22} />
    }

    const { Box, Text } = ui
    const parts: RenderNode[] = segs.map((s, i) => {
      if (s.kind === 'chip') return <Text key={`s${i}`} color={s.color}> {s.text}</Text>
      if (s.kind === 'strong') return <Text key={`s${i}`} bold>{s.text}</Text>
      if (s.kind === 'dim') return <Text key={`s${i}`} dimColor>{s.text}</Text>
      return <Text key={`s${i}`} color={s.color}>{s.text}</Text>
    })
    return (
      <Box flexDirection="row">
        <Text wrap="truncate-end">{parts}</Text>
      </Box>
    )
  })
}

/** The receipt as one SVG row: text segments and the family chips as pills. */
function receiptSvg(segs: readonly Seg[], maxW: number): { source: string; width: number } {
  const size = 12
  const body: string[] = []
  let x = 2
  for (const s of segs) {
    if (s.kind === 'chip') {
      const w = textWidth(s.text, 11) + 12
      body.push(`<rect x="${x + 4}" y="3" width="${w}" height="16" rx="8" fill="${s.color}" opacity=".18"/>`)
      body.push(svgText(x + 4 + w / 2, 15, s.text, { size: 11, weight: 650, anchor: 'middle', fill: s.color }))
      x += w + 4
      continue
    }
    const opts = s.kind === 'strong'
      ? { size, weight: 650 }
      : s.kind === 'dim'
        ? { cls: 's', size }
        : { size, weight: 600, fill: s.color }
    body.push(svgText(x, 15, s.text, opts))
    x += textWidth(s.text, size)
  }
  const width = Math.min(maxW, Math.ceil(x + 6))
  return { source: svg(width, 22, body.join('')), width }
}
