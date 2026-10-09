import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MoDay, MoMetric, MoSnap } from '../types'
import { Canvas, KZ, fmtTokens, fmtUsd, mix, pxOf, svg, svgText, tokensOf } from './lib/kz.ts'
import {
  METRICS, WEEKS, addDays, addTo, bestDay, calendar, cutPoints, dayKey, isEmptyDelta, levelOf, minuteOf, monthOf, streaks, totals,
  valueOf, zeroDay,
} from './calc.ts'
import type { Days, Level } from './calc.ts'

const PANE = 'kz-mosaic'
const TITLE = 'KOZMOS · Mosaic'
const snapAtom = atom({ plugin: 'mosaic', key: 'snap' } as const, null)
const metricAtom = atom({ plugin: 'mosaic', key: 'metric' } as const, 'turns')

const DAYS_KEY = 'days'
const SEEN_KEY = 'seen'
const SESSIONS_KEY = 'sessions'
const METRIC_KEY = 'metric'

const METRIC_COLOR: Record<MoMetric, string> = { turns: KZ.green, tools: KZ.blue, tokens: KZ.violet, usd: KZ.yellow }
const METRIC_LABEL: Record<MoMetric, string> = { turns: 'turns', tools: 'tools', tokens: 'tokens', usd: '$' }
const EMPTY_TERM = '#30363d'
const LEVELS = [0, 1, 2, 3, 4] as const
const SHADE_MIX = [0, 0.35, 0.58, 0.8, 1] as const
const OPACITY = [0, 0.32, 0.55, 0.78, 1] as const

const blank = (now: number): MoSnap => ({ now, today: dayKey(now), days: {}, isWorking: false })

function fmtMetric(v: number, metric: MoMetric): string {
  if (metric === 'usd') return fmtUsd(v)
  if (metric === 'tokens') return fmtTokens(v)
  return v >= 10_000 ? fmtTokens(v) : String(Math.round(v))
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const shade = (metric: MoMetric, level: Level): string =>
  level <= 0 ? EMPTY_TERM : mix('#1f2a24', METRIC_COLOR[metric], SHADE_MIX[level])

function niceDate(key: string): string {
  return `${monthOf(key)} ${Number(key.slice(8))}`
}

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

async function setMetric($: EngineInterface, m: MoMetric): Promise<void> {
  await update($, metricAtom, () => m)
  await $.store.set(METRIC_KEY, m).catch(() => undefined)
}

// Counts not yet written, per local day; module state, flushed every 10 s.
let pending: Record<string, Partial<MoDay>> = {}
let lastMinute = -1
let live: MoSnap = blank(0)
let lastPublished = ''

function addPending(key: string, delta: Partial<MoDay>): void {
  const d = pending[key] ?? {}
  for (const [k, v] of Object.entries(delta) as [keyof MoDay, number][]) d[k] = (d[k] ?? 0) + v
  pending[key] = d
}

const bump = (now: number, delta: Partial<MoDay>): void => addPending(dayKey(now), delta)

/** Counts the current minute once as active. */
async function touch($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const m = minuteOf(now)
  if (m !== lastMinute) {
    lastMinute = m
    bump(now, { m: 1 })
  }
}

async function getObj<T>($: EngineInterface, key: string, fallback: T): Promise<T> {
  try {
    const v = await $.store.get(key)
    return v && typeof v === 'object' ? (v as T) : fallback
  } catch {
    return fallback
  }
}

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify({ ...live, now: 0 })
  if (key === lastPublished) return
  await update($, snapAtom, () => JSON.parse(JSON.stringify(live)) as MoSnap)
  // Noted once written, so a refused write is tried again on the next flush.
  lastPublished = key
}

/** Books the session's new spend, writes the pending counts, and republishes. */
let isFlushing = false
let isFlushAgain = false

/** One flush at a time: a flush asked for while one runs waits and runs once
 * after it, so two never read the stored days and write over each other. */
