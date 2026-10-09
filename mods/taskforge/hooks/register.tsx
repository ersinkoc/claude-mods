import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ForgeCard, ForgeSnap, ForgeStatus } from '../types'
import { KZ, clip, fitText, fmtSpan, mix, pxOf, svg, svgText, textWidth } from './lib/kz.ts'

const PANE = 'kz-taskforge'
const TITLE = 'KOZMOS · Taskforge'
const snapAtom = atom({ plugin: 'taskforge', key: 'snap' } as const, null)

type Column = { status: ForgeStatus; label: string; glyph: string; color: string }

const PENDING: Column = { status: 'pending', label: 'PENDING', glyph: '○', color: KZ.mist }
const ACTIVE: Column = { status: 'in_progress', label: 'IN PROGRESS', glyph: '◐', color: KZ.violet }
const DONE: Column = { status: 'completed', label: 'DONE', glyph: '●', color: KZ.green }
/** Board order, left to right. */
const COLS: Column[] = [PENDING, ACTIVE, DONE]
/** Stacked order on a narrow pane: what runs first. */
const STACKED: Column[] = [ACTIVE, PENDING, DONE]

// ---------------------------------------------------------------------------
// The live board. Module state starts over on a reload.

let cards = new Map<string, ForgeCard>()
let firstAt: number | undefined
let agentNames = new Map<string, string>()
let lastPublished = ''
let ticker: Timer | undefined

const ownerOf = (agentId: string | undefined): string | undefined =>
  agentId === undefined ? undefined : agentNames.get(agentId) ?? `agent ${agentId.slice(0, 6)}`

function snapshot(now: number): ForgeSnap {
  return { cards: [...cards.values()].sort((a, b) => a.createdAt - b.createdAt), firstAt, now }
}

let pubSeq = 0

