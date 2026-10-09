import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { BridgeSnap } from '../types'
import {
  KZ, bar, clamp01, fitText, fmtClock, fmtPct, fmtSpan, fmtTokens, fmtUsd, heat, limitLabel, modelName,
  pxOf, sparkline, svg, svgBar, svgText, toolColor, toolDetail, toolGlyph, toolName, untilReset,
} from './lib/kz.ts'
import {
  GIT_HEAD, GIT_STATUS, MAC_MEMSIZE, MAC_TOP, NO_GIT, NVIDIA_SMI, WIN_SYS, fmtBytes, parseGitStatus, parseMacTop,
  parseMeminfo, parseNvidia, parseProcStat, parseWinSys, platformFrom,
} from './lib/probe.ts'
import type { CpuTicks, GitSnap, Platform, SysSnap } from './lib/probe.ts'

const PANE = 'kz-bridge'
const TITLE = 'KOZMOS · Bridge'
const snapAtom = atom({ plugin: 'bridge', key: 'snap' } as const, null)

const blank = (now: number): BridgeSnap => ({
  model: '',
  isWorking: false,
  ctxWindow: 1_000_000,
  limits: [],
  startedAt: now,
  branch: '',
  isRepo: false,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  cpuHistory: [],
  agentsRunning: 0,
  agentsDone: 0,
  agentsFailed: 0,
  toolCount: 0,
  now,
})

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

// ---------------------------------------------------------------------------
// Probes: $ may only flow into functions of this file, so the shell calls
// live here and lib/probe.ts parses what they print.

