import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { HgSnap, HgWindow } from '../types'
import { Canvas, KZ, clamp01, fmtPct, fmtSpan, heat, pxOf, sparkline, svg, svgBar, svgText, untilReset } from './lib/kz.ts'
import { averageRate, crossings, forecast, lookbackOf, measuredRate, observe, statusText, verdictText } from './calc.ts'
import type { WinMemory } from './calc.ts'

const PANE = 'kz-hourglass'
const TITLE = 'KOZMOS · Hourglass'
const snapAtom = atom({ plugin: 'hourglass', key: 'snap' } as const, null)
const STORE_KEY = 'windows'

const blank = (now: number): HgSnap => ({ now, isWorking: false, windows: [] })

function label(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'spend'
  return kind.replace(/_/g, ' ')
}

function longLabel(kind: string): string {
  if (kind === 'five_hour') return '5-HOUR WINDOW'
  if (kind === 'seven_day') return 'WEEKLY WINDOW'
  if (kind === 'spend_limit') return 'SPEND LIMIT'
  return kind.replace(/_/g, ' ').toUpperCase()
}

const verdictColor = (v: HgWindow['verdict']): string =>
  v === 'full' ? KZ.red : v === 'dry' ? KZ.amber : v === 'learning' ? KZ.mist : KZ.green

// ---------------------------------------------------------------------------

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

let live: HgSnap = blank(0)
let limits: SessionRateLimit[] = []
let lastPublished = ''
let lastStatus: string | undefined
let wantsStatus = false

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify({ ...live, now: 0, windows: live.windows.map(w => ({ ...w, resetInMs: Math.round((w.resetInMs ?? 0) / 60_000), etaMs: Math.round((w.etaMs ?? 0) / 60_000), marginMs: Math.round((w.marginMs ?? 0) / 60_000) })) })
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => JSON.parse(JSON.stringify(live)) as HgSnap)
}

async function readMemory($: EngineInterface): Promise<Record<string, WinMemory>> {
  try {
    const v = await $.store.get(STORE_KEY)
    return v && typeof v === 'object' ? (v as Record<string, WinMemory>) : {}
  } catch {
    return {}
  }
}

/** Takes the latest readings into the store, toasts, and rebuilds the snapshot. */
async function digest($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  live.now = now
  const mem = await readMemory($)
  const before = JSON.stringify(mem)
  const windows: HgWindow[] = []
  for (const l of limits) {
    const w = observe(mem[l.kind], l.kind, l.percentUsed, l.resetsAt, now)
    for (const t of crossings(w.toasted, l.percentUsed)) {
      w.toasted.push(t)
      const left = untilReset(l, now)
      $.ui.toast(`⏳ ${label(l.kind)} limit at ${Math.round(l.percentUsed)}%${left !== undefined ? ` · resets in ${fmtSpan(left)}` : ''}`, { timeoutMs: 8000 })
    }
    mem[l.kind] = w
    const resetInMs = untilReset(l, now)
    const measured = measuredRate(w.samples, now, lookbackOf(l.kind))
    const avg = measured === undefined ? averageRate(l.kind, l.percentUsed, l.resetsAt, now) : undefined
    const rate = measured ?? avg
    const f = forecast(l.percentUsed, rate, resetInMs)
    windows.push({
      kind: l.kind,
      pct: l.percentUsed,
      resetsAt: l.resetsAt,
      resetInMs,
      rate: rate === undefined ? undefined : Math.round(rate * 10) / 10,
      rateSource: measured !== undefined ? 'measured' : avg !== undefined ? 'average' : undefined,
      etaMs: f.etaMs,
      verdict: f.verdict,
      marginMs: f.marginMs,
      history: w.samples.slice(-32).map(([, p]) => p),
    })
  }
  if (JSON.stringify(mem) !== before) await $.store.set(STORE_KEY, mem).catch(() => undefined)
  const order = ['five_hour', 'seven_day', 'spend_limit']
  windows.sort((a, b) => (order.indexOf(a.kind) + 9) % 9 - (order.indexOf(b.kind) + 9) % 9)
  live.windows = windows
  if (wantsStatus) {
    const text = statusText(windows, label)
    if (text !== lastStatus) {
      lastStatus = text
      $.ui.status(text)
    }
  }
  await publish($)
}

