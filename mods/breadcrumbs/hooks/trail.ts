// Breadcrumbs: pure helpers (no `$`): reading web tool calls, grouping by
// domain, Markdown export and the desktop drawings.
import type { BreadcrumbsSnap, Crumb, CrumbHit, CrumbKind } from '../types'
import { KZ, clip, fitText, hash, hue, svg, svgText, xml } from './lib/kz.ts'

export const MAX_CRUMBS = 300
export const MAX_HITS = 5
export const SEARCH = 'search'

export const emptySnap = (): BreadcrumbsSnap => ({ crumbs: [], searches: 0, fetches: 0, browses: 0, failures: 0 })

const BROWSER_TOOL = /browser|chrome|playwright|puppeteer|navigate|firecrawl|scrape|crawl|fetch|web/i

/** Whether a tool call is a web step, and what it asks for. */
export function classify(tool: string, input: Record<string, unknown>): { kind: CrumbKind; url?: string; query?: string } | undefined {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
  if (tool === 'WebFetch') return str('url') ? { kind: 'fetch', url: str('url') } : undefined
  if (tool === 'WebSearch') return { kind: 'search', query: str('query') }
  if (!tool.startsWith('mcp__')) return undefined
  const url = str('url') || str('href') || str('uri')
  if (url && /^https?:\/\//i.test(url)) return { kind: 'browse', url }
  if (/search/i.test(tool) && (str('query') || str('q'))) return { kind: 'search', query: str('query') || str('q') }
  if (url && BROWSER_TOOL.test(tool)) return { kind: 'browse', url }
  return undefined
}

/** `https://www.github.com/a/b?q=1` → `github.com`, `/a/b?q=1`. */
export function splitUrl(url: string): { domain: string; path: string } {
  try {
    const u = new URL(url)
    const domain = u.hostname.replace(/^www\./i, '').toLowerCase() || u.protocol.replace(/:$/, '')
    const path = `${u.pathname}${u.search}` || '/'
    return { domain, path }
  } catch {
    const m = /^(?:[a-z]+:\/\/)?(?:www\.)?([^/?#\s]+)(.*)$/i.exec(url)
    return { domain: (m?.[1] ?? url).toLowerCase(), path: m?.[2] || '/' }
  }
}

/** What a WebSearch result says: how many hits, and the first few. */
export function searchOutcome(result: unknown): { results?: number; hits: CrumbHit[] } {
  const r = (result ?? {}) as Record<string, unknown>
  const blocks = Array.isArray(r.results) ? (r.results as unknown[]) : []
  const hits: CrumbHit[] = []
  let n = 0
  let sawList = false
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    const content = (b as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    sawList = true
    for (const c of content) {
      const hit = c as Record<string, unknown>
      if (typeof hit.url !== 'string') continue
      n++
      if (hits.length < MAX_HITS) hits.push({ title: clip(typeof hit.title === 'string' && hit.title ? hit.title : hit.url, 90), url: hit.url })
    }
  }
  return { results: sawList ? n : undefined, hits }
}

/** What a WebFetch result says: status, size and the URL it ended at. */
export function fetchOutcome(result: unknown): { status?: number; statusText?: string; bytes?: number; url?: string } {
  const r = (result ?? {}) as Record<string, unknown>
  return {
    status: typeof r.code === 'number' ? r.code : undefined,
    statusText: typeof r.codeText === 'string' && r.codeText ? r.codeText : undefined,
    bytes: typeof r.bytes === 'number' ? r.bytes : undefined,
    url: typeof r.url === 'string' && r.url ? r.url : undefined,
  }
}

/** An error's first line, and the HTTP status it names. */
export function errorOutcome(text: string): { status?: number; error: string } {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? 'failed'
  const m = /\b(?:status(?: code)?|HTTP)\s*:?\s*([1-5]\d\d)\b/i.exec(text)
  return { status: m ? Number(m[1]) : undefined, error: clip(line, 140) }
}

/** Two letters for a domain: `docs.python.org` → `Py`, `github.com` → `Gi`. */
export function monogram(domain: string): string {
  if (domain === SEARCH) return '⌕'
  const parts = domain.split('.').filter(Boolean)
  let main = parts[0] ?? domain
  if (parts.length >= 2) {
    main = parts[parts.length - 2] as string
    if (parts.length >= 3 && /^(co|com|org|net|ac|gov|edu|ne|or)$/.test(main)) main = parts[parts.length - 3] as string
  }
  const letters = main.replace(/[^a-z0-9]/gi, '')
  return (letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase()) || '·'
}

export function domainColor(domain: string): string {
  return domain === SEARCH ? KZ.cyan : hue((hash(domain) % 997) / 997, 0.62, 0.58)
}

export function statusColor(c: Crumb): string {
  if (c.isRunning) return KZ.violet
  if (c.isError || (c.status ?? 0) >= 400) return KZ.red
  if ((c.status ?? 0) >= 300) return KZ.amber
  return KZ.green
}

export type Group = { domain: string; crumbs: Crumb[]; last: number; failures: number; bytes: number }

/** Crumbs grouped by domain, the most recently visited group first. */
export function groupsOf(crumbs: readonly Crumb[]): Group[] {
  const by = new Map<string, Group>()
  for (const c of crumbs) {
    let g = by.get(c.domain)
    if (!g) {
      g = { domain: c.domain, crumbs: [], last: 0, failures: 0, bytes: 0 }
      by.set(c.domain, g)
    }
    g.crumbs.push(c)
    g.last = Math.max(g.last, c.at)
    if (c.isError) g.failures++
    g.bytes += c.bytes ?? 0
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined) return ''
  if (n < 1000) return `${n} B`
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`
  return `${(n / 1e6).toFixed(1)} MB`
}

export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '…'
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

export function clockOf(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The status cell of a row: `200`, `404`, `ERR`, `…`. */
export function statusLabel(c: Crumb): string {
  if (c.isRunning) return '…'
  if (c.status !== undefined) return String(c.status)
  return c.isError ? 'ERR' : c.kind === 'browse' ? 'ok' : '—'
}

/** One row's text: `14:09 · 200 · 12 kB · /path`. */
export function rowLabel(c: Crumb): string {
  // A search always has its query; a visit always has its URL's path.
  if (c.kind === 'search') return `⌕ “${c.query}”${c.results !== undefined ? ` · ${c.results} results` : ''}`
  return [statusLabel(c), fmtBytes(c.bytes), c.path].filter(Boolean).join(' · ')
}

/** The whole trail as a nested Markdown list, grouped by domain. */
export function toMarkdown(snap: BreadcrumbsSnap): string {
  const lines: string[] = []
  for (const g of groupsOf(snap.crumbs)) {
    lines.push(`- **${g.domain === SEARCH ? 'Web search' : g.domain}**`)
    for (const c of [...g.crumbs].reverse()) {
      if (c.kind === 'search') {
        lines.push(`  - 🔎 "${c.query}"${c.results !== undefined ? ` (${c.results} results)` : ''}`)
        for (const h of c.hits ?? []) lines.push(`    - [${h.title.replace(/[[\]]/g, '')}](${h.url})`)
      } else {
        // A visit always has its URL and that URL's path.
        const bits = [c.status !== undefined ? String(c.status) : c.isError ? 'error' : '', fmtBytes(c.bytes)].filter(Boolean).join(', ')
        lines.push(`  - [${(c.path as string).replace(/[[\]]/g, '')}](${c.url})${bits ? ` — ${bits}` : ''}`)
      }
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Desktop drawings.

export function headerSvg(s: BreadcrumbsSnap, groups: readonly Group[], W: number): { source: string; height: number } {
  const H = 118
  const parts: string[] = []
  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${KZ.cyan}" stop-opacity=".15"/><stop offset="1" stop-color="${KZ.violet}" stop-opacity=".06"/></linearGradient></defs>`)
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="14"/><rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>`)
  // A dotted trail with footprints.
  parts.push(`<path d="M16 34 C 30 18, 42 44, 58 28" fill="none" stroke="${KZ.cyan}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>`)
  parts.push(`<circle cx="58" cy="28" r="4" fill="${KZ.cyan}" class="pulse"/>`)
  parts.push(svgText(70, 26, 'BREADCRUMBS', { size: 13, weight: 800 }))
  parts.push(svgText(70, 40, 'the web trail of this session', { cls: 'm', size: 10.5 }))
  const tiles: [string, number, string][] = [
    ['FETCHES', s.fetches, KZ.cyan],
    ['SEARCHES', s.searches, KZ.violet],
    ['DOMAINS', groups.filter(g => g.domain !== SEARCH).length, KZ.teal],
    ['FAILED', s.failures, s.failures ? KZ.red : KZ.mist],
  ]
  const tw = (W - 28 - 18) / 4
  tiles.forEach(([k, v, c], i) => {
    const x = 14 + i * (tw + 6)
    parts.push(`<rect class="k" x="${x}" y="52" width="${tw}" height="36" rx="9" opacity=".7"/>`)
    parts.push(svgText(x + tw / 2, 66, k, { cls: 's', size: 8.5, weight: 650, anchor: 'middle' }))
    parts.push(svgText(x + tw / 2, 82, String(v), { size: 13.5, weight: 750, anchor: 'middle', fill: c }))
  })
  // Share of visits per domain.
  const total = s.crumbs.length
  let x = 14
  const bw = W - 28
  if (total) {
    for (const g of groups) {
      const w = (g.crumbs.length / total) * bw
      parts.push(`<rect x="${x.toFixed(1)}" y="98" width="${Math.max(1, w - 1.5).toFixed(1)}" height="8" rx="3" fill="${domainColor(g.domain)}"><title>${xml(`${g.domain}: ${g.crumbs.length}`)}</title></rect>`)
      x += w
    }
  } else {
    parts.push(`<rect class="k" x="14" y="98" width="${bw}" height="8" rx="3"/>`)
  }
  return { source: svg(W, H + 2, parts.join('')), height: H + 2 }
}

export function groupSvg(g: Group, W: number, isFolded: boolean): { source: string; height: number } {
  const H = 50
  const c = domainColor(g.domain)
  const parts: string[] = []
  parts.push(`<rect class="p" width="${W}" height="${H}" rx="12"/>`)
  parts.push(`<circle cx="26" cy="25" r="15" fill="${c}"/>`)
  const mono = monogram(g.domain)
  parts.push(svgText(26, 30, mono, { size: mono.length > 1 ? 12 : 15, weight: 800, anchor: 'middle', fill: '#111' }))
  const label = g.domain === SEARCH ? 'Web search' : g.domain
  const countText = `${g.crumbs.length} ${g.domain === SEARCH ? (g.crumbs.length === 1 ? 'query' : 'queries') : g.crumbs.length === 1 ? 'visit' : 'visits'}`
  parts.push(svgText(50, 22, fitText(label, 13, W - 140), { size: 13, weight: 700 }))
  const meta = [countText, `last ${clockOf(g.last)}`, g.bytes ? fmtBytes(g.bytes) : '', g.failures ? `${g.failures} failed` : ''].filter(Boolean).join(' · ')
  parts.push(svgText(50, 38, fitText(meta, 10, W - 120), { cls: 'm', size: 10 }))
  // Status dots, oldest left.
  const dots = [...g.crumbs].slice(0, 12).reverse()
  let dx = W - 14 - dots.length * 9
  for (const d of dots) {
    const sc = statusColor(d)
    parts.push(`<circle cx="${dx + 4}" cy="25" r="3.4" fill="${sc}" class="${d.isRunning ? 'pulse' : ''}"/>`)
    dx += 9
  }
  if (isFolded) parts.push(svgText(W - 14, 42, 'folded', { cls: 'm', size: 9, anchor: 'end' }))
  return { source: svg(W, H, parts.join('')), height: H }
}

export function altOfGroup(g: Group): string {
  return `${g.domain === SEARCH ? 'Web search' : g.domain}: ${g.crumbs.length} steps, last at ${clockOf(g.last)}${g.failures ? `, ${g.failures} failed` : ''}`
}
