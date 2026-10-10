import { describe, expect, test } from 'claude-code/testing'

import { addTokens, buildHtml, buildMarkdown, emptyReport, esc, familyOf, fileTouch, mdEsc, snapshotArt } from '../hooks/report.ts'
import type { ReportData } from '../hooks/report.ts'

/** A report with something in every section, and an edge in most. */
function rich(): ReportData {
  const d = emptyReport(0)
  d.title = 'Ship it'
  d.model = 'claude-opus-5-5'
  d.models = ['claude-opus-5-5', 'claude-haiku-5']
  d.version = '2.1.293'
  d.root = '/work/`odd`'
  d.endedAt = 600_000
  d.tokens = { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000 }
  d.requests = 7
  d.ctxSeries = [[0, 10], [300_000, 40], [600_000, 35]]
  d.ctxPeakPercent = 40
  d.ctxPeakTokens = 400_000
  d.limits = [
    { kind: 'five_hour', percentUsed: 90, peak: 92, resetsAt: '2030-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 70, peak: 70, resetsAt: 'soon' },
    { kind: 'weekly_opus', percentUsed: 10, peak: 10 },
  ]
  d.families = { shell: 12, weird: 1 }
  d.toolNames = { Bash: 12, Weird: 1 }
  d.toolErrors = 2
  d.turns = [
    { index: 1, prompt: '', startedAt: 0, durationMs: 60_000, tools: 12, tokens: 1000, usd: 1, reason: 'aborted' },
    { index: 2, prompt: 'x'.repeat(200), startedAt: 100_000, durationMs: 30_000, tools: 11, tokens: 10, usd: 0.5, reason: 'error' },
    { index: 3, prompt: 'third', startedAt: 200_000, durationMs: 10_000, tools: 0, tokens: 0, usd: 0.1, reason: 'answer' },
    { index: 4, prompt: 'now', startedAt: 500_000, durationMs: 5_000, tools: 2, tokens: 0, usd: 0, reason: 'running' },
  ]
  d.agents = [
    { id: 'ag-1', type: 'Explore', description: '', model: 'claude-haiku-5', startedAt: 0, durationMs: 1000, tokens: 5, usd: 0.25, status: 'failed' },
    { id: 'ag-2', type: 'Plan', description: 'plan it', model: 'claude-haiku-5', startedAt: 0, durationMs: 1000, tokens: 5, usd: 0, status: 'running' },
    { id: 'ag-3', type: 'Plan', description: 'done one', model: 'claude-haiku-5', startedAt: 0, durationMs: 1000, tokens: 5, usd: 0, status: 'done' },
  ]
  d.files = [
    { path: '/a.ts', reads: 3, edits: 0, writes: 0 },
    { path: '/b.ts', reads: 1, edits: 1, writes: 0 },
    { path: '/c.ts', reads: 5, edits: 0, writes: 0 },
    ...Array.from({ length: 58 }, (_, i) => ({ path: `/many/${i}.ts`, reads: 0, edits: 0, writes: 1 })),
  ]
  d.commands = [{ name: 'review', args: '', at: 1000 }, { name: 'co`mmit', args: 'all of it', at: 2000 }]
  return d
}

describe('small facts', () => {
  test('every tool family', () => {
    const fam = (tools: string[]) => [...new Set(tools.map(familyOf))]
    expect(fam(['mcp__srv__x'])).toEqual(['mcp'])
    expect(fam(['Bash', 'PowerShell', 'Monitor'])).toEqual(['shell'])
    expect(fam(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])).toEqual(['edit'])
    expect(fam(['Read', 'LSP'])).toEqual(['read'])
    expect(fam(['Glob', 'Grep', 'ToolSearch'])).toEqual(['search'])
    expect(fam(['Agent', 'Task', 'Workflow', 'SendMessage'])).toEqual(['agent'])
    expect(fam(['WebFetch', 'WebSearch'])).toEqual(['web'])
    expect(fam(['TodoWrite', 'TaskCreate'])).toEqual(['tasks'])
    expect(fam(['Skill'])).toEqual(['skill'])
    expect(fam(['Frobnicate'])).toEqual(['other'])
  })

  test('which calls touch which file, and how', () => {
    expect(fileTouch('Read', { file_path: '/a' })).toEqual({ path: '/a', kind: 'reads' })
    expect(fileTouch('Write', { file_path: '/a' })).toEqual({ path: '/a', kind: 'writes' })
    expect(fileTouch('MultiEdit', { file_path: '/a' })).toEqual({ path: '/a', kind: 'edits' })
    expect(fileTouch('NotebookEdit', { notebook_path: '/n.ipynb' })).toEqual({ path: '/n.ipynb', kind: 'edits' })
    expect(fileTouch('Grep', { file_path: '/a' })).toBeUndefined()
    expect(fileTouch('Read', { file_path: 42 })).toBeUndefined()
  })

  test('token sums take what a usage has', () => {
    const sum = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
    expect(addTokens(sum, null)).toBe(sum)
    expect(addTokens(sum, {})).toEqual(sum)
    expect(addTokens(sum, { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 })).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 })
  })

  test('nothing escapes to the empty string', () => {
    expect(esc(undefined)).toBe('')
    expect(esc(null)).toBe('')
    expect(mdEsc(undefined)).toBe('')
    expect(mdEsc('# *a* _b_ [c] <d> \\')).toBe('\\# \\*a\\* \\_b\\_ \\[c\\] \\<d\\> \\\\')
  })
})

