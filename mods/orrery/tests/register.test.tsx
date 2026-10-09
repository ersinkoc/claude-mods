import { describe, expect, mock, test } from 'claude-code/testing'

import { angleAt, fieldFrame, legendAgents, legendLines, omegaOf, orrerySvg } from '../hooks/sky.ts'
import type { Agent } from '../hooks/sky.ts'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
}

const agent = (o: Partial<Agent>): Agent => ({
  id: 'a', desc: 'Explore auth', type: 'Explore', model: 'haiku', order: 0, status: 'run',
  start: 0, end: null, tps: 0, tokens: 0, angle: 0, omega: 1, ...o,
})

describe('sky', () => {
  test('a planet streaming faster turns faster', () => {
    expect(omegaOf(120)).toBeGreaterThan(omegaOf(10))
    expect(angleAt(agent({ angle: 1, omega: 2 }), 1000, 2000)).toBe(3)
    expect(angleAt(agent({ status: 'done', angle: 1, omega: 2 }), 1000, 2000)).toBe(1)
  })

  test('the field is the size asked and the sun sits in it', () => {
    const f = fieldFrame([agent({}), agent({ id: 'b', order: 1, status: 'fail', end: 0 })], 0, 500, 30, 5, 40, true)
    expect(f).toHaveLength(5)
    for (const row of f) expect(row.map(s => s.s).join('').length).toBe(30)
    expect(f.flat().map(s => s.s).join('')).toMatch(/[✶✷✸✹]/)
    expect(f.flat().map(s => s.s).join('')).toContain('✖')
  })

  test('the legend lists running agents first, then the latest to finish', () => {
    const list = legendAgents([
      agent({ id: 'd', status: 'done', end: 10, order: 0 }),
      agent({ id: 'r', order: 1 }),
      agent({ id: 'f', status: 'fail', end: 20, order: 2 }),
    ])
    expect(list.map(a => a.id)).toEqual(['r', 'f', 'd'])
    const lines = legendLines([agent({ desc: 'Explore auth', tps: 42 })], 65_000, 60, 5)
    expect(lines[1]?.map(s => s.s).join('')).toContain('Explore auth')
    expect(lines[1]?.map(s => s.s).join('')).toContain('1:05')
  })

  test('the desktop drawing orbits with CSS', () => {
    const src = orrerySvg([agent({ tps: 50, omega: 2 })], 1000, 30, true, 760, 112)
    expect(src).toContain('@keyframes orspin')
    expect(src).toContain('animation-duration')
    expect(src).toContain('Explore auth')
  })
})

describe('register', () => {
  test('a spawned subagent becomes a planet on both surfaces, and finishing settles it', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on, {})
    let roster: { id: string; description: string; type: string; status: 'running' | 'completed' | 'failed' }[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: roster }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5', agentId: 'ag1' }))
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 10, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5' } }
    })
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine" />
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    // No subagent yet: nothing drawn.
    const empty = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...BAND })
    expect(await empty.find({ type: 'Client' })).toBeUndefined()
    await empty.unmount()

    await $.agent.spawn({
      tool_use_id: 'tu1', prompt: 'look around', description: 'Explore the auth flow', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
    })
    roster = [{ id: 'ag1', description: 'Explore the auth flow', type: 'Explore', status: 'running' }]
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5', messageCount: 2, agentId: 'ag1' })
    for await (const _ of stream) void _
    await clock.advance(2000)

    const term = await $.ui.mount({ plugin: 'orrery', surface: 'terminal', ...BAND })
    expect(await term.find({ type: 'Client', key: 'orrery' })).toBeDefined()
    await term.advance(100)
    expect(await term.find({ type: 'Text', text: /Explore the auth flow/, in: 'orrery' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /1 orbiting/, in: 'orrery' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...BAND })
    const svg = await desk.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain('Explore the auth flow')
    await desk.unmount()

    // It fails: a red cross on the outer ring.
    await $.turn.complete({ turnId: 't1', agentId: 'ag1', reason: 'error', answer: '', isAborted: false, durationMs: 4000 })
    const after = await $.ui.mount({ plugin: 'orrery', surface: 'desktop', ...BAND })
    expect(String((await after.find({ type: 'Svg' }))?.props.source)).toContain('✖')
    await after.press({ key: 'orrery-hide' })
    expect(await after.find({ type: 'Svg' })).toBeUndefined()
    await after.unmount()
  })
})
