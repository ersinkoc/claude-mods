import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SwitchServer, SwitchSnap, SwitchStatus, SwitchTool } from '../types'
import { Board, fmtMs } from './board.ts'
import { KZ, clip, fitText, fmtSpan, padEnd, pxOf, svg, svgText, xml } from './lib/kz.ts'

const PANE = 'kz-switchboard'
const TITLE = 'KOZMOS · Switchboard'
const EMPTY: SwitchSnap = { servers: [], calls: 0, errors: 0, now: 0 }
const snapAtom = atom({ plugin: 'switchboard', key: 'snap' } as const, EMPTY)
const expandedAtom = atom({ plugin: 'switchboard', key: 'expanded' } as const, [] as string[])

const LAMP: Record<SwitchStatus, string> = { healthy: KZ.green, erroring: KZ.red, idle: KZ.mist, busy: KZ.cyan }

// ---------------------------------------------------------------------------
// The ledger lives here; the pane draws only the published snapshot.

let board = new Board()
let publishedKey = ''

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const snap = board.snapshot(now)
  // Ages move every tick; round the clock so an idle pane redraws twice a minute.
  const key = JSON.stringify({ ...snap, now: Math.floor(now / 30_000) })
  if (key === publishedKey) return
  await update($, snapAtom, () => snap)
  // Noted once written, so a refused write is tried again on the next tick.
  publishedKey = key
}

