// Polaroid's pure side: the session data it collects and the two documents it
// writes from it, a self-contained HTML page and a Markdown file. No `$` here.

import { KZ, clamp01, fmtClock, fmtTokens, fmtUsd, hash, limitLabel, modelName, rng } from './lib/kz.ts'
import type { Usage } from './lib/kz.ts'

export type ReportTurn = {
  index: number
  prompt: string
  startedAt: number
  durationMs: number
  tools: number
  tokens: number
  usd: number
  reason: string
}

export type ReportAgent = {
  id: string
  type: string
  description: string
  model: string
  startedAt: number
  durationMs: number
  tokens: number
  usd: number
  status: 'running' | 'done' | 'failed'
}

export type ReportFile = { path: string; reads: number; edits: number; writes: number }
export type ReportLimit = { kind: string; percentUsed: number; peak: number; resetsAt?: string }
export type ReportCommand = { name: string; args: string; at: number }
export type TokenSums = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type ReportData = {
  title: string
  model: string
  models: string[]
  version: string
  root: string
  startedAt: number
  endedAt: number
  costUsd?: number
  tokens: TokenSums
  requests: number
  ctxPeakPercent?: number
  ctxPeakTokens?: number
  ctxWindow?: number
  /** [ms since start, percent] samples. */
  ctxSeries: [number, number][]
  limits: ReportLimit[]
  families: Record<string, number>
  toolNames: Record<string, number>
  toolErrors: number
  turns: ReportTurn[]
  agents: ReportAgent[]
  files: ReportFile[]
  commands: ReportCommand[]
}

export function emptyReport(now: number): ReportData {
  return {
    title: '',
    model: '',
    models: [],
    version: '',
    root: '',
    startedAt: now,
    endedAt: now,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    requests: 0,
    ctxSeries: [],
    limits: [],
    families: {},
    toolNames: {},
    toolErrors: 0,
    turns: [],
    agents: [],
    files: [],
    commands: [],
  }
}

// ---------------------------------------------------------------------------
// Small facts.

export const FAMILY_COLOR: Record<string, string> = {
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

export function familyOf(tool: string): string {
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

/** How a tool call touches a file, if it does. */
export function fileTouch(tool: string, input: Record<string, unknown>): { path: string; kind: 'reads' | 'edits' | 'writes' } | undefined {
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  if (!path) return undefined
  if (tool === 'Read') return { path, kind: 'reads' }
  if (tool === 'Write') return { path, kind: 'writes' }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return { path, kind: 'edits' }
  return undefined
}

export function addTokens(sum: TokenSums, u: Usage | null | undefined): TokenSums {
  if (!u) return sum
  return {
    input: sum.input + (u.input_tokens ?? 0),
    output: sum.output + (u.output_tokens ?? 0),
    cacheRead: sum.cacheRead + (u.cache_read_input_tokens ?? 0),
    cacheWrite: sum.cacheWrite + (u.cache_creation_input_tokens ?? 0),
  }
}

export const totalTokens = (t: TokenSums): number => t.input + t.output + t.cacheRead + t.cacheWrite

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `session-20261009-143205` from a timestamp, in local time. */
export function reportStem(at: number): string {
  const d = new Date(at)
  return `session-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

/** Joins onto `root` with the separator `root` already uses. */
export function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return [root.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

export function stamp(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// HTML.

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }

/** Escapes text for HTML element content and quoted attribute values alike. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"'`]/g, c => ENTITIES[c] as string)
}

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const num = (n: number): string => n.toLocaleString('en-US')

