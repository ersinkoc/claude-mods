import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

const COSMIC = ['Warping', 'Orbiting', 'Stargazing', 'Drifting', 'Slingshotting', 'Terraforming', 'Comet-chasing',
  'Moonwalking', 'Docking', 'Hyperjumping', 'Gravitating', 'Eclipsing', 'Pulsating', 'Spacewalking',
  'Star-charting', 'Accreting', 'Ionizing', 'Coalescing', 'Redshifting', 'Transiting', 'Quasar-hunting',
  'Nebula-weaving', 'Starhopping', 'Igniting', 'Free-falling', 'Aligning planets', 'Beaming down']

describe('register', () => {
  test('the spinner word comes from the pack, the tail names the running tool, and /mantra switches packs', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    const seen: RenderPropsOf['Spinner'][] = []
    let release: () => void = () => undefined
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    on('tool.call', async ($, e) => {
      await new Promise<void>(r => { release = r })
      return { result: { stdout: '', stderr: '', interrupted: false }, tool_use_id: e.tool_use_id ?? 'x' }
    })
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      seen.push(e.props)
      const { Text } = $.ui.resolve(e)
      return <Text key="line">{e.props.word}{e.props.suffix}</Text>
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) void c

    const SPIN = { component: 'Spinner' as const, requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
    const think = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    const p0 = seen[seen.length - 1]
    expect(COSMIC).toContain(p0?.word)
    expect(p0?.suffix).toBe('… · ∴ high')
    await think.unmount()

    const running = $.tool.call({ tool: 'Bash', command: 'npm test' })
    await clock.advance(12_000)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mantra', surface, ...SPIN, props: { ...SPIN.props, mode: 'tool-use' as const, word: surface === 'desktop' ? 'Running npm test' : 'Sauteing' } })
      const p = seen[seen.length - 1]
      expect(p?.suffix).toBe('… · $ npm test 0:12')
      if (surface === 'desktop') expect(p?.word).toBe('Running npm test')
      expect(await ui.find({ type: 'Text', text: /npm test 0:12/ })).toBeDefined()
      await ui.unmount()
    }
    release()
    await running

    const { text } = await $.command.run({ command: 'mantra', args: 'turkish', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('turkish')
    const tr = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(seen[seen.length - 1]?.word).toMatch(/[ıüöçşğ]|yor/)
    await tr.unmount()

    await $.command.run({ command: 'mantra', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    const off = await $.ui.mount({ plugin: 'mantra', surface: 'terminal', ...SPIN })
    expect(seen[seen.length - 1]?.word).toBe('Sauteing')
    expect(seen[seen.length - 1]?.suffix).toBe('…')
    await off.unmount()
  })
})
