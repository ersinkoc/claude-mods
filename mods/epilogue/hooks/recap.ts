// Epilogue's bookkeeping, pure: tool families, the running tally of a turn,
// and the recap it becomes.
import type { EpilogueRecap } from '../types'
import { KZ, baseName, costOf, tokensOf } from './lib/kz.ts'
import type { Usage } from './lib/kz.ts'

export type Family = 'edit' | 'shell' | 'read' | 'agent' | 'web' | 'tasks' | 'mcp' | 'other'

export const FAMILIES: Record<Family, { label: string; glyph: string; color: string }> = {
  edit: { label: 'Edit', glyph: '✎', color: KZ.yellow },
  shell: { label: 'Shell', glyph: '$', color: KZ.green },
  read: { label: 'Read', glyph: '◉', color: KZ.blue },
  agent: { label: 'Agent', glyph: '◈', color: KZ.violet },
  web: { label: 'Web', glyph: '◍', color: KZ.cyan },
  tasks: { label: 'Tasks', glyph: '☑', color: KZ.teal },
  mcp: { label: 'MCP', glyph: '⬡', color: KZ.magenta },
  other: { label: 'Other', glyph: '•', color: KZ.mist },
}

export const FAMILY_ORDER: readonly Family[] = ['edit', 'shell', 'read', 'agent', 'web', 'tasks', 'mcp', 'other']

export function familyOf(tool: string): Family {
  const t = String(tool)
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit' || t === 'MultiEdit') return 'edit'
  if (t === 'Bash' || t === 'PowerShell' || t === 'Monitor') return 'shell'
  if (t === 'Read' || t === 'Glob' || t === 'Grep' || t === 'LSP' || t === 'ToolSearch') return 'read'
  if (t === 'Agent' || t === 'Task' || t === 'Workflow' || t === 'SendMessage') return 'agent'
  if (t.startsWith('Web')) return 'web'
  if (t.startsWith('Todo') || t.startsWith('Task')) return 'tasks'
  if (t.startsWith('mcp__')) return 'mcp'
  return 'other'
}

/** The file a tool call writes, when it writes one. */
export function writtenFile(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit' && tool !== 'MultiEdit') return undefined
  const p = input.file_path ?? input.notebook_path
  return typeof p === 'string' && p ? p : undefined
}

export type Tally = {
  turnId: string
  startedAt: number
  prompt: string
  costAtStart?: number
  tools: Partial<Record<Family, number>>
  files: string[]
  agents: number
  failed: { tool: string; detail: string }[]
  usage: Required<Usage>
  estUsd: number
  steps: number
}

export function newTally(turnId: string, startedAt: number, prompt: string, costAtStart?: number): Tally {
  return {
    turnId,
    startedAt,
    prompt,
    costAtStart,
    tools: {},
    files: [],
    agents: 0,
    failed: [],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    estUsd: 0,
    steps: 0,
  }
}

export function addTool(t: Tally, tool: string, input: Record<string, unknown>, failed: boolean, detail: string): void {
  const fam = familyOf(tool)
  t.tools[fam] = (t.tools[fam] ?? 0) + 1
  const f = writtenFile(tool, input)
  if (f && !t.files.includes(f)) t.files.push(f)
  if (failed) t.failed.push({ tool, detail })
}

export function addUsage(t: Tally, model: string, u: Usage | null | undefined): void {
  if (!u) return
  t.usage.input_tokens += u.input_tokens ?? 0
  t.usage.output_tokens += u.output_tokens ?? 0
  t.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
  t.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
  t.estUsd += costOf(model, u)
  t.steps++
}

export function toRecap(t: Tally, endedAt: number, durationMs: number, reason: string, costNow?: number): EpilogueRecap {
  return {
    id: t.turnId,
    endedAt,
    durationMs,
    reason,
    prompt: t.prompt.replace(/\s+/g, ' ').trim().slice(0, 120),
    tools: FAMILY_ORDER.filter(f => (t.tools[f] ?? 0) > 0).map(f => ({ family: f, count: t.tools[f] ?? 0 })),
    toolCount: Object.values(t.tools).reduce((a, b) => a + (b ?? 0), 0),
    files: t.files.map(f => baseName(f)),
    agents: t.agents,
    failed: t.failed.slice(0, 12),
    tokens: tokensOf(t.usage),
    outputTokens: t.usage.output_tokens,
    estUsd: t.estUsd,
    sessionDeltaUsd: costNow !== undefined && t.costAtStart !== undefined ? Math.max(0, costNow - t.costAtStart) : undefined,
  }
}

/** `register.tsx, kz.ts +3` within `max` characters. */
export function fileList(files: readonly string[], max: number): string {
  let out = ''
  let n = 0
  for (const f of files) {
    const next = out ? `${out}, ${f}` : f
    const rest = files.length - n - 1
    if (next.length + (rest > 0 ? ` +${rest}`.length : 0) > max && n > 0) break
    out = next
    n++
  }
  return n < files.length ? `${out} +${files.length - n}` : out
}

/** The prompt sent to the small model for the one-liner. */
export function summaryPrompt(answer: string): string {
  const clipped = answer.length > 6000 ? `${answer.slice(0, 3000)}\n…\n${answer.slice(-3000)}` : answer
  return `Summarize what this assistant reply reports, in at most 15 words, as a plain past-tense sentence fragment with no quotes and no preamble.\n\n<reply>\n${clipped}\n</reply>`
}

/** Cleans the model's one-liner: one line, no quotes, at most 15 words. */
export function cleanSummary(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').trim()
  if (!line) return undefined
  const words = line.split(' ')
  return words.length > 15 ? `${words.slice(0, 15).join(' ')}…` : line
}
