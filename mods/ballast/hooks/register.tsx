import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BallastSnap } from '../types'
import { KZ, clamp01, fitText, fmtPct, fmtTokens, heat, mix, pxOf, svg, svgText } from './lib/kz.ts'

const SNOOZE_POINTS = 4
const AUTO_GAP_MS = 60_000

const blank = (warnAt: number, actAt: number, autoCompact: boolean): BallastSnap => ({
  percent: null,
  tokens: null,
  window: 1_000_000,
  warnAt,
  actAt,
  autoCompact,
  isWorking: false,
  isQueued: false,
  isCompacting: false,
  snoozedAt: null,
  last: null,
})

const snapAtom = atom({ plugin: 'ballast', key: 'snap' } as const, blank(75, 88, false))
const hiddenAtom = atom({ plugin: 'ballast', key: 'isHidden' } as const, false)

// ---------------------------------------------------------------------------
// The live coach. Module state starts over on a reload; session.start fills it.

let live: BallastSnap = blank(75, 88, false)
let hasWarned = false
let isAutoArmed = true
let lastAutoAt = 0
let publishedKey = ''

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify(live)
  if (key === publishedKey) return
  publishedKey = key
  const copy: BallastSnap = { ...live, last: live.last ? { ...live.last } : null }
  await update($, snapAtom, () => copy)
}

async function observe($: EngineInterface, percent: number | undefined, tokens: number | undefined, window: number): Promise<void> {
  if (percent === undefined || !Number.isFinite(percent)) return
  live.percent = Math.round(percent * 10) / 10
  live.tokens = tokens ?? null
  live.window = window || live.window
  if (live.percent < live.warnAt) hasWarned = false
  if (live.percent < live.actAt) isAutoArmed = true
  if (live.snoozedAt !== null && live.percent < live.snoozedAt - SNOOZE_POINTS) live.snoozedAt = null
  if (live.percent >= live.warnAt && live.percent < live.actAt && !hasWarned) {
    hasWarned = true
    $.ui.toast(`⚓ ballast: context at ${fmtPct(live.percent)} — plan a /compact before it fills`, { timeoutMs: 6000 })
  }
  if (live.percent >= live.actAt) hasWarned = true
  if (live.autoCompact && live.percent >= live.actAt && isAutoArmed && !live.isCompacting) {
    const now = await $.clock.now()
    if (now - lastAutoAt > AUTO_GAP_MS) {
      isAutoArmed = false
      lastAutoAt = now
      if (live.isWorking) live.isQueued = true
      else $.clock.after(250, () => void compactNow($).catch(() => undefined))
    }
  }
  await publish($)
}

async function sample($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    await observe($, u.context.percent, u.context.tokens, u.context.window)
  } catch {
    // Keep the last reading.
  }
}

/** Compacts now between turns, or queues it for the end of the running turn. */
async function compactNow($: EngineInterface): Promise<string> {
  if (live.isCompacting) return 'Already compacting.'
  if (live.isWorking) {
    live.isQueued = true
    await publish($)
    $.ui.toast('⚓ ballast: compaction queued for the end of this turn')
    return 'Queued: ballast compacts when this turn ends.'
  }
  live.isQueued = false
  live.isCompacting = true
  await publish($)
  const before = live.tokens
  try {
    const r = await $.session.compact()
    live.isCompacting = false
    if (r.skip !== undefined) {
      $.ui.toast(`⚓ ballast: compaction skipped — ${r.skip}`)
      await publish($)
      return `Compaction skipped: ${r.skip}`
    }
    await sample($)
    const b = r.tokensBefore ?? before
    const a = r.tokensAfter ?? live.tokens
    live.last = { before: b ?? null, after: a ?? null, at: await $.clock.now(), by: 'ballast' }
    live.snoozedAt = null
    await publish($)
    const text = compactedText(b ?? null, a ?? null)
    $.ui.toast(text, { timeoutMs: 8000 })
    return text
  } catch (err) {
    // A turn started under us: try again when it ends.
    live.isCompacting = false
    live.isQueued = true
    await publish($)
    return `Could not compact now (${err instanceof Error ? err.message : String(err)}); queued for the end of the next turn.`
  }
}

function compactedText(before: number | null, after: number | null): string {
  if (before && after !== null) {
    const cut = Math.round((1 - after / before) * 100)
    return `⚓ compacted: ${fmtTokens(before)} → ${fmtTokens(after)} tokens (−${Math.max(0, cut)}%)`
  }
  if (after !== null) return `⚓ compacted: now ${fmtTokens(after)} tokens`
  return '⚓ compacted.'
}

async function snooze($: EngineInterface): Promise<void> {
  live.snoozedAt = live.percent
  await publish($)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session at least.
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  try {
    const v = await $.store.get('isHidden')
    if (typeof v === 'boolean') await update($, hiddenAtom, () => v)
  } catch {
    // Nothing stored yet.
  }
}

