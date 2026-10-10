import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import type { LaurelsBurst } from '../types'
import { KZ, clamp01, costOf, fitText, mix, pips, pxOf, svg, svgBar, svgText, textWidth, tokensOf, xml } from './lib/kz.ts'
import {
  BADGES, badgeById, dayKey, emptyFacts, extOf, isGitCommit, isGitPush, isTestRun, mcpServerOf, newlyUnlocked,
  normCommand, progressOf, sanitizeLife, todosDone, turnFlags,
} from './badges.ts'
import type { Badge, Facts, TurnFacts } from './badges.ts'

const PANE = 'kz-laurels'
const TITLE = 'KOZMOS · Laurels'
const BURST_MS = 6000
const RECENT_MS = 24 * 3600_000

const unlockedAtom = atom({ plugin: 'laurels', key: 'unlocked' } as const, {})
const progressAtom = atom({ plugin: 'laurels', key: 'progress' } as const, {})
const burstAtom = atom({ plugin: 'laurels', key: 'burst' } as const, null)
const hiddenAtom = atom({ plugin: 'laurels', key: 'isHidden' } as const, false)

// Module memory; session.start fills it from $.store.
let facts: Facts = emptyFacts()
let unlocked: Record<string, number> = {}
let turn: (TurnFacts & { files: number; paths: string[] }) | null = null
let failedCommands = new Set<string>()
let lastTodos: { content: string; status: string }[] = []
let ctxPercent = 0
let queue: string[] = []
let isBursting = false
let lastProgress = ''
/** Badges an evaluation is unlocking right now, so a concurrent one leaves them be. */
const claiming = new Set<string>()

function sanitizeUnlocked(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object') for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (typeof t === 'number' && badgeById(k)) out[k] = t
  return out
}

async function persist($: EngineInterface): Promise<void> {
  try {
    await $.store.set('unlocked', unlocked)
    await $.store.set('life', facts.life)
  } catch {
    // Kept for this session.
  }
}

async function showNext($: EngineInterface): Promise<void> {
  const id = queue.shift()
  if (id === undefined) {
    isBursting = false
    await update($, burstAtom, () => null)
    return
  }
  isBursting = true
  const burst: LaurelsBurst = { id, at: await $.clock.now(), more: queue.length }
  await update($, burstAtom, () => burst)
  $.clock.after(BURST_MS, () => void showNext($).catch(() => undefined))
}

async function evaluate($: EngineInterface): Promise<void> {
  // Tool calls run in parallel: claim the fresh badges before the first wait,
  // or two evaluations would both unlock (and toast) the same one.
  const fresh = newlyUnlocked(facts, unlocked).filter(b => !claiming.has(b.id))
  for (const b of fresh) claiming.add(b.id)
  try {
    const progress = progressOf(facts)
    const key = JSON.stringify(progress)
    if (key !== lastProgress) {
      lastProgress = key
      await update($, progressAtom, () => progress)
    }
    if (fresh.length === 0) return
    const now = await $.clock.now()
    for (const b of fresh) {
      unlocked[b.id] = now
      $.ui.toast(`🏆 ${b.name} unlocked — ${b.cheer}`, { timeoutMs: 7000 })
      queue.push(b.id)
    }
    const snapshot = { ...unlocked }
    await update($, unlockedAtom, () => snapshot)
    await persist($)
    if (!isBursting) await showNext($)
    else await update($, burstAtom, b => (b ? { ...b, more: queue.length } : b))
  } finally {
    for (const b of fresh) claiming.delete(b.id)
  }
}

async function poll($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    facts.costUsd = u.cost?.usd ?? facts.costUsd
    ctxPercent = u.context.percent ?? ctxPercent
    if (u.startedAt > 0) facts.sessionMs = Math.max(0, (await $.clock.now()) - u.startedAt)
  } catch {
    // Figures the engine cannot give now stay as they were.
  }
  await countRunning($)
  await evaluate($)
}

