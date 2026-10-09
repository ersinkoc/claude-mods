// Terminus: pure helpers (no `$`): reading a shell call's outcome, and the
// desktop drawings. register.tsx owns the hooks and the terminal tree.
import type { ShellRun, ShellStatus, TerminusFilter, TerminusSnap } from '../types'
import { KZ, clip, fitText, heat, svg, svgText, xml } from './lib/kz.ts'

export const SLOW_MS = 10_000
export const MAX_RUNS = 300
export const MAX_COMMAND = 2000

export const emptySnap = (): TerminusSnap => ({ runs: [], total: 0, failures: 0, slow: 0, totalMs: 0 })

/** The directory a command runs in: an explicit `cwd` input, else a leading `cd <dir> &&` / `;`. */
export function cwdOf(command: string, input: Record<string, unknown>): string | undefined {
  for (const k of ['cwd', 'workdir', 'directory']) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const m = /^\s*(?:cd|Set-Location|pushd)\s+(?:-LiteralPath\s+|-Path\s+)?("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\|\|)/i.exec(command)
  if (!m) return undefined
  return m[2] ?? m[3] ?? m[4]
}

const DENIED = /doesn't want to proceed|did not want to proceed|was rejected|permission to use .* (?:was|has been) denied|denied by|not allowed|blocked by/i

/** The first line of an error that says something: not "Exit code N", preferring one that names a failure. */
export function tellingLine(text: string): string {
  const lines = text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^exit code:?\s*-?\d+$/i.test(l) && !/^<\/?[a-z_-]+>$/i.test(l))
  const loud = lines.find(l => /error|fail|fatal|not found|cannot|can't|unable|denied|refused|exception|no such|invalid|timed? ?out|killed|panic/i.test(l))
  return clip(loud ?? lines[0] ?? '', 160)
}

type Ran = { result?: unknown; isError?: boolean; deny?: string; text?: string }

/** What a finished `tool.call` says about the run: its status, exit code, error and output size. */
export function outcomeOf(ran: Ran): { status: ShellStatus; exit?: number; error?: string; outBytes: number } {
  if (typeof ran.deny === 'string') return { status: 'denied', error: clip(ran.deny, 160), outBytes: ran.deny.length }
  const r = (ran.result ?? {}) as Record<string, unknown>
  if (ran.isError) {
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
    const code = /exit code:?\s*(-?\d+)/i.exec(text)
    const isDenied = DENIED.test(text)
    return {
      status: isDenied ? 'denied' : 'fail',
      exit: code ? Number(code[1]) : undefined,
      // A denial always leaves its telling line; only a bare exit code falls back.
      error: tellingLine(text) || 'failed',
      outBytes: text.length,
    }
  }
  const out = typeof r.stdout === 'string' ? r.stdout.length : 0
  const err = typeof r.stderr === 'string' ? r.stderr.length : 0
  const persisted = typeof r.persistedOutputSize === 'number' ? r.persistedOutputSize : 0
  const outBytes = persisted || out + err || (typeof ran.text === 'string' ? ran.text.length : 0)
  if (r.interrupted === true) return { status: 'fail', error: 'interrupted', outBytes }
  if (typeof r.backgroundTaskId === 'string') return { status: 'bg', outBytes }
  const note = typeof r.returnCodeInterpretation === 'string' ? r.returnCodeInterpretation : undefined
  return { status: 'ok', exit: 0, error: note ? clip(note, 160) : undefined, outBytes }
}

/** A command's first line (a heredoc or a script shows its head). */
export const firstLine = (s: string): string => s.replace(/\n[\s\S]*/, '')

export const isFailed = (r: ShellRun): boolean => r.status === 'fail' || r.status === 'denied'
export const isSlow = (r: ShellRun): boolean => (r.ms ?? 0) > SLOW_MS

export function matches(r: ShellRun, f: TerminusFilter): boolean {
  return f === 'all' || (f === 'failed' ? isFailed(r) : isSlow(r))
}

/** 420ms, 4.2s, 1m07s. */
export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '…'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** 812B, 4.1k, 2.3M characters of output. */
export function fmtSize(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n < 1000) return `${n}B`
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

/** 14:03:22 local time. */
export function clockOf(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function statusColor(s: ShellStatus): string {
  return s === 'ok' ? KZ.green : s === 'fail' ? KZ.red : s === 'denied' ? KZ.amber : s === 'bg' ? KZ.blue : KZ.violet
}

export function statusGlyph(s: ShellStatus): string {
  return s === 'ok' ? '✓' : s === 'fail' ? '✖' : s === 'denied' ? '⊘' : s === 'bg' ? '◔' : '●'
}

/** Duration heat: green under a second, red past 30 s. */
export const durHeat = (ms: number | undefined): string => (ms === undefined ? KZ.violet : heat(Math.log10(Math.max(1, ms / 300)) / 2))

/** The bottom-line of an error or a status, for a row's third line. */
export function statusLine(r: ShellRun): string {
  if (r.status === 'running') return 'running…'
  if (r.status === 'bg') return 'running in the background'
  const code = r.exit !== undefined && r.exit !== 0 ? `exit ${r.exit}` : r.status === 'denied' ? 'denied' : r.status === 'fail' ? 'failed' : ''
  return [code, r.error ?? ''].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------
// Desktop drawings: one Svg for the header, one per run.

export function headerSvg(s: TerminusSnap, W: number): { source: string; height: number } {
  const H = 132
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${KZ.green}" stop-opacity=".16"/><stop offset="1" stop-color="${KZ.cyan}" stop-opacity=".04"/></linearGradient></defs>`)
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#tg)"/>`)
  parts.push(`<rect x="14" y="14" width="26" height="26" rx="7" fill="${KZ.green}" opacity=".18"/>`)
  parts.push(svgText(27, 32, '$_', { size: 13, weight: 800, anchor: 'middle', fill: KZ.green, mono: true }))
  parts.push(svgText(50, 26, 'TERMINUS', { size: 13, weight: 800 }))
  parts.push(svgText(50, 40, 'shell history of this session', { cls: 'm', size: 10.5 }))
  const running = s.runs.filter(r => r.status === 'running').length
  if (running) parts.push(`<circle cx="${W - 20}" cy="24" r="5" fill="${KZ.violet}" class="pulse"/>` + svgText(W - 30, 28, `${running} running`, { size: 10.5, weight: 600, anchor: 'end', fill: KZ.violet }))

  const tiles: [string, string, string][] = [
    ['COMMANDS', String(s.total), KZ.green],
    ['FAILED', String(s.failures), s.failures ? KZ.red : KZ.mist],
    ['SHELL TIME', fmtMs(s.totalMs), KZ.cyan],
  ]
  const tw = (W - 28 - 12) / 3
  tiles.forEach(([k, v, c], i) => {
    const x = 14 + i * (tw + 6)
    parts.push(`<rect class="k" x="${x}" y="52" width="${tw}" height="40" rx="9" opacity=".7"/>`)
    parts.push(`<rect x="${x + 8}" y="60" width="3" height="24" rx="1.5" fill="${c}"/>`)
    parts.push(svgText(x + 17, 69, k, { cls: 's', size: 9, weight: 600 }))
    parts.push(svgText(x + 17, 85, v, { size: 14, weight: 750 }))
  })

  // Duration bars of the last runs, oldest left, colored by status.
  const last = s.runs.slice(0, 48).reverse()
  const gx = 14
  const gw = W - 28
  const gy = 100
  const gh = 22
  if (last.length) {
    const bw = Math.min(10, gw / 48)
    const top = Math.max(1, ...last.map(r => Math.log10(1 + (r.ms ?? 0) / 100)))
    last.forEach((r, i) => {
      const h = Math.max(2, (Math.log10(1 + (r.ms ?? 0) / 100) / top) * gh)
      const x = gx + gw - (last.length - i) * bw
      parts.push(`<rect x="${(x + 1).toFixed(1)}" y="${(gy + gh - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${statusColor(r.status)}" opacity="${r.status === 'running' ? 1 : 0.8}" class="${r.status === 'running' ? 'pulse' : ''}"><title>${xml(clip(r.command, 80))}</title></rect>`)
    })
  } else {
    parts.push(svgText(W / 2, gy + 15, 'no shell commands yet', { cls: 'm', size: 10.5, anchor: 'middle' }))
  }
  parts.push(svgText(gx, gy + gh + 9, s.slow ? `${s.slow} slower than 10 s` : 'durations, last 48', { cls: 'm', size: 8.5 }))
  return { source: svg(W, H + 2, parts.join('')), height: H + 2 }
}

export function runSvg(r: ShellRun, W: number): { source: string; height: number } {
  const c = statusColor(r.status)
  const sub = statusLine(r)
  const hasSub = r.status !== 'ok' || !!r.error
  const H = hasSub ? 66 : 52
  const parts: string[] = []
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="10"/>`)
  parts.push(`<rect width="4" height="${H}" rx="2" fill="${c}" class="${r.status === 'running' ? 'pulse' : ''}"/>`)
  parts.push(svgText(14, 19, statusGlyph(r.status), { size: 12, weight: 800, fill: c }))
  const right = `${fmtMs(r.ms)}`
  parts.push(svgText(W - 10, 19, right, { size: 11.5, weight: 700, anchor: 'end', fill: durHeat(r.ms) }))
  parts.push(svgText(30, 19, fitText(`$ ${firstLine(r.command)}`, 11.5, W - 96), { size: 11.5, weight: 600, mono: true }))
  const meta = [clockOf(r.at), fmtSize(r.outBytes), r.who, r.cwd ? `⌂ ${r.cwd}` : ''].filter(Boolean).join(' · ')
  parts.push(svgText(30, 35, fitText(r.description ?? (r.tool === 'PowerShell' ? 'PowerShell' : 'Bash'), 10.5, W - 40), { cls: 's', size: 10.5 }))
  parts.push(svgText(30, 49, fitText(meta, 9.5, W - 40), { cls: 'm', size: 9.5 }))
  if (hasSub) parts.push(svgText(30, 61, fitText(sub, 10, W - 40), { size: 10, weight: 600, fill: r.status === 'ok' ? KZ.mist : c, mono: true }))
  return { source: svg(W, H, parts.join('')), height: H }
}

export function altOf(r: ShellRun): string {
  return `${r.status} ${r.tool}: ${clip(r.command, 120)}${r.description ? ` (${r.description})` : ''}, ${fmtMs(r.ms)}, by ${r.who}${r.error ? `; ${r.error}` : ''}`
}
