import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShellRun, TerminusFilter, TerminusSnap, TerminusView } from '../types'
import { KZ, clip, fmtTokens, pxOf, sparkline } from './lib/kz.ts'
import {
  MAX_COMMAND, MAX_RUNS, SLOW_MS, altOf, clockOf, cwdOf, durHeat, emptySnap, fmtMs, fmtSize, headerSvg, isFailed, isSlow,
  matches, outcomeOf, runSvg, statusColor, statusGlyph, statusLine,
} from './shell.ts'

const PANE = 'kz-terminus'
const TITLE = 'KOZMOS · Terminus'
const SHOWN = 60
const snapAtom = atom({ plugin: 'terminus', key: 'snap' } as const, null)
const viewAtom = atom({ plugin: 'terminus', key: 'view' } as const, { filter: 'all' })

const FILTERS: readonly { id: TerminusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'slow', label: 'Slow >10s' },
]

// ---------------------------------------------------------------------------
// The collector: module state, published to $.state only when it changed.

let live: TerminusSnap = emptySnap()
let isSeeded = false
let lastPublished = ''
let seq = 0
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

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

function summary(s: TerminusSnap): string {
  const lines = [`Terminus: ${s.total} shell commands, ${s.failures} failed, ${fmtMs(s.totalMs)} in the shell.`]
  for (const r of s.runs.slice(0, 5)) lines.push(`  ${statusGlyph(r.status)} ${fmtMs(r.ms).padStart(6)}  ${clip(r.command, 70)}`)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = emptySnap()
    isSeeded = true
    lastPublished = ''
    agentNames.clear()
    await $.command.register({ name: 'terminus', description: 'KOZMOS: toggle the Terminus shell-history sidebar (/terminus list prints the last runs)', argumentHint: '[list]', immediate: true })
    await publish($).catch(() => undefined)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'terminus' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await seed($)
      return { text: summary(live) }
    }
    return { text: (await toggle($)) ? 'Terminus open.' : 'Terminus closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.description || e.subagentType)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    await seed($)
    const input = e as unknown as Record<string, unknown>
    const command = typeof input.command === 'string' ? input.command : ''
    const description = typeof input.description === 'string' && input.description.trim() ? clip(input.description, 140) : undefined
    const run: ShellRun = {
      id: e.tool_use_id || `r${++seq}`,
      tool: e.tool,
      command: command.length > MAX_COMMAND ? command.slice(0, MAX_COMMAND) + '…' : command,
      description,
      cwd: cwdOf(command, input),
      at: await $.clock.now(),
      status: 'running',
      who: await whoOf($, e.agentId),
    }
    live.runs = [run, ...live.runs.filter(r => r.id !== run.id)].slice(0, MAX_RUNS)
    live.total++
    void publish($).catch(() => undefined)

    const ran = await next(e)
    const out = outcomeOf(ran)
    const ms = Math.max(0, (await $.clock.now()) - run.at)
    const done: ShellRun = { ...run, ms, status: out.status, exit: out.exit, error: out.error, outBytes: out.outBytes }
    live.runs = live.runs.map(r => (r.id === run.id ? done : r))
    if (isFailed(done)) live.failures++
    if (isSlow(done)) live.slow++
    live.totalMs += ms
    await publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? emptySnap()
    const view: TerminusView = await read($, viewAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const shown = snap.runs.filter(r => matches(r, view.filter))
    const counts: Record<TerminusFilter, number> = {
      all: snap.runs.length,
      failed: snap.runs.filter(isFailed).length,
      slow: snap.runs.filter(isSlow).length,
    }
    const filterRow = (
      <Box key="filters" flexDirection="row" flexWrap="wrap" gap={1}>
        {FILTERS.map(f => (
          <Button
            key={`f-${f.id}`}
            label={`${view.filter === f.id ? '●' : '○'} ${f.label} ${counts[f.id]}`}
            plain
            dimColor={view.filter !== f.id}
            onPress={() => update($, viewAtom, () => ({ filter: f.id }))}
          />
        ))}
      </Box>
    )
    const buttons = (r: ShellRun) => (
      <Box key={`b-${r.id}`} flexDirection="row" gap={2} flexShrink={0}>
        <Button key={`cp-${r.id}`} label="copy" plain dimColor onPress={p => void $.ui.copy({ text: r.command, surface: p.surface }).catch(() => undefined)} />
        <Button key={`rp-${r.id}`} label="↩ prompt" plain dimColor onPress={() => void $.prompt.fill({ text: `Run again: ${r.command}` }).catch(() => undefined)} />
      </Box>
    )
    const more = shown.length > SHOWN ? <Text key="more" dimColor>… {shown.length - SHOWN} older runs not shown</Text> : null
    const empty = shown.length === 0
      ? <Text key="empty" dimColor>{snap.total === 0 ? 'No shell commands yet. Bash and PowerShell runs land here.' : 'Nothing matches this filter.'}</Text>
      : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const head = headerSvg(snap, W)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={head.source} alt={`Terminus: ${snap.total} commands, ${snap.failures} failed, ${fmtMs(snap.totalMs)} of shell time`} width={W} height={head.height} />
          {filterRow}
          {shown.slice(0, SHOWN).map(r => {
            const card = runSvg(r, W)
            return (
              <Box key={`row-${r.id}`} flexDirection="column">
                <Svg key={`svg-${r.id}`} source={card.source} alt={altOf(r)} width={W} height={card.height} />
                {buttons(r)}
              </Box>
            )
          })}
          {empty}
          {more}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    const last = snap.runs.slice(0, Math.max(8, cols - 6)).reverse()
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.green}>$_ TERMINUS</Text>
          <Text color={snap.runs.some(r => r.status === 'running') ? KZ.violet : KZ.mist}>{snap.total} cmds</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={snap.failures ? KZ.red : KZ.mist}>✖ {snap.failures} failed</Text>
          <Text dimColor> · </Text>
          <Text color={KZ.cyan}>⏱ {fmtMs(snap.totalMs)} shell</Text>
          <Text dimColor> · </Text>
          <Text color={snap.slow ? KZ.amber : KZ.mist}>{snap.slow} slow</Text>
        </Text>
        {last.length > 0 && (
          <Text wrap="truncate-end">
            <Text dimColor>time </Text>
            {[...sparkline(last.map(r => Math.log10(1 + (r.ms ?? 0) / 100)), last.length)].map((ch, i) => {
              const r = last[i]
              return <Text key={`sp${i}`} color={r ? (isFailed(r) ? KZ.red : durHeat(r.ms)) : KZ.mist}>{ch}</Text>
            })}
          </Text>
        )}
        {filterRow}
        {shown.slice(0, SHOWN).map(r => {
          const c = statusColor(r.status)
          const sub = statusLine(r)
          return (
            <Box key={`row-${r.id}`} flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text color={c} bold>{statusGlyph(r.status)} </Text>
                <Text color={KZ.green}>$ </Text>
                <Text bold>{r.command.split('\n')[0] ?? ''}</Text>
              </Text>
              {r.description && <Text dimColor wrap="truncate-end">  {r.description}</Text>}
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text dimColor>  {clockOf(r.at)} </Text>
                  <Text color={durHeat(r.ms)}>{fmtMs(r.ms)}</Text>
                  <Text dimColor> · {fmtSize(r.outBytes)} · </Text>
                  <Text color={r.who === 'main' ? KZ.mist : KZ.violet}>{r.who === 'main' ? 'main' : `◈ ${r.who}`}</Text>
                  {r.cwd ? <Text dimColor> · ⌂ {r.cwd}</Text> : ''}
                </Text>
                {buttons(r)}
              </Box>
              {(r.status !== 'ok' || r.error) && sub ? <Text color={r.status === 'ok' ? KZ.mist : c} wrap="truncate-end">  └ {sub}</Text> : null}
            </Box>
          )
        })}
        {empty}
        {more}
        {snap.total > 0 && <Text dimColor wrap="truncate-end">slow = over {SLOW_MS / 1000}s · {fmtTokens(snap.runs.reduce((n, r) => n + (r.outBytes ?? 0), 0))} chars of output kept</Text>}
      </Box>
    )
  })
}