async function countRunning($: EngineInterface): Promise<void> {
  try {
    const agents = await $.agent.list()
    const running = agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    facts.maxRunning = Math.max(facts.maxRunning, running)
  } catch {
    // No agent list here.
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

async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

function str(e: unknown, k: string): string {
  const v = (e as Record<string, unknown>)[k]
  return typeof v === 'string' ? v : ''
}

function noteTool(tool: string, e: unknown, failed: boolean): void {
  facts.tools++
  facts.life.tools++
  if (turn) turn.tools++
  if (failed) {
    facts.fails++
    if (turn) turn.fails++
  }
  if (tool === 'Read') facts.reads++
  if (tool === 'Grep' || tool === 'Glob') facts.searches++
  if (tool === 'WebFetch' || tool === 'WebSearch') facts.web++
  const server = mcpServerOf(tool)
  if (server && !failed && !facts.mcpServers.includes(server)) facts.mcpServers.push(server)
  if (!failed && (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit')) {
    const path = str(e, 'file_path') || str(e, 'notebook_path')
    const ext = extOf(path)
    if (ext && !facts.exts.includes(ext)) facts.exts.push(ext)
    if (tool === 'NotebookEdit' || ext === '.ipynb') facts.flags.labNotes = true
    if (turn && path && !turn.paths.includes(path)) {
      turn.paths.push(path)
      turn.files = turn.paths.length
      facts.bestFilesInTurn = Math.max(facts.bestFilesInTurn, turn.files)
    }
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = normCommand(str(e, 'command'))
    if (cmd) {
      if (failed) failedCommands.add(cmd)
      else {
        if (failedCommands.has(cmd)) facts.flags.bugSquasher = true
        if (isGitCommit(cmd)) facts.flags.committed = true
        if (isGitPush(cmd)) facts.flags.pushed = true
        if (isTestRun(str(e, 'command'))) facts.flags.testPilot = true
      }
    }
  }
  if (!failed && tool === 'TodoWrite') {
    const todos = (e as Record<string, unknown>).todos
    if (Array.isArray(todos)) {
      const list = todos.map(t => ({ content: String((t as Record<string, unknown>).content ?? ''), status: String((t as Record<string, unknown>).status ?? '') }))
      facts.life.tasksDone += todosDone(lastTodos, list)
      lastTodos = list
    }
  }
  if (!failed && tool === 'TaskUpdate' && str(e, 'status') === 'completed') facts.life.tasksDone++
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    turn = null
    failedCommands = new Set()
    lastTodos = []
    ctxPercent = 0
    queue = []
    isBursting = false
    lastProgress = ''
    try {
      unlocked = sanitizeUnlocked(await $.store.get('unlocked'))
      facts = emptyFacts(sanitizeLife(await $.store.get('life')))
      const isHidden = (await $.store.get('hidden')) === true
      await update($, hiddenAtom, () => isHidden)
    } catch {
      unlocked = {}
      facts = emptyFacts()
    }
    const snapshot = { ...unlocked }
    await update($, unlockedAtom, () => snapshot)
    await update($, burstAtom, () => null)
    await $.command.register({ name: 'laurels', description: 'KOZMOS: open the achievements gallery (hide / show the unlock band)', argumentHint: '[hide | show]', immediate: true })
    await evaluate($).catch(() => undefined)
    $.clock.every(5000, () => void poll($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'laurels' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'hide' || verb === 'show') {
      await setHidden($, verb === 'hide')
      return { text: verb === 'hide' ? 'Laurels celebrations hidden (toasts still show).' : 'Laurels celebrations shown.' }
    }
    const open = await togglePane($)
    return { text: open ? `Laurels: ${Object.keys(unlocked).length}/${BADGES.length} unlocked.` : 'Laurels closed.' }
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    ctxPercent = e.context.percent ?? ctxPercent
    if (e.cost) facts.costUsd = e.cost.usd
    if (e.changed.includes('cost')) await evaluate($)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    turn = { startedAt: now, durationMs: 0, tools: 0, fails: 0, files: 0, paths: [], steps: 0, estUsd: 0, input: 0, cacheRead: 0, cacheWrite: 0, reason: '' }
    if (ctxPercent >= 90) {
      facts.flags.contextSurfer = true
      await evaluate($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (r.usage) {
      facts.tokens += tokensOf(r.usage)
      if (turn) {
        turn.steps++
        turn.estUsd += costOf(r.usage.model || e.model, r.usage)
        if (e.agentId === undefined) {
          turn.input += r.usage.input_tokens
          turn.cacheRead += r.usage.cache_read_input_tokens
          turn.cacheWrite += r.usage.cache_creation_input_tokens
        }
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    noteTool(String(e.tool), e, ran.isError === true || ran.deny !== undefined)
    await evaluate($)
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if ((r as { agentId?: string }).agentId) {
      facts.agents++
      await countRunning($)
      await evaluate($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || !turn) return done
    const t = { ...turn, durationMs: e.durationMs, reason: e.reason }
    turn = null
    const d = new Date(t.startedAt)
    for (const f of turnFlags(t, d.getHours(), d.getDay())) facts.flags[f] = true
    facts.turns++
    facts.life.turns++
    const day = dayKey(t.startedAt)
    if (!facts.life.days.includes(day)) facts.life.days = [...facts.life.days, day].slice(-60)
    if (facts.tools >= 20 && facts.fails === 0) facts.flags.cleanSlate = true
    await evaluate($)
    await persist($)
    return done
  }).catch(($, e, next) => next(e))

  // ---- the celebration band -------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    const burst = await read($, burstAtom)
    // A burst names a badge of this book (one renamed since a reload draws nothing).
    const b = burst ? badgeById(burst.id) : undefined
    if (!burst || !b || e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const cols = Math.max(40, e.props.bodyColumns || 80)
    let mine
    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)
      mine = <Client key="laurels-burst" module="./burst.tsx" width={cols - 3} height={1} props={{ cols: cols - 3, name: b.name, glyph: b.glyph, color: b.color, cheer: b.cheer, more: burst.more }} />
    } else {
      // Every other surface draws Svg.
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(cols)
      mine = <Svg source={burstSvg(b, W, burst.more)} alt={`Achievement unlocked: ${b.name}. ${b.desc}`} width={W} height={44} />
    }
    const { Box, Button } = $.ui.resolve(e)
    const hide = <Button key="laurels-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="laurels" flexDirection="row">
          {mine}
          {hide}
        </Box>
      </Box>
    )
  })

  // ---- the gallery ----------------------------------------------------------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const got = await read($, unlockedAtom)
    const progress = await read($, progressAtom)
    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = Math.max(36, e.props.bodyColumns || 60)
    const ordered = orderBadges(got, progress)
    const count = Object.keys(got).length

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(cols, 60)
      const head = galleryHeader(W, count, got)
      const rows = medalRows(ordered, got, progress, now, W)
      return (
        <Box flexDirection="column">
          <Svg key="lh" source={head} alt={`Laurels: ${count} of ${BADGES.length} unlocked`} width={W} height={64} />
          {rows.map((r, i) => <Svg key={`lr${i}`} source={r.source} alt={r.alt} width={W} height={r.height} />)}
        </Box>
      )
    }

    const twoCols = cols >= 100
    const colW = twoCols ? Math.floor((cols - 2) / 2) : cols
    const lines = ordered.map(b => badgeLine(b, got[b.id], progress[b.id] ?? 0, colW, Box, Text))
    const grid = twoCols
      ? Array.from({ length: Math.ceil(lines.length / 2) }, (_, i) => (
          <Box key={`g${i}`} flexDirection="row">
            {lines.slice(i * 2, i * 2 + 2).map((line, j) => <Box key={`c${j}`} width={colW} marginRight={j === 0 ? 2 : 0}>{line}</Box>)}
          </Box>
        ))
      : lines
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Text bold color={KZ.yellow}>🏆 LAURELS</Text>
          <Text>
            <Text color={KZ.yellow}>{pips(count / BADGES.length, Math.min(20, Math.max(6, cols - 30)))}</Text>
            <Text bold> {count}/{BADGES.length}</Text>
          </Text>
        </Box>
        {grid}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Drawing.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateOf(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** Unlocked first (newest first), then locked by how close they are. */
function orderBadges(got: Readonly<Record<string, number>>, progress: Readonly<Record<string, number>>): Badge[] {
  const done = BADGES.filter(b => got[b.id] !== undefined).sort((a, b) => Number(got[b.id]) - Number(got[a.id]))
  const left = BADGES.filter(b => got[b.id] === undefined).sort((a, b) => (progress[b.id] ?? 0) / b.goal - (progress[a.id] ?? 0) / a.goal)
  return [...done, ...left]
}

function fmtGoal(b: Badge, v: number): string {
  if (b.id === 'big-spender') return `$${v.toFixed(2)}/$${b.goal}`
  if (b.id === 'marathon') return `${Math.floor(v / 60)}h${String(Math.floor(v % 60)).padStart(2, '0')}/2h`
  if (b.goal >= 100_000) return `${Math.round((v / b.goal) * 100)}%`
  return `${Math.floor(v)}/${b.goal}`
}


function badgeLine(b: Badge, at: number | undefined, value: number, width: number, Box: ElementConstructor<BoxProps>, Text: ElementConstructor<TextProps>) {
  if (at !== undefined) {
    return (
      <Box key={b.id} flexDirection="row">
        <Box width={3} flexShrink={0}><Text color={b.color}>{b.glyph}</Text></Box>
        <Text wrap="truncate-end">
          <Text bold color={b.color}>{b.name}</Text>
          <Text dimColor> {dateOf(at)} · {b.desc}</Text>
        </Text>
      </Box>
    )
  }
  const isCounter = b.goal > 1
  const barW = Math.max(4, Math.min(10, width - b.name.length - 18))
  return (
    <Box key={b.id} flexDirection="row">
      <Box width={3} flexShrink={0}><Text dimColor>○</Text></Box>
      <Text wrap="truncate-end">
        <Text dimColor bold>{b.name} </Text>
        {isCounter ? <Text color="#6b7280">{pips(clamp01(value / b.goal), barW)} {fmtGoal(b, value)} </Text> : null}
        <Text dimColor>· {b.hint}</Text>
      </Text>
    </Box>
  )
}

function galleryHeader(W: number, count: number, got: Readonly<Record<string, number>>): string {
  const latest = Object.entries(got).sort((a, b) => b[1] - a[1])[0]
  const lb = latest ? badgeById(latest[0]) : undefined
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="lhG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#fde047"/></linearGradient></defs>`)
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="56" rx="14"/>`)
  parts.push(`<text x="16" y="36" font-size="24">🏆</text>`)
  parts.push(svgText(52, 25, 'LAURELS', { size: 11, weight: 800, fill: '#d97706' }))
  parts.push(svgText(52, 44, `${count} of ${BADGES.length} unlocked`, { size: 15, weight: 700 }))
  const bx = Math.max(220, W * 0.45)
  const bw = W - bx - 16
  if (bw > 60) {
    parts.push(svgBar(bx, 20, bw, 8, count / BADGES.length, 'url(#lhG)'))
    if (lb && latest) parts.push(svgText(W - 16, 45, fitText(`latest · ${lb.name} · ${dateOf(latest[1])}`, 10.5, bw), { cls: 'm', size: 10.5, anchor: 'end' }))
  }
  return svg(W, 64, parts.join(''))
}

/** Splits text into at most `max` lines of `width` px. */
function wrapText(s: string, size: number, width: number, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of s.split(' ')) {
    const next = cur ? `${cur} ${w}` : w
    if (textWidth(next, size) > width && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === max) break
    } else cur = next
  }
  if (lines.length < max && cur) lines.push(cur)
  if (lines.length === max && textWidth(lines.join(' '), size) < textWidth(s, size) - 1) lines[max - 1] = fitText(`${lines[max - 1]} …`, size, width)
  return lines
}

const MEDAL_CSS = `
.lr-lockg{filter:grayscale(1);opacity:.4}
.lr-shn{animation:lsh 3.2s ease-in-out infinite}@keyframes lsh{0%{transform:translateX(-70px)}55%,100%{transform:translateX(70px)}}
.lr-glow{transform-box:fill-box;transform-origin:center;animation:lgl 2.4s ease-in-out infinite}@keyframes lgl{50%{transform:scale(1.08);opacity:.15}}
.lr-pop{transform-box:fill-box;transform-origin:center;animation:lpop .6s cubic-bezier(.2,1.6,.4,1) both}@keyframes lpop{from{transform:scale(.4);opacity:0}}
`

function medal(b: Badge, cx: number, cy: number, at: number | undefined, value: number, now: number, idx: string): string {
  const R = 30
  if (at === undefined) {
    let s = `<circle class="k" cx="${cx}" cy="${cy}" r="${R}"/><circle cx="${cx}" cy="${cy}" r="${R - 6}" fill="none" class="ln" stroke-width="1.5" stroke-dasharray="3 4"/>`
    if (b.goal > 1 && value > 0) {
      const C = 2 * Math.PI * (R - 2)
      const p = clamp01(value / b.goal)
      s += `<circle cx="${cx}" cy="${cy}" r="${R - 2}" fill="none" stroke="${b.color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" opacity=".8"/>`
    }
    s += `<text class="lr-lockg" x="${cx}" y="${cy + 8}" font-size="22" text-anchor="middle">${xml(b.glyph)}</text>`
    return s
  }
  const isRecent = now - at < RECENT_MS
  const light = mix(b.color, '#ffffff', 0.55)
  const dark = mix(b.color, '#000000', 0.35)
  let s = `<defs><radialGradient id="lmf-${idx}" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${b.color}"/><stop offset="1" stop-color="${dark}"/></radialGradient>` +
    `<linearGradient id="lmr-${idx}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#d97706"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>` +
    `<clipPath id="lmc-${idx}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs>`
  // Ribbon tails behind the medal.
  s += `<path d="M${cx - 13} ${cy + 18}l-6 22 8-5 5 7 5-22z" fill="${dark}"/><path d="M${cx + 13} ${cy + 18}l6 22-8-5-5 7-5-22z" fill="${b.color}"/>`
  if (isRecent) s += `<circle class="lr-glow" cx="${cx}" cy="${cy}" r="${R + 4}" fill="${b.color}" opacity=".3"/>`
  s += `<g class="${isRecent ? 'lr-pop' : ''}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#lmr-${idx})"/><circle cx="${cx}" cy="${cy}" r="${R - 5}" fill="url(#lmf-${idx})"/>`
  // A laurel wreath: five leaves up each side of the lower rim, tangent to it.
  for (let i = 0; i < 5; i++) {
    for (const deg of [105 + i * 15, 75 - i * 15]) {
      const a = (deg * Math.PI) / 180
      const x = (cx + Math.cos(a) * (R - 8)).toFixed(1)
      const y = (cy + Math.sin(a) * (R - 8)).toFixed(1)
      s += `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="4.2" fill="#fef3c7" opacity=".6" transform="rotate(${deg} ${x} ${y})"/>`
    }
  }
  s += `<text x="${cx}" y="${cy + 8}" font-size="22" text-anchor="middle">${xml(b.glyph)}</text>`
  if (isRecent) s += `<g clip-path="url(#lmc-${idx})"><rect class="lr-shn" x="${cx - 12}" y="${cy - R}" width="14" height="${R * 2}" fill="#ffffff" opacity=".45" transform="skewX(-20)"/></g>`
  s += `</g>`
  return s
}

function medalRows(list: readonly Badge[], got: Readonly<Record<string, number>>, progress: Readonly<Record<string, number>>, now: number, W: number): { source: string; height: number; alt: string }[] {
  const gap = 8
  const per = Math.max(2, Math.floor((W + gap) / (128 + gap)))
  const cw = (W - gap * (per - 1)) / per
  const H = 150
  const rows: { source: string; height: number; alt: string }[] = []
  for (let r = 0; r * per < list.length; r++) {
    const parts: string[] = []
    const alts: string[] = []
    list.slice(r * per, r * per + per).forEach((b, i) => {
      const x = i * (cw + gap)
      const at = got[b.id]
      const v = progress[b.id] ?? 0
      const cx = x + cw / 2
      parts.push(`<g><title>${xml(`${b.name}: ${at !== undefined ? b.desc : b.hint}`)}</title>`)
      parts.push(`<rect class="p" x="${x}" y="0" width="${cw}" height="${H - 6}" rx="14"/>`)
      parts.push(medal(b, cx, 42, at, v, now, b.id))
      parts.push(svgText(cx, 96, fitText(b.name, 12, cw - 12), { size: 12, weight: 700, anchor: 'middle', cls: at !== undefined ? 't' : 'm' }))
      const body = wrapText(at !== undefined ? b.desc : b.hint, 9.5, cw - 16, 2)
      body.forEach((line, j) => parts.push(svgText(cx, 110 + j * 12, line, { size: 9.5, anchor: 'middle', cls: at !== undefined ? 's' : 'm' })))
      const foot = at !== undefined ? dateOf(at) : b.goal > 1 ? fmtGoal(b, v) : 'locked'
      parts.push(svgText(cx, 138, foot, { size: 9.5, weight: 600, anchor: 'middle', fill: at !== undefined ? b.color : undefined, cls: 'm' }))
      parts.push(`</g>`)
      alts.push(`${b.name} ${at !== undefined ? `unlocked ${dateOf(at)}` : `locked${b.goal > 1 ? ` ${fmtGoal(b, v)}` : ''}`}`)
    })
    rows.push({ source: svg(W, H, parts.join(''), MEDAL_CSS), height: H, alt: alts.join('; ') })
  }
  return rows
}

/** The 1-row desktop celebration: a medal popping in, rays turning, confetti falling. */
function burstSvg(b: Badge, W: number, more: number): string {
  const css = `
.lr-rays{transform-box:fill-box;transform-origin:center;animation:lrray 6s linear infinite}@keyframes lrray{to{transform:rotate(360deg)}}
.lr-bpop{transform-box:fill-box;transform-origin:center;animation:lbpop .7s cubic-bezier(.2,1.7,.4,1) both}@keyframes lbpop{from{transform:scale(.2);opacity:0}}
.lr-slide{animation:lsl .6s cubic-bezier(.2,.8,.2,1) .15s both}@keyframes lsl{from{opacity:0;transform:translateX(-10px)}}
.lr-cf{animation:lcf 2.2s linear infinite}@keyframes lcf{from{transform:translateY(-14px) rotate(0)}to{transform:translateY(52px) rotate(260deg)}}
.lr-cf{transform-box:fill-box;transform-origin:center}
.lr-sweep{animation:lsw${W} 1.8s ease-out .3s both}@keyframes lsw${W}{from{transform:translateX(-200px)}to{transform:translateX(${W + 200}px)}}
`
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="lbg-${b.id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${b.color}" stop-opacity=".28"/><stop offset=".6" stop-color="${b.color}" stop-opacity=".08"/><stop offset="1" stop-color="${b.color}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="lsw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="lbc${W}"><rect x="0" y="0" width="${W}" height="44" rx="12"/></clipPath></defs>`)
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="44" rx="12"/><rect x="0" y="0" width="${W}" height="44" rx="12" fill="url(#lbg-${b.id})"/>`)
  parts.push(`<g clip-path="url(#lbc${W})">`)
  // Confetti: seeded pieces falling at their own pace.
  const hues = ['#f472b6', '#facc15', '#4ade80', '#22d3ee', '#a78bfa', '#fb923c']
  for (let i = 0; i < 26; i++) {
    const x = 220 + ((i * 97.3) % Math.max(60, W - 240))
    const delay = ((i * 0.37) % 2.2).toFixed(2)
    const dur = (1.8 + ((i * 0.53) % 1.4)).toFixed(2)
    const c = hues[i % hues.length]
    parts.push(i % 3 === 0
      ? `<circle class="lr-cf" style="animation-delay:-${delay}s;animation-duration:${dur}s" cx="${x.toFixed(0)}" cy="0" r="1.8" fill="${c}"/>`
      : `<rect class="lr-cf" style="animation-delay:-${delay}s;animation-duration:${dur}s" x="${x.toFixed(0)}" y="-2" width="3" height="6" rx="1" fill="${c}"/>`)
  }
  // Rays behind the medal.
  const cx = 26
  const cy = 22
  let rays = ''
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    rays += `<path d="M${cx} ${cy}L${(cx + Math.cos(a - 0.12) * 26).toFixed(1)} ${(cy + Math.sin(a - 0.12) * 26).toFixed(1)}L${(cx + Math.cos(a + 0.12) * 26).toFixed(1)} ${(cy + Math.sin(a + 0.12) * 26).toFixed(1)}Z" fill="${b.color}" opacity=".22"/>`
  }
  parts.push(`<g class="lr-rays">${rays}</g>`)
  parts.push(`<g class="lr-bpop"><circle cx="${cx}" cy="${cy}" r="16" fill="#f59e0b"/><circle cx="${cx}" cy="${cy}" r="13" fill="${b.color}"/><text x="${cx}" y="${cy + 6}" font-size="15" text-anchor="middle">${xml(b.glyph)}</text></g>`)
  parts.push(`<g class="lr-slide">`)
  parts.push(svgText(52, 17, more > 0 ? `ACHIEVEMENT UNLOCKED · +${more} MORE` : 'ACHIEVEMENT UNLOCKED', { size: 9.5, weight: 800, fill: '#d97706' }))
  parts.push(svgText(52, 35, b.name, { size: 15, weight: 750 }))
  parts.push(svgText(52 + textWidth(b.name, 15) + 10, 35, fitText(`— ${b.cheer}`, 12, Math.max(40, W - 120 - textWidth(b.name, 15))), { cls: 's', size: 12 }))
  parts.push(`</g>`)
  parts.push(`<rect class="lr-sweep" x="0" y="0" width="160" height="44" fill="url(#lsw)"/>`)
  parts.push(`</g>`)
  return svg(W, 44, parts.join(''), css)
}
