import { describe, expect, test } from 'claude-code/testing'

import type { LaunchpadData } from '../types'
import { KZ } from '../hooks/lib/kz.ts'
import {
  MAX_PROMPT, accentOf, agoText, bannerSvg, bump, cleanName, commandCardSvg, errorText, fillNote, frequentTiles, listText, parseArgs, pinnedTiles, promptCardSvg, sectionSvg,
} from '../hooks/pad.ts'

const data = (over: Partial<LaunchpadData> = {}): LaunchpadData => ({ counts: {}, pinned: [], saved: [], known: {}, hasList: false, ...over })

describe('arguments', () => {
  test('every verb and its aliases', () => {
    expect(parseArgs('   ')).toEqual({ kind: 'toggle' })
    expect(parseArgs('LIST')).toEqual({ kind: 'list' })
    expect(parseArgs('ls')).toEqual({ kind: 'list' })
    expect(parseArgs('add  two\n lines ')).toEqual({ kind: 'save', text: 'two\n lines' })
    expect(parseArgs(`save ${'x'.repeat(MAX_PROMPT + 5)}`)).toEqual({ kind: 'save', text: 'x'.repeat(MAX_PROMPT) })
    expect(parseArgs('remove 3')).toEqual({ kind: 'rm', index: 2 })
    expect(parseArgs('del 1')).toEqual({ kind: 'rm', index: 0 })
    expect(parseArgs('unpin //review now')).toEqual({ kind: 'unpin', name: 'review' })
    expect(parseArgs('forget')).toEqual({ kind: 'forget' })
    expect(parseArgs('reset')).toEqual({ kind: 'forget' })
  })

  test('missing or bad arguments answer with usage', () => {
    expect(parseArgs('save')).toEqual({ kind: 'help', reason: 'Usage: /launchpad save <prompt text>' })
    expect(parseArgs('rm 0')).toEqual({ kind: 'help', reason: 'Usage: /launchpad rm <number> (see /launchpad list)' })
    expect(parseArgs('rm 1.5').kind).toBe('help')
    expect(parseArgs('pin')).toEqual({ kind: 'help', reason: 'Usage: /launchpad pin <command>' })
    expect(parseArgs('unpin /')).toEqual({ kind: 'help', reason: 'Usage: /launchpad unpin <command>' })
    expect(parseArgs('Fly me')).toEqual({ kind: 'help', reason: 'Unknown: fly. Try save <text>, rm <n>, pin <cmd>, unpin <cmd>, list, forget.' })
  })

  test('command names lose their slashes and arguments', () => {
    expect(cleanName('  /review  the diff')).toBe('review')
    expect(cleanName('commit')).toBe('commit')
    expect(cleanName('  ')).toBe('')
  })
})

describe('ranking', () => {
  test('ties break by recency, then by name; launchpad itself is never a tile', () => {
    let counts = bump({}, 'b', 5)
    counts = bump(counts, 'a', 5)
    counts = bump(counts, 'c', 9)
    counts = bump(counts, 'launchpad', 9)
    const d = data({ counts, pinned: ['launchpad', 'zed'] })
    expect(frequentTiles(d).map(t => t.name)).toEqual(['c', 'a', 'b'])
    expect(frequentTiles(d, 1).map(t => t.name)).toEqual(['c'])
    // Without a command list every counted name is offered; a pin never run counts zero.
    expect(pinnedTiles(d)).toEqual([{ name: 'zed', count: 0, at: 0, description: '' }])
    expect(bump(counts, 'a', 7).a).toEqual({ n: 2, at: 7 })
  })

  test('the list text, empty and full', () => {
    expect(listText(data())).toBe([
      'Launchpad', 'Pinned:', '  (none: /launchpad pin <command>)', 'Frequent:', '  (none yet: run some slash commands)', 'Saved:', '  (none: /launchpad save <prompt>)',
    ].join('\n'))
    const full = listText(data({ counts: bump(bump({}, 'review', 1), 'commit', 2), pinned: ['review', 'docs'], saved: ['fix   the\ntests'] }))
    expect(full).toBe(['Launchpad', 'Pinned:', '  ★ /review ×1', '  ★ /docs', 'Frequent:', '  ▶ /commit ×1', 'Saved:', '  1. fix the tests'].join('\n'))
  })

  test('accents are stable per name; ago text', () => {
    expect(accentOf('review')).toBe(accentOf('review'))
    expect(agoText(0, 1000)).toBe('never run')
    expect(agoText(1000, 121_000)).toBe('2m ago')
  })
})

describe('last line', () => {
  test('where a fill went, by the refusal the engine gave', () => {
    expect(fillNote({ isFilled: true })).toBe('in the prompt box')
    expect(fillNote({ isFilled: false, refusal: 'dialog' })).toBe('a dialog holds the prompt box')
    expect(fillNote({ isFilled: false, refusal: 'no_composer' })).toBe('the prompt box did not take it')
    expect(fillNote({ isFilled: false })).toBe('the prompt box did not take it')
  })

  test('failures read as their message, or as text', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('plain')).toBe('plain')
    expect(errorText(42)).toBe('42')
  })
})

describe('desktop tiles', () => {
  test('a command card: initial, pin star, count and bar', () => {
    const pinned = commandCardSvg({ name: 'review', count: 3, at: 1000, description: 'Review the diff' }, 400, 61_000, 6, true)
    expect(pinned).toContain('>R<')
    expect(pinned).toContain('<path d="M44 10')
    expect(pinned).toContain('>×3<')
    expect(pinned).toContain('width="22"')
    expect(pinned).toContain('Review the diff')
    expect(pinned).toContain(KZ.yellow)
  })

  test('a card never run: a slash for an initial, the ago text, no count; a zero max draws an empty bar', () => {
    const plain = commandCardSvg({ name: '--', count: 0, at: 0, description: '' }, 400, 1000, 1, false)
    expect(plain).toContain('>/<')
    expect(plain).toContain('never run')
    expect(plain).not.toContain('×')
    expect(plain).not.toContain('<path d="M44 10')
    expect(plain).toContain(accentOf('--'))
    const zero = commandCardSvg({ name: 'x', count: 2, at: 1, description: '' }, 400, 1000, 0, false)
    expect(zero).toContain('width="3" height="3"')
  })

  test('a long saved prompt wraps to a second line; a short one stays on one', () => {
    const long = promptCardSvg('word '.repeat(60), 4, 300)
    expect(long).toContain('>5<')
    expect((long.match(/<text /g) ?? []).length).toBe(3)
    const short = promptCardSvg('hi', 0, 300)
    expect((short.match(/<text /g) ?? []).length).toBe(2)
  })

  test('the banner counts with singular and plural', () => {
    expect(bannerSvg(400, 1, 1, 1)).toContain('1 run learned · 1 command · 1 saved prompt<')
    expect(bannerSvg(400, 2, 0, 3)).toContain('2 runs learned · 0 commands · 3 saved prompts<')
  })

  test('a section header', () => {
    const s = sectionSvg('Pinned', 'star one', KZ.yellow, 300)
    expect(s).toContain('>PINNED<')
    expect(s).toContain('>star one<')
  })
})
