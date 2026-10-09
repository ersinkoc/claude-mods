import { describe, expect, test } from 'claude-code/testing'

import type { Fault } from '../types'
import {
  BUCKET_MS, MAX_TEXT, WINDOW_MS, addFault, altOf, buckets, copyText, emptySnap, ember, faultSvg, headerSvg, kindColor, kindLabel,
  tellingLine, textLines,
} from '../hooks/lens.ts'

const fault = (over: Partial<Fault> = {}): Fault => ({
  sig: 'Bash|boom', tool: 'Bash', kind: 'error', head: 'boom', firstText: 'boom', isTruncated: false,
  count: 1, first: 0, last: 0, agents: ['main'], ...over,
})

describe('lens helpers', () => {
  test('a text of nothing but noise still names an error', () => {
    expect(tellingLine('Exit code 1\n<error>\n')).toBe('unknown error')
    expect(tellingLine('first line\nsecond')).toBe('first line')
  })

  test('an empty error text keeps the masked head as its first text', () => {
    const s = emptySnap()
    const f = addFault(s, { tool: 'Read', kind: 'error', text: '\u001b[31m\u001b[0m  ', at: 5, who: 'main' })
    expect(f.firstText).toBe('unknown error')
    expect(s.now).toBe(5)
  })

  test('a long first error is clipped and marked', () => {
    const s = emptySnap()
    const f = addFault(s, { tool: 'Bash', kind: 'error', text: `fatal: ${'x'.repeat(MAX_TEXT + 10)}`, at: 0, who: 'main', detail: 'npm test' })
    expect(f.isTruncated).toBe(true)
    expect(f.firstText).toHaveLength(MAX_TEXT)
    expect(copyText(f)).toContain('on: npm test')
    expect(copyText(f).endsWith('\n…')).toBe(true)
    expect(textLines(f, true)).toEqual([f.firstText, '…'])
    expect(textLines(f, false)).toEqual([f.firstText])
  })

  test('copy text without a detail keeps one blank line before the error', () => {
    expect(copyText(fault({ count: 2, agents: ['main', 'Explore'] }))).toMatch(/^Bash — 2× \(first \d\d:\d\d:\d\d, last \d\d:\d\d:\d\d; main, Explore\)\n\nboom$/)
  })

  test('blank lines inside an error stay, blank lines at its ends go', () => {
    const f = fault({ firstText: '\nfirst\n\nthird\n' })
    expect(textLines(f, true)).toEqual(['first', '', 'third'])
    const many = fault({ firstText: 'a\nb\nc\nd\ne' })
    expect(textLines(many, false)).toEqual(['a', 'b', 'c', '…'])
  })

  test('the strip counts only the last ten minutes', () => {
    const now = WINDOW_MS * 2
    const b = buckets([now + 1, now - WINDOW_MS, now - WINDOW_MS + 1, now - BUCKET_MS, now], now)
    expect(b[0]).toBe(1)
    expect(b[18]).toBe(1)
    expect(b[19]).toBe(1)
    expect(b.reduce((x, y) => x + y, 0)).toBe(3)
  })

  test('colors and labels per kind', () => {
    expect(ember(0)).toBe('#4b5563')
    expect(ember(2)).not.toBe(ember(0.5))
    expect(kindColor('denied')).not.toBe(kindColor('api'))
    expect(kindColor('turn')).not.toBe(kindColor('error'))
    expect(kindLabel(fault({ kind: 'denied' }))).toBe('denied')
    expect(kindLabel(fault({ kind: 'api' }))).toBe('API')
    expect(kindLabel(fault({ kind: 'turn' }))).toBe('turn')
    expect(kindLabel(fault({ tool: 'mcp__gh__issue' }))).toBe('gh·issue')
    expect(altOf(fault())).toMatch(/^1 times Bash: boom; first/)
  })

  test('the header says one failure, many, or quiet', () => {
    const s = emptySnap(0)
    expect(headerSvg(s, 300).source).toContain('quiet for the last 10 min')
    addFault(s, { tool: 'Read', kind: 'denied', text: 'denied by policy', at: 1000, who: 'main' })
    expect(headerSvg(s, 300).source).toContain('1 failure in the last 10 min')
    expect(headerSvg(s, 300).source).toContain('1 denied')
    addFault(s, { tool: 'Read', kind: 'error', text: 'boom', at: 2000, who: 'a' })
    expect(headerSvg(s, 300).source).toContain('2 failures in the last 10 min')
  })

  test('a folded card shows two lines of the error; a card past 999 hits caps its badge', () => {
    const folded = faultSvg(fault({ firstText: 'one\ntwo\nthree', detail: 'npm test' }), 320, 1, false)
    expect(folded.height).toBe(58 + 2 * 14 + 6)
    expect(folded.source).toContain('>two<')
    expect(folded.source).not.toContain('>three<')
    expect(folded.source).toContain('npm test')
    const open = faultSvg(fault({ count: 1000 }), 320, 1000, true)
    expect(open.height).toBe(58)
    expect(open.source).toContain('999+')
  })
})
