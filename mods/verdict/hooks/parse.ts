// Verdict's parsers: which shell commands run tests, type checks, linters or
// builds, and what their output says (passed / failed / skipped, error
// counts, the failing tests' names and the first error lines). Pure.

export type Kind = 'test' | 'types' | 'lint' | 'build'

export type Outcome = {
  runner: string
  kind: Kind
  ok: boolean
  pass: number
  fail: number
  skip: number
  errors: number
  warnings: number
  /** Failing test names or first error lines, at most MAX_FAILURES, each clipped. */
  failures: string[]
  /** False when no summary line was recognized (the verdict is the exit status alone). */
  parsed: boolean
}

export const MAX_FAILURES = 8
const MAX_LINE = 160

/** Removes ANSI escapes and carriage-return overprints. */
export function clean(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .split('\n')
    .map(l => l.slice(l.lastIndexOf('\r') + 1))
    .join('\n')
}

const clip = (s: string): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > MAX_LINE ? one.slice(0, MAX_LINE - 1) + '…' : one
}

function uniq(xs: string[]): string[] {
  const out: string[] = []
  for (const x of xs.map(clip)) if (x && !out.includes(x)) out.push(x)
  return out.slice(0, MAX_FAILURES)
}

const num = (re: RegExp, s: string): number => Number(re.exec(s)?.[1] ?? 0) || 0

/** Every match of `re`: the patterns here come without the g flag and never match an empty string. */
function all(re: RegExp, s: string): RegExpExecArray[] {
  const g = new RegExp(re.source, re.flags + 'g')
  const out: RegExpExecArray[] = []
  let m: RegExpExecArray | null
  while ((m = g.exec(s)) !== null) out.push(m)
  return out
}

// ---------------------------------------------------------------------------
// Detection.

type Rule = { re: RegExp; runner: string; kind: Kind }

/** A word that is a command here, not part of a path or file name. */
const w = (word: string): string => `(?<![\\w./\\\\-])(?:\\.[\\\\/])?${word}(?![\\w.-])`
const PM = '(?:npm|pnpm|yarn|bun)'

const RULES: Rule[] = [
  { re: new RegExp(w('vitest')), runner: 'vitest', kind: 'test' },
  { re: new RegExp(w('jest')), runner: 'jest', kind: 'test' },
  { re: new RegExp(`${w('pytest')}|${w('py\\.test')}|python[\\d.]*(?:\\.exe)? -m pytest`), runner: 'pytest', kind: 'test' },
  { re: new RegExp(`${w('go')} test(?![\\w.-])`), runner: 'go test', kind: 'test' },
  { re: new RegExp(`${w('cargo')} (?:test|nextest)(?![\\w.-])`), runner: 'cargo test', kind: 'test' },
  { re: new RegExp(`${w('dotnet')} test(?![\\w.-])`), runner: 'dotnet test', kind: 'test' },
  { re: new RegExp(w('mocha')), runner: 'mocha', kind: 'test' },
  { re: new RegExp(`${w('bun')} test(?![\\w.-])`), runner: 'bun test', kind: 'test' },
  { re: new RegExp(`${w('mvnw?')}(?: [^|&;]*)? (?:test|verify)(?![\\w.-])`), runner: 'maven', kind: 'test' },
  { re: new RegExp(`${w('gradlew?')}(?: [^|&;]*)? (?::?\\w+:)?test(?![\\w.-])`), runner: 'gradle', kind: 'test' },
  { re: new RegExp(`${w(PM)} (?:run )?test(?![\\w.-])|${w('npx?')} test(?![\\w.-])|${w(PM)} t(?![\\w.-])`), runner: 'test', kind: 'test' },
  { re: new RegExp(`${w('tsc')}|${w('vue-tsc')}|${w(PM)} (?:run )?(?:typecheck|type-check|tsc)(?![\\w.-])`), runner: 'tsc', kind: 'types' },
  { re: new RegExp(`${w('eslint')}|${w(PM)} (?:run )?lint(?![\\w.-])`), runner: 'eslint', kind: 'lint' },
  { re: new RegExp(`${w('cargo')} (?:build|check|clippy)(?![\\w.-])`), runner: 'cargo build', kind: 'build' },
  { re: new RegExp(`${w('go')} (?:build|vet)(?![\\w.-])`), runner: 'go build', kind: 'build' },
  { re: new RegExp(`${w('dotnet')} build(?![\\w.-])`), runner: 'dotnet build', kind: 'build' },
  { re: new RegExp(w('mvnw?')), runner: 'maven', kind: 'build' },
  { re: new RegExp(w('gradlew?')), runner: 'gradle', kind: 'build' },
  { re: new RegExp(`${w(PM)} (?:run )?build(?![\\w.-])|${w('vite')} build|${w('next')} build|${w('webpack')}|${w('tsup')}|${w('esbuild')}`), runner: 'build', kind: 'build' },
]

