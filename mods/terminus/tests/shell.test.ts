import { describe, expect, test } from 'claude-code/testing'

import type { ShellRun } from '../types'
import { KZ } from '../hooks/lib/kz.ts'
import {
  altOf, clockOf, cwdOf, durHeat, emptySnap, firstLine, fmtMs, fmtSize, headerSvg, isSlow, matches, outcomeOf, runSvg,
  statusColor, statusGlyph, statusLine, tellingLine,
} from '../hooks/shell.ts'

const RUN: ShellRun = { id: 'a', tool: 'Bash', command: 'ls', at: 0, status: 'ok', who: 'main' }

describe('reading a call', () => {
  test('the cwd: input keys in order, quoted and bare cd forms', () => {
    expect(cwdOf('ls', { cwd: '  ', workdir: ' /w ' })).toBe('/w')
    expect(cwdOf('ls', { directory: 'D:/x', cwd: 3 })).toBe('D:/x')
    expect(cwdOf("cd 'a b' && ls", {})).toBe('a b')
    expect(cwdOf('Set-Location -LiteralPath C:/Repo; dir', {})).toBe('C:/Repo')
    expect(cwdOf('pushd -Path "C:/P Q" || exit', {})).toBe('C:/P Q')
    expect(cwdOf('cd /a', {})).toBeUndefined()
  })

  test('the telling line skips exit codes, tags and colour codes', () => {
    expect(tellingLine('Exit code 1')).toBe('')
    expect(tellingLine('')).toBe('')
    expect(tellingLine('<error>\n\u001b[31mfirst thing\u001b[0m\nsecond\n</error>')).toBe('first thing')
    expect(tellingLine('warn\nError: boom')).toBe('Error: boom')
    expect(tellingLine('x'.repeat(200))).toHaveLength(160)
  })

  test('errors: from text or a string result, the exit code when given, denials', () => {
    expect(outcomeOf({ isError: true, result: 'Exit code 3\nnope' })).toEqual({ status: 'fail', exit: 3, error: 'nope', outBytes: 16 })
    expect(outcomeOf({ isError: true, result: { a: 1 } })).toEqual({ status: 'fail', exit: undefined, error: 'failed', outBytes: 0 })
    expect(outcomeOf({ isError: true, text: 'Exit code 1' })).toMatchObject({ status: 'fail', exit: 1, error: 'failed' })
    expect(outcomeOf({ isError: true, text: 'The user was rejected the command' })).toMatchObject({ status: 'denied', exit: undefined, error: 'The user was rejected the command' })
    expect(outcomeOf({ deny: 'Not now' })).toEqual({ status: 'denied', error: 'Not now', outBytes: 7 })
  })

  test('answers: sizes from the persisted output, the streams or the text', () => {
    expect(outcomeOf({ result: { stdout: 'abc', stderr: 'de', persistedOutputSize: 9000 } }).outBytes).toBe(9000)
    expect(outcomeOf({ result: { stdout: 1, stderr: null }, text: 'four' }).outBytes).toBe(4)
    expect(outcomeOf({ result: undefined })).toEqual({ status: 'ok', exit: 0, error: undefined, outBytes: 0 })
    expect(outcomeOf({ result: { stdout: 'x', interrupted: true } })).toEqual({ status: 'fail', error: 'interrupted', outBytes: 1 })
    expect(outcomeOf({ result: { backgroundTaskId: 'b1' } })).toEqual({ status: 'bg', outBytes: 0 })
    expect(outcomeOf({ result: { stdout: '', returnCodeInterpretation: 'No matches found' } })).toEqual({ status: 'ok', exit: 0, error: 'No matches found', outBytes: 0 })
  })
})

