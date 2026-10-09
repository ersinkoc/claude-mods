import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ClawdlingSnap } from '../types'
import { fitText, pxOf, svg, svgBar, svgText, textWidth, xml } from './lib/kz.ts'
import {
  MOOD_LABEL, UNLOCKS, XP_TOOL, XP_TURN, accessoriesAt, cleanName, levelOf, moodOf, nextUnlock, quipFor, unlocksBetween,
} from './clawd.ts'
import type { Senses } from './clawd.ts'
import { PERIOD, STAGE_H, STAGE_W, crabFrame, frameSvg } from './sprite.ts'
import type { Mood } from './sprite.ts'

const snapAtom = atom({ plugin: 'clawdling', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'clawdling', key: 'isHidden' } as const, false)

const SAD_MS = 8000
const DANCE_MS = 12_000
const LOVE_MS = 5000
const QUIP_MS = 25_000

// Module memory; XP is loaded from $.store on session.start.
let name = 'Pinchy'
let xp = 0
let isDirty = false
let streak = 0
let senses: Senses = { now: 0, loveUntil: 0, sadUntil: 0, danceUntil: 0, ctxPercent: 0, limitPercent: 0, isTurnActive: false, toolsRunning: 0 }
let lastMood: Mood | '' = ''
let quipSeed = 0
let quipAt = 0
let lastPublished = ''

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  senses.now = now
  const mood = moodOf(senses)
  if (mood !== lastMood || now - quipAt > QUIP_MS) {
    quipSeed += 1 + Math.floor(now / 997) % 3
    quipAt = now
    lastMood = mood
  }
  const lv = levelOf(xp)
  const snap: ClawdlingSnap = {
    mood,
    name,
    xp,
    level: lv.level,
    into: lv.into,
    need: lv.need,
    acc: accessoriesAt(lv.level),
    quip: quipFor(mood, quipSeed),
    streak,
    ctxPercent: Math.round(senses.ctxPercent),
    limitPercent: Math.round(senses.limitPercent),
  }
  const key = JSON.stringify(snap)
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => snap)
}

async function save($: EngineInterface): Promise<void> {
  if (!isDirty) return
  isDirty = false
  try {
    await $.store.set('xp', xp)
  } catch {
    isDirty = true
  }
}

async function tick($: EngineInterface): Promise<void> {
  await publish($)
  await save($)
}

async function gain($: EngineInterface, n: number): Promise<void> {
  const before = levelOf(xp).level
  xp += n
  isDirty = true
  const after = levelOf(xp).level
  if (after > before) {
    const now = await $.clock.now()
    senses.danceUntil = now + DANCE_MS
    const got = unlocksBetween(before, after)
    $.ui.toast(`🦀 ${name} reached Lv ${after}!${got.length ? ` ${got.map(u => `${u.icon} ${u.name}`).join(', ')} unlocked` : ''}`, { timeoutMs: 8000 })
    await save($)
  }
}

async function readUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    senses.ctxPercent = u.context.percent ?? 0
    senses.limitPercent = u.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? 0
  } catch {
    // Kept as they were.
  }
}

