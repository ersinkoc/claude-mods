import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { HiveNode, HiveSnap, HiveStatus } from '../types'
import {
  KZ, bar, clamp01, contextOf, costOf, fitText, fmtClock, fmtTokens, fmtUsd, heat, modelName, pxOf, sparkline,
  svg, svgBar, svgText, tokensOf, toolColor, toolDetail, toolGlyph, toolName, windowOf,
} from './lib/kz.ts'

const PANE = 'kz-hivemind'
const TITLE = 'KOZMOS · Hivemind'
const ROOT = 'main'
const SPIN = ['◐', '◓', '◑', '◒']

const snapAtom = atom({ plugin: 'hivemind', key: 'snap' } as const, null)
const viewAtom = atom({ plugin: 'hivemind', key: 'view' } as const, { showDone: true })

// ---------------------------------------------------------------------------
// The live swarm. Module state starts over on a reload; session.start resets it
// and $.agent.list fills back what it can.

type Known = HiveNode & { isKnown: boolean }

const newNode = (id: string, at: number): Known => ({
  id, type: '', description: '', status: 'running', startedAt: at, steps: 0, tokens: 0, usd: 0, tools: 0, isKnown: false,
})

let root: Known = { ...newNode(ROOT, 0), type: 'main', status: 'waiting', isKnown: true }
let nodes = new Map<string, Known>()
let history: number[] = []
let lastPublished = ''
let ticker: Timer | undefined
let tickCount = 0

function nodeFor(id: string | undefined, at: number): Known {
  if (id === undefined) return root
  let n = nodes.get(id)
  if (!n) {
    n = newNode(id, at)
    nodes.set(id, n)
  }
  return n
}

const isRunning = (s: HiveStatus) => s === 'running'
const runningAgents = () => [...nodes.values()].filter(n => n.isKnown && isRunning(n.status)).length

function snapshot(now: number): HiveSnap {
  const strip = ({ isKnown: _k, ...n }: Known): HiveNode => n
  return {
    root: strip(root),
    agents: [...nodes.values()].filter(n => n.isKnown).sort((a, b) => a.startedAt - b.startedAt).map(strip),
    history: [...history],
    now,
  }
}

let pubSeq = 0