async function flush($: EngineInterface): Promise<void> {
  if (isFlushing) {
    isFlushAgain = true
    return
  }
  isFlushing = true
  try {
    do {
      isFlushAgain = false
      await flushOnce($)
    } while (isFlushAgain)
  } finally {
    isFlushing = false
  }
}

async function flushOnce($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (live.isWorking) await touch($)
  try {
    const u = await $.session.usage()
    if (u.cost && u.cost.usd > 0) {
      const seen = await getObj<Record<string, { usd: number; at: number }>>($, SEEN_KEY, {})
      const id = String(u.startedAt)
      const prev = seen[id]?.usd
      const delta = prev === undefined || u.cost.usd < prev ? u.cost.usd : u.cost.usd - prev
      if (delta > 0) {
        const kept: Record<string, { usd: number; at: number }> = {}
        for (const [k, v] of Object.entries(seen)) if (v && v.at >= now - 3 * 86_400_000) kept[k] = v
        kept[id] = { usd: u.cost.usd, at: now }
        await $.store.set(SEEN_KEY, kept)
        // Booked once the store remembers it, so a refused write is not counted twice.
        bump(now, { u: delta })
      }
    }
  } catch {
    // No cost this time.
  }
  let stored: Days | undefined
  try {
    const v = await $.store.get(DAYS_KEY)
    stored = v && typeof v === 'object' ? (v as Days) : {}
  } catch {
    // Unread: nothing is written over the history this time.
  }
  const toWrite = Object.entries(pending).filter(([, d]) => !isEmptyDelta(d))
  pending = {}
  let days = stored ?? {}
  for (const [k, d] of toWrite) days = addTo(days, k, d)
  const isWritten = stored !== undefined && (toWrite.length === 0 || (await $.store.set(DAYS_KEY, days).then(() => true, () => false)))
  // Counts not written wait for the next flush.
  if (!isWritten) for (const [k, d] of toWrite) addPending(k, d)
  const today = dayKey(now)
  const first = addDays(today, -(WEEKS * 7 + 7))
  const shown: Days = {}
  for (const [k, v] of Object.entries(days)) if (k >= first) shown[k] = { ...zeroDay(), ...v }
  live = { ...live, now, today, days: shown }
  await publish($)
}

