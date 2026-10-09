import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GearSlow, GearSnap, GearSort, GearTool } from '../types'
import {
  KZ, bar, brailleGraph, clamp01, fitText, fmtClock, padEnd, padStart, pxOf, svg, svgBar, svgText, toolColor,
  toolDetail, toolGlyph, toolName,
} from './lib/kz.ts'

const PANE = 'kz-gearbox'
const TITLE = 'KOZMOS · Gearbox'
const snapAtom = atom({ plugin: 'gearbox', key: 'snap' } as const, null)
const sortAtom = atom({ plugin: 'gearbox', key: 'sort' } as const, 'time')

const SORTS: GearSort[] = ['time', 'calls', 'errors']
const SORT_LABEL: Record<GearSort, string> = { time: 'total time', calls: 'calls', errors: 'errors' }

// ---------------------------------------------------------------------------
// The live tally. Durations per tool stay here (the snapshot carries the
// figures drawn from them); module state starts over on a reload.

type Acc = { name: string; calls: number; errors: number; totalMs: number; maxMs: number; main: number; sub: number; durations: number[] }

let accs = new Map<string, Acc>()
let slowest: GearSlow[] = []
let minutes: number[] = []
let startedAt = 0
let inFlight = 0
let split = { mainCalls: 0, subCalls: 0, mainMs: 0, subMs: 0 }
let agentNames = new Map<string, string>()
let lastPublished = ''
let pubSeq = 0

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function snapshot(): GearSnap {
  const tools: GearTool[] = [...accs.values()].map(a => ({
    name: a.name,
    calls: a.calls,
    errors: a.errors,
    totalMs: a.totalMs,
    avgMs: a.calls ? Math.round(a.totalMs / a.calls) : 0,
    p95Ms: p95(a.durations),
    maxMs: a.maxMs,
    main: a.main,
    sub: a.sub,
  }))
  return { tools, slowest: [...slowest], perMinute: [...minutes], startedAt, ...split, inFlight }
}

async function publish($: EngineInterface): Promise<void> {
  const seq = ++pubSeq
  const snap = snapshot()
  const key = JSON.stringify(snap)
  if (key === lastPublished) return
  await Promise.resolve()
  if (seq !== pubSeq) return
  lastPublished = key
  await update($, snapAtom, () => snap)
}