async function setWorking($: EngineInterface, isWorking: boolean): Promise<void> {
  live.isWorking = isWorking
  await publish($)
}

async function afterTurn($: EngineInterface): Promise<void> {
  await setWorking($, false)
  await sample($)
  if (live.isQueued && !live.isCompacting) await compactNow($)
}

async function noteCompaction($: EngineInterface, before: number | null, after: number | null, by: string): Promise<void> {
  live.last = { before, after, at: await $.clock.now(), by }
  live.snoozedAt = null
  live.isQueued = false
  await sample($)
  if (live.last.after === null && live.tokens !== null) live.last.after = live.tokens
  await publish($)
  $.ui.toast(compactedText(before, live.last.after), { timeoutMs: 8000 })
}

const isBandDue = (s: BallastSnap): boolean =>
  s.percent !== null && s.percent >= s.actAt && (s.snoozedAt === null || s.percent >= s.snoozedAt + SNOOZE_POINTS)

export const register: Register = (on, options) => {
  const warnAt = Math.max(1, Math.min(99, Number(options.warnAt ?? 75) || 75))
  const actAt = Math.max(warnAt, Math.min(100, Number(options.actAt ?? 88) || 88))
  const autoCompact = options.autoCompact === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank(warnAt, actAt, autoCompact)
    hasWarned = false
    isAutoArmed = true
    lastAutoAt = 0
    publishedKey = ''
    await $.command.register({ name: 'ballast', description: 'KOZMOS: the context coach band — toggle it; /ballast now compacts, /ballast status reports', argumentHint: '[now|status]', immediate: true })
    await loadHidden($)
    await sample($)
    return started
  })

  on('command.run', { command: 'ballast' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'now' || arg === 'compact') return { text: await compactNow($) }
    if (arg === 'status') {
      await sample($)
      const last = live.last ? ` Last compaction: ${compactedText(live.last.before, live.last.after).replace('⚓ ', '')} (${live.last.by}).` : ''
      return { text: `⚓ ballast: context ${fmtPct(live.percent ?? undefined)} (${fmtTokens(live.tokens ?? 0)} of ${fmtTokens(live.window)}); warn at ${warnAt}%, act at ${actAt}%, auto-compact ${autoCompact ? 'on' : 'off'}.${last}` }
    }
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'ballast band hidden. /ballast shows it again.' : 'ballast band shown: it appears when the context passes ' + actAt + '%.' }
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('context')) await observe($, e.context.percent, e.context.tokens, e.context.window)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await setWorking($, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // Between turns only: the queued compaction runs once this turn has ended.
    if (e.agentId === undefined) $.clock.after(300, () => void afterTurn($).catch(() => undefined))
    return r
  })

  // Every other compaction (/compact, the engine's own): toast before → after.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && r.skip === undefined) {
      void noteCompaction($, r.tokensBefore ?? live.tokens, r.tokensAfter ?? null, e.trigger === 'manual' ? 'you' : e.trigger).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const s = await read($, snapAtom)
    if (!isBandDue(s) && !s.isQueued && !s.isCompacting) return drawn
    const ui = $.ui.resolve(e)
    const cols = Math.max(30, e.props.bodyColumns || 80)
    const pct = s.percent ?? 0
    const status = s.isCompacting ? 'compacting…' : s.isQueued ? 'compaction queued for the end of this turn' : 'compact before the next big task'
    const head = `⚓ ctx ${fmtPct(pct)} — ${status}`
    const onCompact = () => void compactNow($).catch(() => undefined)
    const onSnooze = () => void snooze($).catch(() => undefined)
    const { Box, Button } = ui
    const buttons = [
      !s.isCompacting && !s.isQueued ? <Button key="ballast-compact" label="Compact now" onPress={onCompact} /> : null,
      !s.isCompacting ? <Button key="ballast-snooze" label="Not now" plain onPress={onSnooze} /> : null,
      <Button key="ballast-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />,
    ]

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = Math.max(260, pxOf(cols) - 250)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="ballast" flexDirection="row" alignItems="center" gap={1}>
            <Svg source={bandSvg(W, s, status)} alt={`${head}; ${fmtTokens(s.tokens ?? 0)} of ${fmtTokens(s.window)} tokens`} width={W} height={56} />
            {buttons}
          </Box>
        </Box>
      )
    }

    const { Text } = ui
    const gaugeW = Math.max(10, Math.min(60, cols - 24))
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="ballast" flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text bold color={heat(pct / 100)}>{head}</Text>
            </Text>
            <Box flexDirection="row" gap={1}>{buttons}</Box>
          </Box>
          <Text wrap="truncate-end">
            {waterLine(pct, s.warnAt, s.actAt, gaugeW).map(r => <Text key={r.key} color={r.color}>{r.ch}</Text>)}
            <Text dimColor> {fmtTokens(s.tokens ?? 0)}/{fmtTokens(s.window)}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}

