import { describe, expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PANE_ID = 'kz-thermal'
const PROPS = { title: 'KOZMOS · Thermal', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

type World = { clock: MockClock; open: Set<string>; panes: { isBroken: boolean }; ran: string[] }

/**
 * Beneath thermal: a clock, panes kept in a set, the session folder `/work`
 * (`cwd: 'fail-once'` fails the first ask, `'fail'` every ask), and tools
 * that run (or are refused with `deny`).
 */
function world(on: On, opts: { cwd?: 'ok' | 'fail-once' | 'fail'; deny?: boolean } = {}): World {
  const w: World = { clock: mock.clock(on, { now: 5_000_000 }), open: new Set(), panes: { isBroken: false }, ran: [] }
  let cwdAsks = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    w.open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', ($, e, next) => (w.panes.isBroken ? next(e) : { value: [...w.open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.cwd', ($, e, next) => {
    cwdAsks++
    if (opts.cwd === 'fail' || (opts.cwd === 'fail-once' && cwdAsks === 1)) return next(e)
    return { value: '/work' }
  })
  on('tool.call', ($, e) => {
    w.ran.push(String(e.tool))
    return opts.deny ? { deny: 'not allowed' } : { result: { ok: true } }
  })
  return w
}

const thermal = async ($: Engine): Promise<string> => String((await $.command.run({ command: 'thermal', ...RUN })).text)
const read = ($: Engine, file_path: string) => $.tool.call({ tool: 'Read', file_path })
const mount = ($: Engine, surface: 'terminal' | 'desktop', props: Partial<typeof PROPS> = {}) =>
  $.ui.mount({ plugin: 'thermal', surface, component: 'Pane', requestId: PANE_ID, props: { ...PROPS, ...props } })

describe('recording touches', () => {
  test('/thermal toggles the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await thermal($)).toBe('Thermal open.')
    expect(w.open.has(PANE_ID)).toBe(true)
    expect(await thermal($)).toBe('Thermal closed.')
    expect(w.open.size).toBe(0)
  })

  test('every tracked tool counts; other tools, missing paths and refused calls do not', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    await read($, '/work/a.ts')
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'MultiEdit', file_path: '/work/a.ts', edits: [] } as never)
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/n.ipynb', new_source: 'x' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/work/w.ts', content: 'x' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/src' })
    await $.tool.call({ tool: 'Glob', pattern: '*.ts', path: '/work/src' })
    await $.tool.call({ tool: 'Bash', command: 'cat /work/b.ts' })
    await $.tool.call({ tool: 'Read', file_path: 7 } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' })
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: ' 4 paths · 7 touches' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'r1 e2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'e1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'w1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 's2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'n.ipynb' })).toBeDefined()
    await ui.unmount()
  })

  test('a refused call is not a touch', async ($, on) => {
    const w = world(on, { deny: true })
    await $.session.start(START)
    await thermal($)
    const r = await read($, '/work/a.ts')
    expect(r.deny).toBe('not allowed')
    expect(w.ran).toEqual(['Read'])
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /No files touched yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('the session folder is asked again later when it was not known at the start', async ($, on) => {
    world(on, { cwd: 'fail-once' })
    await $.session.start(START)
    await read($, '/work/src/x.ts')
    await thermal($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'src/' })).toBeDefined()
    await ui.unmount()
  })

  test('when the session folder cannot be known, touches are dropped and the call still answers', async ($, on) => {
    world(on, { cwd: 'fail' })
    await $.session.start(START)
    const r = await read($, '/work/src/x.ts')
    expect(r.result).toEqual({ ok: true })
    await thermal($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /No files touched yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('a failing call beneath still fails, recorded or not', async ($, on) => {
    mock.clock(on, { now: 0 })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.cwd', () => ({ value: '/work' }))
    await $.session.start(START)
    await expect(read($, '/work/a.ts')).rejects.toThrow()
  })

  test('past 500 paths the coldest one is dropped', { timeoutMs: 20_000 }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await read($, '/work/cold.ts')
    await w.clock.advance(60 * 60_000)
    for (let i = 0; i < 500; i++) await read($, `/work/f${i}.ts`)
    await thermal($)
    const ui = await mount($, 'terminal', { scroll: { offset: 0, bodyRows: 600 } })
    expect(await ui.find({ type: 'Text', text: ' 500 paths · 500 touches' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'cold.ts' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('keeping the pane fresh', () => {
  test('an open pane redraws at once for a touch, and every 15 s so heat cools', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await thermal($)
    await read($, '/work/a.ts')
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'now' })).toBeDefined()
    // 10 s on: the 5 s ticks find nothing new and nothing old enough.
    await w.clock.advance(10_000)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'now' })).toBeDefined()
    // 40 s on: the ticks at 15 s and 30 s republished, so the touch reads 30 s old.
    await w.clock.advance(30_000)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: '30s' })).toBeDefined()
    await ui.unmount()
  })

  test('a closed pane is left alone; an empty open one is not redrawn on a timer', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await read($, '/work/a.ts')
    await w.clock.advance(20_000)
    const closed = await mount($, 'terminal')
    // Never published: the pane draws from nothing.
    expect(await closed.find({ type: 'Text', text: /No files touched yet/ })).toBeDefined()
    await closed.unmount()
    await thermal($)
    await thermal($)
    expect(w.open.size).toBe(0)
  })

  test('a pane opened at start is filled by the first tick; a failing panes list is shrugged off', { options: { autoOpen: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.open.has(PANE_ID)).toBe(true)
    await w.clock.advance(5000)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: ' 0 paths · 0 touches' })).toBeDefined()
    await ui.unmount()
    w.panes.isBroken = true
    await w.clock.advance(20_000)
    w.panes.isBroken = false
    expect(await thermal($)).toBe('Thermal closed.')
  })
})