/** Counts this session once, across reloads, by its start time. */
async function countSession($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const ids = await getObj<string[]>($, SESSIONS_KEY, [])
    const id = String(u.startedAt)
    if (Array.isArray(ids) && ids.includes(id)) return
    await $.store.set(SESSIONS_KEY, [...(Array.isArray(ids) ? ids : []), id].slice(-100))
    bump(await $.clock.now(), { s: 1 })
  } catch {
    // Not counted.
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    pending = {}
    lastMinute = -1
    lastPublished = ''
    live = blank(await $.clock.now())
    const m = await $.store.get(METRIC_KEY).catch(() => undefined)
    if (typeof m === 'string' && (METRICS as readonly string[]).includes(m)) await update($, metricAtom, () => m as MoMetric)
    await $.command.register({ name: 'mosaic', description: 'KOZMOS: toggle the Mosaic activity calendar sidebar', immediate: true })
    await countSession($)
    await flush($).catch(() => undefined)
    $.clock.every(10_000, () => void flush($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('session.end', async ($, e, next) => {
    await flush($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mosaic' }, async $ => {
    const opened = await toggle($)
    if (opened) await flush($).catch(() => undefined)
    return { text: opened ? 'Mosaic open.' : 'Mosaic closed.' }
  })

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    await touch($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (r.usage) {
      bump(await $.clock.now(), { k: tokensOf(r.usage) })
      await touch($)
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    bump(await $.clock.now(), { c: 1 })
    await touch($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      bump(await $.clock.now(), { t: 1 })
      await touch($)
      live.isWorking = false
      await flush($).catch(() => undefined)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const metric = await read($, metricAtom)
    const { Box, Button } = $.ui.resolve(e)

    const weeksAll = calendar(s.today, WEEKS)
    const keys = weeksAll.flat().filter((k): k is string => k !== null)
    const cuts = cutPoints(keys.map(k => valueOf(s.days[k], metric)))
    const st = streaks(s.days, s.today)
    const best = bestDay(Object.fromEntries(keys.map(k => [k, s.days[k] ?? zeroDay()])), metric)
    const sum = totals(s.days, keys)
    const today = s.days[s.today] ?? zeroDay()

    const buttons = (
      <Box key="metrics" flexDirection="row" gap={1}>
        {METRICS.map((m, i) => (
          <Button
            key={`m-${m}`}
            label={METRIC_LABEL[m]}
            hotkey={String(i + 1)}
            variant={m === metric ? 'primary' : 'secondary'}
            dimColor={m !== metric}
            onPress={() => void setMetric($, m)}
          />
        ))}
      </Box>
    )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(e.props.bodyColumns, 44)
      const cards = [
        calendarCard(s, weeksAll, metric, cuts, st.current, W),
        statsCard(metric, st, best, sum, W),
        todayCard(today, s.isWorking, W),
      ]
      return (
        <Box flexDirection="column">
          {buttons}
          {cards.map((c, i) => <Svg key={`c${i}`} source={c.source} alt={c.alt} width={W} height={c.height} isInteractive={c.isInteractive} />)}
        </Box>
      )
    }

    // ---- terminal ----
    const { Text, Raster } = $.ui.resolve(e)
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const cell = 2 + WEEKS * 2 <= cols ? 2 : 1
    const weeks = Math.min(WEEKS, Math.floor((cols - 2) / cell))
    const shownWeeks = weeksAll.slice(-weeks)
    const c = metricColor(metric)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={c}>◆ MOSAIC · {METRIC_LABEL[metric]}</Text>
          <Text color={st.current ? KZ.amber : KZ.mist}>{st.current ? `▲ ${st.current}-day streak` : 'no streak'}</Text>
        </Box>
        {buttons}
        <Raster key="cal" columns={Math.min(cols, 2 + weeks * cell)} rows={8} cells={calendarRaster(s, shownWeeks, metric, cuts, cell, Math.min(cols, 2 + weeks * cell)).encode()} />
        <Text wrap="truncate-end">
          <Text dimColor>less </Text>
          {LEVELS.map(l => <Text key={`l${l}`} color={shade(metric, l)}>■</Text>)}
          <Text dimColor> more · {weeks} weeks</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color={KZ.amber}>streak {st.current}d</Text>
          <Text dimColor> · longest {st.longest}d · best {best ? `${niceDate(best.date)} (${fmtMetric(best.value, metric)})` : '—'}</Text>
        </Text>
        <Text wrap="truncate-end" dimColor>
          Σ {fmtMetric(sum.t, 'turns')} turns · {fmtMetric(sum.c, 'tools')} tools · {fmtTokens(sum.k)} tok · {fmtUsd(sum.u)} · {fmtMinutes(sum.m)} · {sum.s} sessions
        </Text>
        <Text wrap="truncate-end">
          <Text color={c} bold>today </Text>
          <Text>{today.t} turns · {today.c} tools · {fmtTokens(today.k)} tok · {fmtUsd(today.u)} · {fmtMinutes(today.m)} · {today.s} sess.</Text>
        </Text>
      </Box>
    )
  })
}

const metricColor = (m: MoMetric): string => METRIC_COLOR[m]

/** Month labels on row 0; weekday initials M W F in the first two columns; one square per day. */
function calendarRaster(s: MoSnap, weeks: (string | null)[][], metric: MoMetric, cuts: [number, number, number], cell: number, cols: number): Canvas {
  const c = new Canvas(cols, 8)
  for (const [row, ch] of [[2, 'M'], [4, 'W'], [6, 'F']] as const) c.set(0, row, ch, KZ.mist)
  let labelEnd = -1
  let lastMonth = ''
  weeks.forEach((week, w) => {
    const x = 2 + w * cell
    const mon = monthOf(week[0]!) // a week's Sunday is never after today
    if (mon !== lastMonth) {
      if (x > labelEnd && x + 3 <= cols) {
        c.text(x, 0, mon, KZ.mist)
        labelEnd = x + 3
      }
      lastMonth = mon
    }
    week.forEach((key, d) => {
      if (key === null) return
      const lvl = levelOf(valueOf(s.days[key], metric), cuts)
      c.set(x, d + 1, key === s.today ? '◆' : '■', key === s.today && lvl === 0 ? KZ.mist : shade(metric, lvl))
    })
  })
  return c
}

// ---------------------------------------------------------------------------
// Desktop.

type Card = { source: string; alt: string; height: number; isInteractive?: boolean }

const MO_CSS = `
.mo4{animation:mob 3.2s ease-in-out infinite}@keyframes mob{50%{opacity:.72}}
.motd{animation:mot 1.4s ease-in-out infinite}@keyframes mot{50%{stroke-opacity:.2}}
`

function calendarCard(s: MoSnap, weeks: (string | null)[][], metric: MoMetric, cuts: [number, number, number], streak: number, W: number): Card {
  const pad = 14
  const labelW = 26
  const gap = 3
  const n = weeks.length
  const sq = Math.max(6, Math.min(16, Math.floor((W - pad * 2 - labelW - gap * (n - 1)) / n)))
  const gx = pad + labelW
  const gy = 46
  const H = gy + 7 * (sq + gap) + 30
  const base = METRIC_COLOR[metric]
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(svgText(pad, 22, `ACTIVITY · ${METRIC_LABEL[metric].toUpperCase()}`, { cls: 's', size: 10.5, weight: 650 }))
  if (streak > 0) {
    const txt = `▲ ${streak}-day streak`
    const cw = txt.length * 6.4 + 16
    p.push(`<rect x="${W - pad - cw}" y="9" width="${cw}" height="18" rx="9" fill="${KZ.amber}" opacity=".18"/>`)
    p.push(svgText(W - pad - cw / 2, 22, txt, { size: 10.5, weight: 700, anchor: 'middle', fill: KZ.amber }))
  }
  for (const [d, label] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']] as const) {
    p.push(svgText(pad, gy + d * (sq + gap) + sq - 1, label, { cls: 'm', size: 9 }))
  }
  let lastMonth = ''
  let labelEnd = -1
  weeks.forEach((week, w) => {
    const x = gx + w * (sq + gap)
    const mon = monthOf(week[0]!) // a week's Sunday is never after today
    if (mon !== lastMonth) {
      if (x > labelEnd) {
        p.push(svgText(x, gy - 8, mon, { cls: 'm', size: 9.5 }))
        labelEnd = x + 26
      }
      lastMonth = mon
    }
    week.forEach((key, d) => {
      if (key === null) return
      const y = gy + d * (sq + gap)
      const v = valueOf(s.days[key], metric)
      const lvl = levelOf(v, cuts)
      const tip = `<title>${niceDate(key)} · ${fmtMetric(v, metric)} ${METRIC_LABEL[metric] === '$' ? '' : METRIC_LABEL[metric]}</title>`
      const r = Math.min(3, sq / 4).toFixed(1)
      if (lvl === 0) p.push(`<rect class="k" x="${x}" y="${y}" width="${sq}" height="${sq}" rx="${r}">${tip}</rect>`)
      else {
        const op = OPACITY[lvl]
        const delay = ((w * 7 + d) % 11) * 0.29
        p.push(`<rect x="${x}" y="${y}" width="${sq}" height="${sq}" rx="${r}" fill="${base}" fill-opacity="${op}" ${lvl === 4 ? `class="mo4" style="animation-delay:${delay.toFixed(2)}s"` : ''}>${tip}</rect>`)
      }
      if (key === s.today) p.push(`<rect x="${x - 1.5}" y="${y - 1.5}" width="${sq + 3}" height="${sq + 3}" rx="${(Number(r) + 1.5).toFixed(1)}" fill="none" stroke="${base}" stroke-width="1.5" class="motd"/>`)
    })
  })
  // Legend.
  const ly = H - 14
  let lx = W - pad - 5 * (10 + 3) - 30
  p.push(svgText(lx - 6, ly, 'less', { cls: 'm', size: 9, anchor: 'end' }))
  for (let l = 0; l <= 4; l++) {
    p.push(l === 0 ? `<rect class="k" x="${lx}" y="${ly - 9}" width="10" height="10" rx="2.5"/>` : `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2.5" fill="${base}" fill-opacity="${OPACITY[l]}"/>`)
    lx += 13
  }
  p.push(svgText(lx + 3, ly, 'more', { cls: 'm', size: 9 }))
  return {
    source: svg(W, H, p.join(''), MO_CSS),
    height: H,
    isInteractive: true,
    alt: `Activity calendar of the last ${weeks.length} weeks by ${METRIC_LABEL[metric]}`,
  }
}

function statsCard(metric: MoMetric, st: { current: number; longest: number }, best: { date: string; value: number } | undefined, sum: MoDay, W: number): Card {
  const tiles: [string, string, string, string][] = [
    ['STREAK', `${st.current}d`, st.current ? 'keep it going' : 'start one today', KZ.amber],
    ['LONGEST', `${st.longest}d`, 'in a row', KZ.magenta],
    ['BEST DAY', best ? fmtMetric(best.value, metric) : '—', best ? niceDate(best.date) : 'no data yet', METRIC_COLOR[metric]],
    ['26 WEEKS', fmtMetric(valueOf(sum, metric), metric), `${sum.s} sessions · ${fmtMinutes(sum.m)}`, KZ.cyan],
  ]
  const gap = 6
  const tw = (W - gap) / 2
  const th = 60
  const H = th * 2 + gap
  const p: string[] = []
  tiles.forEach(([k, v, sub, c], i) => {
    const x = (i % 2) * (tw + gap)
    const y = Math.floor(i / 2) * (th + gap)
    p.push(`<rect class="p" x="${x}" y="${y}" width="${tw}" height="${th}" rx="12"/>`)
    p.push(`<rect x="${x + 10}" y="${y + 11}" width="3" height="38" rx="1.5" fill="${c}"/>`)
    p.push(svgText(x + 20, y + 22, k, { cls: 's', size: 10, weight: 650 }))
    p.push(svgText(x + 20, y + 41, v, { size: 16, weight: 740 }))
    p.push(svgText(x + 20, y + 53, sub, { cls: 'm', size: 9.5 }))
  })
  return {
    source: svg(W, H, p.join('')),
    height: H,
    alt: `Current streak ${st.current} days, longest ${st.longest} days, best day ${best ? `${niceDate(best.date)} with ${fmtMetric(best.value, metric)}` : 'none'}`,
  }
}

function todayCard(d: MoDay, isWorking: boolean, W: number): Card {
  const pad = 14
  const H = 64
  const chips: [string, string, string][] = [
    ['turns', String(d.t), KZ.green],
    ['tools', String(d.c), KZ.blue],
    ['tokens', fmtTokens(d.k), KZ.violet],
    ['spent', fmtUsd(d.u), KZ.yellow],
    ['active', fmtMinutes(d.m), KZ.cyan],
    ['sessions', String(d.s), KZ.magenta],
  ]
  const p: string[] = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>`]
  p.push(`<circle cx="${pad + 4}" cy="18" r="4" fill="${isWorking ? KZ.green : KZ.mist}" class="${isWorking ? 'pulse' : ''}"/>`)
  p.push(svgText(pad + 14, 22, 'TODAY', { cls: 's', size: 10.5, weight: 650 }))
  const cw = (W - pad * 2) / chips.length
  chips.forEach(([k, v, c], i) => {
    const x = pad + i * cw
    p.push(svgText(x, 44, v, { size: 13, weight: 720, fill: c }))
    p.push(svgText(x, 56, k, { cls: 'm', size: 9 }))
  })
  return {
    source: svg(W, H, p.join(''), MO_CSS),
    height: H,
    alt: `Today: ${d.t} turns, ${d.c} tool calls, ${fmtTokens(d.k)} tokens, ${fmtUsd(d.u)}, ${fmtMinutes(d.m)} active, ${d.s} sessions`,
  }
}
