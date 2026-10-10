import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { ChronEvent, ChronFilter, ChronKind, ChronSnap } from '../types'
import { Canvas, KZ, clip, fitText, fmtClock, fmtTokens, fmtUsd, limitLabel, pxOf, svg, svgText, toolDetail, toolName } from './lib/kz.ts'

const PANE = 'kz-chronicle'
const TITLE = 'KOZMOS · Chronicle'
const MAX_EVENTS = 300
const MILESTONES = [50, 80, 95]

const snapAtom = atom({ plugin: 'chronicle', key: 'snap' } as const, null)
const filterAtom = atom({ plugin: 'chronicle', key: 'filter' } as const, 'all')

type KindStyle = { icon: string; color: string; rank: number }

const KIND: Record<ChronKind, KindStyle> = {
  session: { icon: '★', color: KZ.mist, rank: 0 },
  prompt: { icon: '❯', color: KZ.cyan, rank: 2 },
  turn: { icon: '◆', color: KZ.violet, rank: 1 },
  'agent-start': { icon: '◈', color: KZ.magenta, rank: 3 },
  'agent-end': { icon: '◇', color: KZ.magenta, rank: 3 },
  commit: { icon: '◉', color: KZ.green, rank: 5 },
  push: { icon: '⇡', color: KZ.teal, rank: 5 },
  'tool-fail': { icon: '✖', color: KZ.red, rank: 6 },
  compact: { icon: '⇊', color: KZ.blue, rank: 4 },
  limit: { icon: '▲', color: KZ.amber, rank: 4 },
  context: { icon: '◔', color: KZ.yellow, rank: 4 },
}

const FILTERS: { id: ChronFilter; label: string; hotkey: string }[] = [
  { id: 'all', label: 'All', hotkey: '1' },
  { id: 'prompts', label: 'Prompts', hotkey: '2' },
  { id: 'agents', label: 'Agents', hotkey: '3' },
  { id: 'git', label: 'Git', hotkey: '4' },
  { id: 'errors', label: 'Errors', hotkey: '5' },
]

function passes(f: ChronFilter, ev: ChronEvent): boolean {
  if (f === 'all') return true
  if (f === 'prompts') return ev.kind === 'prompt' || ev.kind === 'turn'
  if (f === 'agents') return ev.kind === 'agent-start' || ev.kind === 'agent-end'
  if (f === 'git') return ev.kind === 'commit' || ev.kind === 'push'
  return ev.isError === true || ev.kind === 'tool-fail'
}

const colorOf = (ev: ChronEvent) => (ev.isError ? KZ.red : KIND[ev.kind].color)

// ---------------------------------------------------------------------------
// The record. Module state starts over on a reload.

let events: ChronEvent[] = []
let startedAt = 0
let nextId = 1
let lastPublished = ''
let pubSeq = 0
// Turn bookkeeping for the main loop.
let turnTools = 0
let turnCost: number | undefined
let lastCost: number | undefined
// Subagents by id: what they are and when they began.
let agents = new Map<string, { type: string; description: string; at: number }>()
// Milestones already announced, per rate-limit kind and for the context.
let armed = new Map<string, number>()
let isSeeded = false