async function publish($: EngineInterface): Promise<void> {
  const seq = ++pubSeq
  const now = await $.clock.now()
  // A later publish has the newer picture: this one stands down.
  if (seq !== pubSeq) return
  const snap = snapshot(now)
  const active = snap.cards.some(c => c.status === 'in_progress')
  const key = JSON.stringify({ ...snap, now: active ? now : 0 })
  if (key !== lastPublished) {
    lastPublished = key
    await update($, snapAtom, () => snap)
  }
  // Time-in-column only moves visibly while a card is in progress.
  if (active && !ticker) ticker = $.clock.every(1000, () => void publish($).catch(() => undefined))
  else if (!active && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

function place(key: string, at: number, fill: Omit<ForgeCard, 'key' | 'since' | 'createdAt'>): void {
  const old = cards.get(key)
  firstAt ??= at
  cards.set(key, {
    ...old,
    ...fill,
    key,
    createdAt: old?.createdAt ?? at,
    since: old && old.status === fill.status ? old.since : at,
  })
}

type Todo = { content: string; status: ForgeStatus; activeForm?: string }

function applyTodos(todos: readonly Todo[], agentId: string | undefined, at: number): void {
  const scope = agentId ?? 'main'
  const keep = new Set<string>()
  todos.forEach((t, i) => {
    const key = `todo:${scope}:${t.content}`
    keep.add(key)
    const old = cards.get(key)
    // Keep the list's own order for cards met in the same write.
    place(key, old ? at : at + i / 1000, {
      subject: t.content,
      activeForm: t.activeForm || undefined,
      status: t.status,
      owner: ownerOf(agentId),
      source: 'todo',
    })
  })
  for (const [k, c] of cards) if (c.source === 'todo' && k.startsWith(`todo:${scope}:`) && !keep.has(k)) cards.delete(k)
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
    cards = new Map()
    agentNames = new Map()
    firstAt = undefined
    lastPublished = ''
    ticker?.cancel()
    ticker = undefined
    await $.command.register({ name: 'taskforge', description: 'KOZMOS: toggle the Taskforge kanban sidebar', immediate: true })
    await publish($)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'taskforge' }, async $ => ({
    text: (await toggle($)) ? 'Taskforge open.' : 'Taskforge closed.',
  }))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.subagentType || e.description)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError === true || ran.deny !== undefined) return ran
    const at = await $.clock.now()
    if (e.tool === 'TodoWrite') {
      applyTodos(e.todos, e.agentId, at)
      await publish($)
    } else if (e.tool === 'TaskCreate') {
      const res = ran.result as { task?: { id?: string; subject?: string } } | undefined
      const id = res?.task?.id
      if (id !== undefined) {
        place(`task:${id}`, at, {
          subject: e.subject || res?.task?.subject || `#${id}`,
          description: e.description || undefined,
          activeForm: e.activeForm || undefined,
          status: 'pending',
          owner: ownerOf(e.agentId),
          source: 'task',
          taskId: id,
        })
        await publish($)
      }
    } else if (e.tool === 'TaskUpdate') {
      const key = `task:${e.taskId}`
      if (e.status === 'deleted') cards.delete(key)
      else {
        const old = cards.get(key)
        place(key, at, {
          subject: e.subject || old?.subject || `#${e.taskId}`,
          description: e.description || old?.description,
          activeForm: e.activeForm || old?.activeForm,
          status: e.status ?? old?.status ?? 'pending',
          owner: e.owner || old?.owner || ownerOf(e.agentId),
          source: 'task',
          taskId: e.taskId,
        })
      }
      await publish($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? snapshot(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const tally = countsOf(snap)

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const head = headerSvg(snap, W)
      const board = boardSvg(snap, W)
      return (
        <Box flexDirection="column">
          <Svg source={head.source} alt={`${tally.done} of ${tally.total} tasks done (${tally.pct}%)`} width={W} height={head.height} />
          <Svg source={board.source} alt={altBoard(snap)} width={W} height={board.height} />
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    const ratio = tally.total ? tally.done / tally.total : 0
    const barW = Math.max(6, cols - 2)
    const segDone = tally.total ? Math.round((tally.done / tally.total) * barW) : 0
    const segActive = tally.total ? Math.min(barW - segDone, Math.max(tally.active ? 1 : 0, Math.round((tally.active / tally.total) * barW))) : 0
    const header = (
      <Box key="head" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.teal}>⚒ {tally.done}/{tally.total} done</Text>
          <Text bold color={mix(KZ.violet, KZ.green, ratio)}>{tally.pct}%</Text>
        </Box>
        <Text>
          <Text color={KZ.green}>{'█'.repeat(segDone)}</Text>
          <Text color={KZ.violet}>{'▓'.repeat(segActive)}</Text>
          <Text dimColor>{'░'.repeat(Math.max(0, barW - segDone - segActive))}</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color={KZ.mist}>○ {tally.pending}</Text><Text dimColor> pending  </Text>
          <Text color={KZ.violet}>◐ {tally.active}</Text><Text dimColor> active  </Text>
          <Text color={KZ.green}>● {tally.done}</Text><Text dimColor> done</Text>
          {snap.firstAt !== undefined ? <Text dimColor>  · since {fmtSpan(snap.now - snap.firstAt)}</Text> : null}
        </Text>
      </Box>
    )
    if (tally.total === 0) {
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>No tasks yet: TodoWrite lists and TaskCreate tasks land here.</Text>
        </Box>
      )
    }

    if (cols >= 72) {
      const colW = Math.floor((cols - 2) / 3)
      return (
        <Box flexDirection="column">
          {header}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {COLS.map(col => {
              const list = byColumn(snap, col.status)
              const shown = col.status === 'completed' ? list.slice(-8) : list
              return (
                <Box key={`col-${col.status}`} flexDirection="column" width={colW} flexShrink={0}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text bold color={col.color}>{col.glyph} {col.label}</Text>
                    <Text dimColor>{list.length}</Text>
                  </Box>
                  <Text color={col.color}>{'━'.repeat(Math.max(2, colW - 1))}</Text>
                  {shown.map(c => wideCard(ui, c, col.color, snap.now, colW))}
                  {list.length > shown.length ? <Text dimColor>  +{list.length - shown.length} earlier</Text> : null}
                  {list.length === 0 ? <Text dimColor>  —</Text> : null}
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        {STACKED.map(col => {
          const list = byColumn(snap, col.status)
          if (list.length === 0) return null
          const shown = col.status === 'completed' ? list.slice(-6) : list
          return (
            <Box key={`sec-${col.status}`} flexDirection="column" marginTop={1}>
              <Text bold color={col.color}>{col.glyph} {col.label} <Text dimColor>{list.length}</Text></Text>
              {shown.map(c => narrowCard(ui, c, col.color, snap.now, cols))}
              {list.length > shown.length ? <Text dimColor>  +{list.length - shown.length} earlier</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------

function countsOf(s: ForgeSnap): { total: number; pending: number; active: number; done: number; pct: number } {
  let pending = 0
  let active = 0
  let done = 0
  for (const c of s.cards) {
    if (c.status === 'pending') pending++
    else if (c.status === 'in_progress') active++
    else done++
  }
  const total = s.cards.length
  return { total, pending, active, done, pct: total ? Math.round((100 * done) / total) : 0 }
}

function byColumn(s: ForgeSnap, st: ForgeStatus): ForgeCard[] {
  const list = s.cards.filter(c => c.status === st)
  // Done reads in the order things finished; the others in board order.
  return st === 'completed' ? list.sort((a, b) => a.since - b.since) : list
}

function cardMeta(c: ForgeCard, now: number): string {
  return [c.owner ?? '', fmtSpan(now - c.since), c.taskId !== undefined ? `#${c.taskId}` : ''].filter(Boolean).join(' · ')
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>

function wideCard(ui: Ui, c: ForgeCard, color: string, now: number, w: number) {
  const { Box, Text } = ui
  const isActive = c.status === 'in_progress'
  const isDone = c.status === 'completed'
  return (
    <Box key={`c-${c.key}`} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={color}>▍</Text>
        <Text bold={isActive} dimColor={isDone} strikethrough={false}>{clip(c.subject, w * 2)}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color={color}>▍</Text>
        {isActive && c.activeForm ? <Text color={KZ.violet} italic>{c.activeForm} </Text> : null}
        <Text dimColor>{cardMeta(c, now)}</Text>
      </Text>
    </Box>
  )
}

function narrowCard(ui: Ui, c: ForgeCard, color: string, now: number, cols: number) {
  const { Box, Text } = ui
  const isActive = c.status === 'in_progress'
  const meta = cardMeta(c, now)
  return (
    <Box key={`c-${c.key}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color={color}>▍</Text>
          <Text bold={isActive} dimColor={c.status === 'completed'}>{clip(c.subject, cols)}</Text>
        </Text>
        <Text dimColor> {meta}</Text>
      </Box>
      {isActive && c.activeForm
        ? <Text wrap="truncate-end"><Text color={color}>▍</Text><Text color={KZ.violet} italic>↳ {c.activeForm}</Text></Text>
        : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Desktop.

const CSS = `
.cd{fill:#ffffff}.cds{stroke:#e4e2dc}
@media (prefers-color-scheme: dark){.cd{fill:#2a2a28}.cds{stroke:#3a3a37}}
.ants{stroke-dasharray:6 4;animation:tfa .9s linear infinite}@keyframes tfa{to{stroke-dashoffset:-20}}
.glow{animation:tfg 2.2s ease-in-out infinite}@keyframes tfg{50%{opacity:.25}}
`

function altBoard(s: ForgeSnap): string {
  return COLS.map(col => `${col.label.toLowerCase()}: ${byColumn(s, col.status).map(c => c.subject).join(', ') || 'none'}`).join('; ')
}

function headerSvg(s: ForgeSnap, W: number): { source: string; height: number } {
  const t = countsOf(s)
  const p: string[] = []
  const H = 74
  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`)
  p.push(svgText(14, 34, `${t.pct}%`, { size: 26, weight: 750, fill: mix(KZ.violet, KZ.green, t.total ? t.done / t.total : 0) }))
  const x0 = 96
  p.push(svgText(x0, 22, `${t.done} of ${t.total} done`, { size: 12.5, weight: 650 }))
  p.push(svgText(W - 14, 22, s.firstAt !== undefined ? `since ${fmtSpan(s.now - s.firstAt)}` : 'no tasks yet', { cls: 'm', size: 10.5, anchor: 'end' }))
  // One track, three segments: done, in progress, pending.
  const bw = W - x0 - 14
  const by = 32
  p.push(`<rect class="k" x="${x0}" y="${by}" width="${bw}" height="9" rx="4.5"/>`)
  p.push(`<clipPath id="tfc"><rect x="${x0}" y="${by}" width="${bw}" height="9" rx="4.5"/></clipPath>`)
  const dw = t.total ? (bw * t.done) / t.total : 0
  const aw = t.total ? (bw * t.active) / t.total : 0
  p.push(`<g clip-path="url(#tfc)"><rect x="${x0}" y="${by}" width="${dw}" height="9" fill="${KZ.green}"/><rect x="${x0 + dw}" y="${by}" width="${aw}" height="9" fill="${KZ.violet}" class="glow"/></g>`)
  const chips: [string, number, string][] = [['pending', t.pending, KZ.mist], ['in progress', t.active, KZ.violet], ['done', t.done, KZ.green]]
  let cx = x0
  for (const [label, n, c] of chips) {
    p.push(`<circle cx="${cx + 4}" cy="${58}" r="3.5" fill="${c}"/>`)
    const txt = `${n} ${label}`
    p.push(svgText(cx + 12, 62, txt, { cls: 's', size: 10.5 }))
    cx += textWidth(txt, 10.5) + 26
  }
  return { source: svg(W, H, p.join(''), CSS), height: H }
}

function wrap(s: string, size: number, maxW: number, maxLines: number): string[] {
  const words = s.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (textWidth(next, size) <= maxW || !cur) cur = next
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines)
    head[maxLines - 1] = fitText(`${head[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, size, maxW)
    return head
  }
  return lines.map(l => fitText(l, size, maxW))
}

type Drawn = { body: string; height: number }

function cardSvg(c: ForgeCard, x: number, y: number, w: number, color: string, now: number): Drawn {
  const isActive = c.status === 'in_progress'
  const isDone = c.status === 'completed'
  const lines = wrap(c.subject, 11.5, w - 22, 3)
  const form = isActive ? c.activeForm : undefined
  const h = 14 + lines.length * 15 + (form ? 15 : 0) + 18
  const p: string[] = []
  p.push(`<rect class="cd cds" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" stroke-width="1"/>`)
  if (isActive) p.push(`<rect class="ants" x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="7.5" fill="none" stroke="${color}" stroke-width="1.5"/>`)
  p.push(`<rect x="${x + 6}" y="${y + 8}" width="3" height="${h - 16}" rx="1.5" fill="${color}"${isDone ? ' opacity=".55"' : ''}/>`)
  lines.forEach((l, i) => {
    p.push(svgText(x + 16, y + 20 + i * 15, l, { size: 11.5, weight: isActive ? 650 : 500, cls: isDone ? 's' : 't' }))
  })
  let ly = y + 20 + lines.length * 15
  if (form) {
    p.push(svgText(x + 16, ly, fitText(`↳ ${form}`, 10.5, w - 22), { size: 10.5, fill: KZ.violet }))
    ly += 15
  }
  p.push(svgText(x + 16, ly + 1, fitText(cardMeta(c, now), 9.5, w - 22), { cls: 'm', size: 9.5 }))
  if (isDone) p.push(`<path d="M${x + w - 18} ${y + 14}l3 3 6-6" stroke="${KZ.green}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
  if (isActive) p.push(`<circle cx="${x + w - 12}" cy="${y + 12}" r="3.5" fill="${color}" class="pulse"/>`)
  return { body: p.join(''), height: h }
}

function columnSvg(s: ForgeSnap, col: Column, x: number, y: number, w: number): Drawn {
  const all = byColumn(s, col.status)
  const list = col.status === 'completed' ? all.slice(-10) : all
  const p: string[] = []
  let cy = y + 36
  for (const c of list) {
    const d = cardSvg(c, x + 8, cy, w - 16, col.color, s.now)
    p.push(d.body)
    cy += d.height + 6
  }
  if (all.length > list.length) {
    p.push(svgText(x + w / 2, cy + 8, `+${all.length - list.length} earlier`, { cls: 'm', size: 10, anchor: 'middle' }))
    cy += 16
  }
  if (all.length === 0) {
    p.push(`<rect x="${x + 8}" y="${cy}" width="${w - 16}" height="34" rx="8" fill="none" class="ln" stroke-dasharray="4 4"/>`)
    p.push(svgText(x + w / 2, cy + 21, 'empty', { cls: 'm', size: 10, anchor: 'middle' }))
    cy += 40
  }
  const h = cy - y + 4
  const head = [
    `<rect class="p" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`,
    `<circle cx="${x + 16}" cy="${y + 18}" r="4.5" fill="${col.color}"${col.status === 'in_progress' && all.length ? ' class="pulse"' : ''}/>`,
    svgText(x + 27, y + 22, col.label, { size: 10.5, weight: 700, cls: 's' }),
    `<rect x="${x + w - 36}" y="${y + 10}" width="26" height="16" rx="8" fill="${col.color}" opacity=".18"/>`,
    svgText(x + w - 23, y + 22, String(all.length), { size: 10.5, weight: 700, anchor: 'middle', fill: col.color }),
  ]
  return { body: head.join('') + p.join(''), height: h }
}

function boardSvg(s: ForgeSnap, W: number): { source: string; height: number } {
  const gap = 8
  const parts: string[] = []
  let height = 0
  if (W >= 520) {
    const cw = (W - gap * 2) / 3
    const drawn = COLS.map((col, i) => columnSvg(s, col, i * (cw + gap), 0, cw))
    height = Math.max(...drawn.map(d => d.height))
    // Even the columns' panels out to the tallest.
    drawn.forEach(d => parts.push(d.body.replace(/^<rect class="p" x="([\d.]+)" y="0" width="([\d.]+)" height="[\d.]+"/, `<rect class="p" x="$1" y="0" width="$2" height="${height}"`)))
  } else {
    let y = 0
    for (const col of STACKED) {
      const d = columnSvg(s, col, 0, y, W)
      parts.push(d.body)
      y += d.height + gap
    }
    height = y - gap
  }
  return { source: svg(W, Math.max(1, height), parts.join(''), CSS), height: Math.max(1, height) }
}
