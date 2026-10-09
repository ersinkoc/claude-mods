import { describe, expect, mock, test } from 'claude-code/testing'

import { cwdOf, fmtMs, outcomeOf, runSvg, tellingLine } from '../hooks/shell.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-terminus',
  props: { title: 'KOZMOS · Terminus', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

describe('shell', () => {
  test('the cwd comes from an input or a leading cd', () => {
    expect(cwdOf('cd /d/work && npm test', {})).toBe('/d/work')
    expect(cwdOf('cd "C:/My Dir"; ls', {})).toBe('C:/My Dir')
    expect(cwdOf('ls -la', { cwd: '/tmp' })).toBe('/tmp')
    expect(cwdOf('ls -la', {})).toBeUndefined()
  })

  test('an outcome reads the exit code, the telling error line and the output size', () => {
    const failed = outcomeOf({ isError: true, result: undefined, text: 'Exit code 2\n\nnpm ERR! Missing script: "test"\nmore' })
    expect(failed.status).toBe('fail')
    expect(failed.exit).toBe(2)
    expect(failed.error).toContain('Missing script')
    const ok = outcomeOf({ result: { stdout: 'abc', stderr: 'de', interrupted: false } })
    expect(ok).toMatchObject({ status: 'ok', exit: 0, outBytes: 5 })
    expect(outcomeOf({ deny: 'blocked by policy' }).status).toBe('denied')
    expect(outcomeOf({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }).status).toBe('bg')
    expect(tellingLine('Exit code 1\nwarning: x\nfatal: not a git repository')).toBe('fatal: not a git repository')
    expect(fmtMs(12_400)).toBe('12s')
    expect(fmtMs(420)).toBe('420ms')
  })

  test('a run card is one svg', () => {
    const { source } = runSvg({ id: 'a', tool: 'Bash', command: 'npm test', at: 0, ms: 1200, status: 'fail', exit: 1, error: 'boom', outBytes: 10, who: 'main' }, 340)
    expect(source).toMatch(/^<svg/)
    expect(source).toContain('npm test')
    expect(source).toContain('exit 1')
  })
})

describe('register', () => {
  test('shell runs land in the pane with filters, copy and re-run on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    let copied = ''
    let filled = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.copy', ($, e) => {
      copied = e.text
      return { value: { isCopied: true as const } }
    })
    on('prompt.fill', ($, e) => {
      filled = e.text
      return { isFilled: true }
    })
    on('tool.call', async ($, e) => {
      if (e.tool === 'Bash' && e.command === 'npm test') return { isError: true as const, result: undefined, text: 'Exit code 1\nnpm ERR! Missing script: "test"' }
      if (e.tool === 'Bash' && e.command.startsWith('sleep')) await clock.sleep(12_000)
      return { result: { stdout: 'a.ts\nb.ts\n', stderr: '', interrupted: false } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Bash', command: 'cd /work && ls', description: 'List the files' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    const slow = $.tool.call({ tool: 'Bash', command: 'sleep 12', description: 'Wait a while' })
    await clock.advance(12_000)
    await slow
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })

    const { text } = await $.command.run({ command: 'terminus', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('3 shell commands, 1 failed')
    const opened = await $.command.run({ command: 'terminus', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(opened.text).toBe('Terminus open.')

    const term = await $.ui.mount({ plugin: 'terminus', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /TERMINUS/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1 failed/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Missing script/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /⌂ \/work/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /List the files/ })).toBeDefined()

    await term.press({ key: 'f-failed' })
    expect(await term.find({ type: 'Text', text: /List the files/ })).toBeUndefined()
    expect(await term.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    await term.press({ key: 'f-slow' })
    expect(await term.find({ type: 'Text', text: /sleep 12/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /npm test/ })).toBeUndefined()
    await term.press({ key: 'f-all' })

    const buttons = await term.findAll({ type: 'Button' })
    const copyKey = buttons.find(b => b.key?.startsWith('cp-'))?.key ?? ''
    const fillKey = buttons.find(b => b.key?.startsWith('rp-'))?.key ?? ''
    await term.press({ key: copyKey })
    expect(copied).toBe('sleep 12')
    await term.press({ key: fillKey })
    expect(filled).toBe('Run again: sleep 12')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'terminus', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(4)
    expect(String(svgs[0]?.props.source)).toContain('TERMINUS')
    expect(await desk.find({ type: 'Button', text: /prompt/ })).toBeDefined()
    await desk.unmount()
  })

  test('an empty session draws a hint on both surfaces', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'terminus', surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /No shell commands yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