async function publish($: EngineInterface): Promise<void> {
  const seq = ++pubSeq
  const now = await $.clock.now()
  // A later publish has the newer picture: this one stands down.
  if (seq !== pubSeq) return
  const snap = snapshot(now)
  const anyRunning = isRunning(root.status) || runningAgents() > 0
  const key = JSON.stringify({ ...snap, now: anyRunning ? now : 0 })
  if (key !== lastPublished) {
    lastPublished = key
    await update($, snapAtom, () => snap)
  }
  // A one-second clock only while something runs, for the elapsed timers and
  // the spinner frames.
  if (anyRunning && !ticker) ticker = $.clock.every(1000, () => void onTick($).catch(() => undefined))
  else if (!anyRunning && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

async function onTick($: EngineInterface): Promise<void> {
  tickCount++
  history = [...history, runningAgents()].slice(-120)
  if (tickCount % 3 === 0) await reconcile($)
  await publish($)
}

const fromList = (s: string): HiveStatus | undefined =>
  s === 'pending' || s === 'running' ? 'running'
    : s === 'waiting' || s === 'idle' ? 'waiting'
      : s === 'completed' ? 'done'
        : s === 'failed' || s === 'killed' ? 'failed'
          : undefined

/** The engine's own roster wins on status and parentage. */
async function reconcile($: EngineInterface): Promise<void> {
  let list: Awaited<ReturnType<EngineInterface['agent']['list']>>
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const at = await $.clock.now()
  for (const a of list) {
    const n = nodeFor(a.id, at)
    n.isKnown = true
    n.type = n.type || a.type
    n.description = n.description || a.description
    if (a.parentId !== undefined) n.parentId = a.parentId
    const st = fromList(a.status)
    if (!st) continue
    // A loop that ended by our own turn.complete stays ended until it steps again.
    if (st === 'running' && n.endedAt !== undefined) continue
    if (st !== n.status) {
      n.status = st
      if (st === 'done' || st === 'failed') n.endedAt ??= at
    }
  }
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
    const at = await $.clock.now()
    root = { ...newNode(ROOT, at), type: 'main', description: 'the session', status: 'waiting', isKnown: true }
    nodes = new Map()
    history = []
    lastPublished = ''
    ticker?.cancel()
    ticker = undefined
    await $.command.register({ name: 'hivemind', description: 'KOZMOS: toggle the Hivemind agent-tree sidebar', immediate: true })
    try {
      root.model = await $.session.model()
    } catch {
      // Filled by the first turn.step.
    }
    await reconcile($)
    await publish($)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'hivemind' }, async $ => ({
    text: (await toggle($)) ? 'Hivemind open.' : 'Hivemind closed.',
  }))

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    root.status = 'running'
    root.startedAt = at
    root.endedAt = undefined
    await publish($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) {
      const n = nodeFor(r.agentId, await $.clock.now())
      n.isKnown = true
      n.type = e.subagentType
      n.description = e.description
      n.parentId = e.parentAgentId
      n.model = n.model ?? r.model
      n.isBackground = e.background
      if (n.endedAt === undefined) n.status = 'running'
      await publish($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const at = await $.clock.now()
    const n = nodeFor(e.agentId, at)
    n.model = e.model || n.model
    if (e.effort !== undefined) n.effort = String(e.effort)
    if (e.agentId !== undefined && n.endedAt !== undefined) {
      // A teammate woke up for another turn.
      n.endedAt = undefined
      n.status = 'running'
      n.startedAt = at
    }
    if (e.agentId !== undefined && n.status !== 'running') n.status = 'running'
    await publish($)
    const r = yield* next(e)
    if (r.usage) {
      const model = r.usage.model || e.model
      n.steps++
      n.tokens += tokensOf(r.usage)
      n.usd += costOf(model, r.usage)
      n.ctxPct = (100 * contextOf(r.usage)) / windowOf(model)
      await publish($)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    const n = nodeFor(e.agentId, at)
    n.tool = undefined
    if (e.agentId === undefined) {
      n.status = 'waiting'
      n.endedAt = at
    } else {
      n.status = e.reason === 'answer' ? 'done' : 'failed'
      n.endedAt = at
      void reconcile($).then(() => publish($)).catch(() => undefined)
    }
    await publish($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const name = String(e.tool)
    const detail = toolDetail(name, e)
    const n = nodeFor(e.agentId, at)
    n.tool = { id: e.tool_use_id, name, detail, startedAt: at }
    n.tools++
    await publish($)
    const ran = await next(e)
    const ms = (await $.clock.now()) - at
    n.lastTool = { name, detail, ms, isError: ran.isError === true || ran.deny !== undefined }
    if (n.tool?.id === e.tool_use_id) n.tool = undefined
    await publish($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? snapshot(await $.clock.now())
    const view = await read($, viewAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const { rows, hidden } = flatten(snap, view.showDone)
    const finished = snap.agents.filter(a => a.status === 'done' || a.status === 'failed').length
    const toggleDone = finished > 0
      ? (
          <Button
            key="hm-done"
            hotkey="f"
            dimColor
            label={view.showDone ? `▾ hide finished (${finished})` : `▸ show finished (${hidden})`}
            onPress={() => void update($, viewAtom, v => ({ ...v, showDone: !v.showDone }))}
          />
        )
      : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const head = headerSvg(snap, W)
      const tree = treeSvg(snap, rows, W)
      return (
        <Box flexDirection="column">
          <Svg source={head.source} alt={altHeader(snap)} width={W} height={head.height} />
          <Svg source={tree.source} alt={altTree(rows)} width={W} height={tree.height} />
          {toggleDone}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    const t = counts(snap)
    const frame = SPIN[Math.floor(snap.now / 1000) % 4] ?? '◐'
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={KZ.violet} bold>{t.running ? frame : '◇'} {t.running}</Text><Text dimColor> running  </Text>
            <Text color={KZ.green} bold>✓ {t.done}</Text><Text dimColor> done  </Text>
            <Text color={t.failed ? KZ.red : KZ.mist} bold>✖ {t.failed}</Text><Text dimColor> failed</Text>
          </Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text dimColor>Σ agents </Text><Text color={KZ.yellow}>{fmtUsd(t.usd)}</Text><Text dimColor> · {fmtTokens(t.tokens)} tok · {t.steps} req</Text>
          </Text>
          {snap.history.some(v => v > 0)
            ? <Text color={KZ.violet}>{sparkline(snap.history, Math.max(6, Math.min(24, cols - 38)))}</Text>
            : null}
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(4, cols - 1))}</Text>
        {rows.map(r => termNode(ui, r, snap.now, cols))}
        {snap.agents.length === 0
          ? <Text dimColor>  no subagents yet: the swarm grows here as the Agent tool spawns them</Text>
          : null}
        {toggleDone}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Tree shape, shared by both surfaces.

type Row = { node: HiveNode; depth: number; lead: string; cont: string; parentRow?: number }

function counts(s: HiveSnap): { running: number; done: number; failed: number; usd: number; tokens: number; steps: number } {
  const c = { running: 0, done: 0, failed: 0, usd: 0, tokens: 0, steps: 0 }
  for (const a of s.agents) {
    if (a.status === 'running') c.running++
    else if (a.status === 'done') c.done++
    else if (a.status === 'failed') c.failed++
    c.usd += a.usd
    c.tokens += a.tokens
    c.steps += a.steps
  }
  return c
}

function flatten(s: HiveSnap, showDone: boolean): { rows: Row[]; hidden: number } {
  const ids = new Set(s.agents.map(a => a.id))
  const kids = new Map<string, HiveNode[]>()
  for (const a of s.agents) {
    const p = a.parentId && ids.has(a.parentId) ? a.parentId : ROOT
    kids.set(p, [...(kids.get(p) ?? []), a])
  }
  const memo = new Map<string, boolean>()
  const visible = (n: HiveNode): boolean => {
    const hit = memo.get(n.id)
    if (hit !== undefined) return hit
    memo.set(n.id, false) // guards a cycle
    const v = showDone || (n.status !== 'done' && n.status !== 'failed') || (kids.get(n.id) ?? []).some(visible)
    memo.set(n.id, v)
    return v
  }
  const rows: Row[] = [{ node: s.root, depth: 0, lead: '', cont: '' }]
  let hidden = 0
  const seen = new Set<string>([ROOT])
  const walk = (id: string, depth: number, carry: string, parentRow: number) => {
    const all = kids.get(id) ?? []
    const shown = all.filter(visible)
    hidden += all.length - shown.length
    shown.forEach((n, i) => {
      if (seen.has(n.id)) return
      seen.add(n.id)
      const isLast = i === shown.length - 1
      rows.push({ node: n, depth, lead: carry + (isLast ? '└─ ' : '├─ '), cont: carry + (isLast ? '   ' : '│  '), parentRow })
      walk(n.id, depth + 1, carry + (isLast ? '   ' : '│  '), rows.length - 1)
    })
  }
  walk(ROOT, 1, '', 0)
  return { rows, hidden }
}

const statusColor = (st: HiveStatus) => (st === 'running' ? KZ.violet : st === 'done' ? KZ.green : st === 'failed' ? KZ.red : KZ.mist)

function glyphOf(n: HiveNode, now: number): string {
  if (n.status === 'running') return SPIN[Math.floor(now / 1000) % 4] ?? '◐'
  return n.status === 'done' ? '✓' : n.status === 'failed' ? '✖' : '⏸'
}

const elapsedOf = (n: HiveNode, now: number) => (n.endedAt ?? now) - n.startedAt

// ---------------------------------------------------------------------------
// Terminal.

function termNode(ui: ReturnType<EngineInterface['ui']['resolve']>, r: Row, now: number, cols: number) {
  const { Box, Text } = ui
  const n = r.node
  const c = statusColor(n.status)
  const isRoot = r.depth === 0
  const label = isRoot ? '◆ main' : n.type || 'agent'
  const ctx = clamp01((n.ctxPct ?? 0) / 100)
  const meta = [
    n.model ? modelName(n.model) : '',
    n.effort ?? '',
    n.steps ? `${n.steps} req` : '',
    n.tokens ? `${fmtTokens(n.tokens)} tok` : '',
    n.usd ? fmtUsd(n.usd) : '',
  ].filter(Boolean).join(' · ')
  const t = n.tool ?? n.lastTool
  const ind = r.cont + '  '
  return (
    <Box key={`n-${n.id}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text dimColor>{r.lead}</Text>
          <Text color={c} bold>{glyphOf(n, now)} </Text>
          <Text color={isRoot ? KZ.violet : KZ.cyan} bold>{label}</Text>
          {n.description && !isRoot ? <Text> {n.description}</Text> : null}
          {n.isBackground ? <Text dimColor> ⇢bg</Text> : null}
        </Text>
        <Text bold={n.status === 'running'} dimColor={n.status !== 'running'}> {fmtClock(elapsedOf(n, now))}</Text>
      </Box>
      <Text wrap="truncate-end">
        <Text dimColor>{ind}{meta || '—'}</Text>
        {n.ctxPct !== undefined
          ? <Text> <Text color={heat(ctx * 1.1)}>{bar(ctx, Math.max(3, Math.min(8, cols - meta.length - ind.length - 10)))}</Text><Text dimColor> {Math.round(n.ctxPct)}%</Text></Text>
          : null}
      </Text>
      {t
        ? (
            <Text wrap="truncate-end">
              <Text dimColor>{ind}↳ </Text>
              <Text color={n.tool ? toolColor(t.name) : 'isError' in t && t.isError ? KZ.red : KZ.mist}>{toolGlyph(t.name)} {toolName(t.name)}</Text>
              <Text dimColor> {t.detail}{n.tool ? ` · ${fmtClock(now - n.tool.startedAt)}` : n.lastTool ? ` · ${n.lastTool.ms}ms` : ''}</Text>
            </Text>
          )
        : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Desktop: a header card and the whole tree as one SVG each.

const CSS = `
.halo{animation:hmh 1.8s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes hmh{0%{opacity:.55;transform:scale(.6)}100%{opacity:0;transform:scale(1.9)}}
.flow{stroke-dasharray:3 4;animation:hmf 1.2s linear infinite}@keyframes hmf{to{stroke-dashoffset:-14}}
`

function altHeader(s: HiveSnap): string {
  const c = counts(s)
  return `${c.running} agents running, ${c.done} done, ${c.failed} failed; agents spent about ${fmtUsd(c.usd)} over ${fmtTokens(c.tokens)} tokens`
}

function altTree(rows: Row[]): string {
  return rows.map(r => `${r.depth ? r.node.type : 'main'} ${r.node.status}${r.node.description && r.depth ? `: ${r.node.description}` : ''}`).join('; ')
}

function headerSvg(s: HiveSnap, W: number): { source: string; height: number } {
  const c = counts(s)
  const p: string[] = []
  const tiles: [string, string, string, boolean][] = [
    ['RUNNING', String(c.running), KZ.violet, c.running > 0],
    ['DONE', String(c.done), KZ.green, false],
    ['FAILED', String(c.failed), c.failed ? KZ.red : KZ.mist, false],
    ['SPEND', fmtUsd(c.usd), KZ.yellow, false],
  ]
  const gap = 6
  const perRow = W >= 360 ? 4 : 2
  const tw = (W - gap * (perRow - 1)) / perRow
  const th = 56
  tiles.forEach(([k, v, col, live], i) => {
    const x = (i % perRow) * (tw + gap)
    const y = Math.floor(i / perRow) * (th + gap)
    p.push(`<rect class="p" x="${x}" y="${y}" width="${tw}" height="${th}" rx="12"/>`)
    p.push(`<circle cx="${x + 14}" cy="${y + 17}" r="4" fill="${col}"${live ? ' class="pulse"' : ''}/>`)
    p.push(svgText(x + 24, y + 21, k, { cls: 's', size: 9.5, weight: 650 }))
    p.push(svgText(x + 12, y + 44, v, { size: 18, weight: 700, fill: k === 'SPEND' || live ? col : undefined }))
  })
  let y = Math.ceil(tiles.length / perRow) * (th + gap)
  // Activity strip: running subagents over the last two minutes.
  const h = 40
  p.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${h}" rx="12"/>`)
  p.push(svgText(12, y + 16, 'SWARM', { cls: 's', size: 9.5, weight: 650 }))
  p.push(svgText(12, y + 31, `${fmtTokens(c.tokens)} tok · ${c.steps} req`, { cls: 'm', size: 10.5 }))
  const hist = s.history.length > 1 ? s.history : [0, 0]
  const top = Math.max(1, ...hist)
  const gx = 120
  const gw = W - gx - 12
  if (gw > 40) {
    const step = gw / Math.max(1, hist.length - 1)
    const pts = hist.map((v, i) => `${(gx + i * step).toFixed(1)},${(y + h - 8 - (v / top) * (h - 16)).toFixed(1)}`)
    p.push(`<defs><linearGradient id="hmG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}" stop-opacity=".5"/><stop offset="1" stop-color="${KZ.violet}" stop-opacity="0"/></linearGradient></defs>`)
    p.push(`<path d="M${pts.join('L')}L${gx + gw},${y + h - 8}L${gx},${y + h - 8}Z" fill="url(#hmG)"/>`)
    p.push(`<path d="M${pts.join('L')}" stroke="${KZ.violet}" stroke-width="1.5" fill="none" stroke-linejoin="round"/>`)
  }
  y += h
  return { source: svg(W, y, p.join(''), CSS), height: y }
}

function statusMark(n: HiveNode, cx: number, cy: number): string {
  const c = statusColor(n.status)
  if (n.status === 'running') {
    return `<circle cx="${cx}" cy="${cy}" r="7" fill="${c}" class="halo"/>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${c}" stroke-opacity=".25" stroke-width="2"/>` +
      `<path class="spin" d="M${cx} ${cy - 6}A6 6 0 0 1 ${cx + 6} ${cy}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<circle cx="${cx}" cy="${cy}" r="2" fill="${c}"/>`
  }
  if (n.status === 'done') {
    return `<circle cx="${cx}" cy="${cy}" r="6.5" fill="${c}"/>` +
      `<path d="M${cx - 3} ${cy}l2 2.2 4-4.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (n.status === 'failed') {
    return `<circle cx="${cx}" cy="${cy}" r="6.5" fill="${c}"/>` +
      `<path d="M${cx - 2.5} ${cy - 2.5}l5 5M${cx + 2.5} ${cy - 2.5}l-5 5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`
  }
  return `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${c}" stroke-width="1.6"/>` +
    `<path d="M${cx - 1.8} ${cy - 2.5}v5M${cx + 1.8} ${cy - 2.5}v5" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`
}

function treeSvg(s: HiveSnap, rows: Row[], W: number): { source: string; height: number } {
  const pad = 12
  const indent = 18
  const p: string[] = []
  const lines: string[] = []
  const ys: number[] = []
  let y = 10
  rows.forEach((r, i) => {
    const n = r.node
    const hasTool = (n.tool ?? n.lastTool) !== undefined
    const h = hasTool ? 58 : 42
    const cx = pad + 8 + r.depth * indent
    const cy = y + 13
    ys[i] = cy
    if (r.parentRow !== undefined) {
      const pr = rows[r.parentRow]
      const py = ys[r.parentRow] ?? cy
      const px = pad + 8 + (pr?.depth ?? 0) * indent
      lines.push(`<path class="ln${n.status === 'running' ? ' flow' : ''}" d="M${px} ${py + 8}V${cy - 4}Q${px} ${cy} ${px + 4} ${cy}H${cx - 9}" fill="none" stroke-width="1.4"${n.status === 'running' ? ` style="stroke:${KZ.violet};stroke-opacity:.6"` : ''}/>`)
    }
    if (n.status === 'running') p.push(`<rect x="${cx - 12}" y="${y - 2}" width="${W - cx + 10}" height="${h - 4}" rx="9" fill="${KZ.violet}" opacity=".07"/>`)
    p.push(statusMark(n, cx, cy))
    const x0 = cx + 14
    const right = W - pad
    const elapsed = fmtClock(elapsedOf(n, s.now))
    p.push(svgText(right, cy + 4, elapsed, { size: 11, anchor: 'end', mono: true, cls: n.status === 'running' ? 't' : 'm', weight: n.status === 'running' ? 600 : 400 }))
    const title = r.depth === 0 ? '◆ main' : n.type || 'agent'
    const titleW = Math.min(140, title.length * 7.4 + 4)
    p.push(svgText(x0, cy + 4, fitText(title, 12.5, titleW + 10), { size: 12.5, weight: 700, fill: r.depth === 0 ? KZ.violet : undefined }))
    if (r.depth > 0 && n.description) {
      p.push(svgText(x0 + titleW + 8, cy + 4, fitText(n.description, 12, Math.max(20, right - 52 - x0 - titleW - 8)), { cls: 's', size: 12 }))
    }
    const meta = [
      n.model ? modelName(n.model) : '',
      n.effort ?? '',
      n.steps ? `${n.steps} req` : '',
      n.tokens ? `${fmtTokens(n.tokens)} tok` : '',
      n.usd ? fmtUsd(n.usd) : '',
      n.isBackground ? 'background' : '',
    ].filter(Boolean).join(' · ')
    const barW = 46
    const hasCtx = n.ctxPct !== undefined
    p.push(svgText(x0, cy + 21, fitText(meta || '—', 10.5, right - x0 - (hasCtx ? barW + 44 : 0)), { cls: 'm', size: 10.5 }))
    if (hasCtx) {
      const ratio = clamp01((n.ctxPct ?? 0) / 100)
      p.push(svgBar(right - barW - 30, cy + 15, barW, 5, ratio, heat(ratio * 1.1)))
      p.push(svgText(right, cy + 21, `${Math.round(n.ctxPct ?? 0)}%`, { cls: 's', size: 10, anchor: 'end' }))
    }
    const t = n.tool ?? n.lastTool
    if (t) {
      const isLive = n.tool !== undefined
      const col = isLive ? toolColor(t.name) : n.lastTool?.isError ? KZ.red : KZ.mist
      const tag = `${toolGlyph(t.name)} ${toolName(t.name)}`
      const tagW = Math.min(150, tag.length * 6.4 + 14)
      p.push(`<rect x="${x0}" y="${cy + 28}" width="${tagW}" height="16" rx="8" fill="${col}" opacity="${isLive ? 0.2 : 0.12}"${isLive ? ' class="pulse"' : ''}/>`)
      p.push(svgText(x0 + 7, cy + 40, fitText(tag, 10, tagW - 10), { size: 10, weight: 650, fill: col }))
      const tail = isLive && n.tool ? fmtClock(s.now - n.tool.startedAt) : n.lastTool ? `${n.lastTool.ms}ms` : ''
      p.push(svgText(x0 + tagW + 6, cy + 40, fitText(t.detail || '', 10.5, Math.max(10, right - x0 - tagW - 60)), { cls: 's', size: 10.5, mono: true }))
      p.push(svgText(right, cy + 40, tail, { cls: 'm', size: 10, anchor: 'end' }))
    }
    y += h
  })
  if (rows.length === 1) {
    p.push(svgText(pad + 4, y + 8, 'No subagents yet. The swarm grows here as agents spawn.', { cls: 'm', size: 11 }))
    y += 18
  }
  const height = y + 4
  const body = `<rect class="p" x="0" y="0" width="${W}" height="${height}" rx="12"/>${lines.join('')}${p.join('')}`
  return { source: svg(W, height, body, CSS), height }
}
