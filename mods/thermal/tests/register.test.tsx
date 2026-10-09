import { describe, expect, mock, test } from 'claude-code/testing'

import { HALF_LIFE_MS, buildTree, decayed, flatten, hit, squarify, treePath } from '../hooks/heatmap.ts'

const PANE_ID = 'kz-thermal'
const PROPS = { title: 'KOZMOS · Thermal', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('thermal', () => {
  test('touches warm the tree and the treemap; the button switches metric', async ($, on) => {
    const clock = mock.clock(on, { now: 5_000_000 })
    const open = new Set<string>()
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

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      await $.command.run({ command: 'thermal', ...RUN })
      const empty = await $.ui.mount({ plugin: 'thermal', surface, component: 'Pane', requestId: PANE_ID, props: PROPS })
      if (surface === 'terminal') expect(await empty.find({ type: 'Text', text: /No files touched yet/ })).toBeDefined()
      else expect(await empty.find({ type: 'Svg' })).toBeDefined()
      await empty.unmount()
      await $.command.run({ command: 'thermal', ...RUN })
    }

    await $.tool.call({ tool: 'Read', file_path: '/work/src/hooks/register.tsx' })
    await $.tool.call({ tool: 'Read', file_path: '/work/src/hooks/register.tsx' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/hooks/register.tsx', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/work/src/lib/util.ts', content: 'x' })
    await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
    await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: '/work/src' })
    await $.tool.call({ tool: 'Glob', pattern: '*.ts' })
    await clock.advance(1000)
    await $.command.run({ command: 'thermal', ...RUN })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'thermal', surface, component: 'Pane', requestId: PANE_ID, props: PROPS })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /register\.tsx/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /src/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /4 paths/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /r2 e1/ })).toBeDefined()
      } else {
        expect(await ui.find({ type: 'Svg' })).toBeDefined()
      }
      expect(await ui.find({ type: 'Button', text: /heat → reads/ })).toBeDefined()
      await ui.press({ key: 'metric' })
      expect(await ui.find({ type: 'Button', text: /reads → edits/ })).toBeDefined()
      await ui.press({ key: 'metric' })
      await ui.press({ key: 'metric' })
      await ui.unmount()
    }
  })

  test('heat, paths, tree and squarify', () => {
    expect(Math.abs(decayed(8, 0, HALF_LIFE_MS) - 4) < 1e-9).toBe(true)
    expect(treePath('/work', '/work/src/a.ts')).toBe('src/a.ts')
    expect(treePath('D:\\Code', 'd:/code/src/./x/../a.ts')).toBe('src/a.ts')
    expect(treePath('/work', 'lib/b.ts')).toBe('lib/b.ts')
    expect(treePath('/work', '/etc/hosts')).toBe('↗ outside/etc/hosts')

    let f = hit(undefined, 'src/a/b/c.ts', 'read', 0)
    f = hit(f, 'src/a/b/c.ts', 'edit', 0)
    const tree = buildTree([f, hit(undefined, 'src/z.ts', 'write', 0)], 0)
    const { rows } = flatten(tree, 'heat', 10)
    expect(rows.map(r => r.node.name)).toEqual(['src', 'a/b', 'c.ts', 'z.ts'])
    expect(Math.abs(rows[0]!.node.stats.heat - 8) < 1e-9).toBe(true)

    const rects = squarify([6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ value, item: i })), { x: 0, y: 0, w: 6, h: 4 })
    expect(rects.length).toBe(7)
    const area = rects.reduce((a, r) => a + r.w * r.h, 0)
    expect(Math.abs(area - 24) < 1e-6).toBe(true)
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(6.0001)
      expect(r.y + r.h).toBeLessThanOrEqual(4.0001)
    }
  })
})
