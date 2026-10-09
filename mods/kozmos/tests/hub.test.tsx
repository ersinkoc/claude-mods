import { describe, expect, test } from 'claude-code/testing'

import { CATALOG } from '../hooks/catalog.ts'
import { modCard } from '../hooks/register.tsx'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const pane = (bodyColumns: number) => ({
  component: 'Pane' as const,
  requestId: 'kz-hub',
  props: { title: 'KOZMOS', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})
const HUB = { plugin: 'kozmos', key: 'hub' } as const

describe('hub', () => {
  test('/kozmos opens the hub pane, then closes it', async ($, on) => {
    let open = false
    const calls: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({ value: [{ name: 'gitscope', description: 'x', source: 'plugin' as const, plugin: 'gitscope' }] }))
    on('ui.panes', () => ({ value: open ? [{ id: 'kz-hub', title: 'KOZMOS', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      open = true
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      open = false
      return { value: undefined }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    expect((await $.command.run({ command: 'kozmos', args: '', ...RUN })).text).toBe('KOZMOS hub open.')
    expect((await $.command.run({ command: 'kozmos', args: 'list', ...RUN })).text).toContain('✓ /gitscope')
    expect((await $.command.run({ command: 'kozmos', args: '  ', ...RUN })).text).toBe('KOZMOS hub closed.')
    expect(calls).toEqual(['open kz-hub KOZMOS', 'close kz-hub'])
  })

  test('/kozmos list keeps what the hub knew when the command list fails', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const { text } = await $.command.run({ command: 'kozmos', args: 'list', ...RUN })
    expect(text).toContain(`KOZMOS — 0/${CATALOG.length} mods active`)
    expect(text).toContain('Sidebars:')
    expect(text).toContain('· /gitscope — a git radar sidebar.')
    expect(text).not.toContain('✓')
  })

  test('terminal hub: filters, open buttons and the last run line', async ($, on) => {
    const ran: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({
      value: ['gitscope', 'verdict', 'warden'].map(name => ({ name, description: 'x', source: 'plugin' as const, plugin: name })),
    }))
    on('command.run', ($, e, next) => {
      ran.push(e.command)
      if (e.command === 'gitscope') return { text: 'Gitscope open.' }
      if (e.command === 'verdict') return {}
      return next(e)
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const ui = await $.ui.mount({ plugin: 'kozmos', surface: 'terminal', ...pane(48) })
    expect(await ui.find({ type: 'Text', text: /3\/\d+ active/ })).toBeDefined()
    expect((await ui.find({ key: 'f-all' }))?.props.label).toBe('● All')
    expect(await ui.find({ type: 'Text', text: /Breadcrumbs/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^not installed$/ })).length).toBe(CATALOG.length - 3)

    await ui.press({ key: 'f-band' })
    expect((await ui.find({ key: 'f-band' }))?.props.label).toBe('● Bands')
    expect((await ui.find({ key: 'f-all' }))?.props.label).toBe('○ All')
    expect(await ui.find({ type: 'Text', text: /Breadcrumbs/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Verdict/ })).toBeDefined()

    await ui.press({ key: 'run-verdict' })
    expect(await ui.find({ type: 'Text', text: '/verdict: done' })).toBeDefined()

    await ui.press({ key: 'f-pane' })
    await ui.press({ key: 'run-gitscope' })
    expect(await ui.find({ type: 'Text', text: '/gitscope: Gitscope open.' })).toBeDefined()

    await ui.press({ key: 'f-guard' })
    await ui.press({ key: 'run-warden' })
    expect(await ui.find({ type: 'Text', text: '/warden: no implementation for command.run' })).toBeDefined()
    expect(ran).toEqual(['verdict', 'gitscope', 'warden'])
    await ui.unmount()
  })

  test('terminal hub with no width reported, and a filter with no mods', async ($, on) => {
    let filter = 'all'
    // A filter the hub has no mods under (a category added to the catalog later).
    on('state.get', HUB, ($, e, next) => (filter === 'all' ? next(e) : { value: { value: { installed: [], filter }, version: 1 } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount({ plugin: 'kozmos', surface: 'terminal', ...pane(0) })
    expect(await ui.find({ type: 'Text', text: /0\/\d+ active/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Nothing here yet.' })).toBeUndefined()
    await ui.unmount()

    filter = 'extra'
    const empty = await $.ui.mount({ plugin: 'kozmos', surface: 'terminal', ...pane(48) })
    expect(await empty.find({ type: 'Text', text: 'Nothing here yet.' })).toBeDefined()
    await empty.unmount()
  })

  test('desktop hub: banner, cards and Open buttons', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({ value: [{ name: 'gearbox', description: 'x', source: 'plugin' as const, plugin: 'gearbox' }] }))
    on('command.run', () => ({ text: 'Gearbox open.' }))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

    const ui = await $.ui.mount({ plugin: 'kozmos', surface: 'desktop', ...pane(60) })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(CATALOG.length + 1)
    expect(svgs[0]?.props.alt).toBe(`KOZMOS, 1 of ${CATALOG.length} mods active`)
    expect(String(svgs[0]?.props.source)).toContain('1 of')
    const gearbox = svgs.find(s => String(s.props.alt).startsWith('Gearbox'))
    expect(String(gearbox?.props.source)).toContain('/gearbox')
    expect(String(gearbox?.props.source)).toContain('class="pulse"')

    await ui.press({ key: 'f-tool' })
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
    await ui.press({ key: 'run-polaroid' })
    expect(await ui.find({ type: 'Text', text: '/polaroid: Gearbox open.' })).toBeDefined()
    await ui.unmount()
  })

  test('a card for a category the hub has no filter for', () => {
    const off = modCard(300, { name: 'later', title: 'Later', category: 'extra', blurb: 'a mod from the future.' }, false)
    expect(off).toContain('not installed')
    expect(off).toContain('>a mod from the future.<')
    expect(off).toContain('fill="none"')
    const on = modCard(300, { name: 'later', title: 'Later', category: 'extra', blurb: 'a mod from the future.' }, true)
    expect(on).toContain('/later')
    expect(on).toContain('class="pulse"')
    const pane = modCard(300, { name: 'x', title: 'X', category: 'pane', blurb: 'b.' }, true)
    expect(pane).toContain('sidebar · b.')
  })
})
