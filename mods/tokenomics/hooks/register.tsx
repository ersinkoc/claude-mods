import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TokSnap } from '../types'
import {
  Canvas, KZ, clamp01, fitText, fmtClock, fmtPct, fmtTokens, fmtUsd, mix, modelName, pxOf, sparkline, svg, svgBar, svgText,
} from './lib/kz.ts'
import {
  TYPES, accrue, addUsage, averagePerHour, cacheHitRatio, costDelta, dayKey, emptyLedger, lastDays, ledgerUsd, ratePerHour,
  totalOf, weekday,
} from './calc.ts'
import type { Days, TypeKey } from './calc.ts'

const PANE = 'kz-tokenomics'
const TITLE = 'KOZMOS · Tokenomics'
const snapAtom = atom({ plugin: 'tokenomics', key: 'snap' } as const, null)

const DAYS_KEY = 'days'
const SEEN_KEY = 'seen'

const MODEL_COLORS = [KZ.violet, KZ.cyan, KZ.magenta, KZ.teal, KZ.amber, KZ.blue, KZ.lime]
const TYPE_COLOR: Record<TypeKey, string> = { input: KZ.blue, output: KZ.magenta, cacheRead: KZ.green, cacheWrite: KZ.amber }
const TYPE_LABEL: Record<TypeKey, string> = { input: 'input', output: 'output', cacheRead: 'cache read', cacheWrite: 'cache write' }

const blank = (now: number): TokSnap => ({
  startedAt: now,
  now,
  isWorking: false,
  ledger: emptyLedger(),
  turnCosts: [],
  turns: 0,
  days: lastDays({}, dayKey(now), 14),
  weekUsd: 0,
  todayUsd: 0,
})

// ---------------------------------------------------------------------------
// Pane toggle.

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

// ---------------------------------------------------------------------------
// Collector. Module state starts over on a reload; session.start refills it
// from the published snapshot when the session is the same one.

let live: TokSnap = blank(0)
let samples: [number, number][] = []
let lastPublished = ''
let turnStartTotal: number | undefined

/** The best total we have: the engine's, else the estimate. */
const totalNow = (): number => live.costUsd ?? ledgerUsd(live.ledger)

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify({ ...live, now: live.isWorking ? live.now : 0 })
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => JSON.parse(JSON.stringify(live)) as TokSnap)
}

async function readDays($: EngineInterface): Promise<Days> {
  try {
    const v = await $.store.get(DAYS_KEY)
    return v && typeof v === 'object' ? (v as Days) : {}
  } catch {
    return {}
  }
}

function applyDays(days: Days, now: number): void {
  const today = dayKey(now)
  live.days = lastDays(days, today, 14)
  live.weekUsd = totalOf(live.days.slice(-7))
  live.todayUsd = days[today] ?? 0
}

/** Books the growth of this session's cost into today's total, once per dollar. */
async function bookCost($: EngineInterface, startedAt: number, total: number, now: number): Promise<void> {
  const seenRaw = await $.store.get(SEEN_KEY).catch(() => undefined)
  const seen = (seenRaw && typeof seenRaw === 'object' ? seenRaw : {}) as Record<string, { usd: number; at: number }>
  const id = String(startedAt)
  const delta = costDelta(seen[id]?.usd, total)
  if (delta <= 0) return
  const days = accrue(await readDays($), dayKey(now), delta)
  const kept: Record<string, { usd: number; at: number }> = {}
  for (const [k, v] of Object.entries(seen)) if (v && v.at >= now - 3 * 86_400_000) kept[k] = v
  kept[id] = { usd: total, at: now }
  await $.store.set(DAYS_KEY, days)
  await $.store.set(SEEN_KEY, kept)
  applyDays(days, now)
}

