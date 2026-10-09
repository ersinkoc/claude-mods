import { describe, expect, test } from 'claude-code/testing'

import { chipText, clean, health, judge } from '../hooks/parse.ts'
import type { Outcome } from '../hooks/parse.ts'

const outcome = (o: Partial<Outcome>): Outcome => ({
  runner: 'x', kind: 'test', ok: true, pass: 0, fail: 0, skip: 0, errors: 0, warnings: 0, failures: [], parsed: true, ...o,
})

describe('judge edges', () => {
  test('a command that runs nothing Verdict knows has no verdict', () => {
    expect(judge('ls -la', 'x', false)).toBeUndefined()
  })

  test('ANSI colours and carriage-return overprints go before parsing', () => {
    expect(clean('\u001b[32mok\u001b[0m\nload 10%\rload 100%\n\u001b]0;title\u0007done')).toBe('ok\nload 100%\ndone')
  })

  test('an unknown test output: the runner is guessed from it, the failure lines kept', () => {
    const plain = judge('npm test', 'hello\nError: boom\nnpm ERR! code 1\nnpm ERR! Test failed', true)
    expect(plain).toMatchObject({ runner: 'test', ok: false, parsed: false, errors: 0 })
    expect(plain?.failures).toEqual(['Error: boom', 'npm ERR! Test failed'])
    expect(chipText(plain!)).toBe('✗ test failed')
    expect(judge('npm test', 'vitest exited', true)?.runner).toBe('vitest')
    expect(judge('npm test', 'jest: no tests found', true)?.runner).toBe('jest')
    expect(judge('npm test', 'all good', false)).toMatchObject({ runner: 'test', ok: true, parsed: false })
  })

  test('long and repeated failure lines are clipped and folded', () => {
    const long = 'x'.repeat(200)
    const out = ` FAIL  ${long}\n FAIL  ${long}\n FAIL  a\n\n      Tests  1 failed (1)\n`
    const o = judge('npx vitest run', out, true)
    expect(o?.failures).toHaveLength(2)
    expect(o?.failures[0]).toHaveLength(160)
    expect(o?.failures[0]?.endsWith('…')).toBe(true)
  })

  test('jest falls back to the ✕ lines when no ● block names the failure', () => {
    const out = '  ✕ divides (4 ms)\n  ✕ rounds\n\nTests:       2 failed, 3 passed, 5 total\n'
    expect(judge('npm test', out, true)).toMatchObject({ runner: 'jest', fail: 2, pass: 3, failures: ['divides', 'rounds'] })
  })

  test('pytest: no tests ran, failures without a reason, and errors', () => {
    expect(judge('pytest', '============ no tests ran in 0.01s ============', false)).toMatchObject({ runner: 'pytest', ok: true, parsed: true, pass: 0 })
    const out = 'FAILED tests/a.py::t1\nERROR tests/b.py::t2 - ImportError: x\nERROR tests/c.py\n==== 1 failed, 2 errors, 3 warnings in 0.50s ===='
    const o = judge('python -m pytest', out, true)
    expect(o).toMatchObject({ fail: 1, errors: 2, warnings: 3 })
    expect(o?.failures).toEqual(['tests/a.py::t1', 'tests/b.py::t2 — ImportError: x', 'tests/c.py'])
    expect(chipText(o!)).toBe('✗ pytest 1 failed')
  })

  test('go: packages only, and compile errors', () => {
    const pkgs = judge('go test ./...', 'ok  \tgithub.com/a/one\t0.1s\nFAIL\tgithub.com/a/two [build failed]\n', true)
    expect(pkgs).toMatchObject({ pass: 1, fail: 1, failures: ['package github.com/a/two'] })
    const compile = judge('go build ./...', 'main.go:3:5: undefined: x\n', true)
    expect(compile).toMatchObject({ runner: 'go build', kind: 'build', errors: 1, failures: ['main.go:3:5: undefined: x'] })
    expect(judge('go vet', 'nothing to see', false)).toMatchObject({ ok: true, parsed: false })
  })

  test('rust: an error without a code, one on the last line, and nothing to parse', () => {
    const out = '   Compiling a v0.1.0\nerror: linker `cc` not found\nwarning: unused import\nerror[E0601]: `main` function not found'
    const o = judge('cargo build', out, true)
    expect(o?.failures).toEqual(['linker `cc` not found', '[E0601] `main` function not found'])
    expect(o).toMatchObject({ errors: 2, warnings: 1 })
    expect(judge('cargo build', 'error: bad thing\n  --> src/a.rs:1:1\n', true)?.failures).toEqual(['src/a.rs:1:1 bad thing'])
    expect(judge('cargo check', 'Finished dev in 0.2s', false)).toMatchObject({ ok: true, parsed: true })
    expect(judge('cargo clippy', 'nothing', true)).toMatchObject({ ok: false, parsed: false, errors: 1 })
  })

  test('dotnet: the older summary, build error counts, and error lines without a count', () => {
    const old = judge('dotnet test', 'Total tests: 9\n     Passed: 7\n     Failed: 1\n    Skipped: 1\n', true)
    expect(old).toMatchObject({ pass: 7, fail: 1, skip: 1 })
    const build = judge('dotnet build', 'Program.cs(3,1): error CS1002: ; expected [/w/a.csproj]\n    0 Warning(s)\n    1 Error(s)\n', true)
    expect(build).toMatchObject({ errors: 1, failures: ['Program.cs(3,1): error CS1002: ; expected'] })
    expect(chipText(build!)).toBe('✗ dotnet build 1 error')
    const bare = judge('dotnet build', 'a.cs(1,1): error CS0001: one\nb.cs(2,2): error CS0002: two\n', true)
    expect(bare).toMatchObject({ errors: 2 })
  })

  test('mocha with nothing failing', () => {
    expect(judge('npx mocha', '  12 passing (20ms)\n', false)).toMatchObject({ pass: 12, fail: 0, failures: [], ok: true })
  })

  test('tsc without a closing count; eslint without a summary or a file', () => {
    const t = judge('tsc', 'a.ts:1:2 - error TS1005: x expected.\n', true)
    expect(t).toMatchObject({ errors: 1, failures: ['a.ts:1 TS1005 x expected.'] })
    const e = judge('npx eslint .', '  3:1  error  Missing semicolon\n  4:1  warning  meh  no-console\n', true)
    expect(e).toMatchObject({ errors: 1, warnings: 0, failures: ['3 Missing semicolon'] })
    expect(chipText(e!)).toBe('✗ eslint 1 error')
  })

  test('maven: a build that fails without tests, and one that passes', () => {
    const f = judge('mvn compile', '[ERROR] /w/A.java:[3,1] cannot find symbol\n[ERROR] -> [Help 1]\n[INFO] BUILD FAILURE\n', true)
    expect(f).toMatchObject({ runner: 'maven', kind: 'build', errors: 1, failures: ['/w/A.java:[3,1] cannot find symbol'], ok: false })
    expect(judge('mvn compile', '[INFO] BUILD SUCCESS', false)).toMatchObject({ ok: true, errors: 0 })
    expect(judge('mvn compile', 'nothing', false)).toMatchObject({ ok: true, parsed: false })
  })

  test('gradle: compile errors, what went wrong, and plain test counts', () => {
    const out = 'e: file:///w/A.kt:3:1 Unresolved reference: x\nB.java:4: error: ; expected\n* What went wrong:\nExecution failed for task \':compileJava\'.\nBUILD FAILED in 2s\n'
    const g = judge('./gradlew build', out, true)
    expect(g).toMatchObject({ errors: 2, ok: false })
    expect(g?.failures).toEqual(['file:///w/A.kt:3:1 Unresolved reference: x', 'B.java:4: error: ; expected', 'Execution failed for task \':compileJava\'.'])
    const only = judge('gradle build', 'BUILD FAILED in 1s\n', true)
    expect(only).toMatchObject({ errors: 1 })
    expect(judge('./gradlew test', '12 tests completed\nBUILD SUCCESSFUL in 3s', false)).toMatchObject({ pass: 12, fail: 0, skip: 0, ok: true })
    expect(judge('gradle assemble', 'nothing', false)).toMatchObject({ ok: true, parsed: false })
  })

  test('a build tool that parsed clean but exited non-zero still fails', () => {
    const quiet = judge('npm run build', '✖ 2 problems (0 errors, 2 warnings)\nerror Command failed with exit code 1.', true)
    expect(quiet).toMatchObject({ runner: 'build', errors: 1, warnings: 2, ok: false, failures: ['error Command failed with exit code 1.'] })
    const named = judge('mvn package', '[ERROR] Something odd\n[INFO] BUILD SUCCESS', true)
    expect(named).toMatchObject({ errors: 1, failures: ['Something odd'] })
    expect(judge('npm run build', 'src/a.ts(1,1): error TS1: x\nFound 1 error.', true)?.runner).toBe('build')
    expect(judge('npm test', 'test result: ok. 3 passed; 0 failed; 0 ignored', false)).toMatchObject({ runner: 'test', pass: 3 })
  })
})