let platform: Platform | undefined
let cpuTicks: CpuTicks | undefined
let hasGpu: boolean | undefined

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number, cwd?: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, cwd ? { timeoutMs, cwd } : { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

async function readGit($: EngineInterface, cwd: string): Promise<GitSnap> {
  const status = await sh($, GIT_STATUS, 5000, cwd)
  if (status === undefined) return NO_GIT
  return parseGitStatus(status, (await sh($, GIT_HEAD, 3000, cwd)) ?? '')
}

async function readSys($: EngineInterface): Promise<SysSnap> {
  platform ??= platformFrom(await $.env.get('OS'), (await $.env.get('OS')) ? '' : await sh($, ['uname', '-s'], 2000))
  let snap: SysSnap = {}
  if (platform === 'win') snap = parseWinSys((await sh($, WIN_SYS, 8000)) ?? '')
  else if (platform === 'mac') snap = parseMacTop((await sh($, MAC_TOP, 6000)) ?? '', (await sh($, MAC_MEMSIZE, 2000)) ?? '')
  else {
    try {
      const { cpu, ticks } = parseProcStat(await $.fs.read('/proc/stat'), cpuTicks)
      cpuTicks = ticks
      snap = { cpu, ...parseMeminfo(await $.fs.read('/proc/meminfo')) }
    } catch {
      snap = {}
    }
  }
  if (hasGpu !== false) {
    const out = await sh($, NVIDIA_SMI, 4000)
    hasGpu = out !== undefined
    snap.gpu = out === undefined ? undefined : parseNvidia(out)
  }
  return snap
}

// Live collector; the pane draws from the published snapshot in $.state.
// Module state starts over on a reload, and session.start fills it again.
let live: BridgeSnap = blank(0)
let tick = 0
let lastPublished = ''

async function publish($: EngineInterface): Promise<void> {
  live.now = await $.clock.now()
  // Publish only what changed, so an idle pane does not redraw for nothing
  // (the clock only matters while something runs).
  const key = JSON.stringify({ ...live, now: live.tool || live.isWorking ? live.now : 0 })
  if (key === lastPublished) return
  lastPublished = key
  await update($, snapAtom, () => ({ ...live, cpuHistory: [...live.cpuHistory] }))
}

async function sample($: EngineInterface): Promise<void> {
  tick++
  try {
    const usage = await $.session.usage()
    live.ctxTokens = usage.context.tokens
    live.ctxWindow = usage.context.window
    live.ctxPercent = usage.context.percent
    live.limits = usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    live.costUsd = usage.cost?.usd
    live.startedAt = usage.startedAt
    live.model = await $.session.model()
    const agents = await $.agent.list()
    live.agentsRunning = agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    live.agentsDone = agents.filter(a => a.status === 'completed' || a.status === 'idle').length
    live.agentsFailed = agents.filter(a => a.status === 'failed' || a.status === 'killed').length
  } catch {
    // A figure the engine cannot give now is left as it was.
  }
  // Git every 5 s, the machine every 4 s: both shell out.
  if (tick % 5 === 1) {
    const g = await readGit($, await $.session.cwd())
    Object.assign(live, {
      isRepo: g.isRepo, branch: g.branch, ahead: g.ahead, behind: g.behind,
      staged: g.staged, unstaged: g.unstaged, untracked: g.untracked, conflicts: g.conflicts,
    })
  }
  if (tick % 4 === 1) {
    const s = await readSys($)
    live.cpu = s.cpu
    if (s.cpu !== undefined) live.cpuHistory = [...live.cpuHistory, s.cpu].slice(-40)
    live.memUsed = s.memUsed
    live.memTotal = s.memTotal
    live.gpuUtil = s.gpu?.util
    live.gpuName = s.gpu?.name
  }
  await publish($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank(await $.clock.now())
    tick = 0
    lastPublished = ''
    await $.command.register({ name: 'bridge', description: 'KOZMOS: toggle the Bridge mission-control sidebar', immediate: true })
    await sample($).catch(() => undefined)
    $.clock.every(1000, () => void sample($).catch(() => undefined))
    if (options.autoOpen !== false) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'bridge' }, async $ => ({
    text: (await toggle($)) ? 'Bridge open.' : 'Bridge closed.',
  }))

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    void publish($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      live.effort = e.effort === undefined ? live.effort : String(e.effort)
      live.model = e.model
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      live.isWorking = false
      live.tool = undefined
      void publish($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const name = String(e.tool)
    const detail = toolDetail(name, e)
    if (e.agentId === undefined) live.tool = { name, detail, startedAt: at }
    live.toolCount++
    void publish($)
    const ran = await next(e)
    const ms = (await $.clock.now()) - at
    if (e.agentId === undefined) {
      live.lastTool = { name, detail, ms, isError: ran.isError === true || ran.deny !== undefined }
      if (live.tool?.startedAt === at) live.tool = undefined
    }
    void publish($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const { source, height } = desktopCard(snap, W)
      return (
        <Box flexDirection="column">
          <Svg source={source} alt={altText(snap)} width={W} height={height} />
        </Box>
      )
    }

    const cols = Math.max(28, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(24, cols - 22))
    const row = (key: string, label: string, body: RenderChildren) => (
      <Box key={key} flexDirection="row">
        <Box width={5} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text wrap="truncate-end">{body}</Text>
      </Box>
    )
    const ctxRatio = (snap.ctxPercent ?? 0) / 100
    const elapsed = snap.now - snap.startedAt
    const perHour = snap.costUsd !== undefined && elapsed > 60_000 ? snap.costUsd / (elapsed / 3600_000) : undefined
    const gitBits = snap.isRepo
      ? [
          snap.ahead ? `↑${snap.ahead}` : '',
          snap.behind ? `↓${snap.behind}` : '',
          snap.staged ? `●${snap.staged}` : '',
          snap.unstaged ? `✚${snap.unstaged}` : '',
          snap.untracked ? `?${snap.untracked}` : '',
          snap.conflicts ? `✖${snap.conflicts}` : '',
        ].filter(Boolean).join(' ') || '✓ clean'
      : ''

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.violet}>◆ {modelName(snap.model)}{snap.effort ? <Text color={KZ.mist}> · {snap.effort}</Text> : ''}</Text>
          <Text color={snap.isWorking ? KZ.green : KZ.mist}>{snap.isWorking ? '● working' : '○ idle'}</Text>
        </Box>
        {row('ctx', 'CTX', [
          <Text key="b" color={heat(ctxRatio * 1.15)}>{bar(ctxRatio, barW)}</Text>,
          <Text key="t"> {fmtPct(snap.ctxPercent)} <Text dimColor>{fmtTokens(snap.ctxTokens ?? 0)}/{fmtTokens(snap.ctxWindow)}</Text></Text>,
        ])}
        {snap.limits.map(l => {
          const left = untilReset(l, snap.now)
          return row(`lim-${l.kind}`, limitLabel(l.kind).toUpperCase(), [
            <Text key="b" color={heat(l.percentUsed / 100)}>{bar(l.percentUsed / 100, barW)}</Text>,
            <Text key="t"> {fmtPct(l.percentUsed)}{left !== undefined ? <Text dimColor> ↻{fmtSpan(left)}</Text> : ''}</Text>,
          ])
        })}
        {row('cost', 'COST', [
          <Text key="c" color={KZ.yellow}>{snap.costUsd !== undefined ? fmtUsd(snap.costUsd) : '—'}</Text>,
          <Text key="d" dimColor> · {fmtClock(elapsed)}{perHour !== undefined ? ` · ${fmtUsd(perHour)}/h` : ''}</Text>,
        ])}
        {snap.isRepo && row('git', 'GIT', [
          <Text key="b" color={KZ.cyan}> {snap.branch}</Text>,
          <Text key="s" color={snap.conflicts ? KZ.red : snap.staged + snap.unstaged + snap.untracked ? KZ.amber : KZ.green}> {gitBits}</Text>,
        ])}
        {row('cpu', 'CPU', [
          <Text key="s" color={heat((snap.cpu ?? 0) / 100)}>{sparkline(snap.cpuHistory, Math.max(4, barW - 6), 100)}</Text>,
          <Text key="p"> {fmtPct(snap.cpu)}</Text>,
        ])}
        {snap.memTotal !== undefined && row('ram', 'RAM', [
          <Text key="b" color={heat((snap.memUsed ?? 0) / snap.memTotal)}>{bar((snap.memUsed ?? 0) / snap.memTotal, barW)}</Text>,
          <Text key="t" dimColor> {fmtBytes(snap.memUsed)}/{fmtBytes(snap.memTotal)}</Text>,
        ])}
        {snap.gpuUtil !== undefined && row('gpu', 'GPU', [
          <Text key="b" color={heat(snap.gpuUtil / 100)}>{bar(snap.gpuUtil / 100, barW)}</Text>,
          <Text key="t"> {fmtPct(snap.gpuUtil)}</Text>,
        ])}
        {row('agt', 'AGT', [
          <Text key="r" color={snap.agentsRunning ? KZ.violet : KZ.mist}>◈ {snap.agentsRunning} running</Text>,
          <Text key="d" dimColor> · {snap.agentsDone} done{snap.agentsFailed ? ` · ${snap.agentsFailed} failed` : ''}</Text>,
        ])}
        {row('tool', 'TOOL', snap.tool
          ? [
              <Text key="g" color={toolColor(snap.tool.name)}>{toolGlyph(snap.tool.name)} {toolName(snap.tool.name)}</Text>,
              <Text key="d" dimColor> {snap.tool.detail} · {fmtClock(snap.now - snap.tool.startedAt)}</Text>,
            ]
          : snap.lastTool
            ? [
                <Text key="g" color={snap.lastTool.isError ? KZ.red : KZ.mist}>{snap.lastTool.isError ? '✖' : '✓'} {toolName(snap.lastTool.name)}</Text>,
                <Text key="d" dimColor> {snap.lastTool.detail} · {snap.lastTool.ms}ms · #{snap.toolCount}</Text>,
              ]
            : <Text dimColor>—</Text>)}
      </Box>
    )
  })
}