/** The runner a shell command invokes, or undefined when it runs none we know. */
export function detect(command: string): { runner: string; kind: Kind } | undefined {
  const cmd = command.replace(/\s+/g, ' ')
  for (const r of RULES) if (r.re.test(cmd)) return { runner: r.runner, kind: r.kind }
  return undefined
}

// ---------------------------------------------------------------------------
// Parsers, one per family. Each returns undefined when its summary is absent.

type Part = Omit<Outcome, 'runner' | 'kind' | 'ok' | 'parsed'> & { runner?: string; buildFailed?: boolean }

const zero = (): Part => ({ pass: 0, fail: 0, skip: 0, errors: 0, warnings: 0, failures: [] })

export function parseVitest(out: string): Part | undefined {
  const tests = /^\s*Tests\s+(.+?)\s*\((\d+)\)\s*$/m.exec(out)
  if (!tests) return undefined
  const s = tests[1]!
  const p = zero()
  p.fail = num(/(\d+) failed/, s)
  p.pass = num(/(\d+) passed/, s)
  p.skip = num(/(\d+) skipped/, s) + num(/(\d+) todo/, s)
  const errs = num(/^\s*Errors\s+(\d+) errors?/m, out)
  p.errors = errs
  const fails = all(/^\s*FAIL\s+(.+?)\s*$/m, out).map(m => m[1]!)
  const crosses = all(/^\s*[×✗]\s+(.+?)(?:\s+\d+m?s)?\s*$/m, out).map(m => m[1]!)
  p.failures = uniq(fails.length ? fails : crosses)
  p.runner = 'vitest'
  return p
}

export function parseJest(out: string): Part | undefined {
  const tests = /^Tests:\s+(.*?)(\d+) total/m.exec(out)
  if (!tests) return undefined
  const s = tests[1]!
  const p = zero()
  p.fail = num(/(\d+) failed/, s)
  p.pass = num(/(\d+) passed/, s)
  p.skip = num(/(\d+) skipped/, s) + num(/(\d+) todo/, s)
  p.failures = uniq(all(/^\s*● (?!Console)(.+?)\s*$/m, out).map(m => m[1]!).filter(x => !/^Test suite failed to run/.test(x)))
  if (!p.failures.length) p.failures = uniq(all(/^\s*✕ (.+?)(?: \(\d+ ?m?s\))?\s*$/m, out).map(m => m[1]!))
  p.runner = 'jest'
  return p
}

