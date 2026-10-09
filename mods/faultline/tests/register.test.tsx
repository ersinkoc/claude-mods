import { describe, expect, mock, test } from 'claude-code/testing'

import { addFault, buckets, emptySnap, mask, signatureOf, tellingLine } from '../hooks/lens.ts'

const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-faultline',
  props: { title: 'KOZMOS · Faultline', isFocused: false, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

describe('lens', () => {
  test('masking folds paths, numbers, urls and ids', () => {
    expect(mask('ENOENT: no such file, open \'/work/src/a.ts\' at line 42')).toBe("ENOENT: no such file, open '<path>' at line #")
    expect(mask('GET https://x.dev/a?b=1 failed with 503')).toBe('GET <url> failed with #')
    expect(mask('commit 3f9ac21d not found in C:\\repo\\x')).toBe('commit <id> not found in <path>')
  })

  test('two failures that differ only in a path share one signature', () => {
    const a = signatureOf('Read', 'File does not exist: /work/a.ts')
    const b = signatureOf('Read', 'File does not exist: /work/lib/b.ts')
    expect(a.sig).toBe(b.sig)
    expect(signatureOf('Bash', 'Exit code 1\nnpm ERR! Missing script: "test"').head).toBe('exit # · npm ERR! Missing script: "test"')
    expect(tellingLine('Exit code 2\nwarning: x\nfatal: bad object')).toBe('fatal: bad object')
  })

  test('faults group, count and fill the severity strip', () => {
    const s = emptySnap(0)
    addFault(s, { tool: 'Read', kind: 'error', text: 'File does not exist: /a', at: 60_000, who: 'main' })
    addFault(s, { tool: 'Read', kind: 'error', text: 'File does not exist: /b', at: 120_000, who: 'Explore tests' })
    addFault(s, { tool: 'Bash', kind: 'error', text: 'Exit code 1\nboom', at: 130_000, who: 'main' })
    expect(s.faults).toHaveLength(2)
    expect(s.faults[1]?.count).toBe(2)
    expect(s.faults[1]?.agents).toEqual(['main', 'Explore tests'])
    expect(s.total).toBe(3)
    const b = buckets(s.hits, 130_000)
    expect(b.reduce((x, y) => x + y, 0)).toBe(3)
    expect(b[19]).toBe(2)
  })
})

describe('register', () => {
  test('failures, refusals and API errors group into signatures on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
    let copied = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.copy', ($, e) => {
      copied = e.text
      return { value: { isCopied: true as const } }
    })
    on('turn.complete', () => ({ text: '' }))
    on('classic.StopFailure', () => ({}))
    on('tool.call', ($, e) => {
      if (e.tool === 'Read') return { isError: true as const, result: undefined, text: `File does not exist: ${e.file_path}` }
      if (e.tool === 'Bash' && e.command === 'rm -rf /') return { deny: 'blocked by policy' }
      if (e.tool === 'Bash') return { isError: true as const, result: undefined, text: 'Exit code 1\nline two\nnpm ERR! Missing script: "test"\nnpm ERR! more\nfour\nfive' }
      return { result: 'ok' }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await clock.advance(5000)
    await $.tool.call({ tool: 'Read', file_path: '/work/lib/b.ts' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
    await $.tool.call({ tool: 'Glob', pattern: '*.ts' })
    await $.turn.complete({ answer: '', durationMs: 100, isAborted: false, turnId: 't1', reason: 'refusal', refusal: { category: 'cyber', explanation: 'declined' } })
    await $.classic.StopFailure({ error: 'rate_limit', error_details: '429 Too Many Requests' })

    const { text } = await $.command.run({ command: 'faultline', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    expect(text).toContain('6 failures in 5 signatures')

    const term = await $.ui.mount({ plugin: 'faultline', surface: 'terminal', ...PANE })
    expect(await term.find({ type: 'Text', text: /FAULTLINE/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: / 2× / })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /File does not exist: <path>/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /denied/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /Refusal: cyber/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /rate_limit/ })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /npm ERR! more/ })).toBeUndefined()

    const buttons = await term.findAll({ type: 'Button' })
    const bashFault = (await term.findAll({ type: 'Button', text: /more/ })).length
    expect(bashFault).toBe(5)
    // Unfold every signature: the long Bash error shows its later lines.
    for (const b of buttons.filter(x => x.key?.startsWith('x-'))) await term.press({ key: b.key ?? '' })
    expect(await term.find({ type: 'Text', text: /npm ERR! more/ })).toBeDefined()
    const copyKey = buttons.find(b => b.key?.startsWith('cp-'))?.key ?? ''
    await term.press({ key: copyKey })
    expect(copied).toContain('API')
    expect(copied).toContain('429 Too Many Requests')
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'faultline', surface: 'desktop', ...PANE })
    const svgs = await desk.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(6)
    expect(String(svgs[0]?.props.source)).toContain('FAULTLINE')
    expect(await desk.find({ type: 'Code' })).toBeDefined()
    await desk.unmount()
  })

  test('a clean session draws a calm pane on both surfaces', async ($, on) => {
    mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'faultline', surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /No failures yet/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
