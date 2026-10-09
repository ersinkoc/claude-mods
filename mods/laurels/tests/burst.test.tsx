import { describe, expect, test } from 'claude-code/testing'
import type { ClientSurface } from 'claude-code'

import Burst from '../hooks/burst.tsx'

type P = { cols: number; name: string; glyph: string; color: string; cheer: string; more: number }
type S = { f: number }

const PROPS: P = { cols: 80, name: 'Hydra', glyph: '🐉', color: '#a78bfa', cheer: 'five agents at once', more: 0 }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} }

/**
 * A surface as the engine hands it to the module: `setState` lands on the
 * next frame (`flush`), `every` registers a timer the test fires itself.
 */
function fakeSurface(elements: unknown) {
  let pending: S | undefined
  const timers: (() => void)[] = []
  const surface = {
    elements,
    state: undefined as S | undefined,
    setState(next: S) {
      pending = next
    },
    columns: 80,
    rows: 1,
    every(_ms: number, fn: () => void) {
      timers.push(fn)
      return () => undefined
    },
    onPointer: () => () => undefined,
    onKey: () => () => undefined,
    post: () => undefined,
  }
  return {
    surface: surface as unknown as ClientSurface<S>,
    flush() {
      if (pending) surface.state = pending
      pending = undefined
    },
    tick() {
      for (const t of timers) t()
    },
    timers,
  }
}

describe('the terminal burst', () => {
  test('the first frame starts the clock; the timer counts frames on', async ($, on) => {
    let s: ReturnType<typeof fakeSurface> | undefined
    let props = PROPS
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const ui = $.ui.resolve(e)
      if (!('Client' in ui)) throw new Error('terminal only')
      s ??= fakeSurface({ Box: ui.Box, Text: ui.Text })
      return Burst(props, s.surface) as never
    })
    const draw = async () => {
      const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      const colors = (await ui.findAll({ type: 'Text' })).map(t => t.props.color)
      await ui.unmount()
      return { line: texts[0] ?? '', texts, colors }
    }
    // Frame 0, state not landed yet: a trophy, the label, the name, the cheer.
    const first = await draw()
    expect(first.line.startsWith('🏆  UNLOCKED  🐉 Hydra — five agents at once ')).toBe(true)
    expect(s?.timers).toHaveLength(1)
    // A tick before the state lands still counts from zero.
    s?.tick()
    s?.flush()
    expect(s?.surface.state).toEqual({ f: 1 })
    // Frames on: the trophy turns to a sparkle at frame 8.
    for (let i = 0; i < 7; i++) {
      s?.tick()
      s?.flush()
    }
    expect((await draw()).line.startsWith('✨ ')).toBe(true)
    // More unlocks waiting are counted; a bad color falls back to gold.
    props = { ...PROPS, more: 2, color: 'violet' }
    const more = await draw()
    expect(more.line).toContain('— five agents at once  (+2 more) ')
    expect(more.colors).toContain('#facc15')
  })

  test('confetti fills the spare row; a full row ends on a sparkle', async ($, on) => {
    let props = PROPS
    let s: ReturnType<typeof fakeSurface> | undefined
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const ui = $.ui.resolve(e)
      if (!('Client' in ui)) throw new Error('terminal only')
      s ??= fakeSurface({ Box: ui.Box, Text: ui.Text })
      return Burst(props, s.surface) as never
    })
    const draw = async () => {
      const ui = await $.ui.mount({ plugin: 'laurels', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      await ui.unmount()
      return texts[0] ?? ''
    }
    // Cells of a row: the trophy is two wide.
    const cells = (line: string) => Array.from(line).length + (line.startsWith('🏆') ? 1 : 0)
    props = { ...PROPS, glyph: '✦' }
    const wide = await draw()
    // The row is the width asked for, the spare cells carrying confetti.
    expect(cells(wide)).toBe(80)
    expect(/[✦✧·*⋆˚•✶]/.test(wide.slice(45))).toBe(true)
    // No width: sixty cells.
    props = { ...PROPS, glyph: '✦', cols: 0 }
    expect(cells(await draw())).toBe(60)
    // No room left: a sparkle closes the row.
    props = { ...PROPS, cols: 10 }
    expect((await draw()).endsWith('✦')).toBe(true)
  })
})