/** The terminal gauge: a waterline with marks at warnAt and actAt. */
function waterLine(pct: number, warnAt: number, actAt: number, width: number): Run[] {
  const fill = Math.round(clamp01(pct / 100) * width)
  const warnCol = Math.round((warnAt / 100) * width)
  const actCol = Math.round((actAt / 100) * width)
  const out: Run[] = [textRun('▕', KZ.mist, 'l')]
  for (let i = 0; i < width; i++) {
    const isMark = i === warnCol || i === actCol
    if (i < fill) out.push(textRun(i % 2 ? '≈' : '~', mix(KZ.cyan, heat(pct / 100), i / Math.max(1, width)), `w${i}`))
    else out.push(textRun(isMark ? '┊' : '·', isMark ? (i === actCol ? KZ.red : KZ.yellow) : KZ.mist, `w${i}`))
  }
  out.push(textRun('▏', KZ.mist, 'r'))
  return out
}

type Run = { ch: string; color: string; key: string }

function textRun(ch: string, color: string, key: string): Run {
  return { ch, color, key }
}

/** The desktop band: an anchor, the words, and a tank whose water rises with the context. */
function bandSvg(W: number, s: BallastSnap, status: string): string {
  const pct = s.percent ?? 0
  const level = clamp01(pct / 100)
  const c = heat(level)
  const tankW = Math.min(220, Math.max(110, W * 0.32))
  const tankX = W - tankW - 10
  const tankY = 6
  const tankH = 44
  const waterY = tankY + tankH * (1 - level)
  const markY = (p: number) => tankY + tankH * (1 - p / 100)
  const wave = (amp: number, len: number, y: number) => {
    let d = `M${tankX - len} ${y}`
    for (let x = tankX - len; x < tankX + tankW + len; x += len) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`
    return `${d} V${tankY + tankH + 4} H${tankX - len} Z`
  }
  const textW = tankX - 64
  const css = `.wv1{animation:bwave 3.2s linear infinite}.wv2{animation:bwave 5s linear infinite reverse;opacity:.55}
@keyframes bwave{to{transform:translateX(36px)}}
.sway{transform-box:fill-box;transform-origin:50% 10%;animation:bsway 4s ease-in-out infinite}@keyframes bsway{50%{transform:rotate(-7deg)}}`
  const body = `<defs><clipPath id="btank"><rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="9"/></clipPath>
<linearGradient id="bwater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(KZ.cyan, c, 0.55)}"/><stop offset="1" stop-color="${KZ.blue}" stop-opacity=".85"/></linearGradient></defs>
<rect class="p" x="0" y="0" width="${W}" height="56" rx="12"/>
<g class="sway" transform="translate(14 8)" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
<circle cx="15" cy="5" r="3.6"/><path d="M15 9v28M8 15h14M3 26c1 7 6 11 12 11s11-4 12-11M3 26l-2 3M3 26l3.5 1.2M27 26l2 3M27 26l-3.5 1.2"/></g>
${svgText(56, 24, `ctx ${fmtPct(pct)}`, { size: 16, weight: 750, fill: c })}
${svgText(56 + 82, 24, fitText(`— ${status}`, 12.5, Math.max(40, textW - 82)), { cls: 't', size: 12.5, weight: 600 })}
${svgText(56, 43, fitText(`${fmtTokens(s.tokens ?? 0)} of ${fmtTokens(s.window)} tokens · warn ${s.warnAt}% · act ${s.actAt}%${s.autoCompact ? ' · auto-compact' : ''}`, 11, textW), { cls: 'm', size: 11 })}
<rect class="k" x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="9"/>
<g clip-path="url(#btank)">
<path class="wv2" d="${wave(2.6, 36, waterY + 1.5)}" fill="${KZ.blue}"/>
<path class="wv1" d="${wave(3.2, 36, waterY)}" fill="url(#bwater)"/>
</g>
<line x1="${tankX + 4}" x2="${tankX + tankW - 4}" y1="${markY(s.warnAt)}" y2="${markY(s.warnAt)}" stroke="${KZ.yellow}" stroke-dasharray="3 3" stroke-width="1.2"/>
<line x1="${tankX + 4}" x2="${tankX + tankW - 4}" y1="${markY(s.actAt)}" y2="${markY(s.actAt)}" stroke="${KZ.red}" stroke-dasharray="3 3" stroke-width="1.2"/>
<rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="9" fill="none" stroke="${c}" stroke-opacity=".6" stroke-width="1.4"/>
${svgText(tankX + tankW - 8, tankY + 15, fmtPct(pct), { size: 12, weight: 700, anchor: 'end' })}`
  return svg(W, 56, body, css)
}
