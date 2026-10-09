import { describe, expect, mock, test } from 'claude-code/testing'

import { HISTORY, chartPoints, countLines, parseDf, pushHist, smoothPaths } from '../hooks/meter.ts'

const PANE_ID = 'kz-vitals'
const PROPS = { title: 'KOZMOS · Vitals', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('vitals', () => {
  test('samples the machine while open and draws it on every surface', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.env(on, { OS: 'Windows_NT' })
    const open = new Set<string>()
    let sysCalls = 0
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.open', ($, e) => {
      open.add(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.close', ($, e) => {
      open.delete(e.id)
      return { value: undefined }
    })
    on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
    on('session.usage', () => ({ value: { startedAt: 940_000, context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
    on('agent.list', () => ({ value: [] }))
    on('tool.call', () => ({ result: { ok: true } }))
    on('process.run', ($, e) => {
      const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
      if (e.argv[0] === 'powershell') {
        sysCalls++
        return ok(JSON.stringify({ cpu: 20 + sysCalls * 5, free: 8_000_000, total: 32_000_000, dfree: 400e9, dsize: 1000e9, procs: 312 }))
      }
      if (e.argv[0] === 'nvidia-smi') return ok('45, 8192, 24576, 63, NVIDIA GeForce RTX 4090\n')
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await clock.advance(6000)
    expect(sysCalls).toBe(0) // closed: no probes

    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
    await $.command.run({ command: 'vitals', ...RUN })
    await clock.advance(4000)
    expect(sysCalls).toBeGreaterThan(1)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'Pane', requestId: PANE_ID, props: PROPS })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /RTX 4090/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /63°C/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /1 tools/ })).toBeDefined()
      } else {
        expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(3)
      }
      await ui.unmount()
    }

    await $.command.run({ command: 'vitals', ...RUN })
    const before = sysCalls
    await clock.advance(6000)
    expect(sysCalls).toBe(before)
  })

  test('pure helpers', () => {
    expect(parseDf('Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda1 1000 400 600 40% /\n')).toEqual({ diskTotal: 1024000, diskUsed: 409600 })
    expect(countLines('  1\n  2\n 33\n')).toBe(3)
    let h: number[] = []
    for (let i = 0; i < HISTORY + 10; i++) h = pushHist(h, i)
    expect(h.length).toBe(HISTORY)
    const pts = chartPoints([0, 100], 0, 0, 100, 50, 100)
    expect(pts[1]).toEqual([100, 0])
    expect(smoothPaths(pts, 50).area.endsWith('Z')).toBe(true)
  })
})