async function sample($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  live.now = now
  try {
    const u = await $.session.usage()
    live.startedAt = u.startedAt
    live.costUsd = u.cost?.usd
  } catch {
    // Left as it was.
  }
  const total = totalNow()
  if (total > 0) await bookCost($, live.startedAt, total, now).catch(() => undefined)
  if (dayKey(now) !== live.days[live.days.length - 1]?.date) applyDays(await readDays($), now)
  samples.push([now, total])
  samples = samples.filter(([t]) => t >= now - 60 * 60_000)
  const avg = averagePerHour(total, live.startedAt, now)
  const recent = ratePerHour(samples, now)
  live.avgPerHour = avg === undefined ? undefined : Math.round(avg * 100) / 100
  live.perHour = recent !== undefined ? Math.round(recent * 100) / 100 : live.avgPerHour
  await publish($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    const prev = await read($, snapAtom).catch(() => null)
    live = blank(now)
    samples = []
    lastPublished = ''
    turnStartTotal = undefined
    try {
      const u = await $.session.usage()
      if (prev && prev.startedAt === u.startedAt) {
        live.ledger = prev.ledger
        live.turnCosts = prev.turnCosts
        live.turns = prev.turns
      }
    } catch {
      // A fresh ledger.
    }
    applyDays(await readDays($), now)
    await $.command.register({ name: 'tokenomics', description: 'KOZMOS: toggle the Tokenomics cost lab sidebar', immediate: true })
    await sample($).catch(() => undefined)
    $.clock.every(3000, () => void sample($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'tokenomics' }, async $ => {
    const opened = await toggle($)
    if (opened) await sample($).catch(() => undefined)
    return { text: opened ? 'Tokenomics open.' : 'Tokenomics closed.' }
  })

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    turnStartTotal = totalNow()
    void publish($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (r.usage) {
      live.ledger = addUsage(live.ledger, r.usage.model || e.model, r.usage)
      live.now = await $.clock.now()
      void publish($)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      live.isWorking = false
      try {
        const u = await $.session.usage()
        live.costUsd = u.cost?.usd ?? live.costUsd
      } catch {
        // Keep the last reading.
      }
      const total = totalNow()
      if (turnStartTotal !== undefined) {
        live.turnCosts = [...live.turnCosts, Math.max(0, total - turnStartTotal)].slice(-48)
        live.turns++
      }
      turnStartTotal = undefined
      await sample($).catch(() => undefined)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const cards = [headerCard(s, W), modelCard(s, W), typeCard(s, W), dayCard(s, W)]
      return (
        <Box flexDirection="column">
          {cards.map((c, i) => (
            <Svg key={`c${i}`} source={c.source} alt={c.alt} width={W} height={c.height} isInteractive={c.isInteractive} />
          ))}
        </Box>
      )
    }

    // ---- terminal ----
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const est = ledgerUsd(s.ledger)
    const total = s.costUsd ?? est
    const elapsed = s.now - s.startedAt
    const labelW = 12
    const barW = Math.max(4, Math.min(22, cols - labelW - 14))
    const rule = (label: string) => (
      <Text key={`r-${label}`} color={KZ.mist}>{`── ${label} `}{'─'.repeat(Math.max(0, cols - label.length - 4))}</Text>
    )
    const hit = cacheHitRatio(s.ledger.tokens)
    const lastTurn = s.turnCosts[s.turnCosts.length - 1]
    const avgTurn = s.turnCosts.length ? totalOf(s.turnCosts.map(usd => ({ usd }))) / s.turnCosts.length : undefined
    const maxModel = Math.max(1e-9, ...s.ledger.byModel.map(m => m.usd))
    const maxType = Math.max(1e-9, ...TYPES.map(k => s.ledger.usd[k]))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.yellow}>◆ {fmtUsd(total)}{s.costUsd === undefined ? <Text color={KZ.mist}> est.</Text> : ''}</Text>
          <Text color={s.isWorking ? KZ.green : KZ.mist}>{s.isWorking ? '● burning' : '○ idle'}</Text>
        </Box>
        <Text wrap="truncate-end" dimColor>
          {fmtClock(elapsed)} · {s.perHour !== undefined ? `${fmtUsd(s.perHour)}/h` : '—/h'} · {s.turns} turns · {s.ledger.steps} requests
        </Text>
        <Text wrap="truncate-end">
          <Text color={KZ.mist}>at this pace: </Text>
          <Text color={KZ.amber}>{s.perHour !== undefined ? `next hour ≈ ${fmtUsd(s.perHour)}` : 'learning the pace…'}</Text>
        </Text>
        {rule('by model')}
        {s.ledger.byModel.length === 0 && <Text dimColor>no request priced yet</Text>}
        {s.ledger.byModel.slice(0, 5).map((m, i) => (
          <Box key={`m-${m.model}`} flexDirection="row">
            <Box width={labelW} flexShrink={0}><Text color={MODEL_COLORS[i % MODEL_COLORS.length]} wrap="truncate-end">{modelName(m.model)}</Text></Box>
            <Text wrap="truncate-end">
              <Text color={MODEL_COLORS[i % MODEL_COLORS.length]}>{barOf(m.usd / maxModel, barW)}</Text>
              <Text> {fmtUsd(m.usd)}</Text>
              <Text dimColor> {fmtPct(est > 0 ? (m.usd / est) * 100 : 0)}</Text>
            </Text>
          </Box>
        ))}
        {rule('by token type')}
        {TYPES.map(k => (
          <Box key={`t-${k}`} flexDirection="row">
            <Box width={labelW} flexShrink={0}><Text color={TYPE_COLOR[k]}>{TYPE_LABEL[k]}</Text></Box>
            <Text wrap="truncate-end">
              <Text color={TYPE_COLOR[k]}>{barOf(s.ledger.usd[k] / maxType, barW)}</Text>
              <Text> {fmtUsd(s.ledger.usd[k])}</Text>
              <Text dimColor> {fmtTokens(s.ledger.tokens[k])}</Text>
            </Text>
          </Box>
        ))}
        <Box flexDirection="row">
          <Box width={labelW} flexShrink={0}><Text color={KZ.green}>cache hit</Text></Box>
          <Text wrap="truncate-end">
            <Text color={mix(KZ.red, KZ.green, hit ?? 0)}>{barOf(hit ?? 0, barW, '·')}</Text>
            <Text bold> {hit === undefined ? '—' : fmtPct(hit * 100)}</Text>
          </Text>
        </Box>
        {rule('per turn')}
        <Text wrap="truncate-end">
          <Text color={KZ.violet}>{s.turnCosts.length ? sparkline(s.turnCosts, Math.max(6, cols - 22)) : '·'.repeat(Math.max(6, cols - 22))}</Text>
          <Text dimColor> {lastTurn !== undefined ? `last ${fmtUsd(lastTurn)}` : 'no turn yet'}</Text>
        </Text>
        {avgTurn !== undefined && <Text dimColor>avg {fmtUsd(avgTurn)} · max {fmtUsd(Math.max(...s.turnCosts))}</Text>}
        {rule('14 days')}
        {'Raster' in ui ? <ui.Raster key="days" columns={cols} rows={5} cells={dayRaster(s, cols).encode()} /> : null}
        <Text wrap="truncate-end">
          <Text color={KZ.violet}>today {fmtUsd(s.todayUsd)}</Text>
          <Text dimColor> · 7d {fmtUsd(s.weekUsd)} · 14d {fmtUsd(totalOf(s.days))}</Text>
        </Text>
      </Box>
    )
  })
}

