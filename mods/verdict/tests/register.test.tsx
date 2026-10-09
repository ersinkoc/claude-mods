import { describe, expect, mock, test } from 'claude-code/testing'

import { chipText, detect, judge } from '../hooks/parse.ts'
import { bandSvg, chipsOf, paneCard } from '../hooks/view.ts'

const VITEST_FAIL = `
 RUN  v2.1.4 /work/app

 ✓ src/util/date.test.ts (12 tests) 8ms
 ❯ src/api/client.test.ts (31 tests | 2 failed) 41ms
   × client > retries on 503 12ms
     → expected 2 to be 3
   × client > parses the error body 3ms
     → Unexpected token < in JSON at position 0
 ✓ src/ui/button.test.tsx (99 tests | 2 skipped) 120ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/api/client.test.ts > client > retries on 503
AssertionError: expected 2 to be 3
 FAIL  src/api/client.test.ts > client > parses the error body
SyntaxError: Unexpected token < in JSON at position 0

 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 140 passed | 2 skipped (144)
   Start at  10:41:07
   Duration  1.32s (transform 210ms, setup 0ms, collect 380ms, tests 169ms)
`

const VITEST_PASS = `
 ✓ src/a.test.ts (142 tests) 31ms

 Test Files  4 passed (4)
      Tests  142 passed (142)
   Start at  09:12:44
   Duration  812ms
`

const JEST_FAIL = `
FAIL src/cart.test.js
  Cart
    ✓ adds an item (3 ms)
    ✕ applies the discount (5 ms)

  ● Cart › applies the discount

    expect(received).toBe(expected) // Object.is equality

    Expected: 90
    Received: 100

PASS src/user.test.js

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 1 skipped, 37 passed, 39 total
Snapshots:   0 total
Time:        2.104 s
Ran all test suites.
`

const PYTEST_FAIL = `
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-8.2.0, pluggy-1.5.0
collected 46 items

tests/test_parse.py ........F.....                                       [ 30%]
tests/test_api.py ...............s...F.......                            [100%]

=================================== FAILURES ===================================
_______________________________ test_dates_utc _________________________________
...
=========================== short test summary info ============================
FAILED tests/test_parse.py::test_dates_utc - AssertionError: assert '2024-01-01' == '2024-01-02'
FAILED tests/test_api.py::test_timeout - TimeoutError: read timed out
=================== 2 failed, 43 passed, 1 skipped in 3.41s ====================
`

const GO_FAIL = `
=== RUN   TestParse
--- PASS: TestParse (0.00s)
=== RUN   TestRoundTrip
    codec_test.go:41: got "a", want "b"
--- FAIL: TestRoundTrip (0.00s)
=== RUN   TestSkipMe
--- SKIP: TestSkipMe (0.00s)
FAIL
FAIL	github.com/acme/codec	0.012s
ok  	github.com/acme/store	0.230s
`

const CARGO_FAIL = `
   Compiling acme v0.1.0 (/work/acme)
    Finished test [unoptimized + debuginfo] target(s) in 2.31s
     Running unittests src/lib.rs (target/debug/deps/acme-3f2a)

running 12 tests
test parser::tests::empty ... ok
test parser::tests::nested ... FAILED
test lexer::tests::unicode ... ignored

failures:

---- parser::tests::nested stdout ----
thread 'parser::tests::nested' panicked at src/parser.rs:88:9

failures:
    parser::tests::nested

test result: FAILED. 10 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s

error: test failed, to rerun pass \`--lib\`
`

const CARGO_BUILD = `
   Compiling acme v0.1.0 (/work/acme)
error[E0308]: mismatched types
  --> src/main.rs:12:18
   |
12 |     let x: u32 = "five";
   |            ---   ^^^^^^ expected \`u32\`, found \`&str\`

error[E0425]: cannot find value \`y\` in this scope
 --> src/main.rs:14:5

error: could not compile \`acme\` (bin "acme") due to 2 previous errors
`

