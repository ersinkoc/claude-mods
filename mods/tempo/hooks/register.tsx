import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TempoSnap } from '../types'
import { KZ, fitText, pxOf, svg, svgBar, svgText, xml } from './lib/kz.ts'
import { catchUp, dayKey, isTimer, mmss, nextPhase, phaseLabel, parseStart, pruneDays, remainingMs, startTimer } from './timer.ts'
import type { Phase, Timer } from './timer.ts'

const snapAtom = atom({ plugin: 'tempo', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'tempo', key: 'isHidden' } as const, false)

// Module memory, reloaded from $.store on session.start.
let timer: Timer | null = null
let days: Record<string, number> = {}
let isClaudeWorking = false
let shouldSpeak = false
let lastPublished = ''

async function saveTimer($: EngineInterface): Promise<void> {
  try {
    if (timer) await $.store.set('timer', timer)
    else await $.store.delete('timer')
  } catch {
    // Kept in memory for this session.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const snap: TempoSnap | null = timer
    ? {
        phase: timer.phase,
        startedAt: timer.startedAt,
        endsAt: timer.endsAt,
        now,
        workMin: timer.workMin,
        breakMin: timer.breakMin,
        round: timer.round,
        today: days[dayKey(now)] ?? 0,
        isClaudeWorking,
      }
    : null
  const key = JSON.stringify(snap ? { ...snap, now: Math.floor(now / 1000) } : null)
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => snap)
}

async function announce($: EngineInterface, ended: Phase, after: Timer, at: number): Promise<void> {
  let text: string
  let spoken: string
  if (ended === 'work') {
    const k = dayKey(at)
    days = pruneDays({ ...days, [k]: (days[k] ?? 0) + 1 })
    try {
      await $.store.set('days', days)
    } catch {
      // The tally stays in memory.
    }
    const mins = Math.round((after.endsAt - after.startedAt) / 60_000)
    text = `🍅 Focus round ${after.round} done — ${after.phase === 'long' ? 'long break' : 'break'}, ${mins} min. 🍅×${days[k]} today`
    spoken = `Focus round done. Take ${mins} minutes.`
  } else {
    text = `☕ Break over — focus round ${after.round}, ${after.workMin} min. Let's go.`
    spoken = 'Break over. Back to focus.'
  }
  $.ui.toast(text, { timeoutMs: 9000 })
  if (shouldSpeak) {
    try {
      await $.audio.speak(spoken)
    } catch {
      // No synthesizer here.
    }
  }
}

async function tick($: EngineInterface): Promise<void> {
  if (!timer) return
  const now = await $.clock.now()
  const { timer: moved, finished } = catchUp(timer, now)
  if (finished.length) {
    timer = moved
    await saveTimer($)
    // Several phases slept through: only the latest is worth a toast.
    const last = finished[finished.length - 1]
    for (const p of finished.slice(0, -1)) if (p === 'work') days = pruneDays({ ...days, [dayKey(now)]: (days[dayKey(now)] ?? 0) + 1 })
    if (last) await announce($, last, moved, now)
  }
  await publish($)
}

async function setHidden($: EngineInterface, value: boolean): Promise<void> {
  await update($, hiddenAtom, () => value)
  try {
    await $.store.set('hidden', value)
  } catch {
    // Session only.
  }
}

