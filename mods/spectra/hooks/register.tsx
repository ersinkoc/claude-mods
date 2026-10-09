import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpCategory, SpSnap } from '../types'
import {
  Canvas, KZ, brailleGraph, clamp01, fitText, fmtPct, fmtTokens, heat, modelName, pxOf, svg, svgText, xml,
} from './lib/kz.ts'
import { ASSUMED_COMPACT, growthSlope, ranked, thresholdOf, toCategories, toGrid, turnsUntil } from './calc.ts'

const PANE = 'kz-spectra'
const TITLE = 'KOZMOS · Spectra'
const snapAtom = atom({ plugin: 'spectra', key: 'snap' } as const, null)

const blank = (now: number): SpSnap => ({
  now,
  startedAt: now,
  model: '',
  window: 0,
  total: 0,
  percentage: 0,
  threshold: 0,
  thresholdSource: 'assumed',
  isAutoCompact: true,
  categories: [],
  grid: [],
  growth: [],
  memoryFiles: 0,
  mcpTools: 0,
  hasBreakdown: false,
  updatedAt: now,
})

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

let live: SpSnap = blank(0)
let lastPublished = ''

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify({ ...live, now: 0, updatedAt: 0 })
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => JSON.parse(JSON.stringify(live)) as SpSnap)
}

/**
 * Reads the breakdown (an estimate, `summary`: no request leaves). With
 * `record`, also notes the context size this main turn ended at.
 */
