import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, errorOutcome, groupsOf, monogram, searchOutcome, splitUrl, toMarkdown } from '../hooks/trail.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-breadcrumbs',
  props: { title: 'KOZMOS · Breadcrumbs', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const SEARCH_RESULT = {
  query: 'bun mock clock',
  results: [
    'Here are the results',
    { tool_use_id: 's1', content: [{ title: 'Bun docs: testing', url: 'https://bun.sh/docs/test' }, { title: 'A blog', url: 'https://blog.example.com/x' }] },
  ],
  durationSeconds: 1.2,
}

describe('trail', () => {
  test('urls split into domain and path, and get a monogram', () => {
    expect(splitUrl('https://www.github.com/anthropics/x?q=1')).toEqual({ domain: 'github.com', path: '/anthropics/x?q=1' })
    expect(monogram('docs.python.org')).toBe('Py')
    expect(monogram('bbc.co.uk')).toBe('Bb')
    expect(monogram('github.com')).toBe('Gi')
  })

  test('web tools are classified, MCP browser tools included', () => {
    expect(classify('WebFetch', { url: 'https://a.dev/x', prompt: 'p' })).toEqual({ kind: 'fetch', url: 'https://a.dev/x' })
    expect(classify('WebSearch', { query: 'q' })?.kind).toBe('search')
    expect(classify('mcp__claude-in-chrome__navigate', { url: 'https://b.dev' })?.kind).toBe('browse')
    expect(classify('Read', { file_path: '/x' })).toBeUndefined()
  })

  test('a search result is counted and its hits kept; errors name their status', () => {
    const s = searchOutcome(SEARCH_RESULT)
    expect(s.results).toBe(2)
    expect(s.hits[0]?.url).toBe('https://bun.sh/docs/test')
    expect(errorOutcome('Request failed with status code 404\nmore').status).toBe(404)
  })

  test('the markdown groups by domain', () => {
    const md = toMarkdown({
      crumbs: [
        { id: '1', kind: 'fetch', tool: 'WebFetch', at: 2, domain: 'a.dev', url: 'https://a.dev/x', path: '/x', status: 200, bytes: 1200, isRunning: false, isError: false, who: 'main' },
        { id: '2', kind: 'search', tool: 'WebSearch', at: 1, domain: 'search', query: 'q', results: 3, hits: [{ title: 'T', url: 'https://t.dev' }], isRunning: false, isError: false, who: 'main' },
      ],
      searches: 1, fetches: 1, browses: 0, failures: 0,
    })
    expect(md).toContain('- **a.dev**')
    expect(md).toContain('[/x](https://a.dev/x) — 200, 1.2 kB')
    expect(md).toContain('🔎 "q" (3 results)')
    expect(groupsOf([]).length).toBe(0)
  })
})

describe('register', () => {
  test('searches and fetches group by domain with links and a markdown copy on both surfaces', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    let copied = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.copy', ($, e) => {
      copied = e.text
      return { value: { isCopied: true as const } }
    })
    on('tool.call', ($, e) => {
      if (e.tool === 'WebSearch') return { result: SEARCH_RESULT }
      if (e.tool === 'WebFetch' && e.url.includes('missing')) return { isError: true as const, result: undefined, text: 'Request failed with status code 404' }
      if (e.tool === 'WebFetch') return { result: { bytes: 12_400, code: 200, codeText: 'OK', result: 'summary', durationMs: 300, url: e.url } }
      return { result: 'ok' }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'WebSearch', query: 'bun mock clock', mode: 'standard' })
    await $.tool.call({ tool: 'WebFetch', url: 'https://github.com/anthropics/claude-code/issues', prompt: 'list' })
    await $.tool.call({ tool: 'WebFetch', url: 'https://github.com/missing', prompt: 'x' })
    await $.tool.call({ tool: 'WebFetch', url: 'https://docs.python.org/3/library/', prompt: 'x' })

    const { text } = await $.command.run({ command: 'breadcrumbs', args: 'md', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('**github.com**')

    const term = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /3 fetches/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /2 domains/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: / Gi / })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /404/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /2 results/ })).toBeDefined()
    const links = await term.findAll({ type: 'Link' })
    expect(links.some(l => l.props.href === 'https://bun.sh/docs/test')).toBe(true)
    expect(links.some(l => l.props.href === 'https://docs.python.org/3/library/')).toBe(true)
    await term.press({ key: 'copy-md' })
    expect(copied).toContain('[/3/library/](https://docs.python.org/3/library/)')
    await term.press({ key: 'fold-github.com' })
    expect(await term.find({ type: 'Text', text: /404/ })).toBeUndefined()
    await term.press({ key: 'fold-github.com' })
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(4)
    expect(String(svgs[0]?.props.source)).toContain('BREADCRUMBS')
    expect((await desk.findAll({ type: 'Link' })).length).toBeGreaterThan(3)
    await desk.unmount()
  })

  test('an empty trail draws a hint on both surfaces', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /No web steps yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
