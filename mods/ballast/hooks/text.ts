// Ballast's words: pure, no `$`.
import { fmtTokens } from './lib/kz.ts'

/** The toast after a compaction: before → after when both are known. */
export function compactedText(before: number | null, after: number | null): string {
  if (before && after !== null) {
    const cut = Math.round((1 - after / before) * 100)
    return `⚓ compacted: ${fmtTokens(before)} → ${fmtTokens(after)} tokens (−${Math.max(0, cut)}%)`
  }
  if (after !== null) return `⚓ compacted: now ${fmtTokens(after)} tokens`
  return '⚓ compacted.'
}

/** A failure as one line of text. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