async function refresh($: EngineInterface, record: boolean): Promise<void> {
  live.now = await $.clock.now()
  try {
    const u = await $.session.usage({ breakdown: 'summary', columns: 120 })
    live.startedAt = u.startedAt
    const b = u.context.breakdown
    if (b) {
      const window = b.rawMaxTokens || b.maxTokens || u.context.window
      live.window = window
      live.total = b.totalTokens
      live.percentage = b.percentage
      live.model = b.model
      live.isAutoCompact = b.isAutoCompactEnabled
      const t = thresholdOf(b.isAutoCompactEnabled ? b.autoCompactThreshold : window, window)
      live.threshold = t.tokens
      live.thresholdSource = b.isAutoCompactEnabled ? t.source : 'engine'
      live.categories = toCategories(b.categories, window)
      live.grid = toGrid(b.gridRows, live.categories)
      live.memoryFiles = b.memoryFiles.length
      live.mcpTools = b.mcpTools.length
      live.hasBreakdown = true
    } else {
      live.window = u.context.window
      live.total = u.context.tokens ?? 0
      live.percentage = u.context.percent ?? 0
      const t = thresholdOf(undefined, live.window)
      live.threshold = t.tokens
      live.thresholdSource = t.source
    }
    if (record) {
      const tokens = u.context.tokens ?? live.total
      if (tokens > 0) live.growth = [...live.growth, tokens].slice(-48)
    }
  } catch {
    // Keep what we had.
  }
  const slope = growthSlope(live.growth)
  live.slope = slope === undefined ? undefined : Math.round(slope)
  const current = live.growth[live.growth.length - 1] ?? live.total
  live.turnsLeft = turnsUntil(current, live.threshold, slope)
  live.updatedAt = live.now
  await publish($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    const prev = await read($, snapAtom).catch(() => null)
    live = blank(now)
    lastPublished = ''
    try {
      const u = await $.session.usage()
      if (prev && prev.startedAt === u.startedAt) live.growth = prev.growth
    } catch {
      // A fresh series.
    }
    await $.command.register({ name: 'spectra', description: 'KOZMOS: toggle the Spectra context X-ray sidebar', immediate: true })
    await refresh($, false).catch(() => undefined)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'spectra' }, async $ => {
    const opened = await toggle($)
    if (opened) await refresh($, false).catch(() => undefined)
    return { text: opened ? 'Spectra open.' : 'Spectra closed.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refresh($, true).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const order = ranked(s.categories).filter(c => c.kind !== 'deferred')

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const cards = [gridCard(s, W), legendCard(s, order, W), growthCard(s, W)]
      return (
        <Box flexDirection="column">
          {cards.map((c, i) => <Svg key={`c${i}`} source={c.source} alt={c.alt} width={W} height={c.height} isInteractive={c.isInteractive} />)}
        </Box>
      )
    }

    // ---- terminal ----
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const gridW = s.grid[0]?.length ?? 0
    const cell = gridW > 0 && gridW * 2 <= cols ? 2 : 1
    const rule = (label: string) => (
      <Text key={`r-${label}`} color={KZ.mist}>{`── ${label} `}{'─'.repeat(Math.max(0, cols - label.length - 4))}</Text>
    )
    const nameW = Math.max(8, Math.min(18, cols - 24))
    const barW = Math.max(3, cols - nameW - 17)
    const maxUsed = Math.max(1, ...order.filter(c => c.kind === 'used').map(c => c.tokens))
    const graphW = Math.max(8, Math.min(cols - 2, 40))
    const graph = s.growth.length > 1 ? brailleGraph(s.growth, graphW, 2, Math.max(s.threshold, ...s.growth)) : []
    const fill = s.window > 0 ? s.total / s.window : 0

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={heat(fill)}>◆ {fmtPct(s.percentage)} context</Text>
          <Text dimColor>{fmtTokens(s.total)} / {fmtTokens(s.window)}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">{modelName(s.model)} · {s.memoryFiles} memory files · {s.mcpTools} MCP tools</Text>
        {s.grid.length > 0 && 'Raster' in ui
          ? <ui.Raster key="grid" columns={Math.min(cols, gridW * cell)} rows={s.grid.length} cells={gridRaster(s, cell, Math.min(cols, gridW * cell)).encode()} />
          : <Text dimColor>{s.hasBreakdown ? '' : 'the breakdown arrives after the first reply'}</Text>}
        {rule('by category')}
        {order.map(c => (
          <Box key={`c-${c.name}`} flexDirection="row">
            <Text color={c.color}>{c.kind === 'free' ? '·' : c.kind === 'buffer' ? '░' : '■'} </Text>
            <Box width={nameW} flexShrink={0}><Text wrap="truncate-end" dimColor={c.kind !== 'used'}>{c.name}</Text></Box>
            <Text wrap="truncate-end">
              <Text>{fmtTokens(c.tokens).padStart(6)}</Text>
              <Text dimColor>{fmtPct(c.pct).padStart(5)} </Text>
              {c.kind === 'used' ? <Text color={c.color}>{'▬'.repeat(Math.max(1, Math.round((c.tokens / maxUsed) * barW)))}</Text> : ''}
            </Text>
          </Box>
        ))}
        {rule('growth per turn')}
        {graph.length
          ? graph.map((line, i) => <Text key={`g${i}`} color={KZ.cyan}>{line}</Text>)
          : <Text dimColor>a point lands at the end of each turn</Text>}
        <Text wrap="truncate-end">
          <Text color={KZ.cyan}>{s.slope !== undefined ? `${s.slope >= 0 ? '+' : ''}${fmtTokens(Math.abs(s.slope))}/turn` : 'Δ —'}</Text>
          <Text color={compactColor(s.turnsLeft)}> · {forecastLine(s)}</Text>
        </Text>
        <Text dimColor wrap="truncate-end">
          {s.isAutoCompact
            ? `compacts at ${fmtTokens(s.threshold)}${s.thresholdSource === 'assumed' ? ` (assumed ${Math.round(ASSUMED_COMPACT * 100)}% of window)` : ''}`
            : 'auto-compact is off: the window is the wall'}
        </Text>
      </Box>
    )
  })
}

const compactColor = (n: number | undefined): string => (n === undefined ? KZ.mist : n <= 3 ? KZ.red : n <= 10 ? KZ.amber : KZ.green)

function forecastLine(s: SpSnap): string {
  const what = s.isAutoCompact ? 'auto-compact' : 'window full'
  if (s.turnsLeft === undefined) return s.growth.length < 2 ? 'forecast after two turns' : `${what}: not approaching`
  if (s.turnsLeft === 0) return `${what} now`
  return `${what} in ~${s.turnsLeft} turn${s.turnsLeft === 1 ? '' : 's'}`
}

/** The grid in colored cells: ■ full, □ partial, · free, ░ buffer. */
function gridRaster(s: SpSnap, cell: number, cols: number): Canvas {
  const c = new Canvas(cols, Math.max(1, s.grid.length))
  s.grid.forEach((row, y) => row.forEach(([ci, f], x) => {
    const cat = s.categories[ci]
    const px = x * cell
    if (!cat || cat.kind === 'free') c.set(px, y, '·', '#52525b')
    else if (cat.kind === 'buffer') c.set(px, y, '░', KZ.amber)
    else c.set(px, y, f >= 0.7 ? '■' : f > 0 ? '□' : '·', cat.color)
  }))
  return c
}

// ---------------------------------------------------------------------------
// Desktop.

type Card = { source: string; alt: string; height: number; isInteractive?: boolean }

