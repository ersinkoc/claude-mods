import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'

import { blocks, fmtAgo, isAbsolute, relTo, splitPath } from '../hooks/scope.ts'

// A malformed input as a model may send it, which the generated tool types do not allow.
const loose = (input: Record<string, unknown> & { tool: string }) => input as unknown as ToolCallArgs

const PANE_ID = 'kz-gitscope'
const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: { title: 'KOZMOS · Gitscope', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const RUN = { command: 'gitscope', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const NOW = Date.UTC(2030, 0, 1)
const log = (...rows: [string, string, string, number][]) => rows.map(([sha, subject, author, agoMs]) => `${sha}\t${subject}\t-\t${author}\t${(NOW - agoMs) / 1000}`).join('\n')
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const svgOf = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => {
  const s = (await ui.findAll({ type: 'Svg' }))[0]
  return { source: String(s?.props.source), alt: String(s?.props.alt) }
}

/** A repo the git probes answer from; a missing piece answers like git does when it has none. */
type Repo = { status?: string; top?: string; head?: string; log?: string; numstat?: string; cwd?: string; slowMs?: number }

function world(on: On, repo: Repo) {
  const open = new Set<string>()
  const runs: { argv: string; cwd?: string }[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.cwd', () => ({ value: repo.cwd ?? '/work' }))
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'rm -rf /' ? { deny: 'no' } : { result: 'ok' }))
  on('process.run', async ($, e) => {
    const argv = e.argv.join(' ')
    runs.push({ argv, cwd: e.init?.cwd })
    const answer = (out: string | undefined) => ({
      value: out === undefined
        ? { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv.startsWith('git status')) {
      if (repo.slowMs) await clock.sleep(repo.slowMs)
      return answer(repo.status)
    }
    if (argv.startsWith('git rev-parse')) return answer(repo.top)
    if (argv.startsWith('git log -1')) return answer(repo.head)
    if (argv.startsWith('git log')) return answer(repo.log)
    return answer(repo.numstat)
  })
  const statusRuns = () => runs.filter(r => r.argv.startsWith('git status')).length
  return { open, runs, clock, statusRuns }
}

describe('scope helpers', () => {
  test('paths, ages and bars at their edges', () => {
    expect(relTo('', '/work/a.ts')).toBeUndefined()
    expect(relTo('/work/', '/work')).toBe('')
    expect(isAbsolute('C:\\x')).toBe(true)
    expect(isAbsolute('src/a.ts')).toBe(false)
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
    expect(splitPath('src/lib/a.ts')).toEqual({ dir: 'src/lib/', name: 'a.ts' })
    expect(fmtAgo(-5)).toBe('now')
    expect(fmtAgo(5 * 60_000)).toBe('5m')
    expect(fmtAgo(3 * 864e5)).toBe('3d')
    expect(fmtAgo(21 * 864e5)).toBe('3w')
    expect(fmtAgo(90 * 864e5)).toBe('3mo')
    expect(fmtAgo(800 * 864e5)).toBe('2y')
    expect(blocks(2.5)).toBe('██▌')
    expect(blocks(-1)).toBe('')
  })
})

describe('gitscope radar', () => {
  test('/gitscope toggles; autoOpen is off by default', async ($, on) => {
    const { open } = world(on, { status: '# branch.head main\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect(open.size).toBe(0)
    expect((await $.command.run(RUN)).text).toBe('Gitscope open.')
    expect((await $.command.run(RUN)).text).toBe('Gitscope closed.')
  })

  test('autoOpen opens the radar when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const { open } = world(on, { status: '# branch.head main\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect([...open]).toEqual([PANE_ID])
  })

  test('before the first read the pane says it is reading', async ($, on) => {
    world(on, { status: '# branch.head main\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(40) })
    expect(await term.find({ type: 'Text', text: '⎇ reading git…' })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(40) })
    const { source, alt } = await svgOf(desk)
    expect(source).toContain('Reading git…')
    expect(alt).toBe('Reading git')
    await desk.unmount()
  })

  test('a repo with no commits yet: no HEAD, no log, no diff, no toplevel', async ($, on) => {
    const { runs } = world(on, { status: '# branch.head main\n? notes.txt\n? b.txt\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    expect(runs.every(r => r.cwd === '/work')).toBe(true)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(0) })
    const all = await texts(term)
    expect(all).toContain('⎇ main')
    expect(all).toContain('local only')
    expect(all).toContain('?2 new')
    expect(all).toContain('no commits yet')
    expect(all).toContain('── CHANGES 2 files · +0 −0')
    expect(all).not.toContain('COMMITS')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    const { source, alt } = await svgOf(desk)
    expect(source).toContain('no upstream · local only')
    expect(source).toContain('2 new')
    expect(source).toContain('>b.txt<')
    expect(alt).toBe('Branch main; 0 staged, 0 changed, 2 new, 0 conflicts; 0 recent commits; 2 changed files')
    await desk.unmount()
  })

  test('a detached HEAD behind its upstream, with conflicts, staged work and a stash', async ($, on) => {
    world(on, {
      status: ['# branch.head (detached)', '# branch.upstream origin/main', '# branch.ab +0 -3', '# stash 2',
        '1 M. N... 1 1 1 a b src/a.ts', '1 .M N... 1 1 1 a b src/b.ts', 'u UU N... 1 1 1 1 a b c src/c.ts', ''].join('\n'),
      top: '/work\n',
      head: 'a1b2c3d\tWire the radar\t2 hours ago\n',
      log: log(['a1b2c3d', 'Wire the radar', 'Ada Lovelace', 2 * 3600_000], ['e4f5a6b', 'Middle', 'Alan Turing', 3 * 864e5], ['0011223', 'First light', 'Grace', 30 * 864e5]),
      numstat: '12\t3\tsrc/a.ts\n0\t9\tsrc/b.ts\n',
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(60) })
    const all = await texts(term)
    expect(all).toContain('⎇ (detached) a1b2c3d → origin/main')
    expect(all).toContain('↓3')
    expect(all).not.toContain('↑')
    expect(all).toContain('●1 staged')
    expect(all).toContain('✖1 conflict')
    expect(all).toContain('⚑2 stash')
    expect(all).toContain('HEAD a1b2c3d Wire the radar')
    expect(all).toContain('── COMMITS 3')
    expect(all).toMatch(/┬◉/)
    expect(all).toMatch(/├●/)
    expect(all).toMatch(/└●/)
    expect(all).toContain('2h Ada')
    await term.unmount()

    const wide = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(60) })
    expect((await svgOf(wide)).source).toContain('detached @ a1b2c3d')
    expect((await svgOf(wide)).source).toContain('2 stash')
    await wide.unmount()

    // A narrow card has no room for every chip.
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(28) })
    const { source, alt } = await svgOf(desk)
    expect(source).toContain('↓3')
    expect(source).toContain('1 staged')
    expect(source).not.toContain('2 stash')
    expect(source).toContain('class="ring"')
    expect(alt).toBe('Branch a1b2c3d tracking origin/main, 0 ahead, 3 behind; 1 staged, 1 changed, 0 new, 1 conflicts; 3 recent commits; 2 changed files')
    await desk.unmount()
  })

  test('clean and in sync, with a stash: a celebration that says pushed', async ($, on) => {
    world(on, {
      status: '# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n# stash 1\n',
      top: '/work',
      head: 'a1b2c3d\tWire the radar\tnow',
      log: log(['a1b2c3d', 'Wire the radar', 'Ada', 60_000]),
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(52) })
    const all = await texts(term)
    expect(all).toContain('≡ in sync')
    expect(all).toContain('✓ working tree clean')
    expect(all).toContain('⚑1 stash')
    expect(all).toMatch(/^◉◉$/m)
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    const { source, alt } = await svgOf(desk)
    expect(source).toContain('≡ in sync')
    expect(source).toContain('Everything committed and pushed.')
    expect(source).not.toContain('HEAD a1b2c3d')
    expect(alt).toContain('working tree clean')
    await desk.unmount()
  })

  test('clean but ahead: committed, not pushed; clean with no upstream and no commits', async ($, on) => {
    const repo: Repo = { status: '# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n', top: '/work', head: 'a1b2c3d\tWire\tnow', log: '' }
    const { clock } = world(on, repo)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(52) })
    expect(await texts(term)).toContain('↑1 ')
    await term.unmount()
    let desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    let card = await svgOf(desk)
    expect(card.source).toContain('↑1')
    expect(card.source).toContain('Everything is committed.')
    expect(card.source).toContain('HEAD a1b2c3d · Wire')
    await desk.unmount()

    repo.status = '# branch.head main\n'
    repo.head = undefined
    await clock.advance(5_000)
    desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    card = await svgOf(desk)
    expect(card.source).toContain('no commits yet')
    expect(card.source).toContain('Everything is committed.')
    await desk.unmount()
  })

  test('files this session touched: inside, relative, notebooks, outside and the root itself', async ($, on) => {
    world(on, {
      status: '# branch.head main\n1 .M N... 1 1 1 a b src/a.ts\n1 .M N... 1 1 1 a b src/z.ts\n1 .M N... 1 1 1 a b src/y.ts\n? new.txt\n',
      top: '/work',
      head: 'a1b2c3d\tWire\tnow',
      numstat: '2\t2\tsrc/y.ts\n2\t2\tsrc/z.ts\n5\t0\tsrc/a.ts\n',
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/new.txt', new_source: 'x' })
    await $.tool.call({ tool: 'Write', file_path: '/elsewhere/x.ts', content: '' })
    await $.tool.call({ tool: 'Write', file_path: '/work', content: '' })
    await $.tool.call({ tool: 'Write', file_path: '/work/clean.ts', content: '' })
    await $.tool.call({ tool: 'Write', file_path: '', content: '' })
    await $.tool.call(loose({ tool: 'NotebookEdit', new_source: 'x' }))
    await $.tool.call({ tool: 'Read', file_path: '/work/src/z.ts' })
    await $.command.run(RUN)

    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(52) })
    const rows = (await term.findAll({ type: 'Text' })).map(t => t.text).filter(t => /^(src\/.+|new\.txt)$/.test(t))
    expect([...new Set(rows)]).toEqual(['src/a.ts', 'new.txt', 'src/y.ts', 'src/z.ts']) // touched first, then churn, then name
    const all = await texts(term)
    expect(all).toContain('touched this session: 2 changed, 3 clean or outside')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    const { source } = await svgOf(desk)
    expect(source).toContain('touched this session · 2 changed · 3 clean or outside')
    expect(source).toContain('class="pulse"')
    await desk.unmount()
  })

  test('a Windows checkout matches touched files whatever their case', async ($, on) => {
    world(on, { status: '# branch.head main\n1 .M N... 1 1 1 a b src/App.ts\n', top: 'D:/Repo\n', cwd: 'D:/Repo', numstat: '1\t1\tsrc/App.ts\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'D:/Repo' })
    await $.tool.call({ tool: 'Edit', file_path: 'd:\\repo\\SRC\\app.ts', old_string: 'a', new_string: 'b' })
    await $.command.run(RUN)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(52) })
    const all = await texts(term)
    expect(all).toContain('touched this session: 1 changed')
    expect(all).not.toContain('clean or outside')
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    expect((await svgOf(desk)).source).toContain('touched this session · 1 changed<')
    await desk.unmount()
  })

  test('a long path keeps its name and drops its folder on a narrow card', async ($, on) => {
    world(on, {
      status: '# branch.head main\n1 .M N... 1 1 1 a b x\n',
      top: '/work',
      numstat: '3\t0\tsome/really/quite/deeply/nested/folder/with/a-very-long-file-name-indeed.ts\n1\t0\ttop.ts\n',
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(30) })
    const { source } = await svgOf(desk)
    expect(source).toContain('<tspan class="m" font-size="10.5"></tspan>')
    expect(source).toContain('>top.ts<')
    await desk.unmount()
  })

  test('the timer refreshes an open radar every five seconds, and when something changed', async ($, on) => {
    const { clock, statusRuns } = world(on, { status: '# branch.head main\n', top: '/work' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(10_000)
    expect(statusRuns()).toBe(0) // closed: no git at all
    await $.tool.call({ tool: 'Bash', command: 'git commit' })
    expect(statusRuns()).toBe(0)
    await $.command.run(RUN)
    expect(statusRuns()).toBe(1)
    await clock.advance(1_000)
    expect(statusRuns()).toBe(1)
    await clock.advance(4_000)
    expect(statusRuns()).toBe(2)
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' }) // denied: nothing changed
    expect(statusRuns()).toBe(2)
    await $.tool.call({ tool: 'Bash', command: 'touch x' })
    expect(statusRuns()).toBe(3)
  })

  test('a change during a slow read is read again on the next tick', async ($, on) => {
    const { clock, statusRuns } = world(on, { status: '# branch.head main\n', top: '/work', slowMs: 2_000 })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const opening = $.command.run(RUN)
    await clock.settle()
    expect(statusRuns()).toBe(1)
    await $.tool.call({ tool: 'Bash', command: 'touch x' }) // busy: marks the radar dirty
    expect(statusRuns()).toBe(1)
    await clock.advance(2_000)
    await opening
    await clock.advance(1_000)
    expect(statusRuns()).toBe(2)
  })

  test('a session with no folder runs git where the engine runs', async ($, on) => {
    const { runs } = world(on, { status: '# branch.head main\n', cwd: '' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every(r => r.cwd === undefined)).toBe(true)
  })

  test('outside a repo, the radar says so', async ($, on) => {
    world(on, {})
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const desk = await $.ui.mount({ plugin: 'gitscope', surface: 'desktop', ...pane(52) })
    expect((await svgOf(desk)).alt).toBe('Not a git repository')
    await desk.unmount()
  })
})

describe('gitscope when the engine fails beneath', () => {
  test('no folder to read and no process to run: the radar still opens', async ($, on) => {
    const open = new Set<string>()
    mock.clock(on, { now: NOW })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      open.add(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect((await $.command.run(RUN)).text).toBe('Gitscope open.')
    // An edit with a relative path needs the session's folder: the note is dropped, the call goes through.
    expect(await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })).toMatchObject({ result: 'ok' })
  })

  test('git that cannot be started reads as no repository', async ($, on) => {
    const open = new Set<string>()
    mock.clock(on, { now: NOW })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      open.add(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
    on('session.cwd', () => ({ value: '/work' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(RUN)
    const term = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', ...pane(40) })
    expect(await term.find({ type: 'Text', text: 'Not a git repository' })).toBeDefined()
    await term.unmount()
  })

  test('a tool call nothing answers passes its failure on; the timer shrugs off an unreadable pane list', async ($, on) => {
    const clock = mock.clock(on)
    let paneLists = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.panes', ($, e, next) => {
      paneLists++
      return next(e)
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await expect($.tool.call({ tool: 'Read', file_path: '/w/a' })).rejects.toThrow()
    await clock.advance(1_000)
    expect(paneLists).toBe(1)
  })
})
