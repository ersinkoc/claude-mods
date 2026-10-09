// Almanac's pure helpers: the ledger it keeps, how a tool name tells its
// family, MCP server and plugin, and the desktop drawings. No `$` here.

import type { AlmanacEntry, AlmanacSnap } from '../types'
import { FONT, KZ, fitText, fmtClock, hash, hue, modelName, svg, svgBar, svgText, textWidth, xml } from './lib/kz.ts'

/** A counter that remembers when each name first showed up. */
export class Tally {
  private readonly m = new Map<string, { n: number; first: number }>()

  add(name: string, at: number, by = 1): void {
    if (!name) return
    const prev = this.m.get(name)
    if (prev) prev.n += by
    else this.m.set(name, { n: by, first: at })
  }

  has(name: string): boolean {
    return this.m.has(name)
  }

  get size(): number {
    return this.m.size
  }

  /** Ranked: most first, then earliest. `first` relative to `origin`. */
  entries(origin: number): AlmanacEntry[] {
    return [...this.m.entries()]
      .map(([name, v]) => ({ name, n: v.n, first: Math.max(0, v.first - origin) }))
      .sort((a, b) => b.n - a.n || a.first - b.first || a.name.localeCompare(b.name))
  }
}

export type Family = 'shell' | 'edit' | 'read' | 'search' | 'agent' | 'web' | 'tasks' | 'skill' | 'mcp' | 'other'

export const FAMILY_COLOR: Record<Family, string> = {
  shell: KZ.green,
  edit: KZ.yellow,
  read: KZ.blue,
  search: KZ.teal,
  agent: KZ.violet,
  web: KZ.cyan,
  tasks: KZ.lime,
  skill: KZ.amber,
  mcp: KZ.magenta,
  other: KZ.mist,
}

export function familyOf(tool: string): Family {
  const t = String(tool)
  if (t.startsWith('mcp__')) return 'mcp'
  if (t === 'Bash' || t === 'PowerShell' || t === 'Monitor') return 'shell'
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit' || t === 'MultiEdit') return 'edit'
  if (t === 'Read' || t === 'LSP') return 'read'
  if (t === 'Glob' || t === 'Grep' || t === 'ToolSearch') return 'search'
  if (t === 'Agent' || t === 'Task' || t === 'Workflow' || t === 'SendMessage') return 'agent'
  if (t.startsWith('Web')) return 'web'
  if (t.startsWith('Todo') || t.startsWith('Task')) return 'tasks'
  if (t === 'Skill') return 'skill'
  return 'other'
}

/**
 * What an `mcp__…` tool name says: the MCP server it belongs to, and the plugin
 * that provides it. `mcp__plugin_<plugin>_<server>__<tool>` is a plugin's MCP
 * server; `mcp__<x>__<tool>` is a plugin's own registered tool when the engine
 * lists it as not MCP (`ownTools`), else the MCP server `<x>`.
 */
export function mcpParts(tool: string, ownTools: ReadonlySet<string>): { server?: string; plugin?: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!m) return {}
  const head = m[1] ?? ''
  const pm = /^plugin_([^_]+)_(.+)$/.exec(head)
  if (pm) return { server: pm[2], plugin: pm[1] }
  if (ownTools.has(tool)) return { plugin: head }
  return { server: head }
}

/** A plugin's agent type reads `plugin:name`; built-ins have no prefix. */
export function pluginOfAgent(type: string): string | undefined {
  const i = type.indexOf(':')
  return i > 0 ? type.slice(0, i) : undefined
}

export function snapText(s: AlmanacSnap): string {
  const sec = (title: string, xs: AlmanacEntry[], fmt: (e: AlmanacEntry) => string = e => e.name) =>
    `${title}: ${xs.length ? xs.map(e => `${fmt(e)} ×${e.n}`).join(', ') : '—'}`
  return [
    `Almanac — Claude Code ${s.version || '?'} · ${fmtClock(s.now - s.startedAt)} · ${s.tools} tool calls`,
    sec('Commands', s.commands, e => `/${e.name}`),
    sec('Skills', s.skills),
    sec('Subagents', s.agents),
    sec('MCP servers', s.mcp),
    sec('Models', s.models, e => modelName(e.name)),
    sec('Plugins', s.plugins),
    sec('Tool families', s.families),
    s.installed >= 0 ? `Installed commands: ${s.installed}, never run this session: ${s.unused}` : 'Installed commands: unknown',
  ].join('\n')
}

export const tagColor = (name: string): string => hue((hash(name) % 997) / 997, 0.78, 0.57)

// ---------------------------------------------------------------------------
// Desktop drawings: one SVG per section.

