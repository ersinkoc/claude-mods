/** What kind of step on the web: a search, a fetched page, a browser-like MCP tool visit. */
export type CrumbKind = 'search' | 'fetch' | 'browse'

export type CrumbHit = { title: string; url: string }

/** One web step of the session (WebSearch, WebFetch, a browser-like MCP tool). */
export type Crumb = {
  id: string
  kind: CrumbKind
  /** The tool that made it (`WebFetch`, `WebSearch`, `mcp__…`). */
  tool: string
  /** When it started, `$.clock.now()` milliseconds. */
  at: number
  /** How long it took; absent while it runs. */
  ms?: number
  /** The group: the host without `www.`, or `search` for searches. */
  domain: string
  /** The URL visited (the final one after redirects, when the result says). */
  url?: string
  /** Path and query of `url`, for the row label. */
  path?: string
  /** The search query. */
  query?: string
  /** How many results the search said it found. */
  results?: number
  /** The first few search hits. */
  hits?: CrumbHit[]
  /** HTTP status and its text, when the fetch said. */
  status?: number
  statusText?: string
  /** Size of the fetched content in bytes, when the fetch said. */
  bytes?: number
  isRunning: boolean
  isError: boolean
  /** The first line of the error. */
  error?: string
  /** `main`, or the subagent's description. */
  who: string
}

export type BreadcrumbsSnap = {
  /** Newest first, at most 300. */
  crumbs: Crumb[]
  searches: number
  fetches: number
  browses: number
  failures: number
}

export type BreadcrumbsView = {
  /** Domains folded to their header. */
  folded: string[]
}

declare module 'claude-code' {
  interface PluginState {
    breadcrumbs: { snap: BreadcrumbsSnap | null; view: BreadcrumbsView }
  }
}