function hhmmss(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function record(at: number, kind: ChronKind, title: string, detail?: string, isError?: boolean): void {
  events = [...events, { id: nextId++, at, kind, title, ...(detail ? { detail } : {}), ...(isError ? { isError } : {}) }].slice(-MAX_EVENTS)
}

async function publish($: EngineInterface): Promise<void> {
  const seq = ++pubSeq
  const snap: ChronSnap = { events, startedAt }
  const key = JSON.stringify(snap)
  if (key === lastPublished) return
  await Promise.resolve()
  if (seq !== pubSeq) return
  lastPublished = key
  await update($, snapAtom, () => snap)
}

/** Crossing 50, 80 and 95 %; a fall below re-arms the levels it fell under. */
function milestone(key: string, percent: number | undefined, at: number, announce: (level: number) => void): void {
  if (percent === undefined || !Number.isFinite(percent)) return
  const level = MILESTONES.filter(m => percent >= m).pop() ?? 0
  const had = armed.get(key) ?? 0
  if (level > had && isSeeded) announce(level)
  if (level !== had) armed.set(key, level)
}

/** Whether some part of a command line (`a && b | c`) is `git [options] <verb>` that is not a dry run. */
function runsGit(cmd: string, verb: 'commit' | 'push'): boolean {
  const re = new RegExp(`^(\\w+=\\S* )*git(\\s+-\\S+(\\s+\\S+)?)*\\s+${verb}(?![\\w-])`)
  const dry = verb === 'push' ? /\s(--dry-run|-[a-zA-Z]*n[a-zA-Z]*)(?=\s|$)/ : /\s--dry-run(?=\s|$)/
  return cmd.split(/&&|\|\||[;&|\n]/).map(p => p.replace(/\s+/g, ' ').trim()).some(p => re.test(p) && !dry.test(p))
}

function commitMessage(cmd: string): string {
  // A HEREDOC body is the message (Claude Code's own form): its first line is the subject.
  const doc = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2\b/.exec(cmd)
  const subject = doc?.[3]?.split('\n').find(l => l.trim())
  // -m, a cluster ending in m (-am), --message, with a space, "=" or nothing before the text.
  const m = /\s(?:-[a-zA-Z]*m|--message)(?:\s+|=)?(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(cmd)
  const raw = subject ?? m?.[1] ?? m?.[2] ?? m?.[3] ?? ''
  return clip(raw.replace(/\\n/g, ' '), 72)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function costNow($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
  } catch {
    return lastCost
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    startedAt = await $.clock.now()
    events = []
    nextId = 1
    lastPublished = ''
    turnTools = 0
    turnCost = undefined
    lastCost = undefined
    agents = new Map()
    armed = new Map()
    isSeeded = false
    record(startedAt, 'session', 'session started', e.cwd ? clip(e.cwd, 60) : undefined)
    await $.command.register({ name: 'chronicle', description: 'KOZMOS: toggle the Chronicle timeline sidebar', immediate: true })
    await publish($)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'chronicle' }, async $ => ({
    text: (await toggle($)) ? 'Chronicle open.' : 'Chronicle closed.',
  }))

  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    // The person's own prompts: not task notifications, peers or triggers.
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk'
    if (r.drop === undefined && isPerson && (r.text || e.text).trim()) {
      record(await $.clock.now(), 'prompt', clip(r.text || e.text, 80))
      await publish($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    turnTools = 0
    turnCost = lastCost ?? (await costNow($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      const cost = await costNow($)
      if (cost !== undefined) lastCost = cost
      const delta = cost !== undefined && turnCost !== undefined ? cost - turnCost : undefined
      const how = e.reason === 'answer' ? 'turn' : e.reason === 'aborted' ? 'turn interrupted' : e.reason === 'refusal' ? 'turn refused' : 'turn failed'
      const bits = [`${turnTools} tool${turnTools === 1 ? '' : 's'}`, delta !== undefined && delta > 0 ? `+${fmtUsd(delta)}` : '']
      record(at, 'turn', `${how} · ${fmtClock(e.durationMs)}`, bits.filter(Boolean).join(' · '), e.reason === 'error' || e.reason === 'refusal')
      turnCost = cost
    } else {
      const a = agents.get(e.agentId)
      if (a) {
        const ok = e.reason === 'answer'
        record(at, 'agent-end', `${a.type} ${ok ? 'finished' : e.reason === 'aborted' ? 'stopped' : 'failed'} · ${fmtClock(at - a.at)}`, a.description, !ok)
      }
    }
    await publish($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) {
      const at = await $.clock.now()
      agents.set(r.agentId, { type: e.subagentType || 'agent', description: e.description, at })
      record(at, 'agent-start', `${e.subagentType || 'agent'} spawned${e.background ? ' (background)' : ''}`, e.description)
      await publish($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) turnTools++
    const ran = await next(e)
    const at = await $.clock.now()
    const failed = ran.isError === true || ran.deny !== undefined
    const name = String(e.tool)
    if (failed) {
      const who = e.agentId === undefined ? '' : ` in ${agents.get(e.agentId)?.type ?? 'agent'}`
      record(at, 'tool-fail', `${toolName(name)} ${ran.deny !== undefined ? 'denied' : 'failed'}${who}`, toolDetail(name, e) || undefined, true)
      await publish($)
    } else if (e.tool === 'Bash') {
      const cmd = e.command
      const res = ran.result as { interrupted?: boolean; gitOperation?: { commit?: { sha?: string; kind?: string; branch?: string }; push?: { branch?: string } } } | undefined
      const op = res?.gitOperation
      if (res?.interrupted !== true && (op?.commit || runsGit(cmd, 'commit'))) {
        const sha = op?.commit?.sha ? op.commit.sha.slice(0, 7) : ''
        const verb = op?.commit?.kind === 'amended' ? 'amend' : 'commit'
        record(at, 'commit', `${verb}${sha ? ` ${sha}` : ''}${op?.commit?.branch ? ` on ${op.commit.branch}` : ''}`, commitMessage(cmd) || undefined)
        await publish($)
      }
      if (res?.interrupted !== true && (op?.push || runsGit(cmd, 'push'))) {
        record(at, 'push', `push${op?.push?.branch ? ` → ${op.push.branch}` : ''}`, clip(cmd, 72))
        await publish($)
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.trigger !== 'precompute' && r.skip === undefined) {
      const at = await $.clock.now()
      const span = r.tokensBefore !== undefined && r.tokensAfter !== undefined ? `${fmtTokens(r.tokensBefore)} → ${fmtTokens(r.tokensAfter)}` : undefined
      const who = e.agentId === undefined ? '' : ` (${agents.get(e.agentId)?.type ?? 'agent'})`
      record(at, 'compact', `compacted · ${e.trigger}${who}`, span)
      // The context fell: its milestones can fire again.
      if (e.agentId === undefined) armed.delete('context')
      await publish($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.cost) lastCost = e.cost.usd
    for (const l of e.rateLimits) {
      milestone(`limit:${l.kind}`, l.percentUsed, at, level =>
        record(at, 'limit', `${limitLabel(l.kind)} limit past ${level}%`, `${Math.round(l.percentUsed)}% used`, level >= 95))
    }
    milestone('context', e.context.percent, at, level =>
      record(at, 'context', `context past ${level}%`, e.context.tokens !== undefined ? `${fmtTokens(e.context.tokens)} of ${fmtTokens(e.context.window)}` : undefined, level >= 95))
    isSeeded = true
    await publish($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? { events, startedAt }
    const filter = await read($, filterAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const shown = snap.events.filter(ev => passes(filter, ev)).reverse()
    const buttons = (
      <Box key="filters" flexDirection="row" gap={1} flexWrap="wrap">
        {FILTERS.map(f => (
          <Button
            key={`f-${f.id}`}
            label={`${f.label} ${snap.events.filter(ev => passes(f.id, ev)).length}`}
            hotkey={f.hotkey}
            variant={f.id === filter ? 'primary' : undefined}
            dimColor={f.id !== filter}
            onPress={() => void update($, filterAtom, () => f.id)}
          />
        ))}
      </Box>
    )

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const head = headerSvg(snap, W)
      const line = timelineSvg(shown.slice(0, 60), W)
      return (
        <Box flexDirection="column">
          <Svg source={head.source} alt={altHeader(snap)} width={W} height={head.height} />
          {buttons}
          <Svg source={line.source} alt={shown.slice(0, 12).map(ev => `${hhmmss(ev.at)} ${ev.title}`).join('; ') || 'no events'} width={W} height={line.height} />
        </Box>
      )
    }

    // Only the terminal is left, and it always has Raster.
    const { Raster } = ui as Elements['terminal']
    const cols = Math.max(30, e.props.bodyColumns || 44)
    const t = tally(snap)
    const ribbonW = Math.max(8, cols - 2)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={KZ.cyan}>❯ {t.prompts}</Text><Text dimColor> prompts  </Text>
          <Text color={KZ.magenta}>◈ {t.agents}</Text><Text dimColor> agents  </Text>
          <Text color={KZ.green}>◉ {t.commits}</Text><Text dimColor> commits  </Text>
          <Text color={t.errors ? KZ.red : KZ.mist}>✖ {t.errors}</Text><Text dimColor> errors</Text>
        </Text>
        <Raster key="ribbon" columns={ribbonW} rows={1} cells={ribbon(snap, ribbonW)} />
        {buttons}
        {shown.length === 0 ? <Text dimColor>  nothing here yet</Text> : null}
        {shown.slice(0, 80).map((ev, i) => {
          const c = colorOf(ev)
          const isLast = i === Math.min(shown.length, 80) - 1
          return (
            <Box key={`ev-${ev.id}`} flexDirection="column">
              <Text wrap="truncate-end">
                <Text dimColor>{hhmmss(ev.at)} </Text>
                <Text color={c} bold>{KIND[ev.kind].icon} </Text>
                <Text bold={ev.kind === 'prompt' || ev.kind === 'commit'} color={ev.isError ? KZ.red : undefined}>{ev.title}</Text>
              </Text>
              {ev.detail || !isLast
                ? (
                    <Text wrap="truncate-end">
                      <Text dimColor>{'         '}</Text>
                      <Text color={c} dimColor>{isLast ? ' ' : '│'} </Text>
                      {ev.detail ? <Text dimColor>{ev.detail}</Text> : null}
                    </Text>
                  )
                : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------

function tally(s: ChronSnap): { prompts: number; agents: number; commits: number; errors: number } {
  const t = { prompts: 0, agents: 0, commits: 0, errors: 0 }
  for (const ev of s.events) {
    if (ev.kind === 'prompt') t.prompts++
    else if (ev.kind === 'agent-start') t.agents++
    else if (ev.kind === 'commit') t.commits++
    if (ev.isError) t.errors++
  }
  return t
}

/** The session squeezed into `w` slices, each painted by its loudest event. */
function slices(s: ChronSnap, w: number): (ChronEvent | undefined)[] {
  const out: (ChronEvent | undefined)[] = Array.from({ length: w }, () => undefined)
  const last = s.events[s.events.length - 1]?.at ?? s.startedAt
  const span = Math.max(60_000, last - s.startedAt)
  for (const ev of s.events) {
    const i = Math.min(w - 1, Math.max(0, Math.floor(((ev.at - s.startedAt) / span) * w)))
    const cur = out[i]
    const rank = (x: ChronEvent) => (x.isError ? 9 : KIND[x.kind].rank)
    if (!cur || rank(ev) >= rank(cur)) out[i] = ev
  }
  return out
}

function ribbon(s: ChronSnap, w: number): string {
  const cv = new Canvas(w, 1)
  slices(s, w).forEach((ev, x) => {
    if (ev) cv.set(x, 0, ev.kind === 'session' ? '▏' : '█', colorOf(ev))
    else cv.set(x, 0, '▁', '#3f3f46')
  })
  return cv.encode()
}

// ---------------------------------------------------------------------------
// Desktop.

const CSS = `
.ring{animation:chr 2s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chr{0%{opacity:.6;transform:scale(.7)}100%{opacity:0;transform:scale(2.2)}}
`

function altHeader(s: ChronSnap): string {
  const t = tally(s)
  return `${s.events.length} events: ${t.prompts} prompts, ${t.agents} agents, ${t.commits} commits, ${t.errors} errors`
}

function headerSvg(s: ChronSnap, W: number): { source: string; height: number } {
  const t = tally(s)
  const p: string[] = []
  const H = 70
  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`)
  const chips: [string, number, string][] = [['prompts', t.prompts, KZ.cyan], ['agents', t.agents, KZ.magenta], ['commits', t.commits, KZ.green], ['errors', t.errors, t.errors ? KZ.red : KZ.mist]]
  const cw = (W - 24) / chips.length
  chips.forEach(([label, n, c], i) => {
    const x = 12 + i * cw
    p.push(svgText(x, 26, String(n), { size: 17, weight: 750, fill: c }))
    p.push(svgText(x + String(n).length * 10.5 + 5, 26, label, { cls: 's', size: 10.5 }))
  })
  // The ribbon: the whole session left to right.
  const rw = W - 24
  const n = Math.max(10, Math.min(120, Math.floor(rw / 4)))
  const sw = rw / n
  p.push(`<rect class="k" x="12" y="40" width="${rw}" height="14" rx="4"/>`)
  slices(s, n).forEach((ev, i) => {
    if (ev && ev.kind !== 'session') p.push(`<rect x="${(12 + i * sw + 0.5).toFixed(1)}" y="41" width="${Math.max(1, sw - 1).toFixed(1)}" height="12" rx="1.5" fill="${colorOf(ev)}"/>`)
  })
  const last = s.events[s.events.length - 1]?.at ?? s.startedAt
  p.push(svgText(12, 65, hhmmss(s.startedAt), { cls: 'm', size: 9, mono: true }))
  p.push(svgText(W - 12, 65, hhmmss(last), { cls: 'm', size: 9, mono: true, anchor: 'end' }))
  return { source: svg(W, H + 4, p.join(''), CSS), height: H + 4 }
}

function timelineSvg(list: ChronEvent[], W: number): { source: string; height: number } {
  const p: string[] = []
  const lineX = 74
  let y = 16
  const ys: number[] = []
  list.forEach((ev, i) => {
    const c = colorOf(ev)
    const h = ev.detail ? 38 : 26
    ys.push(y)
    p.push(svgText(12, y + 4, hhmmss(ev.at), { cls: 'm', size: 10, mono: true }))
    if (i === 0) p.push(`<circle cx="${lineX}" cy="${y}" r="6" fill="${c}" class="ring"/>`)
    p.push(`<circle cx="${lineX}" cy="${y}" r="${ev.kind === 'prompt' || ev.kind === 'commit' || ev.isError ? 5 : 4}" fill="${c}"/>`)
    if (ev.kind === 'turn' || ev.kind === 'agent-end') p.push(`<circle cx="${lineX}" cy="${y}" r="1.8" class="p"/>`)
    const tx = lineX + 14
    p.push(svgText(tx, y + 4, fitText(ev.title, 12, W - tx - 12), { size: 12, weight: ev.kind === 'prompt' || ev.kind === 'commit' ? 650 : 500, fill: ev.isError ? KZ.red : undefined }))
    if (ev.detail) p.push(svgText(tx, y + 19, fitText(ev.detail, 10.5, W - tx - 12), { cls: 's', size: 10.5, mono: ev.kind === 'commit' || ev.kind === 'push' || ev.kind === 'tool-fail' }))
    y += h
  })
  if (list.length === 0) {
    p.push(svgText(W / 2, 22, 'Nothing here yet.', { cls: 'm', size: 11, anchor: 'middle' }))
    y = 36
  }
  const height = Math.max(36, y - 6)
  const top = ys[0] ?? 0
  const bottom = ys[ys.length - 1] ?? 0
  const rail = list.length > 1
    ? `<defs><linearGradient id="chG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}"/><stop offset=".6" stop-color="${KZ.cyan}" stop-opacity=".7"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity=".1"/></linearGradient></defs>` +
      `<rect x="${lineX - 1}" y="${top}" width="2" height="${bottom - top}" rx="1" fill="url(#chG)"/>`
    : ''
  return { source: svg(W, height, `<rect class="p" x="0" y="0" width="${W}" height="${height}" rx="12"/>${rail}${p.join('')}`, CSS), height }
}