function countMinute(at: number): void {
  const idx = Math.max(0, Math.floor((at - startedAt) / 60_000))
  const offset = Math.max(0, idx - 119)
  if (offset > 0) {
    // Slide the window: keep the last 120 minutes.
    startedAt += offset * 60_000
    minutes = minutes.slice(offset)
  }
  const i = idx - offset
  while (minutes.length <= i) minutes.push(0)
  minutes[i] = (minutes[i] ?? 0) + 1
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    accs = new Map()
    slowest = []
    minutes = [0]
    startedAt = await $.clock.now()
    inFlight = 0
    split = { mainCalls: 0, subCalls: 0, mainMs: 0, subMs: 0 }
    agentNames = new Map()
    lastPublished = ''
    await $.command.register({ name: 'gearbox', description: 'KOZMOS: toggle the Gearbox tool-analytics sidebar', immediate: true })
    await publish($)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'gearbox' }, async $ => ({
    text: (await toggle($)) ? 'Gearbox open.' : 'Gearbox closed.',
  }))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.subagentType || 'agent')
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    inFlight++
    countMinute(at)
    await publish($)
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      inFlight = Math.max(0, inFlight - 1)
      const ms = Math.max(0, (await $.clock.now()) - at)
      const name = String(e.tool)
      const isError = ran === undefined || ran.isError === true || ran.deny !== undefined
      const a = accs.get(name) ?? { name, calls: 0, errors: 0, totalMs: 0, maxMs: 0, main: 0, sub: 0, durations: [] }
      a.calls++
      if (isError) a.errors++
      a.totalMs += ms
      a.maxMs = Math.max(a.maxMs, ms)
      a.durations = [...a.durations, ms].slice(-1000)
      const isMain = e.agentId === undefined
      if (isMain) {
        a.main++
        split.mainCalls++
        split.mainMs += ms
      } else {
        a.sub++
        split.subCalls++
        split.subMs += ms
      }
      accs.set(name, a)
      const slow: GearSlow = { name, detail: toolDetail(name, e), ms, at, isError, ...(isMain ? {} : { agent: agentNames.get(e.agentId ?? '') ?? 'agent' }) }
      slowest = [...slowest, slow].sort((x, y) => y.ms - x.ms).slice(0, 5)
      await publish($)
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? snapshot()
    const sort = await read($, sortAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const tools = sorted(snap.tools, sort)
    const sortButton = (
      <Button
        key="gb-sort"
        hotkey="s"
        dimColor
        label={`⇅ sort: ${SORT_LABEL[sort]}`}
        onPress={() => void update($, sortAtom, s => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length] ?? 'time')}
      />
    )
    const totals = totalsOf(snap)

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const head = headerSvg(snap, W)
      const chart = chartSvg(tools, sort, W)
      const slow = slowSvg(snap.slowest, W)
      return (
        <Box flexDirection="column">
          <Svg source={head.source} alt={`${totals.calls} tool calls, ${totals.errors} errors, ${fmtMs(totals.ms)} of tool time`} width={W} height={head.height} />
          {sortButton}
          <Svg source={chart.source} alt={tools.map(t => `${toolName(t.name)} ${t.calls} calls ${fmtMs(t.totalMs)}`).join('; ') || 'no tool calls yet'} width={W} height={chart.height} />
          {snap.slowest.length ? <Svg source={slow.source} alt={`slowest: ${snap.slowest.map(s => `${toolName(s.name)} ${fmtMs(s.ms)}`).join(', ')}`} width={W} height={slow.height} /> : null}
        </Box>
      )
    }

    const cols = Math.max(32, e.props.bodyColumns || 44)
    const isWide = cols >= 58
    const nameW = Math.min(14, Math.max(8, ...tools.map(t => toolName(t.name).length + 2)))
    const fixed = nameW + 6 + 5 + (isWide ? 7 + 7 + 7 : 7) + 8
    const barW = Math.max(4, cols - fixed - 1)
    const top = Math.max(1, ...tools.map(t => metric(t, sort)))
    const graphW = Math.max(8, cols - 12)
    const graph = brailleGraph(snap.perMinute, graphW, 2)
    const peak = Math.max(0, ...snap.perMinute)
    const mainShare = totals.calls ? snap.mainCalls / totals.calls : 1
    const splitW = Math.max(6, cols - 26)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text bold color={KZ.cyan}>⚙ {totals.calls}</Text><Text dimColor> calls  </Text>
            <Text bold color={totals.errors ? KZ.red : KZ.mist}>✖ {totals.errors}</Text><Text dimColor> err  </Text>
            <Text bold color={KZ.yellow}>Σ {fmtMs(totals.ms)}</Text>
          </Text>
          {snap.inFlight ? <Text color={KZ.green}>● {snap.inFlight} running</Text> : null}
        </Box>
        <Text wrap="truncate-end">
          <Text dimColor>main </Text>
          <Text color={KZ.violet}>{'█'.repeat(Math.round(mainShare * splitW))}</Text>
          <Text color={KZ.magenta}>{'▒'.repeat(Math.max(0, splitW - Math.round(mainShare * splitW)))}</Text>
          <Text dimColor> sub  </Text>
          <Text color={KZ.violet}>{snap.mainCalls}</Text><Text dimColor>/</Text><Text color={KZ.magenta}>{snap.subCalls}</Text>
        </Text>
        {graph.map((line, i) => (
          <Box key={`g-${i}`} flexDirection="row">
            <Box width={11} flexShrink={0}><Text dimColor>{i === 0 ? `${peak}/min` : 'calls'}</Text></Box>
            <Text color={KZ.cyan}>{line}</Text>
          </Box>
        ))}
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text dimColor>
            {padEnd('TOOL', nameW)}{padStart('CALLS', 6)}{padStart('ERR%', 5)}{isWide ? `${padStart('AVG', 7)}${padStart('P95', 7)}${padStart('MAX', 7)}` : padStart('P95', 7)}{padStart('TOTAL', 8)}
          </Text>
          {sortButton}
        </Box>
        {tools.length === 0 ? <Text dimColor>  no tool calls yet</Text> : null}
        {tools.map(t => {
          const c = toolColor(t.name)
          const errPct = t.calls ? (100 * t.errors) / t.calls : 0
          return (
            <Text key={`t-${t.name}`} wrap="truncate-end">
              <Text color={c}>{padEnd(`${toolGlyph(t.name)} ${toolName(t.name)}`, nameW)}</Text>
              <Text>{padStart(String(t.calls), 6)}</Text>
              <Text color={t.errors ? KZ.red : undefined} dimColor={!t.errors}>{padStart(t.errors ? `${Math.round(errPct)}%` : '·', 5)}</Text>
              {isWide
                ? <Text dimColor>{padStart(fmtMs(t.avgMs), 7)}{padStart(fmtMs(t.p95Ms), 7)}{padStart(fmtMs(t.maxMs), 7)}</Text>
                : <Text dimColor>{padStart(fmtMs(t.p95Ms), 7)}</Text>}
              <Text bold>{padStart(fmtMs(t.totalMs), 8)} </Text>
              <Text color={c}>{bar(metric(t, sort) / top, barW, ' ')}</Text>
            </Text>
          )
        })}
        {snap.slowest.length
          ? (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color={KZ.amber}>⏱ SLOWEST</Text>
                {snap.slowest.map((s, i) => (
                  <Text key={`s-${i}`} wrap="truncate-end">
                    <Text color={heatMs(s.ms)} bold>{padStart(fmtMs(s.ms), 7)} </Text>
                    <Text color={s.isError ? KZ.red : toolColor(s.name)}>{toolName(s.name)}</Text>
                    <Text dimColor> {s.detail}{s.agent ? ` · ${s.agent}` : ''}</Text>
                  </Text>
                ))}
              </Box>
            )
          : null}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return fmtClock(ms)
}