describe('the HTML', () => {
  test('an empty session says so in every section', () => {
    const html = buildHtml(emptyReport(0), 0)
    for (const line of ['No context readings yet.', 'No token counts yet.', 'No rate-limit readings (none reported this session).', 'No turns yet.',
      'No subagents were spawned.', 'No files were read or changed.', 'No slash commands were run.']) expect(html).toContain(line)
    expect(html.match(/No tool calls this session\./g)).toHaveLength(2)
    expect(html).toContain('<title>Polaroid · A Claude Code session</title>')
    expect(html).toContain('model <b>—</b>')
    expect(html).toContain('Claude Code <b>?</b>')
    expect(html).not.toContain('chip mono')
    expect(html).toContain('<div class="v">$0.00</div><div class="s">estimated</div>')
    expect(html).toContain('<div class="k">Context peak</div><div class="v">—</div><div class="s"></div>')
    expect(html).toContain('none failed')
    // The horizon has no families: one faint violet band, and no constellation line.
    expect(snapshotArt(emptyReport(0))).toContain('fill="#a78bfa" opacity=".5"')
    expect(snapshotArt(emptyReport(0))).not.toContain('<polyline')
  })

  test('a model id that names nothing reads as a dash', () => {
    const d = emptyReport(0)
    d.model = 'claude-'
    expect(buildHtml(d, 0)).toContain('model <b>—</b>')
    expect(buildMarkdown(d, 0)).toContain('- **Model:** —\n')
  })

  test('a full session: pills, colors, the estimate, truncation, and more files than fit', () => {
    const html = buildHtml(rich(), 600_000)
    expect(html).toContain('(continuation) <span class="pill" style="--c:#fb923c">aborted</span>')
    expect(html).toContain('<span class="pill" style="--c:#f87171">error</span>')
    expect(html).toContain('<span class="pill" style="--c:#22d3ee">running</span>')
    expect(html).toContain(`${'x'.repeat(89)}…`)
    // Cost is estimated from the turns and the agents: 1 + 0.5 + 0.1 + 0.25.
    expect(html).toContain('<div class="v">$1.85</div><div class="s">estimated</div>')
    expect(html).toContain('400k of 0')
    expect(html).toContain('2 failed')
    expect(html).toContain('also <b>Haiku 5</b>')
    expect(html).toContain('<span class="chip mono">/work/&#96;odd&#96;</span>')
    // Limits: red, amber, green; a reset only where the date reads.
    expect(html).toContain('--c:#f87171"><i style="width:90.0%')
    expect(html).toContain('--c:#fb923c"><i style="width:70.0%')
    expect(html).toContain('--c:#4ade80"><i style="width:10.0%')
    expect(html.match(/ · resets /g)).toHaveLength(1)
    // Agents: the id stands in for a missing description; each status its color.
    expect(html).toContain('<td>ag-1</td>')
    expect(html).toContain('--c:#f87171">failed')
    expect(html).toContain('--c:#22d3ee">running')
    expect(html).toContain('--c:#4ade80">done')
    // Changed files first, then the most read: 60 rows fit, /a.ts (3 reads) is the one left out.
    expect(html).toContain('<p class="mute">and 1 more</p>')
    expect(html.indexOf('>/b.ts<')).toBeLessThan(html.indexOf('>/many/0.ts<'))
    expect(html.indexOf('>/many/57.ts<')).toBeLessThan(html.indexOf('>/c.ts<'))
    expect(html).not.toContain('>/a.ts<')
    expect(html).toContain('<b class="mono">/review</b><span class="t">')
    expect(html).toContain('<span class="dim">all of it</span>')
    // An unknown family is drawn in mist.
    expect(html).toContain('fill="#9ca3af" filter="url(#fg)"')
    expect(html).toContain('<path d="M0,120 L')
    // Stars: amber for a dear turn, magenta for a busy one, cyan otherwise; turns joined by a line.
    const art = snapshotArt(rich())
    expect(art).toContain('fill="#fb923c"/>')
    expect(art).toContain('fill="#f472b6"/>')
    expect(art).toContain('fill="#22d3ee"/>')
    expect(art).toContain('<polyline')
    // The timeline strip: dearest amber, middling magenta, cheap violet.
    expect(html).toContain('rx="4" fill="#fb923c"')
    expect(html).toContain('rx="4" fill="#f472b6"')
    expect(html).toContain('rx="4" fill="#a78bfa"')
  })

  test('one context reading shows the peak alone', () => {
    const d = emptyReport(0)
    d.ctxSeries = [[0, 33]]
    d.ctxPeakPercent = 33.4
    d.ctxWindow = 1_000_000
    d.ctxPeakTokens = 334_000
    d.costUsd = 2
    const html = buildHtml(d, 0)
    expect(html).toContain('<p class="dim">Peak 33% of the window.</p>')
    expect(html).toContain('334k of 1.0M')
    expect(html).toContain('as /cost totals it')
  })
})

