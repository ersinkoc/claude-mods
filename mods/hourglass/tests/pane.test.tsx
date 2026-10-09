import type { On, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const PANE_ID = 'kz-hourglass'
const pane = (bodyColumns = 44) => ({
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: { title: 'KOZMOS · Hourglass', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
})
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()
const H = 3600_000
const M = 60_000

/** The session beneath: usage reads the limits the test holds; toasts and status lines are recorded. */
function world(on: On, limits: () => SessionRateLimit[] | undefined) {
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => {
    const l = limits()
    return l ? { value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: l } } : { deny: 'unavailable' }
  })
  return { toasts, statuses }
}

describe('command', () => {
  test('/hourglass opens the pane, then closes it', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    let reads = 0
    world(on, () => (reads++, []))
    let isOpen = false
    const calls: string[] = []
    on('ui.panes', () => ({ value: isOpen ? [{ id: PANE_ID, title: 'Hourglass', isShown: true, isFocused: false, isPlaced: true }] : [] }))
    on('ui.open', ($, e) => {
      calls.push(`open ${e.id} ${e.title}`)
      isOpen = true
      return { value: { isPlaced: true } }
    })
    on('ui.close', ($, e) => {
      calls.push(`close ${e.id}`)
      isOpen = false
      return { value: undefined }
    })
    await $.session.start(START)
    expect(reads).toBe(1)
    expect((await $.command.run({ command: 'hourglass', args: '', ...RUN }))?.text).toBe('Hourglass open.')
    // Opening reads the limits afresh; closing does not.
    expect(reads).toBe(2)
    expect((await $.command.run({ command: 'hourglass', args: '', ...RUN }))?.text).toBe('Hourglass closed.')
    expect(reads).toBe(2)
    expect(calls).toEqual([`open ${PANE_ID} KOZMOS · Hourglass`, `close ${PANE_ID}`])
  })

  test('autoOpen opens the pane when the session starts', { options: { autoOpen: true } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start(START)
    await clock.settle()
    expect(opened).toEqual([PANE_ID])
  })
})

describe('readings', () => {
  test('a measure that moved the limits is digested at once; one that did not is passed on', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start(START)
    const reading = { kind: 'five_hour' as const, percentUsed: 33, resetsAt: iso(T0 + 2 * H) }
    expect(await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [reading], changed: ['context'] })).toEqual({ changed: ['context'] })
    let ui = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: /No rate-limit windows yet/ })).toBeDefined()
    await ui.unmount()
    expect(await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [reading], changed: ['rateLimits'] })).toEqual({ changed: ['rateLimits'] })
    ui = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: /33%/ })).toBeDefined()
    await ui.unmount()
  })

  test('a usage that cannot be read keeps the last readings', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let limits: SessionRateLimit[] | undefined = [{ kind: 'seven_day', percentUsed: 12, resetsAt: iso(T0 + 3 * 24 * H) }]
    world(on, () => limits)
    await $.session.start(START)
    limits = undefined
    await clock.advance(15_000)
    const ui = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: /12%/ })).toBeDefined()
    await ui.unmount()
  })

  test('subagent turns end without a reading; the main turn takes one', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    let reads = 0
    world(on, () => (reads++, []))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'ag1' })
    await clock.settle()
    expect(reads).toBe(1)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(reads).toBe(2)
  })

  test('hooks with nothing beneath fall through their catch', async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    world(on, () => [])
    await $.session.start(START)
    await expect($.session.measure({ context: { window: 1 }, rateLimits: [], changed: [] })).rejects.toThrow()
    await expect($.turn.start({ text: 'hi', turnId: 't1' })).rejects.toThrow()
    await expect($.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).rejects.toThrow()
  })

  test('a state and a store that refuse reads and writes never break the sampling; the refused write lands later', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    on('store.get', () => ({ deny: 'locked' }))
    on('store.set', () => ({ deny: 'read-only' }))
    let isFrozen = true
    on('state.set', ($, e, next) => (isFrozen ? { deny: 'frozen' } : next(e)))
    let pct = 10
    world(on, () => [{ kind: 'five_hour', percentUsed: pct++, resetsAt: iso(T0 + 4 * H) }])
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    expect((await $.command.run({ command: 'hourglass', args: '', ...RUN }))?.text).toBe('Hourglass open.')
    await clock.advance(15_000)
    await $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: iso(T0 + 4 * H) }], changed: ['rateLimits'] })
    expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })).toEqual({ text: '' })
    await clock.settle()
    expect(pct).toBeGreaterThan(12)
    // The same reading again: nothing changed, yet the refused snapshot is written now.
    isFrozen = false
    await $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct - 1, resetsAt: iso(T0 + 4 * H) }], changed: ['rateLimits'] })
    const ui = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...pane() })
    expect(await ui.find({ type: 'Text', text: new RegExp(`^ ${pct - 1}%$`) })).toBeDefined()
    await ui.unmount()
  })
})