const DOTNET_FAIL = `
  Determining projects to restore...
  Acme.Tests -> /work/Acme.Tests/bin/Debug/net8.0/Acme.Tests.dll
  Failed Acme.Tests.MathTests.Divides_by_zero [12 ms]
  Error Message:
   Assert.Throws() Failure

Failed!  - Failed:     1, Passed:    57, Skipped:     2, Total:    60, Duration: 310 ms - Acme.Tests.dll (net8.0)
`

const TSC_FAIL = `src/api.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/ui/view.tsx(40,11): error TS2339: Property 'foo' does not exist on type 'Props'.

Found 2 errors in 2 files.

Errors  Files
     1  src/api.ts:12
     1  src/ui/view.tsx:40
`

const ESLINT_FAIL = `
/work/src/app.ts
   3:10  error    'unused' is defined but never used  @typescript-eslint/no-unused-vars
  18:1   warning  Unexpected console statement         no-console

/work/src/db.ts
  7:3  error  Unexpected var, use let or const instead  no-var

✖ 3 problems (2 errors, 1 warning)
  1 error and 0 warnings potentially fixable with the \`--fix\` option.
`

const MOCHA = `
  Array
    #indexOf()
      ✔ returns -1 when absent
      1) returns the index

  27 passing (41ms)
  1 failing
  2 pending

  1) Array
       #indexOf()
         returns the index:
     AssertionError: expected -1 to equal 2
`

const BUN = `
src/a.test.ts:
✓ adds [0.12ms]
(fail) subtracts [0.31ms]

 41 pass
 1 fail
 63 expect() calls
Ran 42 tests across 3 files. [88.00ms]
`

const MAVEN = `
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   CalcTest.adds:14 expected: <4> but was: <5>
[INFO]
[ERROR] Tests run: 25, Failures: 1, Errors: 0, Skipped: 3
[INFO]
[INFO] BUILD FAILURE
`

const GRADLE = `
> Task :test FAILED

CalcTest > divides() FAILED
    java.lang.ArithmeticException at CalcTest.java:22

18 tests completed, 1 failed, 2 skipped

FAILURE: Build failed with an exception.
BUILD FAILED in 4s
`

describe('detect', () => {
  test('knows runners by the command, not by file names', () => {
    expect(detect('npx vitest run')?.runner).toBe('vitest')
    expect(detect('pnpm test -- --run')?.runner).toBe('test')
    expect(detect('python -m pytest -q tests/')?.runner).toBe('pytest')
    expect(detect('cd api && go test ./...')?.runner).toBe('go test')
    expect(detect('cargo test --workspace')?.runner).toBe('cargo test')
    expect(detect('cargo build --release')?.runner).toBe('cargo build')
    expect(detect('dotnet test Acme.sln')?.runner).toBe('dotnet test')
    expect(detect('npx tsc --noEmit -p .')).toEqual({ runner: 'tsc', kind: 'types' })
    expect(detect('npm run lint')).toEqual({ runner: 'eslint', kind: 'lint' })
    expect(detect('npm run build')).toEqual({ runner: 'build', kind: 'build' })
    expect(detect('./mvnw -q test')?.runner).toBe('maven')
    expect(detect('./gradlew build')).toEqual({ runner: 'gradle', kind: 'build' })
    expect(detect('cat vitest.config.ts')).toBeUndefined()
    expect(detect('ls src/jest/')).toBeUndefined()
    expect(detect('git status')).toBeUndefined()
  })
})

