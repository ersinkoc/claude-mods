import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { BreadcrumbsSnap, Crumb } from '../types'
import {
  classify, emptySnap, errorOutcome, fetchOutcome, fmtBytes, fmtMs, groupSvg, groupsOf, headerSvg, monogram, rowLabel, searchOutcome,
  splitUrl, statusColor, statusLabel, toMarkdown, altOfGroup,
} from '../hooks/trail.ts'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const SNAP = { plugin: 'breadcrumbs', key: 'snap' } as const
const PANE = (bodyColumns = 48) => ({
  component: 'Pane' as const,
  requestId: 'kz-breadcrumbs',
  props: { title: 'KOZMOS · Breadcrumbs', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const SPAWN = {
  tool_use_id: 'tu1', prompt: 'look', description: 'Researcher', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: false, fork: false,
}
const crumb = (c: Partial<Crumb>): Crumb => ({ id: 'x', kind: 'fetch', tool: 'WebFetch', at: 0, domain: 'a.dev', isRunning: false, isError: false, who: 'main', ...c })

describe('trail helpers', () => {
  test('classify: fetches need a url; MCP tools by url, by a search query, or by a browser-like name', () => {
    expect(classify('WebFetch', { prompt: 'p' })).toBeUndefined()
    expect(classify('WebFetch', { url: 42 })).toBeUndefined()
    expect(classify('WebSearch', {})).toEqual({ kind: 'search', query: '' })
    expect(classify('mcp__x__open', { href: 'https://h.dev' })).toEqual({ kind: 'browse', url: 'https://h.dev' })
    expect(classify('mcp__x__open', { uri: 'HTTP://u.dev' })).toEqual({ kind: 'browse', url: 'HTTP://u.dev' })
    expect(classify('mcp__exa__web_search', { query: ' cats ' })).toEqual({ kind: 'search', query: 'cats' })
    expect(classify('mcp__exa__search', { q: 'dogs' })).toEqual({ kind: 'search', query: 'dogs' })
    expect(classify('mcp__exa__search', {})).toBeUndefined()
    expect(classify('mcp__pw__browser_navigate', { url: 'about:blank' })).toEqual({ kind: 'browse', url: 'about:blank' })
    expect(classify('mcp__notes__open', { url: 'file:///x' })).toBeUndefined()
  })

  test('splitUrl: schemes without a host, bare hosts, and what cannot be parsed', () => {
    expect(splitUrl('about:blank')).toEqual({ domain: 'about', path: 'blank' })
    expect(splitUrl('about:')).toEqual({ domain: 'about', path: '/' })
    expect(splitUrl('WWW.Example.com/Docs')).toEqual({ domain: 'example.com', path: '/Docs' })
    expect(splitUrl('example.com')).toEqual({ domain: 'example.com', path: '/' })
    expect(splitUrl('/Relative/Only')).toEqual({ domain: '/relative/only', path: '/' })
  })

  test('searchOutcome and fetchOutcome read what is there and nothing else', () => {
    expect(searchOutcome(undefined)).toEqual({ results: undefined, hits: [] })
    expect(searchOutcome({ results: 'no' })).toEqual({ results: undefined, hits: [] })
    const many = Array.from({ length: 7 }, (_, i) => ({ title: i === 0 ? '' : `T${i}`, url: `https://h${i}.dev` }))
    const s = searchOutcome({ results: [null, 3, { content: 'x' }, { content: [{ title: 'no url' }, ...many] }] })
    expect(s.results).toBe(7)
    expect(s.hits).toHaveLength(5)
    expect(s.hits[0]).toEqual({ title: 'https://h0.dev', url: 'https://h0.dev' })
    expect(fetchOutcome(undefined)).toEqual({ status: undefined, statusText: undefined, bytes: undefined, url: undefined })
    expect(fetchOutcome({ code: '200', codeText: '', bytes: '1', url: '' })).toEqual({ status: undefined, statusText: undefined, bytes: undefined, url: undefined })
  })

  test('errorOutcome: the first non-empty line, a status when named, "failed" when blank', () => {
    expect(errorOutcome('\n  \n HTTP 503 down\n')).toEqual({ status: 503, error: 'HTTP 503 down' })
    expect(errorOutcome('timeout')).toEqual({ status: undefined, error: 'timeout' })
    expect(errorOutcome('  ')).toEqual({ status: undefined, error: 'failed' })
  })

  test('monograms, sizes, durations, status colors and labels', () => {
    expect(monogram('search')).toBe('⌕')
    expect(monogram('localhost')).toBe('Lo')
    expect(monogram('...')).toBe('·')
    expect(monogram('x.y')).toBe('X')
    expect(monogram('news.ac.jp')).toBe('Ne')
    expect(fmtBytes(undefined)).toBe('')
    expect(fmtBytes(999)).toBe('999 B')
    expect(fmtBytes(1500)).toBe('1.5 kB')
    expect(fmtBytes(45_000)).toBe('45 kB')
    expect(fmtBytes(2_500_000)).toBe('2.5 MB')
    expect(fmtMs(undefined)).toBe('…')
    expect(fmtMs(250.4)).toBe('250ms')
    expect(fmtMs(1500)).toBe('1.5s')
    expect(fmtMs(12_000)).toBe('12s')
    // A value that rounds up to a unit's own size moves to the next unit.
    expect(fmtMs(999.4)).toBe('999ms')
    expect(fmtMs(999.5)).toBe('1.0s')
    expect(fmtBytes(999_499)).toBe('999 kB')
    expect(fmtBytes(999_500)).toBe('1.0 MB')
    expect(fmtBytes(999_999)).toBe('1.0 MB')
    expect(statusColor(crumb({ isRunning: true }))).toBe('#a78bfa')
    expect(statusColor(crumb({ isError: true }))).toBe('#f87171')
    expect(statusColor(crumb({ status: 404 }))).toBe('#f87171')
    expect(statusColor(crumb({ status: 301 }))).toBe('#fb923c')
    expect(statusColor(crumb({}))).toBe('#4ade80')
    expect(statusLabel(crumb({ isRunning: true }))).toBe('…')
    expect(statusLabel(crumb({ isError: true }))).toBe('ERR')
    expect(statusLabel(crumb({ kind: 'browse' }))).toBe('ok')
    expect(statusLabel(crumb({}))).toBe('—')
    expect(rowLabel(crumb({ kind: 'search', query: 'q' }))).toBe('⌕ “q”')
    expect(rowLabel(crumb({ status: 200, bytes: 2000, path: '/p' }))).toBe('200 · 2.0 kB · /p')
  })

  test('markdown: errors without a status, an MCP search without a count, brackets stripped', () => {
    const md = toMarkdown({
      ...emptySnap(),
      crumbs: [
        crumb({ id: '1', isError: true, url: 'https://a.dev/[x]', path: '/[x]' }),
        crumb({ id: '2', url: 'https://a.dev/y', path: '/y' }),
        crumb({ id: '3', kind: 'search', domain: 'search', query: 'q', hits: [{ title: '[T]', url: 'https://t.dev' }] }),
        crumb({ id: '4', kind: 'search', domain: 'search', query: 'running', isRunning: true }),
      ],
    })
    expect(md).toBe([
      '- **a.dev**',
      '  - [/y](https://a.dev/y)',
      '  - [/x](https://a.dev/[x]) — error',
      '- **Web search**',
      '  - 🔎 "running"',
      '  - 🔎 "q"',
      '    - [T](https://t.dev)',
    ].join('\n'))
  })

  test('the desktop drawings: an empty header, counts in the singular and plural, folded and running cards', () => {
    expect(headerSvg(emptySnap(), [], 400).source).toContain('<rect class="k" x="14" y="98"')
    const failing: BreadcrumbsSnap = { ...emptySnap(), failures: 2, crumbs: [crumb({ isError: true })] }
    expect(headerSvg(failing, groupsOf(failing.crumbs), 400).source).toContain('fill="#f87171"')
    const one = groupsOf([crumb({ kind: 'search', domain: 'search', query: 'q', isRunning: true })])[0]
    const many = groupsOf([crumb({ id: '1', bytes: 1200, isError: true }), crumb({ id: '2', at: 5 })])[0]
    if (!one || !many) throw new Error('no groups')
    const a = groupSvg(one, 400, true).source
    expect(a).toContain('1 query')
    expect(a).toContain('folded')
    expect(a).toContain('class="pulse"')
    expect(groupSvg({ ...one, crumbs: [...one.crumbs, ...one.crumbs] }, 300, false).source).toContain('2 queries')
    const b = groupSvg(many, 400, false).source
    expect(b).toContain('2 visits')
    expect(b).toContain('1.2 kB')
    expect(b).toContain('1 failed')
    expect(b).not.toContain('folded')
    expect(groupSvg({ ...many, crumbs: [crumb({})] }, 300, false).source).toContain('1 visit ')
    expect(altOfGroup(many)).toMatch(/^a\.dev: 2 steps, last at \d\d:\d\d, 1 failed$/)
    expect(altOfGroup(one)).toMatch(/^Web search: 1 steps, last at \d\d:\d\d$/)
  })
})

type Opts = { list?: boolean; copy?: boolean }
function base(on: On, opts: Opts = {}): { copied: () => string; toasts: string[] } {
  let copied = ''
  const toasts: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => { toasts.push(String(e.text ?? e)); return { value: undefined } })
  if (opts.copy !== false) {
    on('ui.copy', ($, e) => {
      copied = e.text
      return { value: { isCopied: !e.text.includes('nocopy') } as never }
    })
  }
  if (opts.list !== false) on('agent.list', () => ({ value: [{ id: 'a2', description: '', type: 'Plan', status: 'running' as const, parentId: undefined }] as never }))
  on('agent.spawn', ($, e) => (e.description === 'deny' ? { deny: 'no' } : e.description === 'teammate' ? { model: 'm' } : { model: 'm', agentId: 'a1' }) as never)
  on('tool.call', ($, e) => {
    const t = String(e.tool)
    const x = e as unknown as Record<string, string>
    if (t === 'WebSearch') return { result: { results: [{ content: [{ title: 'Hit', url: 'https://hit.dev' }] }] } }
    if (t === 'WebFetch') {
      if (x.url?.includes('deny')) return { deny: 'blocked by policy' }
      if (x.url?.includes('textfail')) return { isError: true as const, result: undefined, text: 'Request failed with status code 404' }
      if (x.url?.includes('strfail')) return { isError: true as const, result: 'socket hang up' }
      if (x.url?.includes('nofail')) return { isError: true as const, result: { code: 1 } }
      if (x.url?.includes('moved')) return { result: { code: 301, codeText: 'Moved', bytes: 10, url: 'https://new.dev/landing' } }
      return { result: { code: 200, codeText: 'OK', bytes: 45_000, url: x.url } }
    }
    if (t.includes('search')) return { result: 'whatever' }
    if (t.includes('text')) return { result: { ok: true }, text: 'page body' } as never
    return { result: 'ok' }
  })
  return { copied: () => copied, toasts }
}

const fetch = (url: string, extra: Record<string, unknown> = {}) => ({ tool: 'WebFetch', url, prompt: 'p', ...extra } as never)
async function md($: Engine): Promise<string> {
  return String((await $.command.run({ command: 'breadcrumbs', args: ' md ', ...RUN })).text)
}

describe('the trail as it is recorded', () => {
  test('failures, denials, redirects, MCP searches and browser visits', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call(fetch('https://a.dev/deny'))
    await $.tool.call(fetch('https://a.dev/textfail'))
    await $.tool.call(fetch('https://a.dev/strfail'))
    await $.tool.call(fetch('https://a.dev/nofail'))
    await $.tool.call(fetch('https://old.dev/moved'))
    await $.tool.call(fetch('https://same.dev/x'))
    await $.tool.call({ tool: 'mcp__exa__search', query: 'cats' } as never)
    await $.tool.call({ tool: 'mcp__pw__browser_text', url: 'https://b.dev/page' } as never)
    await $.tool.call({ tool: 'mcp__pw__browser_click', url: 'https://b.dev/other' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/x' })
    expect(await md($)).toBe([
      '- **b.dev**',
      '  - [/page](https://b.dev/page) — 9 B',
      '  - [/other](https://b.dev/other)',
      '- **search**'.replace('search', 'Web search'),
      '  - 🔎 "cats"',
      '- **same.dev**',
      '  - [/x](https://same.dev/x) — 200, 45 kB',
      '- **new.dev**',
      '  - [/landing](https://new.dev/landing) — 301, 10 B',
      '- **a.dev**',
      '  - [/deny](https://a.dev/deny) — error',
      '  - [/textfail](https://a.dev/textfail) — 404',
      '  - [/strfail](https://a.dev/strfail) — error',
      '  - [/nofail](https://a.dev/nofail) — error',
    ].join('\n'))
    const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE(0) })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('      └ blocked by policy')
    expect(texts).toContain('      └ socket hang up')
    expect(texts).toContain('      └ failed')
    expect(texts.some(t => t.includes(' · 2 browser'))).toBe(true)
    expect(texts.some(t => t.includes(' · 4 failed'))).toBe(true)
    expect(texts.some(t => t.includes(' · 4✖'))).toBe(true)
    // The browser visit that answered text counts its size.
    expect(texts.some(t => t.endsWith('ok  9 B https://b.dev/page↗ /page'))).toBe(true)
    // An MCP search says no count.
    expect(texts.some(t => t.endsWith('⌕ “cats” · 0ms'))).toBe(true)
    await ui.unmount()
  })

  test('who: the main loop, a spawned subagent, one from the roster, and one nobody knows', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.agent.spawn(SPAWN)
    await $.agent.spawn({ ...SPAWN, description: 'deny' })
    await $.agent.spawn({ ...SPAWN, description: 'teammate' })
    await $.tool.call(fetch('https://a.dev/1', { agentId: 'a1' }))
    await $.tool.call(fetch('https://a.dev/2', { agentId: 'a2' }))
    await $.tool.call(fetch('https://a.dev/3', { agentId: 'zz9999999' }))
    await $.tool.call(fetch('https://a.dev/4'))
    // No description: the type names it.
    await $.agent.spawn({ ...SPAWN, description: '', subagentType: 'Scout' })
    await $.tool.call(fetch('https://a.dev/5', { agentId: 'a1' }))
    const term = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE() })
    const texts = (await term.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain(' · ◈ Researcher')
    expect(texts).toContain(' · ◈ Scout')
    expect(texts).toContain(' · ◈ Plan')
    expect(texts).toContain(' · ◈ agent zz9999')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'desktop', ...PANE() })
    const labels = (await desk.findAll({ type: 'Link' })).map(l => String(l.props.label))
    expect(labels.some(l => l.endsWith('/1 · ◈ Researcher'))).toBe(true)
    expect(labels.some(l => l.endsWith('/4'))).toBe(true)
    await desk.unmount()
  })

  test('an unreadable roster falls back to the id', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on, { list: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call(fetch('https://a.dev/1', { agentId: 'abcdefgh' }))
    const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE() })
    expect((await ui.findAll({ type: 'Text' })).some(t => t.text.endsWith(' · ◈ agent abcdef'))).toBe(true)
    await ui.unmount()
  })

  test('a call with no id of its own still gets a crumb of its own', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call(fetch('https://a.dev/1', { tool_use_id: '' }))
    await $.tool.call(fetch('https://a.dev/2', { tool_use_id: '' }))
    expect((await md($)).split('\n')).toHaveLength(3)
  })
})