describe('the terminal tree', () => {
  test('narrow panes drop the age column; short ones fold the rest into "… more"', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) await read($, `/work/${f}.ts`)
    await w.clock.advance(3 * 60_000)
    await thermal($)
    const wide = await mount($, 'terminal')
    expect(await wide.find({ type: 'Text', text: '3m' })).toBeDefined()
    await wide.unmount()
    const narrow = await mount($, 'terminal', { bodyColumns: 30, scroll: { offset: 0, bodyRows: 6 } })
    expect(await narrow.find({ type: 'Text', text: '3m' })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: '  … 2 more' })).toBeDefined()
    await narrow.unmount()
    // No sizes given: 40 columns (no ages) and 30 rows.
    const unsized = await mount($, 'terminal', { bodyColumns: 0, scroll: { offset: 0, bodyRows: 0 } })
    expect(await unsized.find({ type: 'Text', text: /more/ })).toBeUndefined()
    expect(await unsized.find({ type: 'Text', text: '3m' })).toBeUndefined()
    await unsized.unmount()
  })

  test('folders, their files and the bars; the metric button cycles heat, reads, edits', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    await read($, '/work/src/a.ts')
    await read($, '/work/src/a.ts')
    await $.tool.call({ tool: 'Write', file_path: '/work/src/b.ts', content: '' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/docs' })
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'src/' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▾ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '□' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: '■' })).length).toBeGreaterThan(5)
    expect(await ui.find({ type: 'Button', text: '◐ heat → reads' })).toBeDefined()
    await ui.press({ key: 'metric' })
    expect(await ui.find({ type: 'Button', text: '◐ reads → edits' })).toBeDefined()
    await ui.press({ key: 'metric' })
    expect(await ui.find({ type: 'Button', text: '◐ edits → heat' })).toBeDefined()
    // Sized by edits, the searched folder drops out.
    expect(await ui.find({ type: 'Text', text: 'docs' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the desktop treemap', () => {
  test('an empty session: the placeholder card', async ($, on) => {
    world(on)
    await $.session.start(START)
    const ui = await mount($, 'desktop')
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.alt).toBe('No files touched yet')
    expect(String(svg?.props.source)).toMatch(/No files touched yet/)
    await ui.unmount()
  })

  test('nothing to size by the chosen metric yet', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    await read($, '/work/a.ts')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'metric' })
    await ui.press({ key: 'metric' })
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toMatch(/Nothing to size by edits yet/)
    expect(svg?.props.alt).toBe('Treemap of 1 files by edits; hottest: ')
    await ui.unmount()
  })

  test('one big tile: large label, its counts, and the glow on the hottest', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    await read($, '/work/big.ts')
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/big.ts' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/big.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/work/big.ts', content: '' })
    const ui = await mount($, 'desktop', { bodyColumns: 120 })
    const svg = await ui.find({ type: 'Svg' })
    const src = String(svg?.props.source)
    expect(svg?.props.alt).toBe('Treemap of 1 files by heat; hottest: big.ts (8.5)')
    expect(src).toMatch(/font-size="12"[^>]*>big\.ts</)
    expect(src).toMatch(/>r1 s1 e1 w1</)
    expect(src).toMatch(/big\.ts · heat 8\.5 · 1 reads · 1 searches · 1 edits · 1 writes/)
    expect(src).toMatch(/class="glow"[^>]*stroke=/)
    await ui.unmount()
  })

  test('nested folders, folder leaves too small to nest, and tiles too small for text', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    // A folder per level with a file of its own, six levels down.
    let dir = '/work'
    for (const d of ['a', 'b', 'c', 'd', 'e', 'f']) {
      dir += `/${d}`
      await read($, `${dir}/x${d}.ts`)
    }
    await $.tool.call({ tool: 'Write', file_path: '/work/hot.ts', content: '' })
    await $.tool.call({ tool: 'Write', file_path: '/work/hot.ts', content: '' })
    for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'Grep', pattern: 'x', path: `/work/many/m${i}.ts` })
    const ui = await mount($, 'desktop')
    const src = String((await ui.find({ type: 'Svg' }))?.props.source)
    // Nested folders draw a frame and a heading.
    expect(src).toMatch(/fill-opacity="\.16"/)
    expect(src).toMatch(/>many\/</)
    // A folder that cannot nest is a tile, its name ending in "/".
    expect(src).toMatch(/<title>a\/b\/c\/d\/e\/f\/ · heat/)
    // Small tiles carry a title but no text; mid-sized ones the smaller font.
    expect(src).toMatch(/<title>a\/b\/c\/d\/e\/xe\.ts · heat 1\.0 · 1 reads/)
    expect(src).not.toMatch(/>xe\.ts</)
    expect(src).toMatch(/font-size="10.5"[^>]*>m11\.ts</)
    await ui.unmount()
  })

  test('a folder too narrow to nest is one labelled tile; medium tiles skip the counts line', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    for (const f of ['p', 'q', 'r', 's']) await $.tool.call({ tool: 'Edit', file_path: `/work/${f}.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/g/a.ts' })
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/g/b.ts' })
    const ui = await mount($, 'desktop')
    const src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toMatch(/<title>g\/ · heat 1\.0 · 0 reads · 2 searches/)
    expect(src).toMatch(/>g\/<\/text>/)
    // The folder's files are not drawn on their own.
    expect(src).not.toMatch(/<title>g\/a\.ts/)
    // A tile with room for its name but not its counts.
    expect(src).not.toMatch(/>s2</)
    await ui.unmount()
  })

  test('the hottest tile gets no glow when it is a sliver', async ($, on) => {
    world(on)
    await $.session.start(START)
    await thermal($)
    // The hottest by heat (a write) is the smallest by reads.
    await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/work/hot.ts' })
    await $.tool.call({ tool: 'Write', file_path: '/work/hot.ts', content: '' })
    for (let i = 0; i < 36; i++) for (let k = 0; k < 4; k++) await read($, `/work/f${String(i).padStart(2, '0')}.ts`)
    const ui = await mount($, 'desktop', { bodyColumns: 10 })
    await ui.press({ key: 'metric' })
    const src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toMatch(/<title>hot\.ts · heat 4\.5/)
    expect(src).not.toMatch(/class="glow" x=/)
    await ui.press({ key: 'metric' })
    await ui.press({ key: 'metric' })
    // Sized by heat it is the biggest tile, and it glows.
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/class="glow" x=/)
    await ui.unmount()
  })
})