describe('parse', () => {
  test('vitest: counts and the failing tests', () => {
    const o = judge('npx vitest run', VITEST_FAIL, true)
    expect(o).toMatchObject({ runner: 'vitest', ok: false, pass: 140, fail: 2, skip: 2 })
    expect(o?.failures[0]).toBe('src/api/client.test.ts > client > retries on 503')
    expect(chipText(judge('npm test', VITEST_PASS, false)!)).toBe('✓ vitest 142')
  })

  test('jest', () => {
    const o = judge('npx jest', JEST_FAIL, true)
    expect(o).toMatchObject({ runner: 'jest', pass: 37, fail: 1, skip: 1, ok: false })
    expect(o?.failures).toEqual(['Cart › applies the discount'])
    expect(chipText(o!)).toBe('✗ jest 1 failed')
  })

  test('pytest', () => {
    const o = judge('pytest -q', PYTEST_FAIL, true)
    expect(o).toMatchObject({ pass: 43, fail: 2, skip: 1 })
    expect(o?.failures[0]).toContain('tests/test_parse.py::test_dates_utc')
  })

  test('go test', () => {
    const o = judge('go test ./...', GO_FAIL, true)
    expect(o).toMatchObject({ pass: 1, fail: 1, skip: 1, ok: false })
    expect(o?.failures).toContain('TestRoundTrip')
  })

  test('cargo test and cargo build', () => {
    const t = judge('cargo test', CARGO_FAIL, true)
    expect(t).toMatchObject({ pass: 10, fail: 1, skip: 1 })
    expect(t?.failures[0]).toBe('parser::tests::nested')
    const b = judge('cargo build', CARGO_BUILD, true)
    expect(b).toMatchObject({ kind: 'build', errors: 2, ok: false })
    expect(b?.failures[0]).toContain('src/main.rs:12:18')
    expect(chipText(b!)).toBe('✗ cargo build 2 errors')
  })

  test('dotnet test', () => {
    const o = judge('dotnet test', DOTNET_FAIL, true)
    expect(o).toMatchObject({ pass: 57, fail: 1, skip: 2 })
    expect(o?.failures).toContain('Acme.Tests.MathTests.Divides_by_zero')
  })

  test('tsc: error count and first error lines; a clean run is 0 errors', () => {
    const o = judge('npx tsc --noEmit', TSC_FAIL, true)
    expect(o).toMatchObject({ kind: 'types', errors: 2, ok: false })
    expect(o?.failures[0]).toBe("src/api.ts:12 TS2322 Type 'string' is not assignable to type 'number'.")
    expect(chipText(judge('tsc -p .', '', false)!)).toBe('✓ tsc 0 errors')
  })

  test('eslint: errors and warnings with file and rule', () => {
    const o = judge('npx eslint src', ESLINT_FAIL, true)
    expect(o).toMatchObject({ kind: 'lint', errors: 2, warnings: 1 })
    expect(o?.failures).toEqual(["app.ts:3 'unused' is defined but never used (@typescript-eslint/no-unused-vars)", 'db.ts:7 Unexpected var, use let or const instead (no-var)'])
  })

  test('mocha, bun, maven, gradle', () => {
    expect(judge('npx mocha', MOCHA, true)).toMatchObject({ pass: 27, fail: 1, skip: 2 })
    expect(judge('npx mocha', MOCHA, true)?.failures[0]).toBe('Array › #indexOf() › returns the index')
    const b = judge('bun test', BUN, true)
    expect(b).toMatchObject({ pass: 41, fail: 1 })
    expect(b?.failures).toEqual(['subtracts'])
    const m = judge('mvn test', MAVEN, true)
    expect(m).toMatchObject({ runner: 'maven', pass: 21, fail: 1, skip: 3 })
    expect(m?.failures[0]).toContain('CalcTest.adds:14')
    const g = judge('./gradlew test', GRADLE, true)
    expect(g).toMatchObject({ runner: 'gradle', pass: 15, fail: 1, skip: 2 })
    expect(g?.failures[0]).toBe('CalcTest > divides()')
  })

  test('an unknown build that fails still says so', () => {
    const o = judge('npm run build', 'vite v5.2.0 building for production...\nerror during build:\nCould not resolve "./missing"', true)
    expect(o).toMatchObject({ runner: 'build', ok: false })
    expect(o?.failures[0]).toBe('error during build:')
  })
})

