import { describe, expect, test } from 'claude-code/testing'

import type { AlmanacEntry, AlmanacSnap } from '../types'
import { Tally, barsSvg, cloudSvg, familiesSvg, familyOf, headerSvg, mcpParts, pluginOfAgent, snapText } from '../hooks/book.ts'

const entries = (n: number, base = 'name'): AlmanacEntry[] => Array.from({ length: n }, (_, i) => ({ name: `${base}${i}`, n: n - i, first: i * 1000 }))
const snap = (over: Partial<AlmanacSnap> = {}): AlmanacSnap => ({
  version: '', startedAt: 0, now: 65_000, commands: [], skills: [], agents: [], mcp: [], models: [], plugins: [], families: [],
  tools: 0, installed: -1, unused: -1, ...over,
})

describe('book helpers', () => {
  test('every family by its tool names', () => {
    expect(['Bash', 'PowerShell', 'Monitor'].map(familyOf)).toEqual(['shell', 'shell', 'shell'])
    expect(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].map(familyOf)).toEqual(['edit', 'edit', 'edit', 'edit'])
    expect(['Read', 'LSP'].map(familyOf)).toEqual(['read', 'read'])
    expect(['Glob', 'Grep', 'ToolSearch'].map(familyOf)).toEqual(['search', 'search', 'search'])
    expect(['Agent', 'Task', 'Workflow', 'SendMessage'].map(familyOf)).toEqual(['agent', 'agent', 'agent', 'agent'])
    expect(['WebFetch', 'WebSearch'].map(familyOf)).toEqual(['web', 'web'])
    expect(['TodoWrite', 'TaskCreate'].map(familyOf)).toEqual(['tasks', 'tasks'])
    expect(familyOf('Skill')).toBe('skill')
    expect(familyOf('AskUserQuestion')).toBe('other')
  })

  test('agent types name their plugin', () => {
    expect(pluginOfAgent('plugin-dev:agent-creator')).toBe('plugin-dev')
    expect(pluginOfAgent('Explore')).toBeUndefined()
    expect(pluginOfAgent(':odd')).toBeUndefined()
  })

  test('a tally skips nameless entries and breaks ties by name', () => {
    const t = new Tally()
    t.add('', 0)
    t.add('b', 0)
    t.add('a', 0, 1)
    expect(t.has('')).toBe(false)
    expect(t.entries(0).map(e => e.name)).toEqual(['a', 'b'])
  })

  test('the text print of an empty and a full session', () => {
    expect(snapText(snap())).toBe([
      'Almanac — Claude Code ? · 1:05 · 0 tool calls',
      'Commands: —', 'Skills: —', 'Subagents: —', 'MCP servers: —', 'Models: —', 'Plugins: —', 'Tool families: —',
      'Installed commands: unknown',
    ].join('\n'))
    const full = snapText(snap({ version: '2.1.0', commands: [{ name: 'review', n: 2, first: 0 }], models: [{ name: 'claude-haiku-5', n: 1, first: 0 }], installed: 4, unused: 3 }))
    expect(full).toContain('Almanac — Claude Code 2.1.0')
    expect(full).toContain('Commands: /review ×2')
    expect(full).toContain('Installed commands: 4, never run this session: 3')
  })

  test('the header: version badge, one row of tiles when wide, two when narrow', () => {
    const wide = headerSvg(snap({ version: '2.1.0', installed: 5, unused: 2 }), 600)
    expect(wide).toContain('>v2.1.0<')
    expect(wide).toContain('>2/5<')
    expect(wide).toContain('height="46"')
    const narrow = headerSvg(snap(), 300)
    expect(narrow).toContain('>v?<')
    expect(narrow).toContain('>—<')
    expect(narrow).toContain('height="24"')
  })

  test('ranked bars: empty, ranked, and more than fit', () => {
    const empty = barsSvg('Commands', '#ff0', [], 400, e => e.name)
    expect(empty.source).toContain('none yet')
    expect(empty.height).toBe(56)
    const many = barsSvg('Commands', '#ff0', entries(10), 400, e => `/${e.name}`)
    expect(many.source).toContain('10 · 55×')
    expect(many.source).toContain('/name0')
    expect(many.source).toContain('/name7')
    expect(many.source).not.toContain('/name8')
    expect(many.source).toContain('+2 more')
  })

  test('the cloud: empty, and pills that wrap onto new lines', () => {
    const empty = cloudSvg('Skills', '#fa0', [], 300)
    expect(empty.source).toContain('none yet')
    expect(empty.height).toBe(54)
    const full = cloudSvg('Skills', '#fa0', entries(12, 'skill-with-a-long-name-'), 300)
    expect(full.height).toBeGreaterThan(80)
    expect(full.source).toContain('font-weight="750"')
    expect(full.source).toContain('font-weight="560"')
    expect(full.source).toContain('<tspan font-size="9" opacity=".75"> 12</tspan>')
    expect(full.source).toContain('<tspan font-size="9" opacity=".75"></tspan>')
  })

  test('tool families: none yet, or a stacked bar in two or four columns', () => {
    const none = familiesSvg([], 300)
    expect(none.source).toContain('no tool calls yet')
    const fams = [{ name: 'shell', n: 3, first: 0 }, { name: 'read', n: 1, first: 0 }, { name: 'edit', n: 1, first: 0 }]
    const narrow = familiesSvg(fams, 300)
    expect(narrow.source).toContain('5 calls')
    expect(narrow.source).toContain('shell 3 · 60%')
    expect(narrow.height).toBe(52 + 2 * 17 + 4)
    expect(familiesSvg(fams, 500).height).toBe(52 + 17 + 4)
  })

  test('mcp names without a server part are no MCP call', () => {
    expect(mcpParts('mcp__solo', new Set())).toEqual({})
  })
})
