import { describe, expect, mock, test } from 'claude-code/testing'

import { chipRow, editDelta, lineDelta, mergeEdit, patchDelta, tideFrame, tideSvg, totalsLine } from '../hooks/tide.ts'
import type { TideFile } from '../hooks/tide.ts'

const BAND = (maxRows: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: 100, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})

const FILES: TideFile[] = [
  { path: '/w/src/api.ts', name: 'api.ts', added: 40, removed: 12, edits: 3, at: 1 },
  { path: '/w/src/db.ts', name: 'db.ts', added: 3, removed: 0, edits: 1, at: 2 },
  { path: '/w/README.md', name: 'README.md', added: 85, removed: 30, edits: 2, at: 3 },
]

describe('tide', () => {
  test('line deltas trim the common head and tail and diff the middle', () => {
    expect(lineDelta('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 })
    expect(lineDelta('', 'x\ny\nz')).toEqual({ added: 3, removed: 0 })
    expect(lineDelta('one\ntwo\nthree', 'one\nthree')).toEqual({ added: 0, removed: 1 })
    expect(lineDelta('a\nb\nc\nd', 'a\nx\nb\nc\ny\nd')).toEqual({ added: 2, removed: 0 })
  })

  test('a structuredPatch is counted line by line', () => {
    expect(patchDelta([{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' keep', '-old', '+new', '+more'] }])).toEqual({ added: 2, removed: 1 })
    expect(patchDelta(undefined)).toBeUndefined()
  })

  test('edits fall back to their input when the result has no patch', () => {
    expect(editDelta('Edit', { file_path: '/a.ts', old_string: 'x = 1', new_string: 'x = 1\ny = 2\nz = 3' }, {})).toEqual({ added: 2, removed: 0 })
    expect(editDelta('Write', { file_path: '/b.ts', content: 'l1\nl2\nl3\n' }, { type: 'create', originalFile: null })).toEqual({ added: 3, removed: 0 })
    expect(editDelta('Write', { file_path: '/b.ts', content: 'l1\nL2\nl3\n' }, { type: 'update', originalFile: 'l1\nl2\nl3\n', structuredPatch: [] })).toEqual({ added: 1, removed: 1 })
    expect(editDelta('NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'print(1)\nprint(2)' }, { old_source: 'print(0)' })).toEqual({ added: 2, removed: 1 })
    expect(editDelta('MultiEdit', { file_path: '/m.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'c\nd' }] }, {})).toEqual({ added: 2, removed: 1 })
  })

  test('files merge per path, the newest last, with totals', () => {
    let files: TideFile[] = []
    files = mergeEdit(files, '/w/a.ts', { added: 5, removed: 1 }, 10)
    files = mergeEdit(files, '/w/b.ts', { added: 2, removed: 2 }, 20)
    files = mergeEdit(files, '/w/a.ts', { added: 1, removed: 0 }, 30)
    expect(files.map(f => f.name)).toEqual(['b.ts', 'a.ts'])
    expect(files[1]?.edits).toBe(2)
    expect(totalsLine(files)).toBe('+8 −3 · 2 files')
  })

  test('the terminal waves fill the width exactly and the chips carry the totals', () => {
    const rows = tideFrame(FILES, 70, 3, 12)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect([...r.map(x => x.s).join('')].length).toBe(70)
    expect(rows[0]?.some(r => /[▁▂▃▄▅▆▇█]/.test(r.s))).toBe(true)
    expect(rows[1]?.some(r => /[▔▀█]/.test(r.s))).toBe(true)
    expect(chipRow(FILES, 120, '/w/README.md', 0).map(r => r.s).join('')).toContain('+128 −42 · 3 files')
  })

  test('the desktop svg rolls a green swell and a red ebb per file', () => {
    const src = tideSvg(FILES, 760, 84, 12_345)
    expect(src).toMatch(/^<svg/)
    expect(src).toContain('@keyframes swl')
    expect(src).toContain('README.md')
    expect(src).toContain('+128')
  })
})

describe('register', () => {
  test('edits raise the tide on both surfaces until the next prompt', async ($, on) => {
    mock.clock(on, { now: 50_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('tool.call', ($, e) => {
      if (e.tool === 'Edit') {
        return {
          result: {
            filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: 'a\nb\n', userModified: false, replaceAll: false,
            structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 4, lines: [' a', '-b', '+b2', '+b3', '+b4'] }],
          },
        }
      }
      if (e.tool === 'Write') return { result: { type: 'create' as const, filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
      return { result: 'ok' }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    const calm = await $.ui.mount({ plugin: 'tidewater', surface: 'terminal', ...BAND(20) })
    expect(await calm.find({ type: 'Client' })).toBeUndefined()
    await calm.unmount()

    await $.tool.call({ tool: 'Edit', file_path: '/w/src/app.ts', old_string: 'b', new_string: 'b2\nb3\nb4' })
    await $.tool.call({ tool: 'Write', file_path: '/w/src/new.ts', content: 'one\ntwo\n' })
    await $.tool.call({ tool: 'Read', file_path: '/w/src/app.ts' })

    const term = await $.ui.mount({ plugin: 'tidewater', surface: 'terminal', ...BAND(20) })
    expect(await term.find({ type: 'Client', key: 'tidewater' })).toBeDefined()
    await term.advance(300)
    expect(await term.find({ type: 'Text', text: /\+5/, in: 'tidewater' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /app\.ts/, in: 'tidewater' })).toBeDefined()
    expect(await term.find({ type: 'Button', key: 'tidewater-hide' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'tidewater', surface: 'desktop', ...BAND(20) })
    const src = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(src).toContain('+5')
    expect(src).toContain('new.ts')
    await desk.press({ key: 'tidewater-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    const r = await $.command.run({ command: 'tidewater', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(r.text).toContain('+5 −1 · 2 files')

    await $.prompt.submit({ text: 'next thing', wait: false, origin: { kind: 'composer' } })
    const after = await $.ui.mount({ plugin: 'tidewater', surface: 'desktop', ...BAND(20) })
    expect(await after.find({ type: 'Svg' })).toBeUndefined()
    await after.unmount()
  })

  test('a survey holds the band', async ($, on) => {
    mock.clock(on, { now: 5_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('tool.call', ($, e) => (e.tool === 'Write' ? { result: { type: 'create' as const, filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } } : { result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
    await $.tool.call({ tool: 'Write', file_path: '/w/x.ts', content: 'x' })
    const band = BAND(20)
    const term = await $.ui.mount({ plugin: 'tidewater', surface: 'terminal', ...band, props: { ...band.props, hasSurvey: true } })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
  })
})