describe('the pane', () => {
  test('the command: an empty trail, then the toggle', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    base(on)
    let open = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-breadcrumbs', title: 'KOZMOS · Breadcrumbs', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => { calls.push(`open ${e.id}`); open = true; return { value: { isPlaced: true as const } } })
    on('ui.close', ($, e) => { calls.push(`close ${e.id}`); open = false; return { value: undefined } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await md($)).toBe('Breadcrumbs: no web steps yet.')
    expect((await $.command.run({ command: 'breadcrumbs', args: '', ...RUN })).text).toBe('Breadcrumbs closed.')
    expect((await $.command.run({ command: 'breadcrumbs', args: '', ...RUN })).text).toBe('Breadcrumbs open.')
    expect(calls).toEqual(['open kz-breadcrumbs', 'close kz-breadcrumbs', 'open kz-breadcrumbs'])
  })

  test('autoOpen where no pane can open is quiet', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await clock.settle()
    expect(await md($)).toBe('Breadcrumbs: no web steps yet.')
  })

  test('copying: a toast when copied, none when the copy did not land, nothing when there is no clipboard', async ($, on) => {
    mock.clock(on, { now: 1000 })
    const { copied, toasts } = base(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call(fetch('https://a.dev/x'))
    let ui = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE() })
    await ui.press({ key: 'copy-md' })
    expect(copied()).toContain('[/x](https://a.dev/x)')
    expect(toasts).toHaveLength(1)
    await ui.unmount()
    await $.tool.call(fetch('https://nocopy.dev/x'))
    ui = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'terminal', ...PANE() })
    await ui.press({ key: 'copy-md' })
    expect(copied()).toContain('nocopy.dev')
    expect(toasts).toHaveLength(1)
    await ui.unmount()
  })

  test('a failing clipboard is swallowed', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on, { copy: false })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    await $.tool.call(fetch('https://a.dev/x'))
    const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface: 'desktop', ...PANE() })
    await ui.press({ key: 'copy-md' })
    expect(await ui.find({ type: 'Button', key: 'copy-md' })).toBeDefined()
    await ui.unmount()
  })

  test('a busy domain shows 15 steps and a count of the rest; folding hides them on both surfaces', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/w' })
    for (let i = 0; i < 17; i++) await $.tool.call(fetch(`https://busy.dev/${i}`))
    await $.tool.call({ tool: 'WebSearch', query: 'cats' } as never)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface, ...PANE() })
      expect(await ui.find({ type: 'Text', text: '  … 2 more' })).toBeDefined()
      expect((await ui.findAll({ type: 'Link' })).some(l => l.props.href === 'https://hit.dev')).toBe(true)
      expect((await ui.find({ type: 'Button', key: 'fold-busy.dev' }))?.props.label).toBe('▾')
      await ui.press({ key: 'fold-busy.dev' })
      expect(await ui.find({ type: 'Text', text: '  … 2 more' })).toBeUndefined()
      expect((await ui.find({ type: 'Button', key: 'fold-busy.dev' }))?.props.label).toBe('▸')
      await ui.press({ key: 'fold-busy.dev' })
      await ui.unmount()
    }
  })

  test('before the session starts, the pane is empty on both surfaces', async ($, on) => {
    mock.clock(on, { now: 1000 })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'breadcrumbs', surface, ...PANE() })
      expect(await ui.find({ type: 'Text', text: /No web steps yet/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'copy-md' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('reloads and failures', () => {
  test('a reload picks the kept trail up and adds to it', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on)
    const kept: BreadcrumbsSnap = { ...emptySnap(), fetches: 1, crumbs: [crumb({ id: 'old', url: 'https://kept.dev/a', path: '/a', domain: 'kept.dev' })] }
    let isKept = true
    on('state.get', SNAP, ($, e, next) => (isKept ? { value: { value: kept, version: 1 } } : next(e)))
    await $.tool.call(fetch('https://new.dev/b'))
    isKept = false
    const text = await md($)
    expect(text).toContain('- **kept.dev**')
    expect(text).toContain('- **new.dev**')
  })

  test('a reload with nothing kept starts empty; an unreadable state too', async ($, on) => {
    mock.clock(on, { now: 1000 })
    base(on)
    on('state.get', SNAP, () => ({ deny: 'unreadable' }))
    on('state.set', SNAP, () => ({ deny: 'unwritable' }))
    expect(await md($)).toBe('Breadcrumbs: no web steps yet.')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    // Publishing fails quietly; the call goes on.
    expect(await $.tool.call(fetch('https://a.dev/x'))).toMatchObject({ result: { code: 200 } })
  })

  test('a failure beneath tool.call and agent.spawn reaches the caller', async ($, on) => {
    let err = ''
    try { await $.tool.call(fetch('https://a.dev/x')) } catch (e) { err += String(e) }
    try { await $.agent.spawn(SPAWN) } catch (e) { err += String(e) }
    expect(err).toContain('no implementation for tool.call')
    expect(err).toContain('no implementation for agent.spawn')
  })

  test('with no clock to read, a web call passes through unrecorded', async ($, on) => {
    base(on)
    expect(await $.tool.call(fetch('https://a.dev/x'))).toMatchObject({ result: { code: 200 } })
    expect(await md($)).toBe('Breadcrumbs: no web steps yet.')
  })
})