export function headerSvg(s: AlmanacSnap, W: number): string {
  const H = 112
  const parts = [
    `<defs><linearGradient id="ah" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${KZ.amber}" stop-opacity=".22"/><stop offset=".6" stop-color="${KZ.magenta}" stop-opacity=".1"/><stop offset="1" stop-color="${KZ.violet}" stop-opacity=".05"/></linearGradient></defs>`,
    `<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#ah)"/>`,
    // A small open book.
    `<g transform="translate(16 14)"><path d="M0 4q9-5 16 0v20q-7-5-16 0z" fill="${KZ.amber}" opacity=".9"/><path d="M32 4q-9-5-16 0v20q7-5 16 0z" fill="${KZ.amber}" opacity=".65"/></g>`,
    svgText(56, 30, 'ALMANAC', { size: 16, weight: 800, fill: KZ.amber }),
    svgText(56, 45, `what this session is made of · ${fmtClock(s.now - s.startedAt)}`, { cls: 's', size: 10.5 }),
  ]
  const ver = s.version ? `v${s.version}` : 'v?'
  const vw = textWidth(ver, 10.5) + 16
  parts.push(`<rect x="${W - 12 - vw}" y="14" width="${vw}" height="20" rx="10" fill="${KZ.violet}" opacity=".18"/>`)
  parts.push(svgText(W - 12 - vw / 2, 28, ver, { size: 10.5, weight: 700, anchor: 'middle', fill: KZ.violet, mono: true }))
  const tiles: [string, string, string][] = [
    ['TOOLS', String(s.tools), KZ.green],
    ['COMMANDS', String(s.commands.reduce((a, e) => a + e.n, 0)), KZ.yellow],
    ['SKILLS', String(s.skills.length), KZ.amber],
    ['AGENTS', String(s.agents.reduce((a, e) => a + e.n, 0)), KZ.violet],
    ['MCP', String(s.mcp.length), KZ.magenta],
    ['UNUSED', s.installed >= 0 ? `${s.unused}/${s.installed}` : '—', KZ.mist],
  ]
  const n = W >= 520 ? 6 : 3
  const rowsOf = Math.ceil(tiles.length / n)
  const tw = (W - 24 - (n - 1) * 6) / n
  const th = rowsOf === 1 ? 46 : 24
  tiles.forEach(([k, v, c], i) => {
    const x = 12 + (i % n) * (tw + 6)
    const y = 56 + Math.floor(i / n) * (th + 4)
    parts.push(`<rect class="k" x="${x}" y="${y}" width="${tw}" height="${th}" rx="8" opacity=".7"/>`)
    if (rowsOf === 1) {
      parts.push(svgText(x + 10, y + 16, k, { cls: 'm', size: 9, weight: 700 }))
      parts.push(svgText(x + 10, y + 36, fitText(v, 16, tw - 14), { size: 16, weight: 760, fill: c }))
    } else {
      parts.push(svgText(x + 8, y + 16, k, { cls: 'm', size: 8.5, weight: 700 }))
      parts.push(svgText(x + tw - 8, y + 16.5, fitText(v, 12, tw / 2), { size: 12, weight: 760, anchor: 'end', fill: c }))
    }
  })
  return svg(W, H, parts.join(''))
}

function sectionHead(title: string, sub: string, color: string, W: number): string {
  return `<rect class="p" x="0" y="0" width="${W}" height="100%" rx="12"/>` +
    svgText(12, 19, title.toUpperCase(), { size: 10, weight: 760, fill: color }) +
    svgText(W - 12, 19, sub, { cls: 'm', size: 10, anchor: 'end' })
}

/** Ranked bars: name, bar, count, first use. */
export function barsSvg(title: string, color: string, xs: readonly AlmanacEntry[], W: number, label: (e: AlmanacEntry) => string, max = 8): { source: string; height: number } {
  const shown = xs.slice(0, max)
  const H = 30 + Math.max(1, shown.length) * 20 + 6
  const top = Math.max(1, ...shown.map(e => e.n))
  const total = xs.reduce((a, e) => a + e.n, 0)
  const parts = [sectionHead(title, xs.length ? `${xs.length} · ${total}×` : '', color, W)]
  if (!shown.length) parts.push(svgText(12, 44, 'none yet', { cls: 'm', size: 11 }))
  const nameW = Math.min(170, Math.max(70, W * 0.32))
  shown.forEach((e, i) => {
    const y = 30 + i * 20
    const c = i === 0 ? color : tagColor(e.name)
    parts.push(svgText(12, y + 12, fitText(label(e), 11.5, nameW - 8), { size: 11.5, weight: i === 0 ? 650 : 500 }))
    parts.push(svgBar(12 + nameW, y + 4, Math.max(30, W - nameW - 110), 8, e.n / top, c))
    parts.push(svgText(W - 54, y + 12, `×${e.n}`, { size: 11, weight: 700, anchor: 'end', fill: c }))
    parts.push(svgText(W - 12, y + 12, `+${fmtClock(e.first)}`, { cls: 'm', size: 9.5, anchor: 'end', mono: true }))
  })
  if (xs.length > max) parts.push(svgText(W - 12, H - 6, `+${xs.length - max} more`, { cls: 'm', size: 9, anchor: 'end' }))
  return { source: svg(W, H, parts.join('')), height: H }
}

