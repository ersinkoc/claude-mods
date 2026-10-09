import { describe, expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = (maxRows: number, bodyColumns = 100) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/w' }

type Opts = { store?: Record<string, unknown> | false; clock?: 'mock' | 'fail-first' | 'fail-second' | 'none'; prompt?: boolean }

/**
 * Beneath tidewater: an engine band, the tools answering as Claude Code's do
 * (Write creates, Edit patches), a store, a clock (or one that fails on its
 * first or second read), and prompts.
 */
function world(on: On, opts: Opts = {}): { ran: string[] } {
  const ran: string[] = []
  if (opts.clock === undefined || opts.clock === 'mock') mock.clock(on, { now: 50_000 })
  else if (opts.clock !== 'none') {
    let reads = 0
    on('clock.now', ($, e, next) => {
      reads++
      return (opts.clock === 'fail-first' && reads === 1) || (opts.clock === 'fail-second' && reads === 2) ? next(e) : { value: 50_000 }
    })
  }
  if (opts.store !== false) mock.store(on, opts.store ?? {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  if (opts.prompt !== false) on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', ($, e) => {
    ran.push(String(e.tool))
    if (e.tool === 'Write') return { result: { type: 'create' as const, filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
    if (e.tool === 'Edit' && e.old_string === 'denied') return { deny: 'no' }
    if (e.tool === 'Edit' && e.old_string === 'broken') return { result: 'String not found', isError: true }
    if (e.tool === 'Edit' && e.old_string === 'staged') return { result: { staged: true } }
    return { result: 'ok' }
  })
  return { ran }
}

const tidewater = async ($: Engine): Promise<string> => String((await $.command.run({ command: 'tidewater', ...RUN })).text)
const write = ($: Engine, file_path: string, content = 'one\ntwo\n') => $.tool.call({ tool: 'Write', file_path, content })
const edit = ($: Engine, file_path: string, old_string: string, new_string: string) => $.tool.call({ tool: 'Edit', file_path, old_string, new_string })

/** Whether the band shows anything of tidewater's on the surface. */
async function shows($: Engine, surface: 'terminal' | 'desktop' = 'desktop'): Promise<boolean> {
  const ui = await $.ui.mount({ plugin: 'tidewater', surface, ...BAND(20) })
  const found = await ui.find({ key: 'tidewater-hide' })
  await ui.unmount()
  return found !== undefined
}

describe('the hide toggle', () => {
  test('a hidden band is remembered; /tidewater shows it again', async ($, on) => {
    world(on, { store: { hidden: true } })
    await $.session.start(START)
    await write($, '/w/a.ts')
    expect(await shows($)).toBe(false)
    expect(await tidewater($)).toBe('Tidewater shown. This turn: +2 −0 · 1 file.')
    expect(await shows($)).toBe(true)
    expect(await tidewater($)).toBe('Tidewater hidden. This turn: +2 −0 · 1 file.')
  })

  test('a stored value that is not a boolean is ignored; with nothing edited the reply has no totals', async ($, on) => {
    world(on, { store: { hidden: 'yes' } })
    await $.session.start(START)
    expect(await tidewater($)).toBe('Tidewater hidden.')
  })

  test('with no store the toggle still holds for the session', async ($, on) => {
    world(on, { store: false })
    await $.session.start(START)
    await write($, '/w/a.ts')
    expect(await tidewater($)).toMatch(/^Tidewater hidden\./)
    expect(await shows($)).toBe(false)
  })
})

describe('what raises the tide', () => {
  test('only edits that ran, on a path, and were not staged', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await edit($, '/w/a.ts', 'denied', 'x')
    await edit($, '/w/a.ts', 'broken', 'x')
    await edit($, '/w/a.ts', 'staged', 'x')
    await $.tool.call({ tool: 'Edit', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
    expect(w.ran).toEqual(['Edit', 'Edit', 'Edit', 'Edit', 'Read'])
    expect(await shows($)).toBe(false)
    await edit($, '/w/a.ts', 'a', 'a\nb')
    expect(await tidewater($)).toBe('Tidewater hidden. This turn: +1 −0 · 1 file.')
  })

  test('a prompt typed while idle starts a new tide; one queued into the running turn keeps it', async ($, on) => {
    world(on)
    await $.session.start(START)
    await $.prompt.submit({ text: 'first', wait: false, origin: { kind: 'composer' } })
    await write($, '/w/a.ts')
    await $.prompt.submit({ text: 'and also', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
    expect(await shows($)).toBe(true)
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    expect(await shows($)).toBe(false)
  })

  test('a prompt that fails beneath still fails', async ($, on) => {
    world(on, { prompt: false })
    await $.session.start(START)
    await expect($.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })).rejects.toThrow()
  })

  test('when the clock fails while stamping the edit, the tool result stands and nothing is drawn', async ($, on) => {
    world(on, { clock: 'fail-first' })
    await $.session.start(START)
    const r = await write($, '/w/a.ts')
    expect(r.result).toMatchObject({ type: 'create', filePath: '/w/a.ts' })
    expect(await shows($)).toBe(false)
  })

  test('when the clock fails while publishing, the tool result stands and the next edit catches up', async ($, on) => {
    world(on, { clock: 'fail-second' })
    await $.session.start(START)
    const r = await write($, '/w/a.ts')
    expect(r.result).toMatchObject({ type: 'create' })
    expect(await shows($)).toBe(false)
    await write($, '/w/b.ts')
    expect(await tidewater($)).toBe('Tidewater hidden. This turn: +4 −0 · 2 files.')
  })
})

describe('the band', () => {
  test('a short band draws two rows on the terminal and a lower card on the desktop', async ($, on) => {
    world(on)
    await $.session.start(START)
    await write($, '/w/a.ts')
    const term = await $.ui.mount({ plugin: 'tidewater', surface: 'terminal', ...BAND(6) })
    const client = await term.find({ type: 'Client', key: 'tidewater' })
    expect(client?.props.height).toBe(2)
    expect(client?.props.width).toBe(97)
    expect(client?.props.props).toMatchObject({ cols: 97, rows: 2, newest: '/w/a.ts' })
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'tidewater', surface: 'desktop', ...BAND(6) })
    const svg = await desk.find({ type: 'Svg' })
    expect(svg?.props.height).toBe(68)
    expect(svg?.props.alt).toBe('This turn: +2 −0 · 1 file. a.ts +2 −0')
    await desk.unmount()
  })

  test('a tall band draws three rows; no width given reads as 80 columns; VS Code draws the card', async ($, on) => {
    world(on)
    await $.session.start(START)
    await write($, '/w/a.ts')
    await edit($, '/w/b.ts', 'x', 'y')
    const term = await $.ui.mount({ plugin: 'tidewater', surface: 'terminal', ...BAND(12, 0) })
    const client = await term.find({ type: 'Client', key: 'tidewater' })
    expect(client?.props.height).toBe(3)
    expect(client?.props.width).toBe(77)
    expect(client?.props.props).toMatchObject({ newest: '/w/b.ts' })
    await term.press({ key: 'tidewater-hide' })
    expect(await term.find({ type: 'Client' })).toBeUndefined()
    await term.unmount()
    await tidewater($)
    const code = await $.ui.mount({ plugin: 'tidewater', surface: 'vscode', ...BAND(12) })
    expect((await code.find({ type: 'Svg' }))?.props.height).toBe(84)
    await code.unmount()
  })
})