/** An eighth-block bar with a custom empty glyph. */
function barOf(ratio: number, width: number, empty = ' '): string {
  const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
  const w = Math.max(1, Math.floor(width))
  const exact = clamp01(ratio) * w
  const full = Math.floor(exact)
  const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ''
  return '█'.repeat(full) + part + empty.repeat(Math.max(0, w - full - (part ? 1 : 0)))
}

/** 14 vertical bars in eighth blocks, four rows tall, weekday initials under. */
function dayRaster(s: TokSnap, cols: number): Canvas {
  const c = new Canvas(cols, 5)
  const n = s.days.length
  const bw = Math.max(1, Math.min(3, Math.floor((cols - (n - 1)) / n)))
  const used = n * bw + (n - 1)
  const x0 = Math.max(0, Math.floor((cols - used) / 2))
  const max = Math.max(1e-9, ...s.days.map(d => d.usd))
  const levels = 4 * 8
  const V = ' ▁▂▃▄▅▆▇█'
  s.days.forEach((d, i) => {
    const isToday = i === n - 1
    const h = d.usd > 0 ? Math.max(1, Math.round((d.usd / max) * levels)) : 0
    const color = isToday ? KZ.violet : mix(KZ.teal, KZ.magenta, d.usd / max)
    const x = x0 + i * (bw + 1)
    for (let row = 0; row < 4; row++) {
      const fromBottom = 3 - row
      const fill = Math.max(0, Math.min(8, h - fromBottom * 8))
      const ch = h === 0 && fromBottom === 0 ? '▁' : (V[fill] ?? ' ')
      for (let k = 0; k < bw; k++) c.set(x + k, row, ch, h === 0 ? '#3f3f46' : color)
    }
    const wd = weekday(d.date).charAt(0)
    c.set(x + Math.floor((bw - 1) / 2), 4, wd, isToday ? KZ.violet : KZ.mist)
  })
  return c
}