function gridCard(s: SpSnap, W: number): Card {
  const pad = 14
  const gw = s.grid[0]?.length ?? 0
  const gh = s.grid.length
  const gap = 3
  const sq = gw > 0 ? Math.max(6, Math.min(18, Math.floor((W - pad * 2 - gap * (gw - 1)) / gw))) : 0
  const gridH = gh > 0 ? gh * sq + (gh - 1) * gap : 40
  const H = 74 + gridH + 14
  const fill = s.window > 0 ? s.total / s.window : 0
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(`<defs><pattern id="spB" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="${KZ.amber}" opacity=".55"/></pattern></defs>`)
  p.push(svgText(pad, 22, 'CONTEXT X-RAY', { cls: 's', size: 10.5, weight: 650 }))
  p.push(svgText(W - pad, 22, modelName(s.model), { cls: 'm', size: 11, anchor: 'end' }))
  p.push(svgText(pad, 56, fmtPct(s.percentage), { size: 28, weight: 760, fill: heat(fill) }))
  p.push(svgText(pad + 76, 50, `${fmtTokens(s.total)} of ${fmtTokens(s.window)}`, { size: 12.5, weight: 600 }))
  p.push(svgText(pad + 76, 65, `${s.memoryFiles} memory files · ${s.mcpTools} MCP tools`, { cls: 'm', size: 10 }))
  const y0 = 76
  if (gh === 0) p.push(svgText(W / 2, y0 + 24, 'the breakdown arrives after the first reply', { cls: 'm', size: 11, anchor: 'middle' }))
  // The last used square breathes: where the context grows next.
  let lastUsed: [number, number] | undefined
  s.grid.forEach((row, y) => row.forEach(([ci, f], x) => {
    if (s.categories[ci]?.kind === 'used' && f > 0) lastUsed = [x, y]
  }))
  s.grid.forEach((row, y) => row.forEach(([ci, f], x) => {
    const cat = s.categories[ci]
    const px = pad + x * (sq + gap)
    const py = y0 + y * (sq + gap)
    const tip = cat ? `<title>${xml(cat.name)} · ${fmtTokens(cat.tokens)} · ${cat.pct.toFixed(1)}%</title>` : ''
    const r = Math.min(4, sq / 3).toFixed(1)
    if (!cat || cat.kind === 'free') p.push(`<rect class="k" x="${px}" y="${py}" width="${sq}" height="${sq}" rx="${r}">${tip}</rect>`)
    else if (cat.kind === 'buffer') p.push(`<rect x="${px}" y="${py}" width="${sq}" height="${sq}" rx="${r}" fill="url(#spB)">${tip}</rect>`)
    else {
      const isLast = lastUsed?.[0] === x && lastUsed[1] === y
      p.push(`<rect x="${px}" y="${py}" width="${sq}" height="${sq}" rx="${r}" fill="${cat.color}" opacity="${(0.35 + 0.65 * clamp01(f)).toFixed(2)}" ${isLast ? 'class="pulse"' : ''}>${tip}</rect>`)
    }
  }))
  return {
    source: svg(W, H, p.join('')),
    height: H,
    isInteractive: true,
    alt: `Context ${fmtPct(s.percentage)}: ${fmtTokens(s.total)} of ${fmtTokens(s.window)} tokens`,
  }
}

function legendCard(s: SpSnap, order: SpCategory[], W: number): Card {
  const pad = 14
  const rowH = 22
  const H = 34 + Math.max(1, order.length) * rowH + 6
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(svgText(pad, 22, 'BIGGEST FIRST', { cls: 's', size: 10.5, weight: 650 }))
  const maxUsed = Math.max(1, ...order.filter(c => c.kind === 'used').map(c => c.tokens))
  const barX = pad + Math.min(170, W * 0.42)
  const barW = Math.max(30, W - barX - pad - 96)
  if (order.length === 0) p.push(svgText(pad, 46, 'no breakdown yet', { cls: 'm', size: 11 }))
  order.forEach((c, i) => {
    const y = 42 + i * rowH
    p.push(`<rect x="${pad}" y="${y - 9}" width="10" height="10" rx="3" fill="${c.kind === 'buffer' ? 'url(#spB2)' : c.color}" ${c.kind === 'free' ? 'class="k"' : ''}/>`)
    p.push(svgText(pad + 16, y, fitText(c.name, 11.5, barX - pad - 22), { size: 11.5, weight: c.kind === 'used' ? 600 : 400, cls: c.kind === 'used' ? 't' : 's' }))
    if (c.kind === 'used') {
      const w = Math.max(2, (c.tokens / maxUsed) * barW)
      p.push(`<rect class="k" x="${barX}" y="${y - 8}" width="${barW}" height="8" rx="4"/>`)
      p.push(`<rect x="${barX}" y="${y - 8}" width="${w.toFixed(1)}" height="8" rx="4" fill="${c.color}"/>`)
    }
    p.push(svgText(W - pad - 44, y, fmtTokens(c.tokens), { size: 11.5, anchor: 'end' }))
    p.push(svgText(W - pad, y, `${c.pct.toFixed(1)}%`, { cls: 'm', size: 10.5, anchor: 'end' }))
  })
  p.unshift(`<defs><pattern id="spB2" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="${KZ.amber}"/></pattern></defs>`)
  return {
    source: svg(W, H, p.join('')),
    height: H,
    alt: `Categories: ${order.map(c => `${c.name} ${fmtTokens(c.tokens)}`).join(', ') || 'none yet'}`,
  }
}

