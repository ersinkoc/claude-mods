import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { diffBar, fmtAgo, normPath, relTo, untrackedOf } from '../hooks/scope.ts'

const PANE_ID = 'kz-gitscope'
const PROPS = { title: 'KOZMOS · Gitscope', isFocused: false, bodyColumns: 52, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

const STATUS = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '# stash 1',
  '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
  '1 M. N... 100644 100644 100644 aaa bbb README.md',
  '? notes.txt',
  '',
].join('\n')
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const NOW = Date.UTC(2030, 0, 1)
const LOG = [
  `a1b2c3d\tWire the radar\t2 hours ago\tAda Lovelace\t${(NOW - 2 * 3600_000) / 1000}`,
  `e4f5a6b\tFirst light\t3 days ago\tAlan Turing\t${(NOW - 3 * 864e5) / 1000}`,
].join('\n')

type Repo = { status: string; numstat: string; isRepo: boolean }

function world(on: On, repo: Repo): { open: Set<string> } {
  const open = new Set<string>()
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.cwd', () => ({ value: '/work' }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!repo.isRepo) return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.startsWith('git status')) return ok(repo.status)
    if (argv.startsWith('git rev-parse')) return ok('/work\n')
    if (argv.startsWith('git log -1')) return ok('a1b2c3d\tWire the radar\t2 hours ago\n')
    if (argv.startsWith('git log')) return ok(LOG)
    if (argv.startsWith('git diff')) return ok(repo.numstat)
    return ok('')
  })
  return { open }
}

describe('gitscope', () => {
  test('the radar shows branch, commits, changes and the session marker', async ($, on) => {
    const { open } = world(on, { isRepo: true, status: STATUS, numstat: '12\t3\tsrc/app.ts\n4\t0\tREADME.md\n' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/app.ts', old_string: 'a', new_string: 'b' })
    await $.command.run({ command: 'gitscope', ...RUN })
    expect(open.has(PANE_ID)).toBe(true)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'gitscope', surface, component: 'Pane', requestId: PANE_ID, props: PROPS })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /⎇ main/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /Wire the radar/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /app\.ts/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /✎/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /↑2/ })).toBeDefined()
      } else {
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
      }
      await ui.unmount()
    }

    await $.command.run({ command: 'gitscope', ...RUN })
    expect(open.has(PANE_ID)).toBe(false)
  })

  test('a clean tree celebrates', async ($, on) => {
    world(on, { isRepo: true, status: '# branch.head main\n', numstat: '' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'gitscope', ...RUN })
    const ui = await $.ui.mount({ plugin: 'gitscope', surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PROPS })
    expect(await ui.find({ type: 'Text', text: /working tree clean/ })).toBeDefined()
    await ui.unmount()
  })

  test('outside a repo the pane says so kindly', async ($, on) => {
    world(on, { isRepo: false, status: '', numstat: '' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'gitscope', ...RUN })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'gitscope', surface, component: 'Pane', requestId: PANE_ID, props: PROPS })
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /Not a git repository/ })).toBeDefined()
      else expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pure helpers', () => {
    expect(normPath('D:\\Code\\X\\')).toBe('d:/code/x')
    expect(normPath('/d/Code/x')).toBe('d:/code/x')
    expect(relTo('D:/Code', 'd:\\code\\src\\a.ts')).toBe('src/a.ts')
    expect(relTo('/work', '/elsewhere/a.ts')).toBe(undefined)
    expect(untrackedOf('? a.txt\n1 .M x\n? "b c.txt"\n')).toEqual(['a.txt', 'b c.txt'])
    expect(fmtAgo(30_000)).toBe('now')
    expect(fmtAgo(3 * 3600_000)).toBe('3h')
    const b = diffBar(10, 10, 20, 8)
    expect(b.add).toBe('████')
    expect(b.rem).toBe('████')
  })
})