/** Fast is cool, slow is hot: 100 ms → green, a minute → red. */
function heatMs(ms: number): string {
  const k = clamp01(Math.log10(Math.max(100, ms) / 100) / Math.log10(600))
  return k < 0.5 ? KZ.green : k < 0.8 ? KZ.yellow : KZ.red
}

const metric = (t: GearTool, sort: GearSort) => (sort === 'calls' ? t.calls : sort === 'errors' ? t.errors : t.totalMs)

function sorted(tools: GearTool[], sort: GearSort): GearTool[] {
  return [...tools].sort((a, b) => metric(b, sort) - metric(a, sort) || b.totalMs - a.totalMs || a.name.localeCompare(b.name))
}

function totalsOf(s: GearSnap): { calls: number; errors: number; ms: number } {
  return s.tools.reduce((t, x) => ({ calls: t.calls + x.calls, errors: t.errors + x.errors, ms: t.ms + x.totalMs }), { calls: 0, errors: 0, ms: 0 })
}

// ---------------------------------------------------------------------------
// Desktop.

const CSS = `
.grow{transform-box:fill-box;transform-origin:left;animation:gbg .7s cubic-bezier(.2,.8,.2,1)}@keyframes gbg{from{transform:scaleX(0)}}
`

function headerSvg(s: GearSnap, W: number): { source: string; height: number } {
  const t = totalsOf(s)
  const p: string[] = []
  const tiles: [string, string, string][] = [
    ['CALLS', String(t.calls), KZ.cyan],
    ['ERRORS', t.calls ? `${t.errors} · ${Math.round((100 * t.errors) / t.calls)}%` : '0', t.errors ? KZ.red : KZ.mist],
    ['TOOL TIME', fmtMs(t.ms), KZ.yellow],
  ]
  const gap = 6
  const tw = (W - gap * 2) / 3
  tiles.forEach(([k, v, c], i) => {
    const x = i * (tw + gap)
    p.push(`<rect class="p" x="${x}" y="0" width="${tw}" height="54" rx="12"/>`)
    p.push(`<rect x="${x + 10}" y="12" width="3" height="30" rx="1.5" fill="${c}"/>`)
    p.push(svgText(x + 20, 23, k, { cls: 's', size: 9.5, weight: 650 }))
    p.push(svgText(x + 20, 42, fitText(v, 16, tw - 26), { size: 16, weight: 700 }))
  })
  if (s.inFlight) p.push(`<circle cx="${W - 12}" cy="12" r="4" fill="${KZ.green}" class="pulse"/>`)
  let y = 60
  // Calls per minute, as an area.
  const H = 84
  p.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${H}" rx="12"/>`)
  p.push(svgText(12, y + 18, 'CALLS / MIN', { cls: 's', size: 9.5, weight: 650 }))
  const peak = Math.max(1, ...s.perMinute)
  p.push(svgText(W - 12, y + 18, `peak ${Math.max(0, ...s.perMinute)}`, { cls: 'm', size: 10, anchor: 'end' }))
  const vals = s.perMinute.length > 1 ? s.perMinute : [0, ...s.perMinute]
  const gx = 12
  const gw = W - 24
  const gy = y + 26
  const gh = 28
  const step = gw / Math.max(1, vals.length - 1)
  const pts = vals.map((v, i) => `${(gx + i * step).toFixed(1)},${(gy + gh - (v / peak) * gh).toFixed(1)}`)
  p.push(`<defs><linearGradient id="gbA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity="0"/></linearGradient></defs>`)
  p.push(`<path d="M${pts.join('L')}L${gx + gw},${gy + gh}L${gx},${gy + gh}Z" fill="url(#gbA)"/>`)
  p.push(`<path d="M${pts.join('L')}" stroke="${KZ.cyan}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`)
  // Main loop against subagents.
  const share = t.calls ? s.mainCalls / t.calls : 1
  const sy = y + 64
  const bw = W - 24
  p.push(`<rect class="k" x="12" y="${sy}" width="${bw}" height="7" rx="3.5"/>`)
  p.push(`<clipPath id="gbS"><rect x="12" y="${sy}" width="${bw}" height="7" rx="3.5"/></clipPath>`)
  p.push(`<g clip-path="url(#gbS)"><rect x="12" y="${sy}" width="${bw * share}" height="7" fill="${KZ.violet}"/><rect x="${12 + bw * share}" y="${sy}" width="${bw * (1 - share)}" height="7" fill="${KZ.magenta}" opacity="${t.calls ? 1 : 0}"/></g>`)
  p.push(svgText(12, sy + 18, `main ${s.mainCalls} · ${fmtMs(s.mainMs)}`, { size: 9.5, fill: KZ.violet }))
  p.push(svgText(W - 12, sy + 18, `${fmtMs(s.subMs)} · ${s.subCalls} subagents`, { size: 9.5, fill: KZ.magenta, anchor: 'end' }))
  y += H + 12
  return { source: svg(W, y, p.join(''), CSS), height: y }
}

