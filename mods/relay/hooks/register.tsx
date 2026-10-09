import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput, TurnStepResult } from 'claude-code'

import type { RelayReq, RelaySnap } from '../types'
import { KZ, brailleGraph, fmtTokens, modelName, padEnd, pxOf, sparkline } from './lib/kz.ts'
import {
  BUCKET_LABELS, MAX_REQS, cacheSvg, cacheShare, clockOf, emptySnap, fmtMs, fmtTps, headerSvg, histogramSvg, latencyHeat, mixColor,
  mixSvg, recentSvg, reqOf, slowestSvg, statsOf, stopColor, stopLabel, throughputSvg, vbars,
} from './lab.ts'

const PANE = 'kz-relay'
const TITLE = 'KOZMOS · Relay'
const RECENT = 12
const snapAtom = atom({ plugin: 'relay', key: 'snap' } as const, null)

let live: RelaySnap = emptySnap()
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

async function nowOf($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
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

async function recordStep($: EngineInterface, e: TurnStepInput, r: TurnStepResult, at: number, first: number | undefined): Promise<void> {
  await seed($)
  const req: RelayReq = reqOf(at, await nowOf($), first, e, r, await whoOf($, e.agentId))
  live.reqs = [...live.reqs.filter(x => x.id !== req.id), req].slice(-MAX_REQS)
  live.total++
  if (r.stopReason === null) live.failed++
  await publish($)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

function summary(s: RelaySnap): string {
  if (!s.reqs.length) return 'Relay: no model requests timed yet.'
  const st = statsOf(s)
  const lines = [
    `Relay: ${s.total} requests · p50 ${fmtMs(st.p50)} · p95 ${fmtMs(st.p95)} · ${fmtTps(st.avgTps)} tok/s · cache ${Math.round(st.cache * 100)}%`,
    `  models: ${st.mix.map(m => `${m.model} ${m.n}`).join(', ')}`,
    '  slowest:',
    ...st.slowest.map((r, i) => `    ${i + 1}. ${fmtMs(r.ms).padStart(6)}  ${modelName(r.model)}${r.effort ? ` (${r.effort})` : ''} · ${r.who} · ${stopLabel(r.stop)}`),
  ]
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = emptySnap()
    isSeeded = true
    lastPublished = ''
    agentNames.clear()
    await $.command.register({ name: 'relay', description: 'KOZMOS: toggle the Relay API-latency sidebar (/relay stats prints the numbers)', argumentHint: '[stats]', immediate: true })
    await publish($).catch(() => undefined)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'relay' }, async ($, e) => {
    if (e.args.trim() === 'stats') {
      await seed($)
      return { text: summary(live) }
    }
    return { text: (await toggle($)) ? 'Relay open.' : 'Relay closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.description || e.subagentType)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const at = await nowOf($)
    let first: number | undefined
    const stream = next(e)
    for await (const chunk of stream) {
      if (first === undefined && (chunk.kind === 'text' || chunk.kind === 'thinking' || chunk.kind === 'tool')) first = await nowOf($)
      yield chunk
    }
    const r = await stream.result
    await recordStep($, e, r, at, first).catch(() => undefined)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? emptySnap()
    const st = statsOf(snap)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const cards: [string, { source: string; height: number }, string][] = [
        ['head', headerSvg(snap, st, W), `Relay: ${snap.total} requests, p50 ${fmtMs(st.p50)}, p95 ${fmtMs(st.p95)}, ${fmtTps(st.avgTps)} tokens per second`],
        ['hist', histogramSvg(st, W), `Latency histogram: ${st.hist.map((n, i) => `${BUCKET_LABELS[i]}s ${n}`).join(', ')}`],
        ['tps', throughputSvg(snap.reqs, W), `Tokens per second over the last requests, average ${fmtTps(st.avgTps)}`],
        ['mix', mixSvg(st, W), `Model mix: ${st.mix.map(m => `${m.model} ${m.n}`).join(', ') || 'none'}`],
        ['cache', cacheSvg(snap.reqs, W), `Cache-read share per request, overall ${Math.round(st.cache * 100)}%`],
        ['slow', slowestSvg(st, W), `Slowest requests: ${st.slowest.map(r => fmtMs(r.ms)).join(', ') || 'none'}`],
        ['recent', recentSvg(snap.reqs, st, W, RECENT), `The last ${Math.min(RECENT, snap.reqs.length)} requests`],
      ]
      return (
        <Box flexDirection="column" gap={1}>
          {cards.map(([key, c, alt]) => <Svg key={key} source={c.source} alt={alt} width={W} height={c.height} />)}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    const cell = Math.max(2, Math.min(6, Math.floor((cols - 2) / st.hist.length)))
    const bars = vbars(st.hist, 4)
    const answered = snap.reqs.filter(r => r.tps !== undefined)
    const graphW = Math.max(10, cols - 2)
    const graph = brailleGraph(answered.map(r => r.tps ?? 0), graphW, 3)
    const tpsTop = Math.max(0, ...answered.map(r => r.tps ?? 0))
    const mixW = Math.max(10, cols - 2)
    const section = (key: string, label: string, right = '') => (
      <Box key={key} flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text bold dimColor>{label}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    )
    if (!snap.reqs.length) {
      return (
        <Box flexDirection="column">
          <Text bold color={KZ.violet}>⇄ RELAY</Text>
          <Text dimColor>No model requests timed yet. Each request of the main loop and of subagents lands here with its latency and throughput.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.violet}>⇄ RELAY</Text>
          <Text dimColor>{snap.total} requests</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text dimColor>p50 </Text><Text color={st.p50 === undefined ? KZ.mist : latencyHeat(st.p50)} bold>{fmtMs(st.p50)}</Text>
          <Text dimColor> · p95 </Text><Text color={st.p95 === undefined ? KZ.mist : latencyHeat(st.p95)} bold>{fmtMs(st.p95)}</Text>
          <Text dimColor> · </Text><Text color={KZ.cyan}>{fmtTps(st.avgTps)} t/s</Text>
          <Text dimColor> · ttft </Text><Text color={KZ.violet}>{fmtMs(st.avgTtft)}</Text>
        </Text>
        <Text wrap="truncate-end" dimColor>
          cache {Math.round(st.cache * 100)}% · {fmtTokens(st.tokensIn)} in · {fmtTokens(st.tokensOut)} out{snap.failed ? ` · ${snap.failed} without response` : ''}
        </Text>

        {section('s-lat', 'LATENCY', 'seconds')}
        {bars.map((line, r) => (
          <Text key={`hb${r}`}>
            {[...line].map((ch, i) => (
              <Text key={`hb${r}-${i}`} color={latencyHeat(i === 0 ? 500 : 1000 * 2 ** (i - 1) * 1.5)}>{ch.repeat(Math.max(1, cell - 1))} </Text>
            ))}
          </Text>
        ))}
        <Text dimColor>{BUCKET_LABELS.map(l => padEnd(l, cell)).join('')}</Text>

        {section('s-tps', 'TOKENS / SEC', answered.length ? `max ${fmtTps(tpsTop)}` : '')}
        {answered.length
          ? graph.map((line, i) => <Text key={`tp${i}`} color={KZ.cyan}>{line}</Text>)
          : <Text dimColor>no streamed output yet</Text>}

        {section('s-mix', 'MODEL MIX', `${st.mix.length}`)}
        <Text>
          {st.mix.map(m => <Text key={`mx-${m.model}`} color={m.color}>{'█'.repeat(Math.max(1, Math.round((m.n / Math.max(1, st.n)) * mixW)))}</Text>)}
        </Text>
        {st.mix.map(m => (
          <Text key={`ml-${m.model}`} wrap="truncate-end">
            <Text color={m.color}>● </Text>
            <Text>{m.model}</Text>
            <Text dimColor> {m.n} · {Math.round((m.n / Math.max(1, st.n)) * 100)}%</Text>
          </Text>
        ))}

        {section('s-cache', 'CACHE READ / REQUEST', `${Math.round(st.cache * 100)}%`)}
        <Text color={KZ.teal}>{sparkline(snap.reqs.filter(r => r.stop !== null).map(cacheShare), Math.max(8, cols - 2), 1)}</Text>

        {section('s-slow', 'SLOWEST 5')}
        {st.slowest.map((r, i) => (
          <Text key={`sl-${r.id}`} wrap="truncate-end">
            <Text dimColor>{i + 1} </Text>
            <Text color={latencyHeat(r.ms)} bold>{fmtMs(r.ms).padStart(6)} </Text>
            <Text color={mixColor(st, r.model)}>{modelName(r.model)}</Text>
            <Text dimColor>{r.effort ? ` · ${r.effort}` : ''} · {fmtTokens(r.output)} out · {r.who}</Text>
          </Text>
        ))}

        {section('s-recent', 'RECENT')}
        {snap.reqs.slice(-RECENT).reverse().map(r => (
          <Box key={`rc-${r.id}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={stopColor(r.stop)}>● </Text>
              <Text dimColor>{clockOf(r.at)} </Text>
              <Text color={mixColor(st, r.model)}>{modelName(r.model)}</Text>
              <Text dimColor>{r.effort ? ` ${r.effort}` : ''} </Text>
              <Text color={latencyHeat(r.ms)} bold>{fmtMs(r.ms)}</Text>
              {r.tps !== undefined ? <Text color={KZ.cyan}> {fmtTps(r.tps)}t/s</Text> : ''}
            </Text>
            <Text dimColor wrap="truncate-end">
              {'  '}in {fmtTokens(r.input)} · cache {fmtTokens(r.cacheRead)}/{fmtTokens(r.cacheWrite)} · out {fmtTokens(r.output)} · {stopLabel(r.stop)} · {r.who}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