describe('drawing', () => {
  test('before anything is published the pane draws the empty glass at its floor width', async ($, on) => {
    mock.clock(on, { now: T0 })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'hourglass', surface, ...pane(0) })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster', key: 'hg-empty' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /No rate-limit windows yet/ })).toBeDefined()
      } else {
        const svg = await ui.find({ type: 'Svg' })
        expect(String(svg?.props.alt)).toContain('No rate-limit windows reported')
      }
      await ui.unmount()
    }
  })

  test('spend, unknown and averaged windows: labels, order, verdicts and toasts', { options: { statusLine: true } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    mock.store(on)
    const { toasts, statuses } = world(on, () => [
      { kind: 'opus_weekly', percentUsed: 0 },
      { kind: 'spend_limit', percentUsed: 100 },
      // A 5h window that began 2h ago: 40 % in 2h is 20 %/h on average.
      { kind: 'five_hour', percentUsed: 40, resetsAt: iso(T0 + 3 * H) },
    ])
    await $.session.start(START)
    expect(toasts).toEqual(['⏳ spend limit at 100%', '⏳ spend limit at 100%'])
    expect(statuses).toEqual(['⏳ 5h 40% · spend 100% · opus weekly 0%'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'hourglass', surface, ...pane() })
      if (surface === 'terminal') {
        const rows = await ui.findAll({ type: 'Raster' })
        expect(rows.map(r => r.key)).toEqual(['hg-five_hour', 'hg-spend_limit', 'hg-opus_weekly'])
        expect(await ui.find({ type: 'Text', text: /^spend/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^opus weekly/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /↻ 3h00m · 20\.0%\/h avg · 100% in 3h00m/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^↻ —$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /^✖ limit reached$/ })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /… learning your pace/ })).toBeDefined()
        // An empty window: a bar of nothing but track.
        expect(await ui.find({ type: 'Text', text: /^░+$/ })).toBeDefined()
      } else {
        const [five, spend, opus] = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source))
        expect(five).toContain('20.0%/h (window avg) · 100% in 3h00m')
        expect(spend).toContain('SPEND LIMIT')
        // Full: sand only in the lower bulb.
        expect(spend?.match(/fill="url\(#hgspend_limits\)"/g)).toHaveLength(1)
        expect(spend).toContain('✖ limit reached')
        expect(opus).toContain('OPUS WEEKLY')
        expect(opus).toContain('measuring burn…')
        expect(opus).not.toContain('stroke-linejoin="round"')
      }
      await ui.unmount()
    }
  })

  test('a measured burn on a single reading shows no sparkline; a second reading draws one', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    // 40 % an hour, read on every sample.
    world(on, () => [{ kind: 'five_hour', percentUsed: 20 + ((clock.now() - T0) / H) * 40, resetsAt: iso(T0 + 4 * H) }])
    await $.session.start(START)
    let ui = await $.ui.mount({ plugin: 'hourglass', surface: 'desktop', ...pane() })
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('stroke-linejoin="round"')
    await ui.unmount()
    await clock.advance(15 * M)
    const term = await $.ui.mount({ plugin: 'hourglass', surface: 'terminal', ...pane() })
    expect(await term.find({ type: 'Text', text: /40\.0%\/h · 100% in/ })).toBeDefined()
    await term.unmount()
    ui = await $.ui.mount({ plugin: 'hourglass', surface: 'desktop', ...pane() })
    const src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toContain('stroke-linejoin="round"')
    expect(src).toContain('40.0%/h measured')
    await ui.unmount()
  })
})
