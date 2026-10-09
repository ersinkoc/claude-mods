import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { VitalsSnap } from '../types'
import { KZ, bar, clamp01, fitText, fmtClock, fmtPct, heat, mix, pxOf, svg, svgBar, svgText } from './lib/kz.ts'
import { MAC_MEMSIZE, MAC_TOP, NVIDIA_SMI, WIN_SYS, fmtBytes, parseMacTop, parseMeminfo, parseNvidia, parseProcStat, parseWinSys, platformFrom } from './lib/probe.ts'
import type { CpuTicks, Platform, SysSnap } from './lib/probe.ts'
import { DF_ROOT, HISTORY, PS_PIDS, avg, brailleCanvas, chartPoints, countLines, parseDf, pushHist, ratioOf, smoothPaths, tempRatio } from './meter.ts'

const PANE = 'kz-vitals'
const TITLE = 'KOZMOS · Vitals'
const SAMPLE_MS = 2000
const snapAtom = atom({ plugin: 'vitals', key: 'snap' } as const, null)

const blank = (now: number): VitalsSnap => ({
  platform: 'linux', cpuHist: [], memHist: [], diskLabel: '/', gpuHist: [], samples: 0,
  sessionStart: now, toolCalls: 0, agentsRunning: 0, agentsDone: 0, now,
})

let live: VitalsSnap = blank(0)
let platform: Platform | undefined
let cpuTicks: CpuTicks | undefined
let hasGpu: boolean | undefined
let isBusy = false

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  await sample($).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------
// Probes.

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

/** The host's platform, probed once per module load. */
async function detectPlatform($: EngineInterface): Promise<Platform> {
  if (platform === undefined) {
    const os = await $.env.get('OS')
    platform = platformFrom(os, os ? '' : await sh($, ['uname', '-s'], 2000))
  }
  return platform
}

async function readSys($: EngineInterface, platform: Platform): Promise<SysSnap> {
  let snap: SysSnap = {}
  if (platform === 'win') {
    snap = parseWinSys((await sh($, WIN_SYS, 8000)) ?? '')
  } else {
    if (platform === 'mac') {
      const top = (await sh($, MAC_TOP, 6000)) ?? ''
      snap = parseMacTop(top, (await sh($, MAC_MEMSIZE, 2000)) ?? '')
    } else {
      try {
        const { cpu, ticks } = parseProcStat(await $.fs.read('/proc/stat'), cpuTicks)
        cpuTicks = ticks
        snap = { cpu, ...parseMeminfo(await $.fs.read('/proc/meminfo')) }
      } catch {
        snap = {}
      }
    }
    Object.assign(snap, parseDf((await sh($, DF_ROOT, 3000)) ?? ''))
    snap.procs = countLines((await sh($, PS_PIDS, 3000)) ?? '')
  }
  if (hasGpu !== false) {
    const out = await sh($, NVIDIA_SMI, 4000)
    hasGpu = out !== undefined
    snap.gpu = out === undefined ? undefined : parseNvidia(out)
  }
  return snap
}

async function readClaude($: EngineInterface): Promise<void> {
  try {
    live.sessionStart = (await $.session.usage()).startedAt
  } catch {
    // Keep the start this module saw.
  }
  try {
    const agents = await $.agent.list()
    live.agentsRunning = agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').length
    live.agentsDone = agents.filter(a => a.status === 'completed' || a.status === 'idle').length
  } catch {
    // Left as it was.
  }
}

async function sample($: EngineInterface): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    const host = await detectPlatform($)
    const s = await readSys($, host)
    await readClaude($)
    live.platform = host
    live.diskLabel = live.platform === 'win' ? 'C:' : '/'
    live.cpu = s.cpu
    live.cpuHist = pushHist(live.cpuHist, s.cpu)
    live.memUsed = s.memUsed
    live.memTotal = s.memTotal
    live.memHist = pushHist(live.memHist, s.memTotal ? ((s.memUsed ?? 0) / s.memTotal) * 100 : undefined)
    live.diskUsed = s.diskUsed
    live.diskTotal = s.diskTotal
    live.procs = s.procs
    live.gpu = s.gpu ? { name: s.gpu.name, util: s.gpu.util, memUsed: s.gpu.memUsed, memTotal: s.gpu.memTotal, temp: s.gpu.temp } : undefined
    live.gpuHist = pushHist(live.gpuHist, s.gpu?.util)
    live.samples++
    await publish($)
  } finally {
    isBusy = false
  }
}

// Each sample counts itself, so every publish carries a new picture.
async function publish($: EngineInterface): Promise<void> {
  live.now = await $.clock.now()
  const snap: VitalsSnap = { ...live, cpuHist: [...live.cpuHist], memHist: [...live.memHist], gpuHist: [...live.gpuHist] }
  await update($, snapAtom, () => snap)
}