describe('chip text and health', () => {
  test('tests', () => {
    expect(chipText(outcome({ ok: false, errors: 1 }))).toBe('✗ x 1 error')
    expect(chipText(outcome({ ok: false, errors: 3 }))).toBe('✗ x 3 errors')
    expect(chipText(outcome({ ok: true, parsed: false }))).toBe('✓ x passed')
    expect(chipText(outcome({ ok: true, pass: 5 }))).toBe('✓ x 5')
  })

  test('builds', () => {
    expect(chipText(outcome({ kind: 'build', ok: true, warnings: 2 }))).toBe('✓ x · 2 warn')
    expect(chipText(outcome({ kind: 'build', ok: true }))).toBe('✓ x')
    expect(chipText(outcome({ kind: 'build', ok: false, errors: 4, parsed: false }))).toBe('✗ x 4 errors')
    expect(chipText(outcome({ kind: 'build', ok: false, errors: 1, parsed: false }))).toBe('✗ x failed')
    expect(chipText(outcome({ kind: 'build', ok: false, errors: 1, parsed: true }))).toBe('✗ x 1 error')
  })

  test('types and lint', () => {
    expect(chipText(outcome({ kind: 'lint', ok: false, errors: 1, warnings: 3 }))).toBe('✗ x 1 error · 3 warn')
  })

  test('health', () => {
    expect(health(outcome({ pass: 3, fail: 1 }))).toBe(0.75)
    expect(health(outcome({ kind: 'types', errors: 3 }))).toBe(0.25)
    expect(health(outcome({ ok: true }))).toBe(1)
    expect(health(outcome({ ok: false }))).toBe(0.1)
  })
})