const CSS = `
:root{--bg:#07060f;--panel:rgba(255,255,255,.035);--panel2:rgba(255,255,255,.06);--line:rgba(255,255,255,.09);--text:#eeeaff;--dim:#a29fc4;--mute:#6f6c8f;
--violet:${KZ.violet};--magenta:${KZ.magenta};--cyan:${KZ.cyan};--green:${KZ.green};--yellow:${KZ.yellow};--amber:${KZ.amber};--red:${KZ.red};--blue:${KZ.blue}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;min-height:100vh;
background:radial-gradient(1200px 600px at 10% -10%,rgba(167,139,250,.22),transparent 60%),radial-gradient(900px 500px at 95% 0%,rgba(34,211,238,.14),transparent 60%),radial-gradient(800px 600px at 50% 110%,rgba(244,114,182,.10),transparent 60%),var(--bg)}
main{max-width:1180px;margin:0 auto;padding:40px 20px 64px}
h1,h2,h3{margin:0;font-weight:750;letter-spacing:-.01em}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:14px;display:flex;align-items:center;gap:10px}
h2::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent,var(--violet));box-shadow:0 0 12px var(--accent,var(--violet))}
.mono{font-family:ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace}
.dim{color:var(--dim)}.mute{color:var(--mute)}
.hero{display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:40px;align-items:center;margin-bottom:36px}
.polaroid{background:#f6f2ea;padding:14px 14px 0;border-radius:4px;transform:rotate(-3deg);box-shadow:0 30px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.4) inset,0 0 80px rgba(167,139,250,.25);transition:transform .4s}
.polaroid:hover{transform:rotate(-1deg) scale(1.02)}
.polaroid svg{display:block;width:100%;height:auto;border-radius:2px}
.caption{color:#2b2540;font:22px/1.2 "Segoe Print","Bradley Hand","Comic Sans MS",cursive;padding:12px 4px 18px;text-align:center}
.caption small{display:block;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;color:#7a7390;margin-top:4px}
.kicker{font-size:12px;letter-spacing:.3em;text-transform:uppercase;background:linear-gradient(90deg,var(--violet),var(--magenta),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.title{font-size:clamp(24px,3.4vw,38px);line-height:1.15;margin:8px 0 14px;text-shadow:0 0 40px rgba(167,139,250,.35)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.chip{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 12px;font-size:12px;color:var(--dim)}
.chip b{color:var(--text);font-weight:650}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;position:relative;overflow:hidden}
.kpi::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,var(--violet));box-shadow:0 0 14px var(--c,var(--violet))}
.kpi .k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.kpi .v{font-size:22px;font-weight:780;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi .s{font-size:11.5px;color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:18px;margin-bottom:18px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:18px;padding:20px;backdrop-filter:blur(6px);min-width:0}
.card.wide{grid-column:1/-1}
.card svg{display:block;width:100%;height:auto;overflow:visible}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
tr:hover td{background:rgba(255,255,255,.025)}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.bar{height:6px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden;min-width:60px}
.bar i{display:block;height:100%;border-radius:3px;background:var(--c,var(--violet));box-shadow:0 0 10px var(--c,var(--violet))}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:11.5px;font-weight:650;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c)}
.limit{margin-bottom:14px}.limit .row{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
.limit .bar{height:9px}
.cmds{display:flex;flex-wrap:wrap;gap:8px}
.cmd{border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--panel);font-size:12.5px}
.cmd .t{color:var(--mute);font-size:11px;margin-left:6px}
.empty{color:var(--mute);font-style:italic;padding:8px 0}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--dim);margin-top:10px}
.legend span::before{content:"";display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:var(--c)}
footer{margin-top:36px;text-align:center;color:var(--mute);font-size:12px}
footer b{background:linear-gradient(90deg,var(--violet),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
@media (max-width:760px){.hero{grid-template-columns:1fr}.polaroid{max-width:300px;margin:0 auto}main{padding-top:24px}}
@media (max-width:460px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@keyframes tw{50%{opacity:.25}}.tw{animation:tw 3.2s ease-in-out infinite}
`

