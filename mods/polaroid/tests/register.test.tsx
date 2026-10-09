import { describe, expect, mock, test } from 'claude-code/testing'

import { buildHtml, buildMarkdown, emptyReport, esc, joinPath, mdEsc, reportStem } from '../hooks/report.ts'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('report', () => {
  test('esc covers every character that could break out of text or an attribute', () => {
    expect(esc(`<img src=x onerror="a('b')">&\``)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;&#96;')
  })

  test('the HTML escapes everything the session wrote into it', () => {
    const d = emptyReport(0)
    d.title = '<script>alert(1)</script>'
    d.model = 'claude-opus-5-5'
    d.version = '2.1.293"><blink>'
    d.root = 'C:\\work & play'
    d.endedAt = 120_000
    d.turns = [{ index: 1, prompt: 'fix <div onclick="x">', startedAt: 0, durationMs: 60_000, tools: 3, tokens: 1000, usd: 0.12, reason: 'answer' }]
    d.agents = [{ id: 'a1', type: 'Explore<x>', description: '"quoted" & <blink>', model: 'claude-haiku-5', startedAt: 0, durationMs: 5000, tokens: 10, usd: 0.01, status: 'done' }]
    d.files = [{ path: '/src/<evil>.ts', reads: 1, edits: 2, writes: 0 }]
    d.commands = [{ name: 'review', args: '<i>now</i>', at: 1000 }]
    d.families = { shell: 2, edit: 1 }
    d.toolNames = { 'Bash': 2, 'mcp__x__<y>': 1 }
    d.limits = [{ kind: 'five_hour', percentUsed: 42, peak: 50, resetsAt: '2030-01-01T00:00:00Z' }]
    d.ctxSeries = [[0, 10], [60_000, 30]]
    d.ctxPeakPercent = 30
    const html = buildHtml(d, 120_000)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    for (const raw of ['<script>alert', '<div onclick', '<blink>', '<evil>', '<i>now', 'Explore<x>', 'mcp__x__<y>']) expect(html).not.toContain(raw)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('C:\\work &amp; play')
    expect(html).toContain('2.1.293&quot;&gt;&lt;blink&gt;')
    expect(html).not.toMatch(/<link|<script|src="http/)
    expect(html).toContain('<svg')
  })

  test('the Markdown escapes table-breaking characters', () => {
    expect(mdEsc('a|b\nc`d')).toBe('a\\|b c\\`d')
    const d = emptyReport(0)
    d.files = [{ path: 'a|b.ts', reads: 1, edits: 0, writes: 0 }]
    expect(buildMarkdown(d, 0)).toContain('| a\\|b.ts | 1 | 0 | 0 |')
  })

  test('file names and paths', () => {
    expect(reportStem(new Date(2026, 9, 9, 14, 3, 5).getTime())).toBe('session-20261009-140305')
    expect(joinPath('D:\\code\\', '.kozmos', 'reports', 'x.html')).toBe('D:\\code\\.kozmos\\reports\\x.html')
    expect(joinPath('/work', '.kozmos', 'x.md')).toBe('/work/.kozmos/x.md')
  })
})

describe('register', () => {
  test('collects a session and writes the report', async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: 1_000_000, context: { tokens: 300_000, window: 1_000_000, percent: 30 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }], cost: { usd: 1.25 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.version', () => ({ value: { version: '2.1.293' } }))
    on('session.root', () => ({ value: '/work' }))
    on('session.cwd', () => ({ value: '/work' }))
    on('tool.call', () => ({ result: 'ok' }))
    on('command.run', () => ({ text: '' }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    const written: { path: string; text: string }[] = []
    on('fs.write', ($, e) => {
      written.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    let copied = ''
    on('ui.copy', ($, e) => {
      copied = e.text
      return { value: { isCopied: true as const } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'review', args: 'the diff', ...RUN })
    await $.turn.start({ text: 'Make <the> report', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.turn.complete({ answer: 'done', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })

    const r = await $.command.run({ command: 'polaroid', args: '', ...RUN })
    expect(r.text).toMatch(/\.kozmos[\\/]reports[\\/]session-/)
    expect(r.text).toContain('copied')
    const html = written[0]
    expect(html?.path).toMatch(/work[\\/]\.kozmos[\\/]reports[\\/]session-\d{8}-\d{6}\.html$/)
    expect(copied).toMatch(/session-\d{8}-\d{6}\.html$/)
    expect(r.text).toContain(copied)
    expect(html?.text).toContain('Make &lt;the&gt; report')
    expect(html?.text).toContain('/review')
    expect(html?.text).toContain('/work/a.ts')
    expect(html?.text).toContain('$1.25')

    const md = await $.command.run({ command: 'polaroid', args: 'md', ...RUN })
    expect(md.text).toContain('.md')
    expect(written[1]?.text).toContain('# Session Polaroid: Make \\<the\\> report')
  })
})
