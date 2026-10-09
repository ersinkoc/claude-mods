import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

const T0 = Date.parse('2026-10-09T10:00:00Z')
const PORCELAIN = [
  '# branch.head main',
  '1 .M N... 100644 100644 100644 a a src/a.ts',
  '1 .M N... 100644 100644 100644 b b src/b.ts',
  '1 M. N... 100644 100644 100644 c c src/c.ts',
  '? notes.md',
  '? tmp/x.ts',
  '? tmp/y.ts',
].join('\n')

describe('register', () => {
  test('the hint line carries the most urgent hint, by priority, on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on, {})
    let five = 91
    let ctx = 84
    let running = 3
    const seen: RenderPropsOf['PromptHint'][] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.cwd', () => ({ value: '/work' }))
    on('session.usage', () => ({
      value: {
        startedAt: T0,
        context: { tokens: ctx * 10_000, window: 1_000_000, percent: ctx },
        rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-09T10:40:00Z' }],
        cost: { usd: 1 },
      },
    }))
    on('agent.list', () => ({
      value: Array.from({ length: running }, (_, i) => ({ id: `a${i}`, description: 'task', type: 'Explore', status: 'running' as const })),
    }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: PORCELAIN, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('tool.call', ($, e) => ({ result: { ok: true }, tool_use_id: e.tool_use_id ?? 'x' }))
    on('ui.render', { component: 'PromptHint' }, ($, e) => {
      seen.push(e.props)
      const { Text } = $.ui.resolve(e)
      return <Text key="hint">{e.props.hint}{e.props.tail ? ` ${e.props.tail}` : ''}</Text>
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const HINT = { component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } }
    const last = () => seen[seen.length - 1]
    const show = async (surface: 'terminal' | 'desktop') => {
      const ui = await $.ui.mount({ plugin: 'compass', surface, ...HINT })
      const p = last()
      await ui.unmount()
      return p
    }

    expect((await show('terminal'))?.tail).toBe('· 5h 91% — resets in 40m')
    const desk = await show('desktop')
    expect(desk?.hint).toBe('5h 91% — resets in 40m · ? for shortcuts')

    five = 40
    await clock.advance(2000)
    expect((await show('terminal'))?.tail).toBe('· ctx 84% — /compact soon')

    ctx = 30
    await clock.advance(2000)
    expect((await show('terminal'))?.tail).toBe('· ◈ 3 agents working')

    running = 0
    await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b' })
    await clock.advance(2000)
    expect((await show('terminal'))?.tail).toBe('· ✎ 6 files changed — commit?')

    const { text } = await $.command.run({ command: 'compass', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('off')
    const off = await show('terminal')
    expect(off?.tail).toBeUndefined()
    expect(off?.hint).toBe('? for shortcuts')
  })
})
