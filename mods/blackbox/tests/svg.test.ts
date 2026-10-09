import { describe, expect, test } from 'claude-code/testing'

import type { BbTurn, BlackboxSnap } from '../types'
import { altOf, recorderSvg } from '../hooks/svg.ts'

const turnOf = (over: Partial<BbTurn> = {}): BbTurn => ({ turnId: 't', startedAt: 0, endedAt: null, lanes: ['main'], labels: {}, bars: [], ticks: [], ...over })

describe('recorderSvg', () => {
  test('a live turn: running bars grow, overlapping ones stack, the cursor glides', async () => {
    const turn = turnOf({
      lanes: ['main', 'ag1'],
      labels: { ag1: 'Explore' },
      bars: [
        { lane: 'main', tool: 'Bash', s: 0, e: 2000, isError: false },
        { lane: 'main', tool: 'Read', s: 1000, e: null, isError: false },
      ],
      ticks: [{ lane: 'ag1', at: 1500 }, { lane: 'main', at: 100 }],
    })
    const pic = recorderSvg({ turn, isLive: true, now: 3000 }, 1000)
    expect(pic.width).toBe(1000)
    expect(pic.source).toContain('REC 0:03')
    expect(pic.source).toContain('2 tools')
    // The running Read: a growing bar with its tooltip saying so.
    expect(pic.source).toContain('@keyframes g10')
    expect(pic.source).toContain('Read · running')
    expect(pic.source).toContain('@keyframes cur')
    // Overlapping calls take half the lane each.
    expect(pic.source).toContain('height="6"')
    expect(pic.alt).toBe('Blackbox: recording 0:03, 2 tool calls, 2 model requests, 1 subagent')
  })

  test('a finished turn: one tool, failures outlined, hidden lanes counted, no cursor', async () => {
    const lanes = ['main', 'a', 'b', 'c', 'd', 'e', 'f']
    const turn = turnOf({
      endedAt: 4000,
      lanes,
      bars: [{ lane: 'main', tool: 'Bash', s: 0, e: 1500, isError: true }],
      ticks: lanes.slice(1).map((lane, i) => ({ lane, at: i })),
    })
    const snap: BlackboxSnap = { turn, isLive: false, now: 9000 }
    // Never narrower than 320 px.
    expect(recorderSvg(snap, 100).width).toBe(320)
    const pic = recorderSvg(snap, 900)
    expect(pic.width).toBe(900)
    expect(pic.source).toContain('LAST TURN 0:04')
    expect(pic.source).toContain('Bash · 1.5s · failed')
    expect(pic.source).toContain('fill-opacity=".45"')
    expect(pic.source).toContain('<g opacity=".42">')
    expect(pic.source).not.toContain('@keyframes cur')
    expect(pic.alt).toBe('Blackbox: last turn 0:04, 1 tool calls (1 failed), 6 model requests, 6 subagents')
  })

  test('the tool count beside the clock, with the lanes left out', async () => {
    const lanes = ['main', 'a', 'b', 'c', 'd', 'e', 'f']
    const turn = turnOf({ lanes, bars: [{ lane: 'main', tool: 'Bash', s: 0, e: 500, isError: false }], ticks: lanes.slice(1).map((lane, i) => ({ lane, at: i })) })
    const wide = recorderSvg({ turn, isLive: true, now: 3000 }, 1000)
    expect(wide.source).toContain('1 tool · +2')
    // Narrow: no room for it beside the clock.
    expect(recorderSvg({ turn, isLive: true, now: 3000 }, 400).source).not.toContain('1 tool')
  })

  test('alt text with no subagents', async () => {
    expect(altOf({ turn: turnOf(), isLive: true, now: 0 })).toBe('Blackbox: recording 0:00, 0 tool calls, 0 model requests, 0 subagents')
  })
})