export function parsePytest(out: string): Part | undefined {
  const lines = all(/^(?:=+ )?((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s(?: \([\d:]+\))?(?: =+)?\s*$/m, out)
  const last = lines[lines.length - 1]
  if (!last) {
    if (/^=+ no tests ran/m.test(out)) return zero()
    return undefined
  }
  const s = last[1]!
  const p = zero()
  p.pass = num(/(\d+) passed/, s) + num(/(\d+) xpassed/, s)
  p.fail = num(/(\d+) failed/, s)
  p.skip = num(/(\d+) skipped/, s) + num(/(\d+) xfailed/, s) + num(/(\d+) deselected/, s)
  p.errors = num(/(\d+) errors?/, s)
  p.warnings = num(/(\d+) warnings?/, s)
  p.failures = uniq([
    ...all(/^FAILED (\S+)(?: - (.*))?$/m, out).map(m => (m[2] ? `${m[1]} — ${m[2]}` : m[1]!)),
    ...all(/^ERROR (\S+)(?: - (.*))?$/m, out).map(m => (m[2] ? `${m[1]} — ${m[2]}` : m[1]!)),
  ])
  p.runner = 'pytest'
  return p
}

export function parseGo(out: string): Part | undefined {
  const pass = all(/^\s*--- PASS: /m, out).length
  const failNames = all(/^\s*--- FAIL: (\S+)/m, out).map(m => m[1]!)
  const skip = all(/^\s*--- SKIP: /m, out).length
  const okPkgs = all(/^ok\s+\S+/m, out).length
  const failPkgs = all(/^FAIL\s+(\S+)(?:\s+\[build failed\]|\s+[\d.]+s)?\s*$/m, out).map(m => m[1]!)
  const compile = all(/^(\S+\.go:\d+:\d+: .+)$/m, out).map(m => m[1]!)
  if (!pass && !failNames.length && !skip && !okPkgs && !failPkgs.length && !compile.length) return undefined
  const p = zero()
  if (pass || failNames.length || skip) {
    p.pass = pass
    p.fail = failNames.length
    p.skip = skip
  } else {
    p.pass = okPkgs
    p.fail = failPkgs.length
  }
  p.errors = compile.length
  p.failures = uniq([...failNames, ...compile, ...(failNames.length ? [] : failPkgs.map(x => `package ${x}`))])
  p.runner = 'go test'
  return p
}

/** rustc diagnostics: `error[E0308]: mismatched types` with its `--> src/x.rs:3:5` line. */
function rustErrors(out: string): { errors: string[]; warnings: number } {
  const errors: string[] = []
  const lines = out.split('\n')
  lines.forEach((l, i) => {
    const m = /^error(\[E\d+\])?: (.+)$/.exec(l)
    if (!m || /^(could not compile|aborting due to|test failed|build failed|\d+ previous errors?)/.test(m[2]!)) return
    const at = /^\s*--> (.+)$/.exec(lines[i + 1] ?? '')?.[1]
    errors.push(at ? `${at} ${m[1] ?? ''} ${m[2]}` : `${m[1] ?? ''} ${m[2]}`)
  })
  const warnings = all(/^warning: (?!.*generated \d+ warnings?)(?!unused manifest)/m, out).length
  return { errors, warnings }
}

export function parseCargo(out: string): Part | undefined {
  const results = all(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/m, out)
  const rust = rustErrors(out)
  if (!results.length && !rust.errors.length && !/Finished|Compiling/.test(out)) return undefined
  const p = zero()
  for (const r of results) {
    p.pass += Number(r[1])
    p.fail += Number(r[2])
    p.skip += Number(r[3])
  }
  p.errors = rust.errors.length
  p.warnings = rust.warnings
  p.failures = uniq([...all(/^test (\S+) \.\.\. FAILED$/m, out).map(m => m[1]!), ...rust.errors])
  return p
}

export function parseDotnet(out: string): Part | undefined {
  const p = zero()
  const modern = all(/(?:Failed|Passed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+)/m, out)
  const builds = /(\d+) Error\(s\)/.exec(out)
  if (modern.length) {
    for (const m of modern) {
      p.fail += Number(m[1])
      p.pass += Number(m[2])
      p.skip += Number(m[3])
    }
  } else if (/^\s*Total tests: \d+/m.test(out)) {
    p.pass = num(/^\s*Passed: (\d+)/m, out)
    p.fail = num(/^\s*Failed: (\d+)/m, out)
    p.skip = num(/^\s*Skipped: (\d+)/m, out)
  } else if (!builds && !/: error [A-Z]+\d+:/.test(out)) {
    return undefined
  }
  const errLines = all(/^\s*(\S.*?: error [A-Z]+\d+: .+?)(?: \[[^\]]+\])?\s*$/m, out).map(m => m[1]!)
  p.errors = builds ? Number(builds[1]) : uniq(errLines).length
  p.warnings = num(/(\d+) Warning\(s\)/, out)
  p.failures = uniq([...all(/^\s*Failed (\S+) \[/m, out).map(m => m[1]!), ...errLines])
  return p
}

export function parseMocha(out: string): Part | undefined {
  if (!/^\s*\d+ passing/m.test(out) && !/^\s*\d+ failing/m.test(out)) return undefined
  const p = zero()
  p.pass = num(/^\s*(\d+) passing/m, out)
  p.fail = num(/^\s*(\d+) failing/m, out)
  p.skip = num(/^\s*(\d+) pending/m, out)
  const at = out.search(/^\s*\d+ failing/m)
  const tail = at >= 0 ? out.slice(at).split('\n').slice(1) : []
  const names: string[] = []
  for (let i = 0; i < tail.length; i++) {
    const m = /^\s+\d+\) (.+)$/.exec(tail[i]!)
    if (!m) continue
    const path = [m[1]!]
    // The title continues on deeper-indented lines until one ends with a colon.
    while (!/:$/.test(path[path.length - 1]!) && i + 1 < tail.length && /^\s{4,}\S/.test(tail[i + 1]!) && path.length < 6) path.push(tail[++i]!.trim())
    names.push(path.join(' › ').replace(/:$/, ''))
  }
  p.failures = uniq(names)
  p.runner = 'mocha'
  return p
}

export function parseBun(out: string): Part | undefined {
  if (!/^\s*\d+ pass\s*$/m.test(out) && !/^\s*\d+ fail\s*$/m.test(out)) return undefined
  const p = zero()
  p.pass = num(/^\s*(\d+) pass\s*$/m, out)
  p.fail = num(/^\s*(\d+) fail\s*$/m, out)
  p.skip = num(/^\s*(\d+) skip\s*$/m, out) + num(/^\s*(\d+) todo\s*$/m, out)
  p.failures = uniq(all(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?\s*$/m, out).map(m => m[1]!))
  p.runner = 'bun test'
  return p
}

export function parseTsc(out: string): Part | undefined {
  const lines = [
    ...all(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/m, out),
    ...all(/^(.+?):(\d+):(\d+) - error (TS\d+): (.+)$/m, out),
  ].map(m => `${m[1]}:${m[2]} ${m[4]} ${m[5]}`)
  const found = /Found (\d+) errors?/.exec(out)
  if (!found && !lines.length) return undefined
  const p = zero()
  p.errors = found ? Number(found[1]) : lines.length
  p.failures = uniq(lines)
  return p
}

export function parseEslint(out: string): Part | undefined {
  const summary = /✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(out)
  const p = zero()
  let file = ''
  const errs: string[] = []
  for (const l of out.split('\n')) {
    if (/^(?:[A-Za-z]:)?[/\\]?\S.*\.\w+$/.test(l) && !/^\s/.test(l)) file = l.trim()
    const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/.exec(l)
    if (m && m[3] === 'error') errs.push(`${file ? file.split(/[\\/]/).pop() + ':' : ''}${m[1]} ${m[4]}${m[5] ? ` (${m[5]})` : ''}`)
  }
  if (!summary && !errs.length) return undefined
  p.errors = summary ? Number(summary[2]) : errs.length
  p.warnings = summary ? Number(summary[3]) : 0
  p.failures = uniq(errs)
  return p
}

export function parseMaven(out: string): Part | undefined {
  const runs = all(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/m, out)
  const verdict = /BUILD (SUCCESS|FAILURE)/.exec(out)
  if (!runs.length && !verdict) return undefined
  const p = zero()
  const last = runs[runs.length - 1]
  if (last) {
    const total = Number(last[1])
    p.fail = Number(last[2]) + Number(last[3])
    p.skip = Number(last[4])
    p.pass = Math.max(0, total - p.fail - p.skip)
  }
  const errLines = all(/^\[ERROR\] (.+)$/m, out).map(m => m[1]!).filter(x => x.trim() && !/^(->|Re-run|To see the full|For more information|\[Help|Failed to execute goal|Tests run:|Failures:|Errors:|Run \d|$)/.test(x.trim()))
  p.failures = uniq(errLines)
  p.errors = verdict?.[1] === 'FAILURE' && p.fail === 0 ? Math.max(1, all(/^\[ERROR\] .+\.(?:java|kt):\[?\d+/m, out).length) : 0
  p.buildFailed = verdict?.[1] === 'FAILURE'
  return p
}

export function parseGradle(out: string): Part | undefined {
  const verdict = /BUILD (SUCCESSFUL|FAILED)/.exec(out)
  const tests = /(\d+) tests? completed(?:, (\d+) failed)?(?:, (\d+) skipped)?/.exec(out)
  if (!verdict && !tests) return undefined
  const p = zero()
  if (tests) {
    const total = Number(tests[1])
    p.fail = Number(tests[2]) || 0
    p.skip = Number(tests[3]) || 0
    p.pass = Math.max(0, total - p.fail - p.skip)
  }
  const compile = [...all(/^e: (.+)$/m, out).map(m => m[1]!), ...all(/^(.+\.java:\d+: error: .+)$/m, out).map(m => m[1]!)]
  const wrong = /\* What went wrong:\n(.+)/.exec(out)?.[1]
  p.errors = compile.length || (verdict?.[1] === 'FAILED' && p.fail === 0 ? 1 : 0)
  p.failures = uniq([...all(/^(\S+ > .+) FAILED$/m, out).map(m => m[1]!), ...compile, ...(wrong ? [wrong] : [])])
  p.buildFailed = verdict?.[1] === 'FAILED'
  return p
}

/** Error-looking lines of an unknown build tool, for a failed build. */
function genericErrors(out: string): string[] {
  return uniq(out.split('\n').filter(l => /\berror\b|\bERR!|✘|\bfailed\b/i.test(l) && !/^\s*(?:npm )?ERR! (?:A complete log|code|path|errno)/.test(l)))
}

// ---------------------------------------------------------------------------

const BY_RUNNER: Record<string, ((out: string) => Part | undefined)[]> = {
  vitest: [parseVitest],
  jest: [parseJest],
  pytest: [parsePytest],
  'go test': [parseGo],
  'go build': [parseGo],
  'cargo test': [parseCargo],
  'cargo build': [parseCargo],
  'dotnet test': [parseDotnet],
  'dotnet build': [parseDotnet],
  mocha: [parseMocha],
  'bun test': [parseBun],
  maven: [parseMaven],
  gradle: [parseGradle],
  test: [parseVitest, parseJest, parseBun, parseMocha, parsePytest, parseGo, parseCargo, parseDotnet],
  tsc: [parseTsc],
  eslint: [parseEslint],
  build: [parseTsc, parseEslint],
}

/**
 * The verdict of one run: `command` as given to the shell, `output` its
 * stdout and stderr, `isError` whether the tool reported a failure (a
 * non-zero exit). Undefined when the command runs nothing Verdict knows.
 */
export function judge(command: string, output: string, isError: boolean): Outcome | undefined {
  const hit = detect(command)
  if (!hit) return undefined
  const out = clean(output)
  let part: Part | undefined
  // Every rule's runner has its parsers.
  for (const parse of BY_RUNNER[hit.runner]!) {
    part = parse(out)
    if (part) break
  }
  const runner = hit.runner === 'test' || hit.runner === 'build' ? part?.runner ?? (hit.runner === 'test' ? detectByOutput(out) : 'build') : hit.runner
  const p = part ?? zero()
  if (!part && isError) {
    p.failures = genericErrors(out)
    if (hit.kind !== 'test') p.errors = Math.max(1, Math.min(p.failures.length, 99))
  }
  if (part && hit.kind === 'build' && isError && p.errors === 0 && p.fail === 0) {
    p.errors = 1
    if (!p.failures.length) p.failures = genericErrors(out)
  }
  const ok = hit.kind === 'test'
    ? !isError && p.fail === 0 && p.errors === 0
    : !isError && p.errors === 0 && p.buildFailed !== true
  return {
    runner,
    kind: hit.kind,
    ok,
    pass: p.pass,
    fail: p.fail,
    skip: p.skip,
    errors: p.errors,
    warnings: p.warnings,
    failures: p.failures,
    parsed: part !== undefined,
  }
}

function detectByOutput(out: string): string {
  if (/\bvitest\b/i.test(out)) return 'vitest'
  if (/\bjest\b/i.test(out)) return 'jest'
  return 'test'
}

/** `✓ vitest 142`, `✗ vitest 3 failed`, `✓ tsc 0 errors`, `✗ eslint 4 errors`, `✓ build`. */
export function chipText(o: Pick<Outcome, 'runner' | 'kind' | 'ok' | 'pass' | 'fail' | 'errors' | 'warnings' | 'parsed'>): string {
  const mark = o.ok ? '✓' : '✗'
  if (o.kind === 'test') {
    if (o.fail > 0) return `${mark} ${o.runner} ${o.fail} failed`
    if (!o.ok) return o.errors > 0 ? `${mark} ${o.runner} ${o.errors} ${o.errors === 1 ? 'error' : 'errors'}` : `${mark} ${o.runner} failed`
    return `${mark} ${o.runner} ${o.parsed ? o.pass : 'passed'}`
  }
  if (o.kind === 'build') {
    if (o.ok) return `${mark} ${o.runner}${o.warnings ? ` · ${o.warnings} warn` : ''}`
    return o.errors > 1 || o.parsed ? `${mark} ${o.runner} ${o.errors} ${o.errors === 1 ? 'error' : 'errors'}` : `${mark} ${o.runner} failed`
  }
  return `${mark} ${o.runner} ${o.errors} ${o.errors === 1 ? 'error' : 'errors'}${o.warnings ? ` · ${o.warnings} warn` : ''}`
}

/** 0..1 for a sparkline: the share of tests passing, or 1 / (1 + errors). */
export function health(o: Pick<Outcome, 'kind' | 'ok' | 'pass' | 'fail' | 'errors'>): number {
  if (o.kind === 'test' && o.pass + o.fail > 0) return o.pass / (o.pass + o.fail)
  if (o.errors > 0) return 1 / (1 + o.errors)
  return o.ok ? 1 : 0.1
}