/** The square picture inside the polaroid frame: the session as a night sky. */
export function snapshotArt(d: ReportData): string {
  const S = 300
  const r = rng(hash(`${d.title}|${d.startedAt}`))
  const span = Math.max(1, d.endedAt - d.startedAt)
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#160a33"/><stop offset=".6" stop-color="#1c0f45"/><stop offset="1" stop-color="#05283a"/></linearGradient>
<radialGradient id="neb" cx=".75" cy=".3" r=".55"><stop offset="0" stop-color="${KZ.magenta}" stop-opacity=".45"/><stop offset="1" stop-color="${KZ.magenta}" stop-opacity="0"/></radialGradient>
<radialGradient id="neb2" cx=".2" cy=".8" r=".5"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".3"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity="0"/></radialGradient>
<filter id="gl"><feGaussianBlur stdDeviation="3"/></filter></defs>`)
  parts.push(`<rect width="${S}" height="${S}" fill="url(#sky)"/><rect width="${S}" height="${S}" fill="url(#neb)"/><rect width="${S}" height="${S}" fill="url(#neb2)"/>`)
  for (let i = 0; i < 90; i++) {
    const x = r() * S
    const y = r() * S
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.3 + r() * 1.1).toFixed(2)}" fill="#fff" opacity="${(0.3 + r() * 0.7).toFixed(2)}"${i % 4 === 0 ? ` class="tw" style="animation-delay:-${(r() * 3).toFixed(2)}s"` : ''}/>`)
  }
  // Turns as a constellation across the frame: x by time, y by tool count, size by duration.
  const maxTools = Math.max(1, ...d.turns.map(t => t.tools))
  const maxDur = Math.max(1, ...d.turns.map(t => t.durationMs))
  const pts = d.turns.map(t => {
    const x = 24 + clamp01((t.startedAt - d.startedAt) / span) * (S - 48)
    const y = S - 40 - (t.tools / maxTools) * (S - 90) + (r() - 0.5) * 16
    return { x, y, rad: 2.5 + 7 * Math.sqrt(t.durationMs / maxDur), c: t.usd > 0.5 ? KZ.amber : t.tools > 10 ? KZ.magenta : KZ.cyan }
  })
  if (pts.length > 1) parts.push(`<polyline points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1"/>`)
  for (const p of pts) {
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(p.rad * 2).toFixed(1)}" fill="${p.c}" opacity=".35" filter="url(#gl)"/>`)
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.rad.toFixed(1)}" fill="${p.c}"/>`)
  }
  // A horizon of tool families.
  const fam = Object.entries(d.families).sort((a, b) => b[1] - a[1])
  const total = fam.reduce((s, [, n]) => s + n, 0)
  let x = 0
  for (const [name, n] of fam) {
    const w = (n / Math.max(1, total)) * S
    parts.push(`<rect x="${x.toFixed(1)}" y="${S - 10}" width="${w.toFixed(1)}" height="10" fill="${FAMILY_COLOR[name] ?? KZ.mist}"/>`)
    x += w
  }
  if (!total) parts.push(`<rect x="0" y="${S - 10}" width="${S}" height="10" fill="${KZ.violet}" opacity=".5"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="A picture of the session: one glowing star per turn">${parts.join('')}</svg>`
}

function familyChart(d: ReportData): string {
  const fam = Object.entries(d.families).sort((a, b) => b[1] - a[1])
  if (!fam.length) return '<p class="empty">No tool calls this session.</p>'
  const W = 520
  const rowH = 30
  const H = fam.length * rowH + 6
  const top = Math.max(1, ...fam.map(([, n]) => n))
  const total = fam.reduce((s, [, n]) => s + n, 0)
  const rows = fam.map(([name, n], i) => {
    const y = i * rowH
    const c = FAMILY_COLOR[name] ?? KZ.mist
    const w = Math.max(4, (n / top) * (W - 190))
    return `<g><text x="0" y="${y + 19}" fill="#cfcbe8" font-size="13" font-weight="600">${esc(name)}</text>
<rect x="80" y="${y + 7}" width="${W - 190}" height="14" rx="7" fill="rgba(255,255,255,.06)"/>
<rect x="80" y="${y + 7}" width="${w.toFixed(1)}" height="14" rx="7" fill="${c}" filter="url(#fg)"/>
<text x="${W - 100}" y="${y + 19}" fill="${c}" font-size="13" font-weight="750">${num(n)}</text>
<text x="${W}" y="${y + 19}" fill="#6f6c8f" font-size="12" text-anchor="end">${Math.round((n / total) * 100)}%</text></g>`
  })
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tool calls by family"><defs><filter id="fg" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${rows.join('')}</svg>`
}