describe('views', () => {
  test('chips per runner, newest first, sparklines over the history', () => {
    const base = { kind: 'test' as const, skip: 0, errors: 0, warnings: 0, failures: [], command: 'x', parsed: true, ms: 10 }
    const runs = [
      { ...base, id: 1, at: 100, runner: 'vitest', ok: true, pass: 10, fail: 0 },
      { ...base, id: 2, at: 200, runner: 'vitest', ok: false, pass: 8, fail: 2, failures: ['a > b'] },
      { ...base, id: 3, at: 300, runner: 'tsc', kind: 'types' as const, ok: true, pass: 0, fail: 0 },
    ]
    const chips = chipsOf(runs, 150)
    expect(chips.map(c => c.text)).toEqual(['✓ tsc 0 errors', '✗ vitest 2 failed'])
    expect(chips[1]?.spark).toHaveLength(2)
    const band = bandSvg(chips, 700, true)
    expect(band.source).toContain('class="pz"')
    expect(band.source).toContain('a &gt; b')
    expect(paneCard(chips, 500).source).toContain('VITEST')
  })
})

const BAND = (maxRows: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: 110, scroll: { offset: 0, bodyRows: maxRows - 1 }, view: {} },
})
const PANE = {
  component: 'Pane' as const,
  requestId: 'kz-verdict',
  props: { title: 'KOZMOS · Verdict', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('register', () => {
  test('a failing test run lights the band, the pane lists the failures', async ($, on) => {
    mock.clock(on, { now: 1_700_000_000_000 })
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="engine" /> })
    on('ui.panes', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.call', ($, e) => {
      if (e.tool !== 'Bash') return { result: 'ok' }
      if (e.command.includes('vitest')) return { isError: true as const, result: undefined, text: VITEST_FAIL }
      if (e.command.includes('tsc')) return { result: { stdout: '', stderr: '', interrupted: false } }
      return { result: { stdout: 'hi', stderr: '', interrupted: false } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const none = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...BAND(20) })
    expect(await none.find({ type: 'Client' })).toBeUndefined()
    await none.unmount()

    await $.tool.call({ tool: 'Bash', command: 'echo hi' })
    await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
    await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })

    const term = await $.ui.mount({ plugin: 'verdict', surface: 'terminal', ...BAND(20) })
    expect(await term.find({ type: 'Client', key: 'verdict' })).toBeDefined()
    await term.advance(200)
    expect(await term.find({ type: 'Text', text: /vitest 2 failed/, in: 'verdict' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /tsc 0 errors/, in: 'verdict' })).toBeDefined()
    expect(await term.find({ type: 'Text', text: /src\/api/, in: 'verdict' })).toBeDefined()
    await term.unmount()

    const desk = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(20) })
    const src = String((await desk.find({ type: 'Svg' }))?.props.source)
    expect(src).toContain('vitest 2 failed')
    expect(src).toContain('class="pz"')
    await desk.press({ key: 'verdict-hide' })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    await desk.unmount()

    const r = await $.command.run({ command: 'verdict', args: '', ...RUN })
    expect(r.text).toContain('Verdict open')

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'verdict', surface, ...PANE })
      expect(await pane.find({ type: 'Text', text: /retries on 503/ })).toBeDefined()
      if (surface === 'desktop') expect(await pane.find({ type: 'Svg' })).toBeDefined()
      await pane.unmount()
    }

    // /verdict brought the band back.
    const back = await $.ui.mount({ plugin: 'verdict', surface: 'desktop', ...BAND(20) })
    expect(await back.find({ type: 'Svg' })).toBeDefined()
    await back.unmount()

    const cleared = await $.command.run({ command: 'verdict', args: 'clear', ...RUN })
    expect(cleared.text).toContain('cleared')
  })
})