describe('formatting', () => {
  test('durations, sizes, the clock and the first line', () => {
    expect(fmtMs(undefined)).toBe('…')
    expect(fmtMs(420.4)).toBe('420ms')
    expect(fmtMs(4200)).toBe('4.2s')
    expect(fmtMs(42_000)).toBe('42s')
    expect(fmtMs(67_000)).toBe('1m07s')
    expect(fmtMs(999.5)).toBe('1.0s')
    expect(fmtMs(59_499)).toBe('59s')
    expect(fmtMs(59_500)).toBe('1m00s')
    expect(fmtSize(undefined)).toBe('—')
    expect(fmtSize(812)).toBe('812B')
    expect(fmtSize(4100)).toBe('4.1k')
    expect(fmtSize(41_000)).toBe('41k')
    expect(fmtSize(2_300_000)).toBe('2.3M')
    const d = new Date(2026, 0, 2, 3, 4, 5)
    expect(clockOf(d.getTime())).toBe('03:04:05')
    expect(firstLine('cat <<EOF\nhello\nEOF')).toBe('cat <<EOF')
    expect(firstLine('ls')).toBe('ls')
  })

  test('each status has its colour, glyph and line', () => {
    expect(['ok', 'fail', 'denied', 'bg', 'running'].map(s => statusGlyph(s as ShellRun['status'])).join('')).toBe('✓✖⊘◔●')
    expect(['ok', 'fail', 'denied', 'bg', 'running'].map(s => statusColor(s as ShellRun['status']))).toEqual([KZ.green, KZ.red, KZ.amber, KZ.blue, KZ.violet])
    expect(statusLine({ ...RUN, status: 'running' })).toBe('running…')
    expect(statusLine({ ...RUN, status: 'bg' })).toBe('running in the background')
    expect(statusLine({ ...RUN, status: 'fail', exit: 2, error: 'boom' })).toBe('exit 2 · boom')
    expect(statusLine({ ...RUN, status: 'denied', error: 'no' })).toBe('denied · no')
    expect(statusLine({ ...RUN, status: 'fail' })).toBe('failed')
    expect(statusLine({ ...RUN, status: 'ok', exit: 0, error: 'No matches' })).toBe('No matches')
    expect(statusLine({ ...RUN, status: 'ok', exit: 0 })).toBe('')
    expect(durHeat(undefined)).toBe(KZ.violet)
    expect(durHeat(100)).toBe(durHeat(300))
  })

  test('slow and failed filters', () => {
    expect(isSlow({ ...RUN })).toBe(false)
    expect(isSlow({ ...RUN, ms: 10_001 })).toBe(true)
    expect(matches({ ...RUN, status: 'fail' }, 'all')).toBe(true)
    expect(matches({ ...RUN, status: 'denied' }, 'failed')).toBe(true)
    expect(matches({ ...RUN, ms: 20_000 }, 'failed')).toBe(false)
    expect(matches({ ...RUN, ms: 20_000 }, 'slow')).toBe(true)
  })
})

describe('desktop drawings', () => {
  test('the header: empty, then running, failed and slow runs', () => {
    const empty = headerSvg(emptySnap(), 400)
    expect(empty.height).toBe(134)
    expect(empty.source).toContain('no shell commands yet')
    expect(empty.source).toContain('durations, last 48')
    expect(empty.source).not.toContain('running')

    const runs: ShellRun[] = [
      { ...RUN, id: 'r', command: 'npm run dev', status: 'running' },
      { ...RUN, id: 'f', command: 'npm test', status: 'fail', ms: 1200 },
      { ...RUN, id: 's', command: 'sleep 20', ms: 20_000 },
    ]
    const full = headerSvg({ runs, total: 3, failures: 1, slow: 1, totalMs: 21_200 }, 400)
    expect(full.source).toContain('1 running')
    expect(full.source).toContain('class="pulse"')
    expect(full.source).toContain(KZ.red)
    expect(full.source).toContain('1 slower than 10 s')
    expect(full.source).toContain('<title>npm run dev</title>')
  })

  test('a run card: plain ok, ok with a note, running, PowerShell with a cwd', () => {
    const plain = runSvg({ ...RUN, ms: 30, outBytes: 3 }, 340)
    expect(plain.height).toBe(52)
    expect(plain.source).toContain('Bash')
    const noted = runSvg({ ...RUN, ms: 30, error: 'No matches found', description: 'Search' }, 340)
    expect(noted.height).toBe(66)
    expect(noted.source).toContain(`fill="${KZ.mist}"`)
    expect(noted.source).toContain('Search')
    const running = runSvg({ ...RUN, status: 'running', command: 'cat <<EOF\nsecret\nEOF' }, 340)
    expect(running.source).toContain('class="pulse"')
    expect(running.source).toContain('running…')
    expect(running.source).not.toContain('secret')
    const ps = runSvg({ ...RUN, tool: 'PowerShell', cwd: 'C:/Repo', who: 'reviewer' }, 340)
    expect(ps.source).toContain('PowerShell')
    expect(ps.source).toContain('⌂ C:/Repo')
    expect(ps.source).toContain('reviewer')
  })

  test('the alt text names the description and the error when there are some', () => {
    expect(altOf({ ...RUN, ms: 5 })).toBe('ok Bash: ls, 5ms, by main')
    expect(altOf({ ...RUN, status: 'fail', ms: 5, description: 'List', error: 'boom' })).toBe('fail Bash: ls (List), 5ms, by main; boom')
  })
})