/** A tag cloud: pills sized by use, flowing onto as many lines as they need. */
export function cloudSvg(title: string, color: string, xs: readonly AlmanacEntry[], W: number, label: (e: AlmanacEntry) => string = e => e.name, max = 30): { source: string; height: number } {
  const shown = xs.slice(0, max)
  const top = Math.max(1, ...shown.map(e => e.n))
  const pills: string[] = []
  let x = 12
  let y = 30
  let lineH = 0
  // Alphabetical inside the cloud reads like a cloud; size carries the rank.
  const sorted = [...shown].sort((a, b) => a.name.localeCompare(b.name))
  for (const e of sorted) {
    const size = 10.5 + 8 * Math.sqrt(e.n / top)
    const text = label(e)
    const count = e.n > 1 ? ` ${e.n}` : ''
    const w = Math.min(W - 24, textWidth(text, size) + textWidth(count, 9) + 18)
    const h = size + 10
    if (x + w > W - 12 && x > 12) {
      x = 12
      y += lineH + 6
      lineH = 0
    }
    const c = tagColor(e.name)
    pills.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}" opacity="${0.12 + 0.18 * (e.n / top)}"/>`)
    pills.push(`<text x="${x + 9}" y="${y + h / 2 + size * 0.35}" font-family="${FONT}" font-size="${size.toFixed(1)}" font-weight="${e.n === top ? 750 : 560}" fill="${c}">${xml(fitText(text, size, w - 18))}<tspan font-size="9" opacity=".75">${count}</tspan></text>`)
    x += w + 6
    lineH = Math.max(lineH, h)
  }
  const H = shown.length ? y + lineH + 10 : 54
  const head = sectionHead(title, xs.length ? `${xs.length}` : '', color, W)
  const empty = shown.length ? '' : svgText(12, 42, 'none yet', { cls: 'm', size: 11 })
  return { source: svg(W, H, head + empty + pills.join('')), height: H }
}

/** Tool families: one stacked bar and a legend. */
export function familiesSvg(xs: readonly AlmanacEntry[], W: number): { source: string; height: number } {
  const total = xs.reduce((a, e) => a + e.n, 0)
  const cols = W >= 480 ? 4 : 2
  const legendRows = Math.max(1, Math.ceil(xs.length / cols))
  const H = 52 + legendRows * 17 + 4
  const parts = [sectionHead('Tool families', total ? `${total} calls` : '', KZ.green, W)]
  const bw = W - 24
  parts.push(`<rect class="k" x="12" y="28" width="${bw}" height="12" rx="6"/>`)
  if (total) {
    parts.push(`<clipPath id="fam"><rect x="12" y="28" width="${bw}" height="12" rx="6"/></clipPath><g clip-path="url(#fam)">`)
    let x = 12
    for (const e of xs) {
      const w = (e.n / total) * bw
      parts.push(`<rect x="${x.toFixed(1)}" y="28" width="${w.toFixed(1)}" height="12" fill="${FAMILY_COLOR[e.name as Family] ?? KZ.mist}"/>`)
      x += w
    }
    parts.push('</g>')
  } else parts.push(svgText(12, 62, 'no tool calls yet', { cls: 'm', size: 11 }))
  const slot = bw / cols
  xs.forEach((e, i) => {
    const lx = 12 + (i % cols) * slot
    const ly = 58 + Math.floor(i / cols) * 17
    parts.push(`<rect x="${lx}" y="${ly - 8}" width="9" height="9" rx="2.5" fill="${FAMILY_COLOR[e.name as Family] ?? KZ.mist}"/>`)
    parts.push(svgText(lx + 14, ly, fitText(`${e.name} ${e.n} · ${Math.round((e.n / total) * 100)}%`, 10.5, slot - 18), { cls: 's', size: 10.5 }))
  })
  return { source: svg(W, H, parts.join('')), height: H }
}