function altText(s: BridgeSnap): string {
  const lim = s.limits.map(l => `${limitLabel(l.kind)} ${fmtPct(l.percentUsed)}`).join(', ')
  return `${modelName(s.model)}; context ${fmtPct(s.ctxPercent)}; ${lim}; cost ${s.costUsd !== undefined ? fmtUsd(s.costUsd) : 'unknown'}; branch ${s.branch || 'none'}; ${s.agentsRunning} agents running`
}

/** The whole sidebar as one SVG card stack. */
function desktopCard(s: BridgeSnap, W: number): { source: string; height: number } {
  const parts: string[] = []
  let y = 0
  const pad = 12
  const inner = W - pad * 2

  // Header: model, effort, working orb.
  parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="54" rx="12"/>`)
  parts.push(`<circle cx="${pad + 8}" cy="${y + 27}" r="7" fill="${s.isWorking ? KZ.green : KZ.mist}" class="${s.isWorking ? 'pulse' : ''}"/>`)
  parts.push(svgText(pad + 24, y + 24, fitText(modelName(s.model), 15, inner - 120), { size: 15, weight: 650 }))
  parts.push(svgText(pad + 24, y + 42, s.effort ? `effort · ${s.effort}` : 'effort · —', { cls: 's', size: 11.5 }))
  parts.push(svgText(W - pad, y + 24, s.isWorking ? 'WORKING' : 'IDLE', { size: 10.5, weight: 700, anchor: 'end', fill: s.isWorking ? KZ.green : KZ.mist }))
  parts.push(svgText(W - pad, y + 42, s.tool ? `${toolName(s.tool.name)} · ${fmtClock(s.now - s.tool.startedAt)}` : `${s.toolCount} tool calls`, { cls: 'm', size: 11, anchor: 'end' }))
  y += 62

  // Gauges: context and every rate-limit window.
  const gauge = (label: string, ratio: number, right: string, sub: string) => {
    parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="48" rx="12"/>`)
    parts.push(svgText(pad, y + 18, label, { cls: 's', size: 11, weight: 600 }))
    parts.push(svgText(W - pad, y + 18, right, { size: 12.5, weight: 650, anchor: 'end' }))
    parts.push(svgBar(pad, y + 27, inner, 8, ratio, heat(ratio * 1.1)))
    if (sub) parts.push(svgText(pad, y + 45, sub, { cls: 'm', size: 9.5 }))
    y += 56
  }
  gauge('CONTEXT', clamp01((s.ctxPercent ?? 0) / 100), fmtPct(s.ctxPercent), `${fmtTokens(s.ctxTokens ?? 0)} of ${fmtTokens(s.ctxWindow)}`)
  for (const l of s.limits) {
    const left = untilReset(l, s.now)
    gauge(`${limitLabel(l.kind).toUpperCase()} LIMIT`, clamp01(l.percentUsed / 100), fmtPct(l.percentUsed), left !== undefined ? `resets in ${fmtSpan(left)}` : '')
  }

  // Tiles: cost, time, agents.
  const elapsed = s.now - s.startedAt
  const perHour = s.costUsd !== undefined && elapsed > 60_000 ? s.costUsd / (elapsed / 3600_000) : undefined
  const tiles: [string, string, string, string][] = [
    ['COST', s.costUsd !== undefined ? fmtUsd(s.costUsd) : '—', perHour !== undefined ? `${fmtUsd(perHour)}/h` : '', KZ.yellow],
    ['TIME', fmtClock(elapsed), '', KZ.cyan],
    ['AGENTS', String(s.agentsRunning), `${s.agentsDone} done`, KZ.violet],
  ]
  const tw = (W - 12) / 3
  tiles.forEach(([k, v, sub, c], i) => {
    const x = i * (tw + 6)
    parts.push(`<rect class="p" x="${x}" y="${y}" width="${tw}" height="58" rx="12"/>`)
    parts.push(`<rect x="${x + 10}" y="${y + 10}" width="3" height="38" rx="1.5" fill="${c}"/>`)
    parts.push(svgText(x + 20, y + 22, k, { cls: 's', size: 10, weight: 600 }))
    parts.push(svgText(x + 20, y + 40, v, { size: 15, weight: 700 }))
    if (sub) parts.push(svgText(x + 20, y + 52, sub, { cls: 'm', size: 9.5 }))
  })
  y += 66

  // Git.
  if (s.isRepo) {
    parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="46" rx="12"/>`)
    parts.push(`<path d="M${pad + 4} ${y + 14}v18M${pad + 4} ${y + 23}c8 0 10-6 10-9" stroke="${KZ.cyan}" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="${pad + 14}" cy="${y + 13}" r="3" fill="${KZ.cyan}"/>`)
    parts.push(svgText(pad + 26, y + 20, fitText(s.branch, 13, inner - 140), { size: 13, weight: 650 }))
    const ab = `${s.ahead ? `↑${s.ahead} ` : ''}${s.behind ? `↓${s.behind}` : ''}`.trim()
    parts.push(svgText(pad + 26, y + 37, ab || 'in sync', { cls: 'm', size: 10.5 }))
    const chips: [string, number, string][] = [['staged', s.staged, KZ.green], ['changed', s.unstaged, KZ.amber], ['new', s.untracked, KZ.blue], ['conflict', s.conflicts, KZ.red]]
    let cx = W - pad
    for (const [label, n, c] of chips.reverse()) {
      if (!n) continue
      const txt = `${n} ${label}`
      const cw = txt.length * 6.2 + 14
      cx -= cw
      parts.push(`<rect x="${cx}" y="${y + 14}" width="${cw}" height="18" rx="9" fill="${c}" opacity=".18"/>`)
      parts.push(svgText(cx + cw / 2, y + 27, txt, { size: 10, weight: 600, anchor: 'middle', fill: c }))
      cx -= 6
    }
    if (s.staged + s.unstaged + s.untracked + s.conflicts === 0) parts.push(svgText(W - pad, y + 27, '✓ clean', { size: 11, weight: 600, anchor: 'end', fill: KZ.green }))
    y += 54
  }

  // Machine: CPU sparkline area, RAM and GPU bars.
  parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${s.gpuUtil !== undefined ? 96 : 78}" rx="12"/>`)
  parts.push(svgText(pad, y + 18, 'CPU', { cls: 's', size: 10.5, weight: 600 }))
  parts.push(svgText(W - pad, y + 18, fmtPct(s.cpu), { size: 12, weight: 650, anchor: 'end' }))
  const hist = s.cpuHistory.length ? s.cpuHistory : [0]
  const gw = inner
  const gh = 22
  const step = gw / Math.max(1, hist.length - 1)
  const pts = hist.map((v, i) => `${(pad + i * step).toFixed(1)},${(y + 24 + gh - (v / 100) * gh).toFixed(1)}`)
  parts.push(`<defs><linearGradient id="cpuG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}" stop-opacity=".55"/><stop offset="1" stop-color="${KZ.violet}" stop-opacity="0"/></linearGradient></defs>`)
  if (hist.length > 1) {
    parts.push(`<path d="M${pts.join('L')}L${pad + gw},${y + 24 + gh}L${pad},${y + 24 + gh}Z" fill="url(#cpuG)"/>`)
    parts.push(`<path d="M${pts.join('L')}" stroke="${KZ.violet}" stroke-width="1.6" fill="none"/>`)
  }
  let my = y + 58
  if (s.memTotal !== undefined) {
    const r = (s.memUsed ?? 0) / s.memTotal
    parts.push(svgText(pad, my + 4, 'RAM', { cls: 's', size: 10.5, weight: 600 }))
    parts.push(svgBar(pad + 36, my - 3, inner - 120, 7, r, heat(r)))
    parts.push(svgText(W - pad, my + 4, `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}`, { cls: 'm', size: 10, anchor: 'end' }))
    my += 18
  }
  if (s.gpuUtil !== undefined) {
    const r = s.gpuUtil / 100
    parts.push(svgText(pad, my + 4, 'GPU', { cls: 's', size: 10.5, weight: 600 }))
    parts.push(svgBar(pad + 36, my - 3, inner - 120, 7, r, heat(r)))
    parts.push(svgText(W - pad, my + 4, `${fmtPct(s.gpuUtil)}`, { cls: 'm', size: 10, anchor: 'end' }))
  }
  y += (s.gpuUtil !== undefined ? 96 : 78) + 8

  // The tool running now, or the last one.
  const t = s.tool ?? s.lastTool
  if (t) {
    // Only the last tool carries its duration.
    const isRunning = !('ms' in t)
    const c = 'ms' in t ? (t.isError ? KZ.red : KZ.mist) : toolColor(t.name)
    parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="40" rx="12"/>`)
    parts.push(`<rect x="0" y="${y}" width="4" height="40" rx="2" fill="${c}" class="${isRunning ? 'pulse' : ''}"/>`)
    parts.push(svgText(pad + 4, y + 17, `${isRunning ? 'RUNNING' : 'LAST'} · ${toolName(t.name)}`, { size: 10.5, weight: 700, fill: c }))
    parts.push(svgText(pad + 4, y + 32, fitText(t.detail || '—', 11, inner - 70), { cls: 's', size: 11, mono: true }))
    parts.push(svgText(W - pad, y + 24, 'ms' in t ? `${t.ms}ms` : fmtClock(s.now - t.startedAt), { cls: 'm', size: 11, anchor: 'end' }))
    y += 48
  }

  return { source: svg(W, y, parts.join('')), height: y }
}