async function tick($: EngineInterface): Promise<void> {
  if (await isOpen($)) await sample($)
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank(await $.clock.now())
    cpuTicks = undefined
    isBusy = false
    await $.command.register({ name: 'vitals', description: 'KOZMOS: toggle the Vitals machine monitor sidebar', immediate: true })
    $.clock.every(SAMPLE_MS, () => void tick($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'vitals' }, async $ => ({
    text: (await toggle($)) ? 'Vitals open.' : 'Vitals closed.',
  }))

  on('tool.call', async ($, e, next) => {
    live.toolCalls++
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? blank(await $.clock.now())
    const cols = Math.max(28, e.props.bodyColumns || 40)

    // Every surface but the terminal draws Svg cards; the terminal draws Raster graphs.
    if (e.surface !== 'terminal') {
      const { Box, Svg } = $.ui.resolve(e)
      const W = pxOf(cols, 44)
      const cards = desktopCards(snap, W)
      return (
        <Box flexDirection="column">
          {cards.map(c => <Svg key={c.key} source={c.source} alt={c.alt} width={W} height={c.height} />)}
        </Box>
      )
    }

    const { Box, Text, Raster } = $.ui.resolve(e)
    const label = (key: string, name: string, value: RenderChildren, right: RenderChildren) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text wrap="truncate-end"><Text bold color={KZ.violet}>{name}</Text> {value}</Text>
        <Box flexShrink={0} marginLeft={1}><Text dimColor>{right}</Text></Box>
      </Box>
    )
    const graph = (key: string, values: readonly number[], rows: number, tint?: (l: number) => string) => {
      const c = brailleCanvas(values, cols, rows, 100, tint)
      return <Raster key={key} columns={c.cols} rows={c.rows} cells={c.encode()} />
    }
    const barW = Math.max(6, cols - 24)
    const meter = (key: string, name: string, ratio: number, text: string) => (
      <Box key={key} flexDirection="row">
        <Box width={5} flexShrink={0}><Text dimColor>{name}</Text></Box>
        <Text color={heat(ratio)}>{bar(ratio, barW)}</Text>
        <Text> {text}</Text>
      </Box>
    )

    const cpuAvg = avg(snap.cpuHist.slice(-30))
    const cpuPeak = Math.max(0, ...snap.cpuHist)
    const memRatio = ratioOf(snap.memUsed, snap.memTotal)
    const diskRatio = ratioOf(snap.diskUsed, snap.diskTotal)
    const elapsed = snap.now - snap.sessionStart
    const memTint = (l: number) => mix(KZ.teal, KZ.violet, l)
    const gpuTint = (l: number) => mix(KZ.green, KZ.magenta, l)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.cyan}>▌VITALS</Text>
          <Text dimColor>{snap.samples ? <Text color={KZ.green}>● </Text> : '○ '}{snap.platform} · {SAMPLE_MS / 1000}s · {Math.min(snap.cpuHist.length, HISTORY)} pts</Text>
        </Box>
        {label('cpu', 'CPU', <Text bold color={heat((snap.cpu ?? 0) / 100)}>{fmtPct(snap.cpu)}</Text>, `avg ${fmtPct(cpuAvg)} · peak ${fmtPct(cpuPeak)}`)}
        {graph('cpu-g', snap.cpuHist, 4)}
        {label('ram', 'RAM', <Text bold color={heat(memRatio)}>{fmtPct(memRatio * 100)}</Text>, `${fmtBytes(snap.memUsed)} / ${fmtBytes(snap.memTotal)}`)}
        {meter('ram-b', '', memRatio, '')}
        {graph('ram-g', snap.memHist, 2, memTint)}
        {label('disk', `DISK ${snap.diskLabel}`, <Text bold color={heat(diskRatio)}>{snap.diskTotal ? fmtPct(diskRatio * 100) : '—'}</Text>, `${fmtBytes(snap.diskUsed)} / ${fmtBytes(snap.diskTotal)}`)}
        {snap.diskTotal ? meter('disk-b', '', diskRatio, '') : null}
        {snap.gpu
          ? [
              label('gpu', 'GPU', <Text bold color={heat(snap.gpu.util / 100)}>{fmtPct(snap.gpu.util)}</Text>, snap.gpu.name),
              meter('gpu-u', 'util', snap.gpu.util / 100, ''),
              meter('gpu-m', 'vram', snap.gpu.memTotal ? snap.gpu.memUsed / snap.gpu.memTotal : 0, `${fmtBytes(snap.gpu.memUsed)}`),
              <Box key="gpu-t" flexDirection="row">
                <Box width={5} flexShrink={0}><Text dimColor>temp</Text></Box>
                <Text color={heat(tempRatio(snap.gpu.temp))}>{bar(tempRatio(snap.gpu.temp), barW)}</Text>
                <Text bold color={heat(tempRatio(snap.gpu.temp))}> {Math.round(snap.gpu.temp)}°C</Text>
              </Box>,
              graph('gpu-g', snap.gpuHist, 2, gpuTint),
            ]
          : null}
        <Box marginTop={1} flexDirection="row" justifyContent="space-between">
          <Text><Text bold color={KZ.violet}>PROC</Text> {snap.procs ?? '—'}</Text>
          <Text dimColor>{snap.samples} samples</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={KZ.mist} dimColor>{'─'.repeat(Math.max(4, cols))}</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={KZ.clay}>✻ </Text>
          <Text color={KZ.cyan}>⏱ {fmtClock(elapsed)}</Text>
          <Text dimColor>  ·  </Text>
          <Text color={KZ.yellow}>⚒ {snap.toolCalls} tools</Text>
          <Text dimColor>  ·  </Text>
          <Text color={snap.agentsRunning ? KZ.violet : KZ.mist}>◈ {snap.agentsRunning} agents</Text>
        </Text>
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Desktop: one SVG per section.

type Card = { key: string; source: string; alt: string; height: number }

const CSS = `
.live{transform-box:fill-box;transform-origin:center;animation:vtlive 1.6s ease-out infinite}@keyframes vtlive{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(3)}}
.sweep{animation:vtsweep 2s ease-in-out infinite}@keyframes vtsweep{0%,100%{opacity:.0}50%{opacity:.5}}
`

/** An area chart with a gradient, light grid and a live dot at the newest sample. */
function areaChart(id: string, values: readonly number[], x: number, y: number, w: number, h: number, color: string): string {
  const out: string[] = []
  out.push(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset=".7" stop-color="${color}" stop-opacity=".12"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`)
  for (const g of [0.25, 0.5, 0.75]) out.push(`<line class="ln" x1="${x}" x2="${x + w}" y1="${(y + h - g * h).toFixed(1)}" y2="${(y + h - g * h).toFixed(1)}" stroke-width="1" stroke-dasharray="2 4"/>`)
  out.push(`<line class="ln" x1="${x}" x2="${x + w}" y1="${y + h}" y2="${y + h}" stroke-width="1"/>`)
  if (values.length >= 2) {
    const pts = chartPoints(values, x, y, w, h, 100)
    const { line, area } = smoothPaths(pts, y + h)
    out.push(`<path d="${area}" fill="url(#${id})"/>`)
    out.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`)
    const [lx, ly] = pts[pts.length - 1]!
    out.push(`<line x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="${y}" y2="${y + h}" stroke="${color}" stroke-width="1" class="sweep"/>`)
    out.push(`<circle class="live" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${color}"/>`)
    out.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.2"/>`)
  } else {
    out.push(svgText(x + w / 2, y + h / 2 + 4, 'sampling…', { cls: 'm', size: 10.5, anchor: 'middle' }))
  }
  return out.join('')
}