// ---------------------------------------------------------------------------
// Desktop cards: one Svg per section.

type Card = { source: string; alt: string; height: number; isInteractive?: boolean }

function headerCard(s: TokSnap, W: number): Card {
  const pad = 14
  const H = 112
  const total = s.costUsd ?? ledgerUsd(s.ledger)
  const p: string[] = []
  p.push(`<defs><linearGradient id="tkG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.yellow}" stop-opacity=".45"/><stop offset="1" stop-color="${KZ.yellow}" stop-opacity="0"/></linearGradient></defs>`)
  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`)
  p.push(svgText(pad, 22, 'SESSION COST', { cls: 's', size: 10.5, weight: 650 }))
  p.push(`<circle cx="${pad + 92}" cy="18" r="4" fill="${s.isWorking ? KZ.green : KZ.mist}" class="${s.isWorking ? 'pulse' : ''}"/>`)
  p.push(svgText(pad, 54, fmtUsd(total), { size: 30, weight: 760, fill: KZ.yellow }))
  if (s.costUsd === undefined) p.push(svgText(pad + 4 + fmtUsd(total).length * 17, 54, 'est.', { cls: 'm', size: 11 }))
  p.push(svgText(W - pad, 24, s.perHour !== undefined ? `${fmtUsd(s.perHour)}/h` : '—/h', { size: 15, weight: 700, anchor: 'end' }))
  p.push(svgText(W - pad, 41, s.perHour !== undefined ? `next hour ≈ ${fmtUsd(s.perHour)}` : 'learning the pace…', { cls: 's', size: 10.5, anchor: 'end' }))
  p.push(svgText(W - pad, 56, `${fmtClock(s.now - s.startedAt)} · ${s.turns} turns`, { cls: 'm', size: 10, anchor: 'end' }))
  // Cost per turn, as an area chart along the bottom.
  const gx = pad
  const gy = 68
  const gw = W - pad * 2
  const gh = 32
  const vals = s.turnCosts.slice(-40)
  if (vals.length > 1) {
    const max = Math.max(1e-9, ...vals)
    const step = gw / (vals.length - 1)
    const pts = vals.map((v, i) => `${(gx + i * step).toFixed(1)},${(gy + gh - (v / max) * gh).toFixed(1)}`)
    p.push(`<path d="M${pts.join('L')}L${gx + gw},${gy + gh}L${gx},${gy + gh}Z" fill="url(#tkG)"/>`)
    p.push(`<path d="M${pts.join('L')}" stroke="${KZ.yellow}" stroke-width="1.6" fill="none" stroke-linejoin="round"/>`)
    const last = pts[pts.length - 1]?.split(',') ?? ['0', '0']
    p.push(`<circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${KZ.yellow}" class="pulse"/>`)
    p.push(svgText(gx, gy + 8, `per turn · max ${fmtUsd(max)}`, { cls: 'm', size: 9 }))
  } else {
    p.push(`<line class="ln" x1="${gx}" y1="${gy + gh}" x2="${gx + gw}" y2="${gy + gh}" stroke-dasharray="3 4"/>`)
    p.push(svgText(gx, gy + gh - 6, 'cost per turn appears after two turns', { cls: 'm', size: 10 }))
  }
  return {
    source: svg(W, H, p.join('')),
    height: H,
    alt: `Session cost ${fmtUsd(total)}; ${s.perHour !== undefined ? fmtUsd(s.perHour) + ' per hour' : 'pace unknown'}; ${s.turns} turns`,
  }
}

