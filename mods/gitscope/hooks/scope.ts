// gitscope's own pure helpers: paths, untracked files, ages, diff bars.
// No `$` here; register.tsx runs git and hands the text over.

/** Forward slashes, msys `/d/x` → `d:/x`, no trailing slash; lowercased for Windows drive paths. */
export function normPath(p: string): string {
  let s = p.trim().replace(/\\/g, '/')
  const msys = /^\/([a-zA-Z])\//.exec(s)
  if (msys) s = `${msys[1]}:/${s.slice(3)}`
  s = s.replace(/\/+$/, '')
  if (/^[a-zA-Z]:\//.test(s)) s = s.toLowerCase()
  return s
}

export function isAbsolute(p: string): boolean {
  return /^([a-zA-Z]:)?[\\/]/.test(p)
}

/** `abs` relative to `root` (both normalized), or undefined when outside it. */
export function relTo(root: string, abs: string): string | undefined {
  const r = normPath(root)
  const a = normPath(abs)
  if (!r) return undefined
  if (a === r) return ''
  return a.startsWith(r + '/') ? a.slice(r.length + 1) : undefined
}

/** Untracked paths from `git status --porcelain=v2` output (`? path`). */
export function untrackedOf(status: string): string[] {
  return status
    .split('\n')
    .filter(l => l.startsWith('? '))
    .map(l => l.slice(2).trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

/** `now`, `4m`, `3h`, `2d`, `5w`, `7mo`, `2y`: a commit's age. */
export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.round(d / 7)}w`
  if (d < 365) return `${Math.round(d / 30)}mo`
  return `${Math.round(d / 365)}y`
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A run of `cells` (fractional) width in eighth blocks, no padding. */
export function blocks(cells: number): string {
  const c = Math.max(0, cells)
  const full = Math.floor(c)
  const part = EIGHTHS[Math.round((c - full) * 8) % 8] ?? ''
  return '█'.repeat(full) + part
}

/**
 * The +/− histogram of one file: green cells for added lines, red for
 * removed, scaled against the largest file; a non-zero side shows at least
 * an eighth.
 */
export function diffBar(added: number, removed: number, max: number, width: number): { add: string; rem: string } {
  const top = Math.max(1, max)
  const a = added > 0 ? Math.max(0.125, (added / top) * width) : 0
  const r = removed > 0 ? Math.max(0.125, (removed / top) * width) : 0
  return { add: blocks(a), rem: blocks(r) }
}

/** Splits a repo path into its folder (with slash) and file name. */
export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) }
}
