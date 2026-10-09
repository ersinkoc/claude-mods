// Switchboard's ledger: pure bookkeeping of MCP servers, tools and calls.
// No `$` here; register.tsx feeds it names, times and outcomes.

import type { SwitchServer, SwitchSnap, SwitchStatus, SwitchTool } from '../types'

/** A call within this long keeps a server lit as healthy; older is idle. */
export const RECENT_MS = 5 * 60_000
const SAMPLES = 200

/** `mcp__github__search_code` → `{ server: 'github', tool: 'search_code' }`. */
export function splitMcp(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const at = rest.indexOf('__')
  if (at <= 0) return { server: rest || '?', tool: '' }
  return { server: rest.slice(0, at), tool: rest.slice(at + 2) }
}

type ToolLedger = {
  name: string
  isListed: boolean
  calls: number
  errors: number
  ms: number[]
  lastAt: number | null
  lastOk: boolean[]
  inFlight: number
}

type ServerLedger = {
  name: string
  tools: Map<string, ToolLedger>
  lastTool: string | null
  lastAt: number | null
  lastError: string | null
  recent: boolean[]
}

export class Board {
  private servers = new Map<string, ServerLedger>()

  private server(name: string): ServerLedger {
    let s = this.servers.get(name)
    if (!s) {
      s = { name, tools: new Map(), lastTool: null, lastAt: null, lastError: null, recent: [] }
      this.servers.set(name, s)
    }
    return s
  }

  private tool(s: ServerLedger, name: string): ToolLedger {
    let t = s.tools.get(name)
    if (!t) {
      t = { name, isListed: false, calls: 0, errors: 0, ms: [], lastAt: null, lastOk: [], inFlight: 0 }
      s.tools.set(name, t)
    }
    return t
  }

  /** The tool list as it stands: names the model can call now. */
  list(names: readonly string[]): void {
    for (const s of this.servers.values()) for (const t of s.tools.values()) t.isListed = false
    for (const n of names) {
      const p = splitMcp(n)
      if (!p) continue
      this.tool(this.server(p.server), p.tool).isListed = true
    }
  }

  start(name: string): void {
    const p = splitMcp(name)
    if (!p) return
    this.tool(this.server(p.server), p.tool).inFlight++
  }

  finish(name: string, at: number, ms: number, isError: boolean, error?: string): void {
    const p = splitMcp(name)
    if (!p) return
    const s = this.server(p.server)
    const t = this.tool(s, p.tool)
    t.inFlight = Math.max(0, t.inFlight - 1)
    t.calls++
    if (isError) t.errors++
    t.ms = [...t.ms, Math.max(0, ms)].slice(-SAMPLES)
    t.lastAt = at
    s.lastAt = at
    s.lastTool = p.tool
    s.recent = [...s.recent, !isError].slice(-5)
    if (isError) s.lastError = error ? error.slice(0, 160) : 'error'
  }

  snapshot(now: number): SwitchSnap {
    const servers = [...this.servers.values()].map(s => serverRow(s, now))
    servers.sort((a, b) => rank(b.status) - rank(a.status) || (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.name.localeCompare(b.name))
    return {
      servers,
      calls: servers.reduce((n, s) => n + s.calls, 0),
      errors: servers.reduce((n, s) => n + s.errors, 0),
      now,
    }
  }
}

const rank = (s: SwitchStatus): number => (s === 'erroring' ? 3 : s === 'busy' ? 2 : s === 'healthy' ? 1 : 0)

export function avgOf(ms: readonly number[]): number | null {
  return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null
}

/** The 95th percentile, nearest rank. */
export function p95Of(ms: readonly number[]): number | null {
  if (!ms.length) return null
  const sorted = [...ms].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null
}

/** Erroring when the last call failed or two of the last five did. */
export function statusOf(recent: readonly boolean[], lastAt: number | null, inFlight: number, now: number): SwitchStatus {
  const fails = recent.filter(ok => !ok).length
  if (recent.length && (recent[recent.length - 1] === false || fails >= 2)) return 'erroring'
  if (inFlight > 0) return 'busy'
  if (lastAt !== null && now - lastAt < RECENT_MS) return 'healthy'
  return 'idle'
}

function serverRow(s: ServerLedger, now: number): SwitchServer {
  const tools: SwitchTool[] = [...s.tools.values()]
    .map(t => ({ name: t.name, isListed: t.isListed, calls: t.calls, errors: t.errors, avgMs: avgOf(t.ms), p95Ms: p95Of(t.ms), lastAt: t.lastAt, inFlight: t.inFlight }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
  const all = [...s.tools.values()].flatMap(t => t.ms)
  const inFlight = tools.reduce((n, t) => n + t.inFlight, 0)
  return {
    name: s.name,
    toolCount: tools.filter(t => t.isListed).length,
    calls: tools.reduce((n, t) => n + t.calls, 0),
    errors: tools.reduce((n, t) => n + t.errors, 0),
    avgMs: avgOf(all),
    p95Ms: p95Of(all),
    lastAt: s.lastAt,
    lastTool: s.lastTool,
    lastError: s.lastError,
    inFlight,
    status: statusOf(s.recent, s.lastAt, inFlight, now),
    tools,
  }
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}
