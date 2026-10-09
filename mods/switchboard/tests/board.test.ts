import { describe, expect, test } from 'claude-code/testing'

import { Board, avgOf, fmtMs, p95Of, splitMcp } from '../hooks/board.ts'

describe('board edges', () => {
  test('a name with no tool part is a server with an empty tool; an empty one is "?"', () => {
    expect(splitMcp('mcp__solo')).toEqual({ server: 'solo', tool: '' })
    expect(splitMcp('mcp__')).toEqual({ server: '?', tool: '' })
    expect(splitMcp('mcp____x')).toEqual({ server: '__x', tool: '' })
  })

  test('calls to tools that are not MCP are not booked', () => {
    const b = new Board()
    b.start('Read')
    b.finish('Read', 10, 5, true, 'nope')
    expect(b.snapshot(20)).toEqual({ servers: [], calls: 0, errors: 0, now: 20 })
  })

  test('an error with no message is booked as "error"; long ones are cut', () => {
    const b = new Board()
    b.finish('mcp__a__x', 10, 5, true)
    expect(b.snapshot(20).servers[0]?.lastError).toBe('error')
    b.finish('mcp__a__x', 11, 5, true, 'e'.repeat(300))
    expect(b.snapshot(20).servers[0]?.lastError).toHaveLength(160)
  })

  test('servers sort by status, then by the latest call, then by name', () => {
    const b = new Board()
    b.list(['mcp__zeta__a', 'mcp__alpha__a'])
    b.finish('mcp__old__a', 100, 1, false)
    b.finish('mcp__new__a', 200, 1, false)
    b.start('mcp__busy__a')
    b.finish('mcp__bad__a', 50, 1, true)
    expect(b.snapshot(300).servers.map(s => s.name)).toEqual(['bad', 'busy', 'new', 'old', 'alpha', 'zeta'])
  })

  test('latencies read in ms, seconds with a decimal, or whole seconds', () => {
    expect(fmtMs(null)).toBe('—')
    expect(fmtMs(250.4)).toBe('250ms')
    expect(fmtMs(1500)).toBe('1.5s')
    expect(fmtMs(12_400)).toBe('12s')
    expect(avgOf([])).toBeNull()
    expect(avgOf([1, 2])).toBe(2)
    expect(p95Of([7])).toBe(7)
  })
})