describe('the Markdown', () => {
  test('an empty session', () => {
    const md = buildMarkdown(emptyReport(0), 0)
    expect(md).toContain('# Session Polaroid: A Claude Code session')
    expect(md).toContain('- **Model:** —\n')
    expect(md).toContain('- **Claude Code:** ?')
    expect(md).not.toContain('**Project:**')
    expect(md).toContain('- **Cost:** $0.00 (estimated)')
    expect(md).toContain('- **Context peak:** —\n')
    expect(md).toContain('- **Tool calls:** 0\n')
    expect(md).not.toContain('## Rate limits')
    expect(md).not.toContain('## Tools by family')
    for (const line of ['_No turns yet._', '_No subagents were spawned._', '_No files were read or changed._', '_No slash commands were run._']) expect(md).toContain(line)
  })

  test('a newline in the project root or a command name cannot leave its code span', () => {
    const d = emptyReport(0)
    d.root = '/work/p\n# Forged heading\n[click](javascript:alert(1))'
    d.commands = [{ name: 'run\r\n# Also forged', args: '', at: 0 }]
    const md = buildMarkdown(d, 0)
    expect(md.split('\n').filter(l => l.startsWith('#'))).toEqual(['# Session Polaroid: A Claude Code session', '## Timeline of turns', '## Subagents', '## Files touched', '## Commands run'])
    expect(md).toContain('- **Project:** `/work/p # Forged heading [click](javascript:alert(1))`\n')
    expect(md).toContain("- 0:00 `/run # Also forged`\n")
  })

  test('a full session', () => {
    const d = rich()
    const md = buildMarkdown(d, 0)
    expect(md).toContain('- **Model:** Opus 5.5 (also Haiku 5)')
    expect(md).toContain("- **Project:** `/work/'odd'`")
    expect(md).toContain('- **Cost:** $1.85 (estimated)')
    expect(md).toContain('- **Context peak:** 40% (400k of 0)')
    expect(md).toContain('- **Tool calls:** 13 (2 failed)')
    expect(md).toMatch(/\| 5h \| 90% \| 92% \| \d{4}-\d\d-\d\d \d\d:\d\d \|/)
    expect(md).toContain('| 7d | 70% | 70% | — |')
    expect(md).toContain('| weekly opus | 10% | 10% | — |')
    expect(md).toContain('| shell | 12 | 92% |')
    expect(md).toContain('| 1 | (continuation) | 1:00 | 12 | 1.0k | $1.00 |')
    expect(md).toContain('| ag-1 | Explore | Haiku 5 |')
    expect(md).toContain('| plan it | Plan |')
    expect(md).toContain('| /many/57.ts | 0 | 0 | 1 |')
    expect(md).toContain("- 0:01 `/review`\n")
    expect(md).toContain("- 0:02 `/co'mmit` all of it")
    d.costUsd = 3
    expect(buildMarkdown(d, 0)).toContain('- **Cost:** $3.00\n')
  })
})
