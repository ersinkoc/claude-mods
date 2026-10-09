import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { GAP, SEP, buildSegments, compose, parseSegments, scrolls, windowAt } from '../hooks/ticker.ts'
import type { TickerData } from '../hooks/ticker.ts'

const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const NOW = Date.UTC(2030, 0, 1, 12, 0, 0)

const DATA: TickerData = {
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  ctxPercent: 42,
  limits: [
    { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(NOW + (2 * 60 + 41) * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 3 * 864e5).toISOString() },
  ],
  costUsd: 3.21,
  git: { branch: 'main', ahead: 2, behind: 0, dirty: 3 },
  tool: { name: 'Bash', detail: 'npm test', startedAt: NOW - 12_000 },
  now: NOW,
}

function world(on: On): { lines: (string | undefined)[]; store: Map<string, unknown> } {
  const lines: (string | undefined)[] = []
  const store = new Map<string, unknown>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 420_000, window: 1_000_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: new Date(NOW + 3600_000).toISOString() }],
      cost: { usd: 3.21 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', ($, e) => {
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[1] === 'status') return ok('# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -0\n1 .M N... 1 1 1 a b x.ts\n')
    return ok('a1b2c3d\tsubject\tnow\n')
  })
  return { lines, store }
}

describe('marquee', () => {
  test('the segment builder writes the example line', () => {
    const line = compose(buildSegments(DATA, parseSegments(undefined)))
    expect(line).toBe('◆ Opus 5.5·xhigh │ ctx 42% │ 5h 23% ↻2h41m │ 7d 41% │ $3.21 │ ⎇ main ↑2 ●3 │ ▶ Bash npm test 0:12')
  })

  test('segments pick and order, unknown names dropped', () => {
    expect(parseSegments(' git, cost ,nope,git')).toEqual(['git', 'cost'])
    expect(buildSegments(DATA, ['cost', 'model'])).toEqual(['$3.21', '◆ Opus 5.5·xhigh'])
    expect(buildSegments({ limits: [], now: 0 }, parseSegments(undefined))).toEqual([])
  })

  test('the window is static when it fits and rotates when it does not', () => {
    const segs = ['alpha', 'beta', 'gamma']
    const full = `alpha${SEP}beta${SEP}gamma`
    expect(windowAt(segs, 60, 7)).toBe(full)
    expect(scrolls(segs, 60)).toBe(false)
    expect(scrolls(segs, 10)).toBe(true)
    expect(windowAt(segs, 10, 0)).toBe(full.slice(0, 10))
    expect(windowAt(segs, 10, 1)).toBe(full.slice(1, 11))
    expect(windowAt(segs, 10, 2, 3)).toBe(full.slice(6, 16))
    // A full lap comes back to the start, across the gap.
    const lap = Array.from(full + GAP).length
    expect(windowAt(segs, 10, lap)).toBe(windowAt(segs, 10, 0))
    const wrap = windowAt(segs, 10, full.length - 2)
    expect(wrap).toBe((full + GAP + full).slice(full.length - 2, full.length + 8))
    expect(Array.from(wrap).length).toBe(10)
  })

  test('the status line ticks, scrolls when narrow, and /marquee clears it', { options: { width: 30 } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { lines, store } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(3000)
    const shown = lines.filter((l): l is string => typeof l === 'string')
    expect(shown.length).toBeGreaterThan(1)
    for (const l of shown) expect(Array.from(l).length).toBe(30)
    expect(shown.some(l => l.includes('Opus 5.5'))).toBe(true)

    await $.command.run({ command: 'marquee', ...RUN })
    expect(lines[lines.length - 1]).toBe(undefined)
    expect(store.get('enabled')).toBe(false)
    const n = lines.length
    await clock.advance(3000)
    expect(lines.length).toBe(n)

    await $.command.run({ command: 'marquee', ...RUN })
    expect(store.get('enabled')).toBe(true)
    expect(typeof lines[lines.length - 1]).toBe('string')
  })

  test('a wide line stays static and shows git and the running tool', { options: { width: 200 } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { lines } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(2000)
    const last = lines[lines.length - 1] ?? ''
    expect(last).toContain('◆ Opus 5.5 │ ctx 42% │ 5h 23% ↻59m │ $3.21 │ ⎇ main ↑2 ●1')
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'npm test' })
    expect(lines.some(l => typeof l === 'string' && l.includes('▶ Bash npm test 0:00'))).toBe(true)
  })
})