async function readTools($: EngineInterface): Promise<void> {
  try {
    const tools = await $.tool.list()
    board.list(tools.filter(t => t.mcp || t.name.startsWith('mcp__')).map(t => t.name))
  } catch {
    // Keep what the board knew.
  }
  await publish($)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await readTools($)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function flip($: EngineInterface, server: string): Promise<void> {
  await update($, expandedAtom, prev => (prev.includes(server) ? prev.filter(s => s !== server) : [...prev, server]))
}

/** $.mcp.connect dials only the servers this plugin's own manifest lists; say so when it refuses. */
async function reconnect($: EngineInterface, server: string): Promise<void> {
  try {
    const r = await $.mcp.connect(server)
    if (r.isConnected) $.ui.toast(`⬡ ${server}: connected`)
    else if (r.reason === 'unlisted') $.ui.toast(`⬡ ${server}: a plugin cannot redial this server — reconnect it from /mcp`, { timeoutMs: 7000 })
    else $.ui.toast(`⬡ ${server}: ${r.message}`, { timeoutMs: 7000 })
  } catch (err) {
    // A refusal from beneath always arrives as an Error (a hook that throws is skipped).
    $.ui.toast(`⬡ ${server}: ${(err as Error).message} — try /mcp`, { timeoutMs: 7000 })
  }
  await readTools($)
}

function report(s: SwitchSnap): string {
  if (!s.servers.length) return 'Switchboard: no MCP servers in this session.'
  const lines = [`⬡ Switchboard — ${s.servers.length} servers · ${s.calls} calls · ${s.errors} errors`]
  for (const v of s.servers) {
    lines.push(`  ${lampGlyph(v.status)} ${padEnd(v.name, 18)} ${v.status.padEnd(8)} ${v.toolCount} tools · ${v.calls} calls · ${v.errors} err · avg ${fmtMs(v.avgMs)} · p95 ${fmtMs(v.p95Ms)}`)
  }
  return lines.join('\n')
}

const lampGlyph = (s: SwitchStatus): string => (s === 'erroring' ? '✖' : s === 'busy' ? '◉' : s === 'healthy' ? '●' : '○')

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    board = new Board()
    publishedKey = ''
    await $.command.register({ name: 'switchboard', description: 'KOZMOS: toggle the Switchboard MCP observatory sidebar (/switchboard list prints it)', argumentHint: '[list]', immediate: true })
    await readTools($)
    // MCP servers come and go: read the list again every 30 s, ages every 5 s.
    let tick = 0
    $.clock.every(5000, () => void (++tick % 6 === 0 ? readTools($) : publish($)).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'switchboard' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'list') {
      await readTools($)
      return { text: report(await read($, snapAtom)) }
    }
    return { text: (await toggle($)) ? 'Switchboard open.' : 'Switchboard closed.' }
  })

  // Observer on MCP calls only: time them, note the outcome, never refuse.
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const name = String(e.tool)
    const at = await $.clock.now()
    board.start(name)
    void publish($).catch(() => undefined)
    try {
      const ran = await next(e)
      const isError = ran.isError === true || ran.deny !== undefined
      const end = await $.clock.now()
      board.finish(name, end, end - at, isError, ran.deny ?? (ran.isError ? ran.text : undefined))
      void publish($).catch(() => undefined)
      return ran
    } catch (err) {
      const end = await $.clock.now()
      board.finish(name, end, end - at, true, (err as Error).message)
      void publish($).catch(() => undefined)
      throw err
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snapAtom)
    const expanded = await read($, expandedAtom)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const bay = patchBay(W, s)
      const cardW = Math.max(180, W - 150)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg source={bay.source} alt={`Switchboard: ${s.servers.length} MCP servers, ${s.calls} calls, ${s.errors} errors`} width={W} height={bay.height} />
          {s.servers.map(v => {
            const isOpen = expanded.includes(v.name)
            return (
              <Box key={`srv-${v.name}`} flexDirection="column">
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Svg source={serverCard(cardW, v, s.now)} alt={`${v.name}: ${v.status}, ${v.calls} calls, ${v.errors} errors`} width={cardW} height={52} />
                  <Button key={`exp-${v.name}`} label={isOpen ? '▾ tools' : '▸ tools'} plain onPress={() => void flip($, v.name)} />
                  {v.status === 'erroring' ? <Button key={`re-${v.name}`} label="reconnect" onPress={() => void reconnect($, v.name)} /> : null}
                </Box>
                {isOpen && v.tools.length ? <Svg key={`tools-${v.name}`} source={toolTable(cardW, v.tools, s.now)} alt={`${v.name} tools`} width={cardW} height={20 + v.tools.length * 20} /> : null}
              </Box>
            )
          })}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 44)
    if (!s.servers.length) {
      return (
        <Box flexDirection="column">
          <Text bold color={KZ.magenta}>⬡ SWITCHBOARD</Text>
          <Text dimColor>No MCP servers in this session yet.</Text>
          <Text dimColor>Connect one with /mcp; it shows here as soon as its tools are listed.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.magenta}>⬡ SWITCHBOARD</Text>
          <Text dimColor>{s.servers.length} srv · {s.calls} calls{s.errors ? <Text color={KZ.red}> · {s.errors} err</Text> : ''}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(Math.min(cols, 80))}</Text>
        {s.servers.map(v => {
          const isOpen = expanded.includes(v.name)
          const ago = v.lastAt !== null ? `${fmtSpan(s.now - v.lastAt)} ago` : 'never called'
          return (
            <Box key={`srv-${v.name}`} flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  <Button key={`exp-${v.name}`} label={isOpen ? '▾' : '▸'} plain onPress={() => void flip($, v.name)} />
                  <Text wrap="truncate-end">
                    <Text color={LAMP[v.status]}> {lampGlyph(v.status)} </Text>
                    <Text bold>{clip(v.name, Math.max(8, cols - 26))}</Text>
                    <Text color={LAMP[v.status]}> {v.status}</Text>
                  </Text>
                </Box>
                {v.status === 'erroring'
                  ? <Button key={`re-${v.name}`} label="reconnect" plain onPress={() => void reconnect($, v.name)} />
                  : <Text dimColor>{v.calls} calls</Text>}
              </Box>
              <Text dimColor wrap="truncate-end">
                {'    '}{v.toolCount} tools · {v.calls} calls · <Text color={v.errors ? KZ.red : undefined} dimColor={!v.errors}>{v.errors} err</Text> · avg {fmtMs(v.avgMs)} · p95 {fmtMs(v.p95Ms)} · {ago}{v.lastTool ? ` · ${v.lastTool}` : ''}
              </Text>
              {v.status === 'erroring' && v.lastError ? <Text color={KZ.red} wrap="truncate-end">    ✖ {clip(v.lastError, cols - 6)}</Text> : null}
              {isOpen
                ? v.tools.map(t => (
                    <Text key={`t-${v.name}-${t.name}`} wrap="truncate-end">
                      <Text dimColor>      {t.isListed ? '◦' : '·'} </Text>
                      <Text color={t.errors ? KZ.amber : undefined}>{padEnd(clip(t.name, 22), Math.min(22, Math.max(8, cols - 30)))}</Text>
                      <Text dimColor> {String(t.calls).padStart(3)}× {fmtMs(t.avgMs).padStart(6)} p95 {fmtMs(t.p95Ms).padStart(6)}</Text>
                      {t.errors ? <Text color={KZ.red}> {t.errors}✖</Text> : ''}
                    </Text>
                  ))
                : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Desktop drawings.

/** The patch bay: a Claude jack on the left, a socket per server, cables to the live ones. */
function patchBay(W: number, s: SwitchSnap): { source: string; height: number } {
  const shown = s.servers.slice(0, 12)
  const rowH = 26
  const H = Math.max(96, 44 + shown.length * rowH)
  const jackX = 46
  const jackY = H / 2 + 6
  const sockX = Math.max(jackX + 120, W - Math.min(190, W * 0.45))
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="sbpanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1830"/><stop offset="1" stop-color="#0f1622"/></linearGradient>
<filter id="sbglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#sbpanel)"/>`)
  // Rack screws and the title strip.
  for (const [x, y] of [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10]] as const) parts.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="#3b3760"/><path d="M${x - 1.6} ${y}h3.2" stroke="#1b1830" stroke-width="1"/>`)
  parts.push(`<text x="18" y="24" font-family="'Segoe UI',Inter,sans-serif" font-size="12" font-weight="800" letter-spacing="3" fill="${KZ.magenta}">SWITCHBOARD</text>`)
  parts.push(`<text x="${W - 18}" y="24" text-anchor="end" font-family="'Segoe UI',Inter,sans-serif" font-size="10.5" fill="#a8a3c7">${xml(`${s.servers.length} servers · ${s.calls} calls · ${s.errors} err`)}</text>`)
  // The Claude jack.
  parts.push(`<circle cx="${jackX}" cy="${jackY}" r="15" fill="#26223f" stroke="${KZ.violet}" stroke-width="2"/><circle cx="${jackX}" cy="${jackY}" r="6" fill="${KZ.violet}" class="pulse"/>`)
  parts.push(`<text x="${jackX}" y="${jackY + 30}" text-anchor="middle" font-family="'Segoe UI',Inter,sans-serif" font-size="9" font-weight="700" letter-spacing="1.5" fill="#a8a3c7">CLAUDE</text>`)
  if (!shown.length) {
    parts.push(`<text x="${sockX}" y="${jackY + 4}" font-family="'Segoe UI',Inter,sans-serif" font-size="11.5" fill="#a8a3c7">no MCP servers yet</text>`)
    parts.push(`<path d="M${jackX + 15} ${jackY}C${jackX + 70} ${jackY + 26} ${sockX - 70} ${jackY + 26} ${sockX - 14} ${jackY}" stroke="#4a4570" stroke-width="2" fill="none" stroke-dasharray="3 5"/>`)
  }
  shown.forEach((v, i) => {
    const y = 44 + i * rowH + rowH / 2 - 6
    const c = LAMP[v.status]
    const isLive = v.calls > 0
    if (isLive) {
      const d = `M${jackX + 15} ${jackY}C${jackX + 90} ${jackY} ${sockX - 90} ${y} ${sockX - 12} ${y}`
      const isFlowing = v.status === 'busy' || (v.lastAt !== null && s.now - v.lastAt < 60_000)
      parts.push(`<path d="${d}" stroke="${c}" stroke-width="5" fill="none" opacity=".35" filter="url(#sbglow)"${isFlowing ? ' class="pulse"' : ''}/>`)
      parts.push(`<path d="${d}" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`)
      if (isFlowing) parts.push(`<path d="${d}" stroke="#ffffff" stroke-width="1.6" fill="none" stroke-dasharray="2 14" class="flow" opacity=".85"/>`)
      parts.push(`<circle cx="${sockX - 12}" cy="${y}" r="3.6" fill="${c}"/>`)
    }
    parts.push(`<circle cx="${sockX}" cy="${y}" r="8.5" fill="#0b0f18" stroke="${isLive ? c : '#4a4570'}" stroke-width="2"/>`)
    parts.push(`<circle cx="${sockX}" cy="${y}" r="3" fill="${isLive ? c : '#2c2948'}"${v.status === 'erroring' ? ' class="pulse"' : ''}/>`)
    parts.push(`<text x="${sockX + 16}" y="${y + 4}" font-family="'Segoe UI',Inter,sans-serif" font-size="11.5" font-weight="650" fill="#ecebf7">${xml(fitText(v.name, 11.5, W - sockX - 70))}</text>`)
    parts.push(`<text x="${W - 16}" y="${y + 4}" text-anchor="end" font-family="ui-monospace,Consolas,monospace" font-size="10" fill="${v.status === 'idle' ? '#8d88ad' : c}">${v.calls ? `${v.calls}×` : 'idle'}</text>`)
  })
  if (s.servers.length > shown.length) parts.push(`<text x="${sockX + 16}" y="${H - 8}" font-family="'Segoe UI',Inter,sans-serif" font-size="10" fill="#8d88ad">+${s.servers.length - shown.length} more</text>`)
  const css = `.flow{animation:sbflow 1.1s linear infinite}@keyframes sbflow{to{stroke-dashoffset:-32}}`
  return { source: svg(W, H, parts.join(''), css), height: H }
}

function serverCard(W: number, v: SwitchServer, now: number): string {
  const c = LAMP[v.status]
  const ago = v.lastAt !== null ? `${fmtSpan(now - v.lastAt)} ago${v.lastTool ? ` · ${v.lastTool}` : ''}` : 'never called'
  const chipW = v.status.length * 6.4 + 16
  const body = `<rect class="p" x="0" y="0" width="${W}" height="52" rx="11"/>
<rect x="0" y="0" width="4" height="52" rx="2" fill="${c}"/>
<circle cx="20" cy="18" r="9" fill="${c}" opacity=".18"${v.status === 'erroring' || v.status === 'busy' ? ' class="pulse"' : ''}/>
<circle cx="20" cy="18" r="4.6" fill="${c}"/>
${svgText(36, 22, fitText(v.name, 13.5, W - chipW - 110), { size: 13.5, weight: 700 })}
<rect x="${W - chipW - 70}" y="9" width="${chipW}" height="17" rx="8.5" fill="${c}" opacity=".18"/>
${svgText(W - chipW / 2 - 70, 21, v.status, { size: 10, weight: 700, anchor: 'middle', fill: c })}
${svgText(W - 10, 21, `${v.calls} calls`, { size: 11, weight: 650, anchor: 'end' })}
${svgText(14, 42, fitText(`${v.toolCount} tools · ${v.errors} err · avg ${fmtMs(v.avgMs)} · p95 ${fmtMs(v.p95Ms)} · ${ago}`, 10.5, W - 24), { cls: v.errors ? 's' : 'm', size: 10.5 })}`
  return svg(W, 52, body)
}

function toolTable(W: number, tools: readonly SwitchTool[], now: number): string {
  const H = 20 + tools.length * 20
  const parts = [`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="9"/>`]
  parts.push(svgText(14, 14, 'TOOL', { cls: 'm', size: 9, weight: 700 }))
  parts.push(svgText(W - 150, 14, 'CALLS', { cls: 'm', size: 9, weight: 700, anchor: 'end' }))
  parts.push(svgText(W - 92, 14, 'AVG', { cls: 'm', size: 9, weight: 700, anchor: 'end' }))
  parts.push(svgText(W - 40, 14, 'P95', { cls: 'm', size: 9, weight: 700, anchor: 'end' }))
  tools.forEach((t, i) => {
    const y = 32 + i * 20
    const c = t.errors ? KZ.red : t.inFlight ? KZ.cyan : t.calls ? KZ.green : KZ.mist
    parts.push(`<circle cx="18" cy="${y - 4}" r="3" fill="${c}"/>`)
    parts.push(svgText(28, y, fitText(t.name, 11, W - 210), { size: 11, mono: true, ...(t.isListed ? {} : { cls: 'm' }) }))
    parts.push(svgText(W - 150, y, `${t.calls}${t.errors ? ` (${t.errors}✖)` : ''}`, { size: 10.5, anchor: 'end', ...(t.errors ? { fill: KZ.red } : { cls: 's' }) }))
    parts.push(svgText(W - 92, y, fmtMs(t.avgMs), { cls: 's', size: 10.5, anchor: 'end' }))
    parts.push(svgText(W - 40, y, fmtMs(t.p95Ms), { cls: 's', size: 10.5, anchor: 'end' }))
    parts.push(svgText(W - 8, y, t.lastAt !== null ? fmtSpan(now - t.lastAt) : '', { cls: 'm', size: 9.5, anchor: 'end' }))
  })
  return svg(W, H, parts.join(''))
}