function growthCard(s: SpSnap, W: number): Card {
  const pad = 14
  const H = 150
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(`<defs><linearGradient id="spG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity="0"/></linearGradient></defs>`)
  p.push(svgText(pad, 22, 'GROWTH PER TURN', { cls: 's', size: 10.5, weight: 650 }))
  p.push(svgText(W - pad, 22, s.slope !== undefined ? `${s.slope >= 0 ? '+' : '−'}${fmtTokens(Math.abs(s.slope))}/turn` : '', { size: 12, weight: 650, anchor: 'end', fill: KZ.cyan }))
  const gx = pad
  const gy = 34
  const gw = W - pad * 2
  const gh = 70
  const series = s.growth
  const ahead = s.turnsLeft !== undefined ? Math.min(s.turnsLeft, Math.max(3, series.length)) : 0
  const n = series.length + ahead
  const top = Math.max(s.threshold, ...series, 1) * 1.04
  const X = (i: number) => gx + (n > 1 ? (i / (n - 1)) * gw : 0)
  const Y = (v: number) => gy + gh - (v / top) * gh
  // The compaction line.
  const ty = Y(s.threshold)
  p.push(`<line x1="${gx}" y1="${ty.toFixed(1)}" x2="${gx + gw}" y2="${ty.toFixed(1)}" stroke="${KZ.red}" stroke-width="1" stroke-dasharray="5 4" opacity=".8"/>`)
  p.push(svgText(gx + gw, ty - 4, `${s.isAutoCompact ? 'compact' : 'window'} ${fmtTokens(s.threshold)}${s.thresholdSource === 'assumed' ? ' (assumed)' : ''}`, { size: 9, anchor: 'end', fill: KZ.red }))
  if (series.length > 1) {
    const pts = series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
    p.push(`<path d="M${pts.join('L')}L${X(series.length - 1).toFixed(1)},${gy + gh}L${gx},${gy + gh}Z" fill="url(#spG)"/>`)
    p.push(`<path d="M${pts.join('L')}" stroke="${KZ.cyan}" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`)
    const lx = X(series.length - 1)
    const lv = series[series.length - 1] ?? 0
    if (ahead > 0 && s.slope !== undefined) {
      const ex = X(n - 1)
      const ev = Math.min(top, lv + s.slope * ahead)
      p.push(`<path d="M${lx.toFixed(1)},${Y(lv).toFixed(1)}L${ex.toFixed(1)},${Y(ev).toFixed(1)}" stroke="${KZ.cyan}" stroke-width="1.4" stroke-dasharray="2 4" fill="none" class="spdash"/>`)
    }
    p.push(`<circle cx="${lx.toFixed(1)}" cy="${Y(lv).toFixed(1)}" r="3.5" fill="${KZ.cyan}" class="pulse"/>`)
  } else p.push(svgText(gx + gw / 2, gy + gh / 2, 'a point lands at the end of each turn', { cls: 'm', size: 11, anchor: 'middle' }))
  const c = compactColor(s.turnsLeft)
  p.push(`<rect x="${pad}" y="${H - 34}" width="${gw}" height="22" rx="11" fill="${c}" opacity=".14"/>`)
  p.push(svgText(pad + 10, H - 19, forecastLine(s), { size: 11.5, weight: 650, fill: c }))
  return {
    source: svg(W, H, p.join(''), '.spdash{animation:spd 1.2s linear infinite}@keyframes spd{to{stroke-dashoffset:-12}}'),
    height: H,
    alt: `Context growth: ${forecastLine(s)}`,
  }
}
