import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { THRIFT_NOTE, comparison, topLimit } from '../hooks/register.tsx'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The world beneath thrift: limits read `limits.now`, prompts land in `seen`. */
function world(on: On): { limits: { now: Limit[] }; seen: (readonly string[] | undefined)[]; toasts: string[] } {
  const limits: { now: Limit[] } = { now: [] }
  const seen: (readonly string[] | undefined)[] = []
  const toasts: string[] = []
  mock.clock(on, { now: Date.parse('2030-01-01T00:00:00Z') })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: limits.now } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.submit', ($, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { limits, seen, toasts }
}

async function runTurn($: Engine, id: string): Promise<void> {
  await $.turn.start({ text: 'go', turnId: id })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const c of stream) void c
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' })
}

describe('pure parts', () => {
  test('the note stays under 50 words; the fullest live window wins; the comparison reads right', async () => {
    expect(THRIFT_NOTE.split(/\s+/).length).toBeLessThan(50)
    const now = Date.parse('2030-01-01T00:00:00Z')
    expect(topLimit([{ kind: 'five_hour', percentUsed: 40 }, { kind: 'seven_day', percentUsed: 93 }], now)?.kind).toBe('seven_day')
    expect(topLimit([{ kind: 'five_hour', percentUsed: 95, resetsAt: '2029-12-31T23:00:00Z' }], now)).toBeNull()
    expect(topLimit([{ kind: 'spend_limit', percentUsed: 99 }], now)).toBeNull()
    expect(comparison({ thrift: { turns: 2, cost: 0.2 }, normal: { turns: 2, cost: 0.5 } })).toBe('thrift turns cost 60% less on average')
    expect(comparison({ thrift: { turns: 0, cost: 0 }, normal: { turns: 2, cost: 0.5 } })).toBeUndefined()
  })
})

describe('register', () => {
  test('/thrift on adds the note beside the prompt; off takes it away', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.prompt.submit({ text: 'plain', wait: false, origin: { kind: 'composer' } })
    expect(w.seen[0] ?? []).not.toContain(THRIFT_NOTE)
    const r = await $.command.run({ command: 'thrift', args: 'on', ...CMD })
    expect(r.text).toMatch(/thrift on/)
    await $.prompt.submit({ text: 'frugal', wait: false, origin: { kind: 'composer' } })
    expect(w.seen[1]).toContain(THRIFT_NOTE)
    await $.command.run({ command: 'thrift', args: 'off', ...CMD })
    await $.prompt.submit({ text: 'plain again', wait: false, origin: { kind: 'composer' } })
    expect(w.seen[2] ?? []).not.toContain(THRIFT_NOTE)
  })

  test('auto turns on past autoAt, draws the coin band, and turns off when the window resets', async ($, on) => {
    const w = world(on)
    w.limits.now = [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2030-01-01T03:00:00Z' }]
    await $.session.start(START)
    await $.command.run({ command: 'thrift', args: 'auto', ...CMD })
    expect(w.toasts.some(t => /thrift on \(auto\): 5h at 92%/.test(t))).toBe(true)

    const term = await $.ui.mount({ plugin: 'thrift', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /5h 92%/ })).toBeDefined()
    await term.unmount()
    const desk = await $.ui.mount({ plugin: 'thrift', surface: 'desktop', ...BAND })
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    await desk.unmount()

    await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2030-01-01T08:00:00Z' }], changed: ['rateLimits'] })
    expect(w.toasts.some(t => /thrift off \(auto\)/.test(t))).toBe(true)
    const after = await $.ui.mount({ plugin: 'thrift', surface: 'desktop', ...BAND })
    expect(await after.find({ type: 'Svg' })).toBeUndefined()
    await after.unmount()
  })

  test('turn costs are tallied apart and /thrift compares them', async ($, on) => {
    world(on)
    let output = 50_000
    on('turn.step', async function* ($, e) {
      yield { kind: 'text' as const, index: 0, text: 'ok' }
      return {
        turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const,
        usage: { input_tokens: 1000, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
      }
    })
    await $.session.start(START)
    await runTurn($, 't1')
    await $.command.run({ command: 'thrift', args: 'on', ...CMD })
    output = 10_000
    await runTurn($, 't2')
    const r = await $.command.run({ command: 'thrift', args: '', ...CMD })
    expect(r.text).toMatch(/thrift turns\s+1 · avg \$0\.20/)
    expect(r.text).toMatch(/normal turns\s+1 · avg \$1\.00/)
    expect(r.text).toMatch(/80% less/)
  })
})
