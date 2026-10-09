import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-hub',
  props: { title: 'KOZMOS', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

describe('register', () => {
  test('/kozmos list marks the installed mods, and the hub draws on terminal and desktop', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('command.list', () => ({ value: [{ name: 'bridge', description: 'x', source: 'plugin' as const, plugin: 'bridge' }] }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const { text } = await $.command.run({ command: 'kozmos', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('✓ /bridge')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'kozmos', surface, ...PANE })
      expect(await ui.find({ type: surface === 'terminal' ? 'Text' : 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})