function status(now: number): string {
  const today = days[dayKey(now)] ?? 0
  const tally = `🍅×${today} today`
  if (!timer) return `No timer running · ${tally}. Start one with /tempo start [work=25] [break=5].`
  return `${timer.phase === 'work' ? '🍅' : '☕'} ${phaseLabel(timer.phase)}${timer.phase === 'work' ? ` round ${timer.round}` : ''} · ${mmss(remainingMs(timer, now))} left · ${timer.workMin}/${timer.breakMin} min · ${tally}`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    shouldSpeak = options.speak === true
    lastPublished = ''
    isClaudeWorking = false
    try {
      const t = await $.store.get('timer')
      timer = isTimer(t) ? t : null
      const d = await $.store.get('days')
      days = d && typeof d === 'object' ? pruneDays(d as Record<string, number>) : {}
      const isHidden = (await $.store.get('hidden')) === true
      await update($, hiddenAtom, () => isHidden)
    } catch {
      timer = null
      days = {}
    }
    await $.command.register({ name: 'tempo', description: 'KOZMOS: Pomodoro focus timer (start [work] [break], stop, skip, hide, show)', argumentHint: '[start [work=25] [break=5] | stop | skip | hide | show]', immediate: true })
    await tick($).catch(() => undefined)
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'tempo' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const verb = (words[0] ?? '').toLowerCase()
    const now = await $.clock.now()
    if (verb === 'start') {
      const parsed = parseStart(words.slice(1))
      if ('error' in parsed) return { text: parsed.error }
      timer = startTimer(now, parsed.workMin, parsed.breakMin)
      await saveTimer($)
      await setHidden($, false)
      await publish($)
      return { text: `🍅 Focus round 1 · ${parsed.workMin} min, then ${parsed.breakMin} min break. /tempo stop ends it.` }
    }
    if (verb === 'stop') {
      if (!timer) return { text: 'No timer is running.' }
      timer = null
      await saveTimer($)
      await publish($)
      return { text: `Timer stopped · 🍅×${days[dayKey(now)] ?? 0} today.` }
    }
    if (verb === 'skip') {
      if (!timer) return { text: 'No timer is running.' }
      timer = nextPhase(timer, now)
      await saveTimer($)
      await publish($)
      return { text: `Skipped to ${phaseLabel(timer.phase).toLowerCase()} · ${mmss(remainingMs(timer, now))}.` }
    }
    if (verb === 'hide' || verb === 'show') {
      await setHidden($, verb === 'hide')
      return { text: verb === 'hide' ? 'Tempo band hidden (the timer keeps running).' : 'Tempo band shown.' }
    }
    return { text: status(now) }
  })

  on('turn.start', async ($, e, next) => {
    isClaudeWorking = true
    void publish($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isClaudeWorking = false
      void publish($).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    const snap = await read($, snapAtom)
    if (!snap || e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const cols = Math.max(30, e.props.bodyColumns || 80)
    const remain = Math.max(0, snap.endsAt - snap.now)
    const total = Math.max(1, snap.endsAt - snap.startedAt)
    const hide = <Button key="tempo-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    let mine
    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(cols)
      mine = (
        <Box key="tempo" flexDirection="row">
          <Svg source={ringRow(snap, W)} alt={altOf(snap)} width={W} height={48} />
          {hide}
        </Box>
      )
    } else if ('Client' in ui) {
      const { Client } = ui
      const props = { cols: cols - 3, phase: snap.phase, remain, total, round: snap.round, today: snap.today, claude: snap.isClaudeWorking }
      mine = (
        <Box key="tempo" flexDirection="row">
          <Client key="tempo-band" module="./band.tsx" width={cols - 3} height={1} props={props} />
          {hide}
        </Box>
      )
    } else {
      mine = (
        <Box key="tempo" flexDirection="row">
          <Text>{altOf(snap)} </Text>
          {hide}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {drawn}
        {mine}
      </Box>
    )
  })
}

function altOf(s: TempoSnap): string {
  const left = mmss(Math.max(0, s.endsAt - s.now))
  const what = s.phase === 'work' ? `Focus round ${s.round}` : s.phase === 'long' ? 'Long break' : 'Break'
  const claude = s.phase !== 'work' && s.isClaudeWorking ? ' — Claude keeps going ☕' : ''
  return `${s.phase === 'work' ? '🍅' : '☕'} ${what} · ${left} left · 🍅×${s.today} today${claude}`
}

/** The desktop row: a progress ring around a tomato (or cup), the clock, round pips and today's tally. */
function ringRow(s: TempoSnap, W: number): string {
  const isWork = s.phase === 'work'
  const col = isWork ? '#ef4444' : KZ.teal
  const remain = Math.max(0, s.endsAt - s.now)
  const total = Math.max(1, s.endsAt - s.startedAt)
  const p = Math.max(0, Math.min(1, 1 - remain / total))
  const r = 17
  const C = 2 * Math.PI * r
  const cx = 24
  const cy = 24
  const secs = Math.max(1, Math.ceil(remain / 1000))
  // Unique per drawing: inline SVGs on one page share keyframe names.
  const anim = `tpa${Math.round(p * 1e5)}`
  const css = `
.tp-trk{stroke:#e7e5e0}@media (prefers-color-scheme: dark){.tp-trk{stroke:#2d2d2b}}
.tp-arc{stroke-dasharray:${C.toFixed(2)};animation:${anim} ${secs}s linear forwards}
@keyframes ${anim}{from{stroke-dashoffset:${(C * (1 - p)).toFixed(2)}}to{stroke-dashoffset:0}}
.tp-bob{transform-box:fill-box;transform-origin:center bottom;animation:tpb 2.4s ease-in-out infinite}
@keyframes tpb{50%{transform:translateY(-1px) rotate(-4deg)}}
.tp-stm{animation:tps 2.2s ease-in-out infinite;opacity:0}.tp-stm2{animation-delay:.7s}.tp-stm3{animation-delay:1.4s}
@keyframes tps{0%{opacity:0;transform:translateY(3px)}40%{opacity:.8}100%{opacity:0;transform:translateY(-6px)}}
.tp-hot{animation:tph 1s ease-in-out infinite}@keyframes tph{50%{opacity:.45}}
.tp-dots tspan{animation:tpd 1.2s infinite;opacity:.2}.tp-dots tspan:nth-child(2){animation-delay:.2s}.tp-dots tspan:nth-child(3){animation-delay:.4s}
@keyframes tpd{40%{opacity:1}}
`
  const parts: string[] = []
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="48" rx="12"/>`)
  parts.push(`<circle class="tp-trk" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="4"/>`)
  parts.push(`<g class="${remain < 60_000 ? 'tp-hot' : ''}"><circle class="tp-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/></g>`)
  if (isWork) {
    // A tomato: round body, a highlight, a five-point calyx and a stem.
    parts.push(`<g class="tp-bob"><circle cx="${cx}" cy="${cy + 1.5}" r="8.5" fill="#ef4444"/><ellipse cx="${cx - 3}" cy="${cy - 1}" rx="2.4" ry="1.6" fill="#fecaca" opacity=".8"/>` +
      `<path d="M${cx} ${cy - 6.5}l-4.2-1.2 2.6 2.6-3.6 1.4 4.2.2 1 3 1-3 4.2-.2-3.6-1.4 2.6-2.6z" fill="#22c55e"/><path d="M${cx} ${cy - 6.5}v-3" stroke="#15803d" stroke-width="1.6" stroke-linecap="round"/></g>`)
  } else {
    // A cup with three wisps of steam.
    parts.push(`<path d="M${cx - 7} ${cy - 2}h12v5a6 6 0 0 1-6 6a6 6 0 0 1-6-6z" fill="${KZ.teal}"/><path d="M${cx + 5} ${cy}h1.5a2.3 2.3 0 0 1 0 4.6h-2" stroke="${KZ.teal}" stroke-width="1.6" fill="none"/>`)
    for (const [i, dx] of [[1, -4], [2, -1], [3, 2]] as const) {
      parts.push(`<path class="tp-stm tp-stm${i}" d="M${cx + dx} ${cy - 4}c-1.5-1.5 1.5-2.5 0-4.5" stroke="#94a3b8" stroke-width="1.2" fill="none" stroke-linecap="round"/>`)
    }
  }
  const x = 54
  const label = isWork ? `FOCUS · ROUND ${s.round}` : s.phase === 'long' ? 'LONG BREAK' : 'BREAK'
  parts.push(svgText(x, 18, label, { size: 10, weight: 700, fill: col }))
  parts.push(svgText(x, 38, mmss(remain), { size: 19, weight: 700, mono: true }))
  const span = isWork ? `of ${s.workMin} min` : `of ${Math.round(total / 60_000)} min`
  parts.push(svgText(x + 64, 38, span, { cls: 'm', size: 10.5 }))
  const roomy = W >= 420
  // A track from here to the pips: the phase's progress with a glowing head,
  // then either Claude's note or when the phase ends.
  const tx0 = x + 128
  const tx1 = roomy ? W - 178 : W - 14
  if (tx1 - tx0 > 60) {
    const tw = tx1 - tx0
    parts.push(svgBar(tx0, 14, tw, 6, p, col))
    parts.push(`<circle class="pulse" cx="${(tx0 + Math.max(3, tw * p)).toFixed(1)}" cy="17" r="4.5" fill="${col}" opacity=".45"/>`)
    if (!isWork && s.isClaudeWorking) {
      parts.push(`<text class="s tp-dots" x="${tx0}" y="38" font-size="11.5" font-family="-apple-system,'Segoe UI',sans-serif">${xml(fitText('Break — Claude keeps going ☕', 11.5, tw - 20))}<tspan>.</tspan><tspan>.</tspan><tspan>.</tspan></text>`)
    } else {
      const end = new Date(s.endsAt)
      const hhmm = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
      parts.push(svgText(tx0, 38, `${isWork ? 'break at' : 'back to focus at'} ${hhmm}`, { cls: 'm', size: 10.5 }))
    }
  }
  if (!roomy) return svg(W, 48, parts.join(''), css)
  // Round pips: the four rounds of a cycle, the current one pulsing.
  const inCycle = ((s.round - 1) % 4) + 1
  const pipX = W - 150
  for (let i = 1; i <= 4; i++) {
    const done = i < inCycle || (i === inCycle && !isWork)
    const cur = i === inCycle && isWork
    parts.push(`<circle cx="${pipX + (i - 1) * 12}" cy="16" r="3.6" ${done || cur ? `fill="#ef4444"` : 'class="k"'}${cur ? ' class="pulse"' : ''}/>`)
  }
  parts.push(svgText(pipX + 46, 19, 'cycle', { cls: 'm', size: 9.5 }))
  // Today's tally: little tomatoes, then the count.
  const shown = Math.min(6, s.today)
  for (let i = 0; i < shown; i++) {
    const tx = W - 150 + i * 11
    parts.push(`<circle cx="${tx}" cy="35" r="4" fill="#ef4444"/><path d="M${tx - 2} ${cy + 7.5}l2 1.5 2-1.5" stroke="#22c55e" stroke-width="1.2" fill="none"/>`)
  }
  parts.push(svgText(W - 12, 38, `×${s.today} today`, { cls: 's', size: 11, weight: 600, anchor: 'end' }))
  return svg(W, 48, parts.join(''), css)
}