function contextChart(d: ReportData): string {
  const pts = d.ctxSeries
  if (pts.length < 2) return d.ctxPeakPercent !== undefined ? `<p class="dim">Peak ${Math.round(d.ctxPeakPercent)}% of the window.</p>` : '<p class="empty">No context readings yet.</p>'
  const W = 520
  const H = 120
  const span = Math.max(1, d.endedAt - d.startedAt)
  const xy = pts.map(([t, p]) => [(clamp01(t / span) * W).toFixed(1), (H - 8 - clamp01(p / 100) * (H - 16)).toFixed(1)])
  const line = xy.map(([x, y]) => `${x},${y}`).join(' ')
  // Two points at least, so there is a last one.
  const area = `M0,${H} L${xy.map(([x, y]) => `${x},${y}`).join(' L')} L${(xy[xy.length - 1] as string[])[0]},${H} Z`
  const grid = [25, 50, 75].map(p => `<line x1="0" x2="${W}" y1="${H - 8 - (p / 100) * (H - 16)}" y2="${H - 8 - (p / 100) * (H - 16)}" stroke="rgba(255,255,255,.07)" stroke-dasharray="3 5"/><text x="${W}" y="${H - 11 - (p / 100) * (H - 16)}" fill="#6f6c8f" font-size="10" text-anchor="end">${p}%</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Context fill over the session"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".5"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#cg)"/><polyline points="${line}" fill="none" stroke="${KZ.cyan}" stroke-width="2" stroke-linejoin="round"/></svg>`
}

function timelineStrip(d: ReportData): string {
  if (!d.turns.length) return ''
  const W = 1000
  const H = 46
  const span = Math.max(1, d.endedAt - d.startedAt)
  const maxUsd = Math.max(0.0001, ...d.turns.map(t => t.usd))
  const blocks = d.turns.map(t => {
    const x = clamp01((t.startedAt - d.startedAt) / span) * W
    const w = Math.max(3, (t.durationMs / span) * W)
    const k = t.usd / maxUsd
    const c = k > 0.66 ? KZ.amber : k > 0.33 ? KZ.magenta : KZ.violet
    return `<rect x="${x.toFixed(1)}" y="10" width="${w.toFixed(1)}" height="22" rx="4" fill="${c}" opacity="${(0.55 + 0.45 * k).toFixed(2)}"><title>Turn ${t.index}: ${esc(fmtClock(t.durationMs))}, ${t.tools} tools, ${esc(fmtUsd(t.usd))}</title></rect>`
  })
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:46px" role="img" aria-label="Turns across the session"><rect x="0" y="20" width="${W}" height="2" fill="rgba(255,255,255,.08)"/>${blocks.join('')}<text x="0" y="45" fill="#6f6c8f" font-size="10">0:00</text><text x="${W}" y="45" fill="#6f6c8f" font-size="10" text-anchor="end">${esc(fmtClock(span))}</text></svg>`
}

const barCell = (ratio: number, color: string): string => `<div class="bar" style="--c:${color}"><i style="width:${(clamp01(ratio) * 100).toFixed(1)}%"></i></div>`

export function buildHtml(d: ReportData, generatedAt: number): string {
  const dur = Math.max(0, d.endedAt - d.startedAt)
  const toks = totalTokens(d.tokens)
  const toolTotal = Object.values(d.families).reduce((s, n) => s + n, 0)
  const title = d.title || 'A Claude Code session'
  const cost = d.costUsd ?? d.turns.reduce((s, t) => s + t.usd, 0) + d.agents.reduce((s, a) => s + a.usd, 0)
  const kpi = (k: string, v: string, s: string, c: string) => `<div class="kpi" style="--c:${c}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`

  const tokenBar = toks
    ? `<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:6px">${(
        [['input', d.tokens.input, KZ.blue], ['output', d.tokens.output, KZ.magenta], ['cache read', d.tokens.cacheRead, KZ.teal], ['cache write', d.tokens.cacheWrite, KZ.amber]] as const
      ).map(([, n, c]) => `<i style="width:${((n / toks) * 100).toFixed(2)}%;background:${c}"></i>`).join('')}</div>
<div class="legend">${(
        [['input', d.tokens.input, KZ.blue], ['output', d.tokens.output, KZ.magenta], ['cache read', d.tokens.cacheRead, KZ.teal], ['cache write', d.tokens.cacheWrite, KZ.amber]] as const
      ).map(([k, n, c]) => `<span style="--c:${c}">${esc(k)} <b>${esc(fmtTokens(n))}</b></span>`).join('')}</div>`
    : '<p class="empty">No token counts yet.</p>'

  const limits = d.limits.length
    ? d.limits.map(l => {
        const c = l.percentUsed >= 85 ? KZ.red : l.percentUsed >= 60 ? KZ.amber : KZ.green
        const reset = l.resetsAt && Number.isFinite(Date.parse(l.resetsAt)) ? ` · resets ${stamp(Date.parse(l.resetsAt))}` : ''
        return `<div class="limit"><div class="row"><span><b>${esc(limitLabel(l.kind))}</b> <span class="mute">${esc(l.kind.replace(/_/g, ' '))}</span></span><span>${Math.round(l.percentUsed)}% <span class="mute">peak ${Math.round(l.peak)}%${esc(reset)}</span></span></div>${barCell(l.percentUsed / 100, c)}</div>`
      }).join('')
    : '<p class="empty">No rate-limit readings (none reported this session).</p>'

  const topTools = Object.entries(d.toolNames).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const toolTop = Math.max(1, ...topTools.map(([, n]) => n))
  const toolsTable = topTools.length
    ? `<table><thead><tr><th>Tool</th><th></th><th class="n">Calls</th></tr></thead><tbody>${topTools.map(([name, n]) => `<tr><td class="mono">${esc(name)}</td><td style="width:45%">${barCell(n / toolTop, FAMILY_COLOR[familyOf(name)] as string)}</td><td class="n">${num(n)}</td></tr>`).join('')}</tbody></table>`
    : ''

  const maxDur = Math.max(1, ...d.turns.map(t => t.durationMs))
  const turnsTable = d.turns.length
    ? `<div class="scroll"><table><thead><tr><th>#</th><th>Prompt</th><th>Duration</th><th></th><th class="n">Tools</th><th class="n">Tokens</th><th class="n">Cost</th></tr></thead><tbody>${d.turns.map(t => `<tr><td class="mute">${t.index}</td><td>${esc(oneLine(t.prompt || '(continuation)', 90))}${t.reason !== 'answer' ? ` <span class="pill" style="--c:${t.reason === 'running' ? KZ.cyan : t.reason === 'aborted' ? KZ.amber : KZ.red}">${esc(t.reason)}</span>` : ''}</td><td class="n mono">${esc(fmtClock(t.durationMs))}</td><td style="width:18%">${barCell(t.durationMs / maxDur, KZ.violet)}</td><td class="n">${num(t.tools)}</td><td class="n">${esc(fmtTokens(t.tokens))}</td><td class="n">${esc(fmtUsd(t.usd))}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">No turns yet.</p>'

  const agentsTable = d.agents.length
    ? `<div class="scroll"><table><thead><tr><th>Agent</th><th>Type</th><th>Model</th><th class="n">Time</th><th class="n">Tokens</th><th class="n">Cost</th><th>Status</th></tr></thead><tbody>${d.agents.map(a => {
        const c = a.status === 'failed' ? KZ.red : a.status === 'running' ? KZ.cyan : KZ.green
        return `<tr><td>${esc(oneLine(a.description || a.id, 60))}</td><td><span class="pill" style="--c:${KZ.violet}">${esc(a.type)}</span></td><td>${esc(modelName(a.model))}</td><td class="n mono">${esc(fmtClock(a.durationMs))}</td><td class="n">${esc(fmtTokens(a.tokens))}</td><td class="n">${esc(fmtUsd(a.usd))}</td><td><span class="pill" style="--c:${c}">${esc(a.status)}</span></td></tr>`
      }).join('')}</tbody></table></div>`
    : '<p class="empty">No subagents were spawned.</p>'

  const files = [...d.files].sort((a, b) => b.edits + b.writes - (a.edits + a.writes) || b.reads - a.reads).slice(0, 60)
  const fileTop = Math.max(1, ...files.map(f => f.reads + f.edits + f.writes))
  const filesTable = files.length
    ? `<div class="scroll"><table><thead><tr><th>File</th><th class="n">Read</th><th class="n">Edited</th><th class="n">Written</th><th></th></tr></thead><tbody>${files.map(f => `<tr><td class="mono" style="word-break:break-all">${esc(f.path)}</td><td class="n">${f.reads || ''}</td><td class="n">${f.edits || ''}</td><td class="n">${f.writes || ''}</td><td style="width:16%">${barCell((f.reads + f.edits + f.writes) / fileTop, f.edits + f.writes ? KZ.yellow : KZ.blue)}</td></tr>`).join('')}</tbody></table></div>${d.files.length > files.length ? `<p class="mute">and ${d.files.length - files.length} more</p>` : ''}`
    : '<p class="empty">No files were read or changed.</p>'

  const commands = d.commands.length
    ? `<div class="cmds">${d.commands.map(c => `<span class="cmd"><b class="mono">/${esc(c.name)}</b>${c.args ? ` <span class="dim">${esc(oneLine(c.args, 40))}</span>` : ''}<span class="t">${esc(fmtClock(c.at - d.startedAt))}</span></span>`).join('')}</div>`
    : '<p class="empty">No slash commands were run.</p>'

  const models = d.models.length > 1 ? `<span class="chip">also <b>${esc(d.models.filter(m => m !== d.model).map(modelName).join(', '))}</b></span>` : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(`Polaroid · ${oneLine(title, 60)}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<section class="hero">
  <figure class="polaroid" style="margin:0">
    ${snapshotArt(d)}
    <figcaption class="caption">${esc(oneLine(title, 42))}<small>${esc(stamp(d.startedAt))} · ${esc(fmtClock(dur))}</small></figcaption>
  </figure>
  <div>
    <div class="kicker">Session Polaroid</div>
    <h1 class="title">${esc(title)}</h1>
    <div class="chips">
      <span class="chip">model <b>${esc(modelName(d.model) || '—')}</b></span>${models}
      <span class="chip">Claude Code <b>${esc(d.version || '?')}</b></span>
      <span class="chip">from <b>${esc(stamp(d.startedAt))}</b> to <b>${esc(stamp(d.endedAt))}</b></span>
      ${d.root ? `<span class="chip mono">${esc(d.root)}</span>` : ''}
    </div>
    <div class="kpis">
      ${kpi('Duration', fmtClock(dur), `${d.turns.length} turns`, KZ.cyan)}
      ${kpi('Cost', fmtUsd(cost), d.costUsd === undefined ? 'estimated' : 'as /cost totals it', KZ.yellow)}
      ${kpi('Tokens', fmtTokens(toks), `${num(d.requests)} requests`, KZ.magenta)}
      ${kpi('Context peak', d.ctxPeakPercent !== undefined ? `${Math.round(d.ctxPeakPercent)}%` : '—', d.ctxPeakTokens !== undefined ? `${fmtTokens(d.ctxPeakTokens)} of ${fmtTokens(d.ctxWindow ?? 0)}` : '', KZ.blue)}
      ${kpi('Tool calls', num(toolTotal), d.toolErrors ? `${d.toolErrors} failed` : 'none failed', KZ.green)}
      ${kpi('Subagents', num(d.agents.length), `${d.files.length} files touched`, KZ.violet)}
    </div>
  </div>
</section>

<div class="grid">
  <section class="card" style="--accent:var(--cyan)"><h2>Context</h2>${contextChart(d)}<h2 style="margin-top:18px;--accent:var(--magenta)">Tokens</h2>${tokenBar}</section>
  <section class="card" style="--accent:var(--green)"><h2>Rate limits</h2>${limits}</section>
</div>

<div class="grid">
  <section class="card" style="--accent:var(--green)"><h2>Tools by family</h2>${familyChart(d)}</section>
  <section class="card" style="--accent:var(--blue)"><h2>Most-used tools</h2>${toolsTable || '<p class="empty">No tool calls this session.</p>'}</section>
</div>

<div class="grid">
  <section class="card wide" style="--accent:var(--violet)"><h2>Timeline of turns</h2>${timelineStrip(d)}${turnsTable}</section>
  <section class="card wide" style="--accent:var(--violet)"><h2>Subagents</h2>${agentsTable}</section>
  <section class="card" style="--accent:var(--yellow)"><h2>Files touched</h2>${filesTable}</section>
  <section class="card" style="--accent:var(--amber)"><h2>Commands run</h2>${commands}</section>
</div>

<footer>Shot by <b>KOZMOS Polaroid</b> · Claude Code ${esc(d.version || '?')} · ${esc(stamp(generatedAt))}</footer>
</main>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Markdown.

/** Escapes text for a Markdown table cell or line: pipes, backticks, markup, newlines. */
export function mdEsc(s: unknown): string {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/([\\`*_[\]|<>#])/g, '\\$1')
}

export function buildMarkdown(d: ReportData, generatedAt: number): string {
  const dur = Math.max(0, d.endedAt - d.startedAt)
  const toks = totalTokens(d.tokens)
  const cost = d.costUsd ?? d.turns.reduce((s, t) => s + t.usd, 0) + d.agents.reduce((s, a) => s + a.usd, 0)
  const toolTotal = Object.values(d.families).reduce((s, n) => s + n, 0)
  const L: string[] = []
  L.push(`# Session Polaroid: ${mdEsc(d.title || 'A Claude Code session')}`, '')
  L.push(`- **Model:** ${mdEsc(modelName(d.model) || '—')}${d.models.length > 1 ? ` (also ${mdEsc(d.models.filter(m => m !== d.model).map(modelName).join(', '))})` : ''}`)
  L.push(`- **Claude Code:** ${mdEsc(d.version || '?')}`)
  L.push(`- **When:** ${stamp(d.startedAt)} to ${stamp(d.endedAt)} (${fmtClock(dur)})`)
  if (d.root) L.push(`- **Project:** \`${d.root.replace(/`/g, "'")}\``)
  L.push(`- **Cost:** ${fmtUsd(cost)}${d.costUsd === undefined ? ' (estimated)' : ''}`)
  L.push(`- **Tokens:** ${fmtTokens(toks)} over ${d.requests} requests (input ${fmtTokens(d.tokens.input)}, output ${fmtTokens(d.tokens.output)}, cache read ${fmtTokens(d.tokens.cacheRead)}, cache write ${fmtTokens(d.tokens.cacheWrite)})`)
  L.push(`- **Context peak:** ${d.ctxPeakPercent !== undefined ? `${Math.round(d.ctxPeakPercent)}%` : '—'}${d.ctxPeakTokens !== undefined ? ` (${fmtTokens(d.ctxPeakTokens)} of ${fmtTokens(d.ctxWindow ?? 0)})` : ''}`)
  L.push(`- **Tool calls:** ${toolTotal}${d.toolErrors ? ` (${d.toolErrors} failed)` : ''}`, '')

  if (d.limits.length) {
    L.push('## Rate limits', '', '| Window | Used | Peak | Resets |', '| --- | ---: | ---: | --- |')
    for (const l of d.limits) L.push(`| ${mdEsc(limitLabel(l.kind))} | ${Math.round(l.percentUsed)}% | ${Math.round(l.peak)}% | ${l.resetsAt && Number.isFinite(Date.parse(l.resetsAt)) ? stamp(Date.parse(l.resetsAt)) : '—'} |`)
    L.push('')
  }
  const fam = Object.entries(d.families).sort((a, b) => b[1] - a[1])
  if (fam.length) {
    L.push('## Tools by family', '', '| Family | Calls | Share |', '| --- | ---: | ---: |')
    for (const [name, n] of fam) L.push(`| ${mdEsc(name)} | ${n} | ${Math.round((n / toolTotal) * 100)}% |`)
    L.push('')
  }
  L.push('## Timeline of turns', '')
  if (d.turns.length) {
    L.push('| # | Prompt | Duration | Tools | Tokens | Cost |', '| ---: | --- | ---: | ---: | ---: | ---: |')
    for (const t of d.turns) L.push(`| ${t.index} | ${mdEsc(oneLine(t.prompt || '(continuation)', 80))} | ${fmtClock(t.durationMs)} | ${t.tools} | ${fmtTokens(t.tokens)} | ${fmtUsd(t.usd)} |`)
  } else L.push('_No turns yet._')
  L.push('', '## Subagents', '')
  if (d.agents.length) {
    L.push('| Agent | Type | Model | Time | Tokens | Cost | Status |', '| --- | --- | --- | ---: | ---: | ---: | --- |')
    for (const a of d.agents) L.push(`| ${mdEsc(oneLine(a.description || a.id, 60))} | ${mdEsc(a.type)} | ${mdEsc(modelName(a.model))} | ${fmtClock(a.durationMs)} | ${fmtTokens(a.tokens)} | ${fmtUsd(a.usd)} | ${a.status} |`)
  } else L.push('_No subagents were spawned._')
  L.push('', '## Files touched', '')
  if (d.files.length) {
    L.push('| File | Read | Edited | Written |', '| --- | ---: | ---: | ---: |')
    for (const f of d.files) L.push(`| ${mdEsc(f.path)} | ${f.reads} | ${f.edits} | ${f.writes} |`)
  } else L.push('_No files were read or changed._')
  L.push('', '## Commands run', '')
  if (d.commands.length) for (const c of d.commands) L.push(`- ${fmtClock(c.at - d.startedAt)} \`/${c.name.replace(/`/g, "'")}\`${c.args ? ` ${mdEsc(oneLine(c.args, 60))}` : ''}`)
  else L.push('_No slash commands were run._')
  L.push('', `---`, `Shot by KOZMOS Polaroid · ${stamp(generatedAt)}`, '')
  return L.join('\n')
}
