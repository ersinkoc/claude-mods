import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fault, FaultKind, FaultlineSnap, FaultlineView } from '../types'
import { KZ, hash, pxOf, toolDetail } from './lib/kz.ts'
import {
  BUCKET_MS, DENIED, WINDOW_MS, addFault, agentsOf, altOf, buckets, clockOf, copyText, ember, emptySnap, faultSvg, headerSvg,
  kindColor, kindLabel, recentCount, textLines,
} from './lens.ts'

const PANE = 'kz-faultline'
const TITLE = 'KOZMOS · Faultline'
const SHOWN = 50
const snapAtom = atom({ plugin: 'faultline', key: 'snap' } as const, null)
const viewAtom = atom({ plugin: 'faultline', key: 'view' } as const, { expanded: [] })

let live: FaultlineSnap = emptySnap()
let isSeeded = false
let lastPublished = ''
const agentNames = new Map<string, string>()

async function seed($: EngineInterface): Promise<void> {
  if (isSeeded) return
  isSeeded = true
  try {
    const kept = await read($, snapAtom)
    if (kept) live = structuredClone(kept)
  } catch {
    // Nothing kept: start empty.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify(live)
  if (key === lastPublished) return
  lastPublished = key
  const next = structuredClone(live)
  await update($, snapAtom, () => next)
}

async function whoOf($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'main'
  const known = agentNames.get(agentId)
  if (known) return known
  try {
    for (const a of await $.agent.list()) agentNames.set(a.id, a.description || a.type)
  } catch {
    // The roster is not readable now; fall back to the id.
  }
  return agentNames.get(agentId) ?? `agent ${agentId.slice(0, 6)}`
}

async function record($: EngineInterface, tool: string, kind: FaultKind, text: string, agentId: string | undefined, detail?: string): Promise<void> {
  await seed($)
  addFault(live, { tool, kind, text, at: await $.clock.now(), who: await whoOf($, agentId), detail: detail || undefined })
  await publish($)
}

/** Moves the severity strip on while it has something to show. */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const at = Math.floor(now / BUCKET_MS) * BUCKET_MS
  if (live.hits.length > 0) {
    live.now = at
    live.hits = live.hits.filter(t => t > now - WINDOW_MS)
    await publish($)
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

function summary(s: FaultlineSnap): string {
  if (!s.total) return 'Faultline: no failures this session.'
  const lines = [`Faultline: ${s.total} failures in ${s.faults.length} signatures, ${recentCount(s)} in the last 10 minutes.`]
  for (const f of s.faults.slice(0, 8)) lines.push(`  ${String(f.count).padStart(3)}×  ${kindLabel(f)}  ${f.head}`)
  return lines.join('\n')
}

const keyOf = (f: Fault): string => hash(f.sig).toString(36)

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = emptySnap(await $.clock.now())
    isSeeded = true
    lastPublished = ''
    agentNames.clear()
    await $.command.register({ name: 'faultline', description: 'KOZMOS: toggle the Faultline error-lens sidebar (/faultline list prints the top signatures)', argumentHint: '[list]', immediate: true })
    await publish($).catch(() => undefined)
    $.clock.every(15_000, () => void tick($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'faultline' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await seed($)
      return { text: summary(live) }
    }
    return { text: (await toggle($)) ? 'Faultline open.' : 'Faultline closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.description || e.subagentType)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) {
      const tool = String(e.tool)
      const text = ran.deny ?? ran.text ?? (typeof ran.result === 'string' ? ran.result : 'failed')
      const kind: FaultKind = ran.deny !== undefined || DENIED.test(text) ? 'denied' : 'error'
      await record($, tool, kind, text, e.agentId, toolDetail(tool, e)).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'refusal') {
      const r = e.refusal
      const text = `Refusal${r.category ? `: ${r.category}` : ''}${r.explanation ? `\n${r.explanation}` : ''}`
      await record($, 'turn', 'turn', text, e.agentId, `turn ${e.turnId.slice(0, 8)}`).catch(() => undefined)
    } else if (e.reason === 'error') {
      await record($, 'turn', 'turn', 'Turn ended on an API error (retries exhausted or the context limit)', e.agentId, `turn ${e.turnId.slice(0, 8)}`).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    const text = `API error: ${e.error}${e.error_details ? `\n${e.error_details}` : ''}`
    await record($, 'api', 'api', text, e.agent_id, e.last_assistant_message ? `after: ${e.last_assistant_message.slice(0, 60)}` : undefined).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? emptySnap()
    const view: FaultlineView = await read($, viewAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const maxCount = Math.max(1, ...snap.faults.map(f => f.count))
    const recent = recentCount(snap)
    const toggleOpen = (sig: string) => update($, viewAtom, v => ({
      expanded: v.expanded.includes(sig) ? v.expanded.filter(s => s !== sig) : [...v.expanded, sig].slice(-50),
    }))
    const actions = (f: Fault, isOpen: boolean) => (
      <Box key={`a-${keyOf(f)}`} flexDirection="row" gap={2} flexShrink={0}>
        <Button key={`x-${keyOf(f)}`} label={isOpen ? '▴ less' : '▾ more'} plain dimColor onPress={() => toggleOpen(f.sig)} />
        <Button key={`cp-${keyOf(f)}`} label="copy" plain dimColor onPress={p => void $.ui.copy({ text: copyText(f), surface: p.surface }).catch(() => undefined)} />
      </Box>
    )
    const empty = snap.faults.length === 0
      ? <Text key="empty" color={KZ.green}>✓ No failures yet. Failed or denied tool calls, refusals and API errors land here.</Text>
      : null
    const more = snap.faults.length > SHOWN ? <Text key="more" dimColor>… {snap.faults.length - SHOWN} older signatures not shown</Text> : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg, Code } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const head = headerSvg(snap, W)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={head.source} alt={`Faultline: ${snap.total} failures, ${recent} in the last 10 minutes`} width={W} height={head.height} />
          {snap.faults.slice(0, SHOWN).map(f => {
            const isOpen = view.expanded.includes(f.sig)
            const card = faultSvg(f, W, maxCount, isOpen)
            return (
              <Box key={`f-${keyOf(f)}`} flexDirection="column">
                <Svg key={`s-${keyOf(f)}`} source={card.source} alt={altOf(f)} width={W} height={card.height} />
                {isOpen ? <Code key={`c-${keyOf(f)}`} source={textLines(f, true).join('\n')} language="text" wrap="wrap" /> : null}
                {actions(f, isOpen)}
              </Box>
            )
          })}
          {empty}
          {more}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    const strip = buckets(snap.hits, snap.now)
    const top = Math.max(1, ...strip)
    const cell = Math.max(1, Math.floor((cols - 2) / strip.length))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={recent ? KZ.red : KZ.mist}>⚡ FAULTLINE</Text>
          <Text color={snap.total ? KZ.red : KZ.mist}>{snap.total} failures</Text>
        </Box>
        <Text wrap="truncate-end">
          {strip.map((n, i) => (
            <Text key={`st${i}`} color={ember(n / top)}>{(n ? '█' : '▁').repeat(cell)}</Text>
          ))}
        </Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>10 min ago</Text>
          <Text dimColor>now</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={recent ? KZ.red : KZ.green}>{recent} recent</Text>
          <Text dimColor> · {snap.faults.length} signatures · {agentsOf(snap)} agents</Text>
        </Text>
        {snap.faults.slice(0, SHOWN).map(f => {
          const isOpen = view.expanded.includes(f.sig)
          const c = kindColor(f.kind)
          return (
            <Box key={`f-${keyOf(f)}`} flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text backgroundColor={ember(0.25 + (f.count / maxCount) * 0.75)} color="#ffffff" bold> {f.count}× </Text>
                <Text color={c} bold> {kindLabel(f)} </Text>
                <Text>{f.head}</Text>
              </Text>
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor wrap="truncate-end">  {clockOf(f.first)} → {clockOf(f.last)} · {f.agents.map(a => (a === 'main' ? 'main' : `◈ ${a}`)).join(', ')}</Text>
                {actions(f, isOpen)}
              </Box>
              {f.detail ? <Text dimColor wrap="truncate-end">  on {f.detail}</Text> : null}
              {textLines(f, isOpen).map((l, i) => (
                <Text key={`l-${keyOf(f)}-${i}`} color={i === 0 ? KZ.red : undefined} dimColor={i > 0} wrap={isOpen ? 'wrap' : 'truncate-end'}>  │ {l}</Text>
              ))}
            </Box>
          )
        })}
        {empty}
        {more}
      </Box>
    )
  })
}