async function sample($: EngineInterface): Promise<void> {
  try {
    limits = (await $.session.usage()).rateLimits
  } catch {
    // Keep the last readings.
  }
  await digest($)
}

export const register: Register = (on, options) => {
  wantsStatus = options.statusLine === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank(await $.clock.now())
    limits = []
    lastPublished = ''
    lastStatus = undefined
    await $.command.register({ name: 'hourglass', description: 'KOZMOS: toggle the Hourglass limit oracle sidebar', immediate: true })
    await sample($).catch(() => undefined)
    $.clock.every(15_000, () => void sample($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'hourglass' }, async $ => {
    const opened = await toggle($)
    if (opened) await sample($).catch(() => undefined)
    return { text: opened ? 'Hourglass open.' : 'Hourglass closed.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      limits = e.rateLimits
      await digest($).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    void publish($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      live.isWorking = false
      void sample($).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const cards = s.windows.length ? s.windows.map(w => windowCard(w, s.isWorking, W)) : [emptyCard(W)]
      return (
        <Box flexDirection="column">
          {cards.map((c, i) => <Svg key={`w${i}`} source={c.source} alt={c.alt} width={W} height={c.height} />)}
        </Box>
      )
    }

    const cols = Math.max(28, e.props.bodyColumns || 40)
    if (s.windows.length === 0) {
      return (
        <Box flexDirection="column">
          {'Raster' in ui ? <ui.Raster key="hg-empty" columns={7} rows={4} cells={glass(0, false).encode()} /> : null}
          <Text color={KZ.violet} bold>No rate-limit windows yet.</Text>
          <Text dimColor wrap="wrap">They appear after the first reply on a Claude subscription. With an API key or a gateway without limits there is nothing to watch: spend freely, Tokenomics counts the dollars.</Text>
        </Box>
      )
    }
    const textW = Math.max(18, cols - 9)
    const barW = Math.max(6, Math.min(24, textW - 16))
    return (
      <Box flexDirection="column">
        {s.windows.map(w => {
          const c = heat(w.pct / 100)
          return (
            <Box key={`w-${w.kind}`} flexDirection="row" marginBottom={1}>
              {'Raster' in ui ? <ui.Raster key={`hg-${w.kind}`} columns={7} rows={4} cells={glass(w.pct / 100, s.isWorking).encode()} /> : null}
              <Box flexDirection="column" marginLeft={2} width={textW}>
                <Text wrap="truncate-end">
                  <Text bold color={c}>{label(w.kind).padEnd(5)}</Text>
                  <Text color={c}>{barOf(w.pct / 100, barW)}</Text>
                  <Text bold> {fmtPct(w.pct)}</Text>
                </Text>
                <Text wrap="truncate-end" dimColor>
                  {w.resetInMs !== undefined ? `↻ ${fmtSpan(w.resetInMs)}` : '↻ —'}
                  {w.rate !== undefined ? ` · ${w.rate.toFixed(1)}%/h${w.rateSource === 'average' ? ' avg' : ''}` : ''}
                  {w.etaMs !== undefined && w.verdict !== 'full' ? ` · 100% in ${fmtSpan(w.etaMs)}` : ''}
                </Text>
                <Text wrap="truncate-end">
                  <Text color={KZ.violet}>{w.history.length > 1 ? sparkline(w.history, Math.min(16, textW - 2), 100) : ''}</Text>
                </Text>
                <Text wrap="truncate-end" color={verdictColor(w.verdict)}>{verdictText({ verdict: w.verdict, etaMs: w.etaMs, marginMs: w.marginMs }, w.resetInMs)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}

function barOf(ratio: number, width: number): string {
  const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
  const w = Math.max(1, Math.floor(width))
  const exact = clamp01(ratio) * w
  const full = Math.floor(exact)
  const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ''
  return '█'.repeat(full) + part + '░'.repeat(Math.max(0, w - full - (part ? 1 : 0)))
}

/**
 * A 7×8-pixel hourglass in half blocks (7 columns, 4 rows): the upper bulb
 * holds what is left, the lower what is used; a grain in the neck while working.
 */
function glass(used: number, isWorking: boolean): Canvas {
  const c = new Canvas(7, 4)
  const FRAME = KZ.clay
  const GLASS = '#3f3f46'
  const sand = heat(used)
  for (let x = 0; x < 7; x++) {
    c.pixel(x, 0, FRAME)
    c.pixel(x, 7, FRAME)
  }
  // Interior rows: upper bulb rows 1..3 (widths 5,3,1), lower rows 4..6 (1,3,5).
  const rows: [number, number][] = [[1, 5], [2, 3], [3, 1], [4, 1], [5, 3], [6, 5]]
  for (const [y, w] of rows) for (let x = 0; x < 7; x++) if (Math.abs(x - 3) <= (w - 1) / 2) c.pixel(x, y, GLASS)
  // Upper bulb fills from the neck up; lower bulb from the floor up.
  const order = (ys: number[]): [number, number][] => ys.flatMap(y => {
    const w = rows.find(r => r[0] === y)?.[1] ?? 1
    const xs = Array.from({ length: w }, (_, i) => 3 - (w - 1) / 2 + i).sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3))
    return xs.map(x => [x, y] as [number, number])
  })
  const top = order([3, 2, 1])
  const bottom = order([6, 5, 4])
  const left = Math.round(clamp01(1 - used) * top.length)
  const fell = Math.round(clamp01(used) * bottom.length)
  for (const [x, y] of top.slice(0, left)) c.pixel(x, y, sand)
  for (const [x, y] of bottom.slice(0, fell)) c.pixel(x, y, sand)
  if (isWorking && used < 1 && fell < bottom.length) c.pixel(3, 4, sand)
  return c
}

// ---------------------------------------------------------------------------
// Desktop.

type Card = { source: string; alt: string; height: number }

function hourglassSvg(id: string, x: number, y: number, w: number, h: number, used: number, isWorking: boolean): string {
  const cx = x + w / 2
  const top = y + 6
  const bot = y + h - 6
  const neck = (top + bot) / 2
  const x0 = x + 4
  const x1 = x + w - 4
  const bulb = (bot - top) * 0.32
  const d = `M${x0} ${top}H${x1}C${x1} ${top + bulb} ${cx + 3} ${neck - 8} ${cx + 2} ${neck}C${cx + 3} ${neck + 8} ${x1} ${bot - bulb} ${x1} ${bot}H${x0}C${x0} ${bot - bulb} ${cx - 3} ${neck + 8} ${cx - 2} ${neck}C${cx - 3} ${neck - 8} ${x0} ${top + bulb} ${x0} ${top}Z`
  const u = clamp01(used)
  const sand = heat(u)
  const half = neck - top
  const topLevel = neck - (1 - u) * half
  const botLevel = bot - u * half
  const p: string[] = []
  p.push(`<defs><clipPath id="${id}"><path d="${d}"/></clipPath><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sand}" stop-opacity=".95"/><stop offset="1" stop-color="${sand}" stop-opacity=".7"/></linearGradient></defs>`)
  p.push(`<path d="${d}" class="k"/>`)
  p.push(`<g clip-path="url(#${id})">`)
  if (u < 1) p.push(`<rect x="${x}" y="${topLevel.toFixed(1)}" width="${w}" height="${(neck - topLevel).toFixed(1)}" fill="url(#${id}s)" class="${isWorking ? 'hgdrain' : ''}"/>`)
  if (u > 0) p.push(`<rect x="${x}" y="${botLevel.toFixed(1)}" width="${w}" height="${(bot - botLevel).toFixed(1)}" fill="url(#${id}s)"/>`)
  if (isWorking && u < 1) {
    p.push(`<line x1="${cx}" y1="${neck}" x2="${cx}" y2="${botLevel.toFixed(1)}" stroke="${sand}" stroke-width="1.6" stroke-dasharray="2 3" class="hgfall"/>`)
    p.push(`<circle cx="${cx}" cy="${botLevel.toFixed(1)}" r="2.2" fill="${sand}" class="pulse"/>`)
  }
  p.push('</g>')
  p.push(`<path d="${d}" fill="none" stroke="${KZ.mist}" stroke-opacity=".55" stroke-width="1.2"/>`)
  p.push(`<path d="M${x0 + 4} ${top + 4}C${x0 + 4} ${top + bulb} ${cx - 4} ${neck - 10} ${cx - 3} ${neck - 4}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/>`)
  p.push(`<rect x="${x}" y="${top - 6}" width="${w}" height="6" rx="3" fill="${KZ.clay}"/>`)
  p.push(`<rect x="${x}" y="${bot}" width="${w}" height="6" rx="3" fill="${KZ.clay}"/>`)
  return p.join('')
}

const HG_CSS = `
.hgfall{animation:hgf .5s linear infinite}@keyframes hgf{to{stroke-dashoffset:-10}}
.hgdrain{animation:hgd 2.4s ease-in-out infinite}@keyframes hgd{50%{opacity:.8}}
`

function windowCard(w: HgWindow, isWorking: boolean, W: number): Card {
  const pad = 14
  const H = 132
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(hourglassSvg(`hg${w.kind.replace(/\W/g, '')}`, pad, 14, 58, H - 28, w.pct / 100, isWorking))
  const tx = pad + 74
  const tw = W - tx - pad
  const vc = verdictColor(w.verdict)
  p.push(svgText(tx, 24, longLabel(w.kind), { cls: 's', size: 10.5, weight: 650 }))
  p.push(svgText(W - pad, 24, w.resetInMs !== undefined ? `↻ ${fmtSpan(w.resetInMs)}` : '', { cls: 'm', size: 11, anchor: 'end' }))
  p.push(svgText(tx, 56, fmtPct(w.pct), { size: 28, weight: 760, fill: heat(w.pct / 100) }))
  if (w.history.length > 1) {
    const gx = tx + 84
    const gw = Math.max(20, tw - 84)
    const step = gw / (w.history.length - 1)
    const pts = w.history.map((v, i) => `${(gx + i * step).toFixed(1)},${(52 - (clamp01(v / 100) * 22)).toFixed(1)}`)
    p.push(`<path d="M${pts.join('L')}" fill="none" stroke="${KZ.violet}" stroke-width="1.5" stroke-linejoin="round"/>`)
  }
  p.push(svgBar(tx, 66, tw, 8, w.pct / 100, heat(w.pct / 100)))
  const rateLine = [
    w.rate !== undefined ? `${w.rate.toFixed(1)}%/h ${w.rateSource === 'average' ? '(window avg)' : 'measured'}` : 'measuring burn…',
    w.etaMs !== undefined && w.verdict !== 'full' ? `100% in ${fmtSpan(w.etaMs)}` : '',
  ].filter(Boolean).join(' · ')
  p.push(svgText(tx, 92, rateLine, { cls: 's', size: 11 }))
  p.push(`<rect x="${tx}" y="102" width="${tw}" height="22" rx="11" fill="${vc}" opacity=".14"/>`)
  p.push(svgText(tx + 10, 117, verdictText({ verdict: w.verdict, etaMs: w.etaMs, marginMs: w.marginMs }, w.resetInMs), { size: 11.5, weight: 650, fill: vc }))
  return {
    source: svg(W, H, p.join(''), HG_CSS),
    height: H,
    alt: `${longLabel(w.kind)} ${fmtPct(w.pct)} used; ${verdictText({ verdict: w.verdict, etaMs: w.etaMs, marginMs: w.marginMs }, w.resetInMs)}`,
  }
}

function emptyCard(W: number): Card {
  const pad = 14
  const H = 112
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(hourglassSvg('hgempty', pad, 12, 50, H - 24, 0, false))
  p.push(svgText(pad + 66, 34, 'No rate-limit windows yet', { size: 14, weight: 700 }))
  p.push(svgText(pad + 66, 56, 'They appear after the first reply on a', { cls: 's', size: 11 }))
  p.push(svgText(pad + 66, 72, 'Claude subscription. On an API key there', { cls: 's', size: 11 }))
  p.push(svgText(pad + 66, 88, 'is nothing to ration: spend freely.', { cls: 's', size: 11 }))
  return { source: svg(W, H, p.join(''), HG_CSS), height: H, alt: 'No rate-limit windows reported: an API key or no subscription.' }
}