function header(W: number, title: string, value: string, valueColor: string, sub: string, pad: number): string {
  return svgText(pad, 22, title, { cls: 's', size: 10.5, weight: 700 }) +
    svgText(pad, 46, value, { size: 24, weight: 750, fill: valueColor }) +
    svgText(W - pad, 22, sub, { cls: 'm', size: 10.5, anchor: 'end' })
}

function desktopCards(s: VitalsSnap, W: number): Card[] {
  const pad = 14
  const inner = W - pad * 2
  const cards: Card[] = []

  // CPU.
  {
    const H = 150
    const c = heat((s.cpu ?? 0) / 100)
    const body = `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>` +
      header(W, 'CPU', fmtPct(s.cpu), c, `avg ${fmtPct(avg(s.cpuHist.slice(-30)))} · peak ${fmtPct(Math.max(0, ...s.cpuHist))}`, pad) +
      svgText(W - pad, 46, `${s.procs ?? '—'} processes`, { cls: 's', size: 11, anchor: 'end' }) +
      areaChart('vtCpu', s.cpuHist, pad, 60, inner, H - 72, c)
    cards.push({ key: 'cpu', source: svg(W, H, body, CSS), alt: `CPU ${fmtPct(s.cpu)}, ${s.procs ?? 'unknown'} processes`, height: H })
  }

  // RAM.
  {
    const H = 122
    const r = ratioOf(s.memUsed, s.memTotal)
    const body = `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>` +
      header(W, 'MEMORY', fmtPct(s.memTotal ? r * 100 : undefined), mix(KZ.teal, KZ.violet, r), `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}`, pad) +
      svgBar(W / 2, 38, inner / 2 - 0, 8, r, mix(KZ.teal, KZ.violet, r)) +
      areaChart('vtRam', s.memHist, pad, 62, inner, H - 72, KZ.violet)
    cards.push({ key: 'ram', source: svg(W, H, body, CSS), alt: `Memory ${fmtBytes(s.memUsed)} of ${fmtBytes(s.memTotal)}`, height: H })
  }

  // Disk: a ring gauge.
  {
    const H = 84
    const r = ratioOf(s.diskUsed, s.diskTotal)
    const R = 26
    const C = 2 * Math.PI * R
    const cx = pad + R + 2
    const cy = H / 2
    const c = heat(r)
    const body = `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${KZ.mist}" stroke-opacity=".22" stroke-width="7"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * clamp01(r)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
      svgText(cx, cy + 4, s.diskTotal ? fmtPct(r * 100) : '—', { size: 12, weight: 700, anchor: 'middle' }) +
      svgText(cx + R + 18, cy - 6, `DISK ${s.diskLabel}`, { cls: 's', size: 10.5, weight: 700 }) +
      svgText(cx + R + 18, cy + 13, s.diskTotal ? `${fmtBytes(s.diskUsed)} used of ${fmtBytes(s.diskTotal)}` : 'not measured', { size: 12, weight: 600 }) +
      (s.diskTotal ? svgText(W - pad, cy + 13, `${fmtBytes(s.diskTotal * (1 - r))} free`, { cls: 'm', size: 10.5, anchor: 'end' }) : '')
    cards.push({ key: 'disk', source: svg(W, H, body, CSS), alt: `Disk ${s.diskLabel} ${s.diskTotal ? fmtPct(r * 100) : 'unknown'}`, height: H })
  }

  // GPU, when nvidia-smi answers.
  if (s.gpu) {
    const g = s.gpu
    const H = 168
    const memR = g.memTotal ? g.memUsed / g.memTotal : 0
    const tr = tempRatio(g.temp)
    const gw = (inner - 16) / 3
    const gauge = (i: number, label: string, ratio: number, text: string, color: string) => {
      const x = pad + i * (gw + 8)
      return svgText(x, 66, label, { cls: 'm', size: 9.5, weight: 700 }) +
        svgText(x + gw, 66, text, { size: 11, weight: 650, anchor: 'end', fill: color }) +
        svgBar(x, 72, gw, 6, ratio, color)
    }
    const body = `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>` +
      header(W, 'GPU', fmtPct(g.util), heat(g.util / 100), fitText(g.name, 10.5, inner * 0.6), pad) +
      gauge(0, 'UTIL', g.util / 100, fmtPct(g.util), heat(g.util / 100)) +
      gauge(1, 'VRAM', memR, fmtBytes(g.memUsed), mix(KZ.teal, KZ.violet, memR)) +
      gauge(2, 'TEMP', tr, `${Math.round(g.temp)}°C`, heat(tr)) +
      areaChart('vtGpu', s.gpuHist, pad, 90, inner, H - 100, KZ.magenta)
    cards.push({ key: 'gpu', source: svg(W, H, body, CSS), alt: `GPU ${g.name} ${fmtPct(g.util)}, ${Math.round(g.temp)} degrees`, height: H })
  }

  // The Claude side.
  {
    const H = 64
    const tw = (W - 12) / 3
    const tiles: [string, string, string][] = [
      ['SESSION', fmtClock(s.now - s.sessionStart), KZ.cyan],
      ['TOOL CALLS', String(s.toolCalls), KZ.yellow],
      ['AGENTS', `${s.agentsRunning} running`, s.agentsRunning ? KZ.violet : KZ.mist],
    ]
    const body = tiles.map(([k, v, c], i) => {
      const x = i * (tw + 6)
      return `<rect class="p" x="${x}" y="0" width="${tw}" height="${H}" rx="14"/>` +
        `<rect x="${x + 10}" y="12" width="3" height="${H - 24}" rx="1.5" fill="${c}"${i === 2 && s.agentsRunning ? ' class="pulse"' : ''}/>` +
        svgText(x + 20, 26, k, { cls: 's', size: 9.5, weight: 700 }) +
        svgText(x + 20, 46, fitText(v, 15, tw - 28), { size: 15, weight: 700 })
    }).join('')
    cards.push({ key: 'claude', source: svg(W, H, body, CSS), alt: `Session ${fmtClock(s.now - s.sessionStart)}, ${s.toolCalls} tool calls, ${s.agentsRunning} agents running`, height: H })
  }
  return cards
}