function modelCard(s: TokSnap, W: number): Card {
  const pad = 14
  const rows = s.ledger.byModel.slice(0, 6)
  const H = Math.max(120, 44 + rows.length * 20)
  const est = ledgerUsd(s.ledger)
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(svgText(pad, 22, 'BY MODEL · estimated', { cls: 's', size: 10.5, weight: 650 }))
  const r = 34
  const cx = pad + r + 4
  const cy = 30 + r + 8
  const C = 2 * Math.PI * r
  p.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="12" class="ln" style="stroke-opacity:.9"/>`)
  let acc = 0
  rows.forEach((m, i) => {
    const frac = est > 0 ? m.usd / est : 0
    if (frac <= 0) return
    const len = Math.max(0.5, frac * C - (rows.length > 1 ? 1.5 : 0))
    p.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${MODEL_COLORS[i % MODEL_COLORS.length]}" stroke-width="12" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc * C).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`)
    acc += frac
  })
  if (s.isWorking) p.push(`<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${KZ.violet}" stroke-width="1" stroke-dasharray="2 6" opacity=".6" class="spin"/>`)
  p.push(svgText(cx, cy + 2, fmtUsd(est), { size: 13, weight: 720, anchor: 'middle' }))
  p.push(svgText(cx, cy + 15, `${s.ledger.steps} req`, { cls: 'm', size: 9, anchor: 'middle' }))
  const lx = cx + r + 24
  if (rows.length === 0) p.push(svgText(lx, cy + 4, 'no request priced yet', { cls: 'm', size: 11 }))
  rows.forEach((m, i) => {
    const y = 44 + i * 20
    const c = MODEL_COLORS[i % MODEL_COLORS.length] ?? KZ.violet
    p.push(`<rect x="${lx}" y="${y - 9}" width="10" height="10" rx="3" fill="${c}"/>`)
    p.push(svgText(lx + 16, y, fitText(modelName(m.model), 12, W - lx - 120), { size: 12, weight: 600 }))
    p.push(svgText(W - pad - 40, y, fmtUsd(m.usd), { size: 12, anchor: 'end' }))
    p.push(svgText(W - pad, y, fmtPct(est > 0 ? (m.usd / est) * 100 : 0), { cls: 'm', size: 11, anchor: 'end' }))
  })
  return {
    source: svg(W, H, p.join('')),
    height: H,
    alt: `By model: ${rows.map(m => `${modelName(m.model)} ${fmtUsd(m.usd)}`).join(', ') || 'nothing yet'}`,
  }
}

function typeCard(s: TokSnap, W: number): Card {
  const pad = 14
  const H = 182
  const est = ledgerUsd(s.ledger)
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(svgText(pad, 22, 'BY TOKEN TYPE', { cls: 's', size: 10.5, weight: 650 }))
  const bw = W - pad * 2
  p.push(`<defs><clipPath id="tkC"><rect x="${pad}" y="34" width="${bw}" height="14" rx="7"/></clipPath></defs>`)
  p.push(`<rect class="k" x="${pad}" y="34" width="${bw}" height="14" rx="7"/>`)
  let x = pad
  p.push('<g clip-path="url(#tkC)">')
  for (const k of TYPES) {
    const w = est > 0 ? (s.ledger.usd[k] / est) * bw : 0
    if (w > 0) p.push(`<rect x="${x.toFixed(1)}" y="34" width="${w.toFixed(1)}" height="14" fill="${TYPE_COLOR[k]}"/>`)
    x += w
  }
  p.push('</g>')
  TYPES.forEach((k, i) => {
    const y = 72 + i * 19
    p.push(`<circle cx="${pad + 5}" cy="${y - 4}" r="4.5" fill="${TYPE_COLOR[k]}"/>`)
    p.push(svgText(pad + 16, y, TYPE_LABEL[k], { size: 11.5, weight: 600 }))
    p.push(svgText(W - pad - 110, y, fmtTokens(s.ledger.tokens[k]), { cls: 'm', size: 11, anchor: 'end' }))
    p.push(svgText(W - pad - 44, y, fmtUsd(s.ledger.usd[k]), { size: 11.5, anchor: 'end' }))
    p.push(svgText(W - pad, y, fmtPct(est > 0 ? (s.ledger.usd[k] / est) * 100 : 0), { cls: 'm', size: 11, anchor: 'end' }))
  })
  const hit = cacheHitRatio(s.ledger.tokens)
  const hy = 158
  p.push(svgText(pad, hy, 'CACHE HIT', { cls: 's', size: 10, weight: 650 }))
  p.push(svgBar(pad + 72, hy - 8, bw - 72 - 46, 9, hit ?? 0, mix(KZ.red, KZ.green, hit ?? 0)))
  p.push(svgText(W - pad, hy, hit === undefined ? '—' : fmtPct(hit * 100), { size: 13, weight: 720, anchor: 'end', fill: mix(KZ.red, KZ.green, hit ?? 0) }))
  p.push(svgText(pad + 72, hy + 15, 'cache reads ÷ all input tokens', { cls: 'm', size: 9 }))
  return {
    source: svg(W, H, p.join('')),
    height: H,
    alt: `By token type: ${TYPES.map(k => `${TYPE_LABEL[k]} ${fmtUsd(s.ledger.usd[k])}`).join(', ')}; cache hit ${hit === undefined ? 'unknown' : fmtPct(hit * 100)}`,
  }
}