function chartSvg(tools: GearTool[], sort: GearSort, W: number): { source: string; height: number } {
  const p: string[] = []
  const rowH = 36
  const labelW = Math.min(130, Math.max(80, W * 0.28))
  const valueW = 64
  const bx = labelW + 8
  const bw = Math.max(40, W - bx - valueW - 12)
  const top = Math.max(1, ...tools.map(t => metric(t, sort)))
  let y = 12
  p.push(svgText(12, y + 6, `BY ${SORT_LABEL[sort].toUpperCase()}`, { cls: 's', size: 9.5, weight: 650 }))
  y += 16
  tools.forEach(t => {
    const c = toolColor(t.name)
    const ratio = metric(t, sort) / top
    p.push(svgText(12, y + 13, fitText(`${toolGlyph(t.name)} ${toolName(t.name)}`, 12, labelW - 8), { size: 12, weight: 600, fill: c }))
    p.push(`<g class="grow">${svgBar(bx, y + 4, bw, 11, ratio, c)}</g>`)
    if (t.errors && sort !== 'errors') {
      // The errored share of the bar, hatched red at its end.
      const fw = Math.max(11, bw * clamp01(ratio))
      const ew = Math.max(2, fw * (t.errors / t.calls))
      p.push(`<rect x="${bx + fw - ew}" y="${y + 4}" width="${ew}" height="11" rx="2" fill="${KZ.red}" opacity=".85"/>`)
    }
    const value = sort === 'calls' ? `${t.calls}×` : sort === 'errors' ? `${t.errors} err` : fmtMs(t.totalMs)
    p.push(svgText(W - 12, y + 14, value, { size: 12, weight: 700, anchor: 'end' }))
    const sub = [`${t.calls}×`, `avg ${fmtMs(t.avgMs)}`, `p95 ${fmtMs(t.p95Ms)}`, `max ${fmtMs(t.maxMs)}`, t.errors ? `${t.errors} err (${Math.round((100 * t.errors) / t.calls)}%)` : '', t.sub ? `${t.sub} in agents` : '']
    p.push(svgText(bx, y + 29, fitText(sub.filter(Boolean).join(' · '), 9.5, bw + valueW), { cls: 'm', size: 9.5 }))
    y += rowH
  })
  if (tools.length === 0) {
    p.push(svgText(W / 2, y + 12, 'No tool calls yet.', { cls: 'm', size: 11, anchor: 'middle' }))
    y += 26
  }
  const height = y + 4
  return { source: svg(W, height, `<rect class="p" x="0" y="0" width="${W}" height="${height}" rx="12"/>${p.join('')}`, CSS), height }
}