async function setHidden($: EngineInterface, value: boolean): Promise<void> {
  await update($, hiddenAtom, () => value)
  try {
    await $.store.set('hidden', value)
  } catch {
    // Session only.
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    name = cleanName(options.name)
    streak = 0
    lastMood = ''
    lastPublished = ''
    senses = { now: 0, loveUntil: 0, sadUntil: 0, danceUntil: 0, ctxPercent: 0, limitPercent: 0, isTurnActive: false, toolsRunning: 0 }
    try {
      const stored = await $.store.get('xp')
      xp = typeof stored === 'number' && Number.isFinite(stored) ? Math.max(0, stored) : 0
      const isHidden = (await $.store.get('hidden')) === true
      await update($, hiddenAtom, () => isHidden)
    } catch {
      xp = 0
    }
    isDirty = false
    await $.command.register({ name: 'clawdling', description: `KOZMOS: show or hide ${name} the crab (feed, stats)`, argumentHint: '[feed | stats]', immediate: true })
    await readUsage($)
    await publish($)
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    $.clock.every(10_000, () => void readUsage($)) // readUsage never throws
    return started
  })

  on('command.run', { command: 'clawdling' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    const lv = levelOf(xp)
    if (verb === 'feed') {
      senses.loveUntil = (await $.clock.now()) + LOVE_MS
      if (await read($, hiddenAtom)) await setHidden($, false)
      await publish($)
      return { text: `🦀 ${name}: ${quipFor('love', quipSeed + 1)}` }
    }
    if (verb === 'stats') {
      const up = nextUnlock(lv.level)
      const owned = UNLOCKS.filter(u => u.level <= lv.level).map(u => u.icon).join(' ')
      return { text: `🦀 ${name} · Lv ${lv.level} · ${lv.into}/${lv.need} XP (${xp} total) · streak ${streak}${owned ? ` · wearing ${owned}` : ''}${up ? ` · next: ${up.icon} ${up.name} at Lv ${up.level}` : ' · fully dressed'}` }
    }
    const hidden = !(await read($, hiddenAtom))
    await setHidden($, hidden)
    return { text: hidden ? `${name} went back to the sea. /clawdling brings them back.` : `🦀 ${name} is back!` }
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    senses.ctxPercent = e.context.percent ?? senses.ctxPercent
    senses.limitPercent = e.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? senses.limitPercent
    await publish($)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    senses.isTurnActive = true
    senses.toolsRunning = 0
    await publish($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    if (isMain) {
      senses.toolsRunning++
      void publish($).catch(() => undefined)
    }
    let ran
    try {
      ran = await next(e)
    } finally {
      if (isMain) senses.toolsRunning = Math.max(0, senses.toolsRunning - 1)
    }
    if (ran.isError === true || ran.deny !== undefined) senses.sadUntil = (await $.clock.now()) + SAD_MS
    else await gain($, XP_TOOL)
    void publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    senses.isTurnActive = false
    senses.toolsRunning = 0
    if (e.reason === 'answer') {
      streak++
      await gain($, XP_TURN)
      if (streak >= 5) senses.danceUntil = (await $.clock.now()) + DANCE_MS
    } else streak = 0
    await publish($)
    await save($)
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    const snap = await read($, snapAtom)
    if (!snap || e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const { Box, Button } = $.ui.resolve(e)
    const cols = Math.max(40, e.props.bodyColumns || 80)
    const hide = <Button key="clawdling-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    const icons = UNLOCKS.filter(u => u.level <= snap.level).map(u => u.icon).join('')
    let mine
    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)
      const props = {
        cols: cols - 3, mood: snap.mood, name: snap.name, level: snap.level, into: snap.into, need: snap.need,
        quip: snap.quip, acc: snap.acc, icons, status: statusOf(snap),
      }
      mine = <Client key="clawdling-crab" module="./crab.tsx" width={cols - 3} height={4} props={props} />
    } else {
      // Desktop, VS Code and mobile: the flipbook card.
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(cols)
      mine = <Svg source={crabCard(snap, W, icons)} alt={altOf(snap)} width={W} height={CARD_H} />
    }
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="clawdling" flexDirection="row">
          {mine}
          {hide}
        </Box>
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------

function statusOf(s: ClawdlingSnap): string {
  const bits = [MOOD_LABEL[s.mood]]
  if (s.streak >= 2) bits.push(`🔥${s.streak}`)
  if (s.ctxPercent > 0) bits.push(`ctx ${s.ctxPercent}%`)
  if (s.limitPercent > 0) bits.push(`5h ${s.limitPercent}%`)
  const up = nextUnlock(s.level)
  if (up) bits.push(`next ${up.icon} Lv ${up.level}`)
  return bits.join(' · ')
}

function altOf(s: ClawdlingSnap): string {
  return `${s.name}, a pixel crab, is ${MOOD_LABEL[s.mood]}. Level ${s.level}, ${s.into} of ${s.need} XP. “${s.quip}”`
}

const SCALE = 5
const CARD_H = 60
const FRAME_MS = 125

/** The desktop band: a 24-frame flipbook of the same sprite, then name, level, XP and the quip. */
function crabCard(s: ClawdlingSnap, W: number, icons: string): string {
  const T = (PERIOD * FRAME_MS) / 1000
  const slice = (100 / PERIOD).toFixed(4)
  const css = `
.cw-fr{opacity:0;animation:cfl ${T}s step-end infinite}
@keyframes cfl{0%{opacity:1}${slice}%{opacity:0}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){.cw-f0{opacity:1}}
.cw-bub{animation:cbu 4s ease-in infinite;opacity:0}@keyframes cbu{0%{opacity:0;transform:translateY(0)}20%{opacity:.55}100%{opacity:0;transform:translateY(-34px)}}
.cw-typ{animation:cty 1.2s steps(24) both}@keyframes cty{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
`
  const stageW = STAGE_W * SCALE
  const stageH = STAGE_H * SCALE
  const sx = 10
  const sy = 6
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="cxp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fb923c"/><stop offset="1" stop-color="#f43f5e"/></linearGradient>` +
    `<linearGradient id="csea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity="0"/><stop offset="1" stop-color="#38bdf8" stop-opacity=".16"/></linearGradient></defs>`)
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="${CARD_H}" rx="14"/>`)
  parts.push(`<rect x="0" y="0" width="${stageW + sx * 2}" height="${CARD_H}" rx="14" fill="url(#csea)"/>`)
  // Sand and two pebbles.
  parts.push(`<rect x="${sx - 4}" y="${sy + stageH + 2}" width="${stageW + 8}" height="4" rx="2" fill="#e9c46a" opacity=".55"/>`)
  parts.push(`<circle cx="${sx + stageW - 8}" cy="${sy + stageH + 2}" r="2.4" fill="#a8a29e"/><circle cx="${sx + 6}" cy="${sy + stageH + 2.5}" r="1.8" fill="#d6d3d1"/>`)
  // Rising bubbles, out of phase.
  for (const [x, d, r] of [[sx + 18, 0, 2], [sx + stageW - 30, 1.6, 1.6], [sx + stageW / 2, 2.8, 1.3]] as const) {
    parts.push(`<circle class="cw-bub" style="animation-delay:${d}s" cx="${x}" cy="${sy + stageH - 2}" r="${r}" fill="none" stroke="#7dd3fc" stroke-width=".9"/>`)
  }
  // The flipbook.
  parts.push(`<g transform="translate(${sx} ${sy})">`)
  for (let i = 0; i < PERIOD; i++) {
    const fr = crabFrame({ mood: s.mood, f: i, acc: s.acc })
    parts.push(`<g class="cw-fr cw-f${i}" style="animation-delay:${((i * FRAME_MS) / 1000).toFixed(3)}s">${frameSvg(fr, SCALE)}</g>`)
  }
  parts.push(`</g>`)
  // Side: name and level, XP bar, quip, status.
  const x = sx * 2 + stageW + 8
  const room = W - x - 14
  parts.push(svgText(x, 19, s.name, { size: 14, weight: 750, fill: '#f05a3c' }))
  const nx = x + textWidth(s.name, 14) + 8
  parts.push(`<rect x="${nx}" y="7" width="36" height="16" rx="8" fill="#fbbf24" opacity=".2"/>`)
  parts.push(svgText(nx + 18, 19, `Lv ${s.level}`, { size: 10.5, weight: 750, anchor: 'middle', fill: '#d97706' }))
  if (icons) parts.push(`<text x="${nx + 44}" y="19" font-size="12">${xml(icons)}</text>`)
  const barW = Math.max(60, Math.min(200, room - 90))
  parts.push(svgBar(x, 27, barW, 6, s.into / s.need, 'url(#cxp)')) // need: 100 XP or more
  parts.push(svgText(x + barW + 8, 33, `${s.into}/${s.need} XP`, { cls: 'm', size: 10 }))
  parts.push(`<g class="cw-typ">${svgText(x, 48, fitText(`“${s.quip}”`, 11.5, room), { cls: 's', size: 11.5 }).replace('<text ', '<text font-style="italic" ')}</g>`)
  if (room > 300) parts.push(svgText(W - 14, 19, fitText(statusOf(s), 10, Math.max(80, room - textWidth(s.name, 14) - 120)), { cls: 'm', size: 10, anchor: 'end' }))
  return svg(W, CARD_H, parts.join(''), css)
}