function dayCard(s: TokSnap, W: number): Card {
  const pad = 14
  const H = 150
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(`<defs><linearGradient id="tkD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}"/><stop offset="1" stop-color="${KZ.magenta}"/></linearGradient></defs>`)
  p.push(svgText(pad, 22, 'LAST 14 DAYS', { cls: 's', size: 10.5, weight: 650 }))
  p.push(svgText(W - pad, 22, `7d ${fmtUsd(s.weekUsd)} · today ${fmtUsd(s.todayUsd)}`, { size: 11.5, weight: 650, anchor: 'end' }))
  const n = s.days.length
  const gx = pad
  const gy = 36
  const gw = W - pad * 2
  const gh = 82
  const slot = gw / n
  const bw = Math.max(4, slot * 0.64)
  const max = Math.max(1e-9, ...s.days.map(d => d.usd))
  const avg = totalOf(s.days) / n
  s.days.forEach((d, i) => {
    const isToday = i === n - 1
    const h = d.usd > 0 ? Math.max(3, (d.usd / max) * gh) : 2
    const x = gx + i * slot + (slot - bw) / 2
    const fill = isToday ? 'url(#tkD)' : mix(KZ.teal, KZ.violet, d.usd / max)
    p.push(`<rect x="${x.toFixed(1)}" y="${(gy + gh - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${d.usd > 0 ? fill : 'none'}" ${d.usd > 0 ? '' : 'class="k"'} ${isToday && s.isWorking ? 'class="pulse"' : ''}><title>${d.date} · ${fmtUsd(d.usd)}</title></rect>`)
    p.push(svgText(x + bw / 2, gy + gh + 14, weekday(d.date).charAt(0), { cls: isToday ? 't' : 'm', size: 9.5, weight: isToday ? 700 : 400, anchor: 'middle' }))
  })
  if (avg > 0) {
    const ay = gy + gh - (avg / max) * gh
    p.push(`<line x1="${gx}" y1="${ay.toFixed(1)}" x2="${gx + gw}" y2="${ay.toFixed(1)}" stroke="${KZ.amber}" stroke-width="1" stroke-dasharray="4 4" opacity=".8"/>`)
    p.push(svgText(gx + gw, ay - 3, `avg ${fmtUsd(avg)}`, { size: 9, anchor: 'end', fill: KZ.amber }))
  } else p.push(svgText(gx + gw / 2, gy + gh / 2, 'days fill in as sessions spend', { cls: 'm', size: 11, anchor: 'middle' }))
  return {
    source: svg(W, H, p.join('')),
    height: H,
    isInteractive: true,
    alt: `Last 14 days: ${fmtUsd(totalOf(s.days))}; last 7 days ${fmtUsd(s.weekUsd)}; today ${fmtUsd(s.todayUsd)}`,
  }
}