function slowSvg(list: GearSlow[], W: number): { source: string; height: number } {
  const p: string[] = []
  let y = 10
  p.push(svgText(12, y + 8, 'SLOWEST CALLS', { cls: 's', size: 9.5, weight: 650 }))
  y += 18
  const top = Math.max(1, ...list.map(s => s.ms))
  list.forEach((s, i) => {
    const c = s.isError ? KZ.red : toolColor(s.name)
    p.push(`<circle cx="22" cy="${y + 10}" r="9" fill="${c}" opacity=".18"/>`)
    p.push(svgText(22, y + 14, String(i + 1), { size: 10.5, weight: 750, anchor: 'middle', fill: c }))
    p.push(svgText(38, y + 9, fitText(`${toolName(s.name)}${s.agent ? ` · ${s.agent}` : ''}`, 11.5, W - 120), { size: 11.5, weight: 650 }))
    p.push(svgText(38, y + 23, fitText(s.detail || '—', 10, W - 120), { cls: 's', size: 10, mono: true }))
    p.push(svgText(W - 12, y + 12, fmtMs(s.ms), { size: 12, weight: 700, anchor: 'end', fill: heatMs(s.ms) }))
    p.push(svgBar(W - 72, y + 18, 60, 4, s.ms / top, heatMs(s.ms)))
    y += 32
  })
  const height = y + 4
  return { source: svg(W, height, `<rect class="p" x="0" y="0" width="${W}" height="${height}" rx="12"/>${p.join('')}`, CSS), height }
}
