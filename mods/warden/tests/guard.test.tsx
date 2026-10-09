import { describe, expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 110, scroll: { offset: 0, bodyRows: 10 }, view: {} },
}
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

type Base = { ran: string[]; asked: string[]; toasts: string[] }

/** Beneath warden: Bash and PowerShell run and report; the dialog answers `answer` (null: dismissed). */
function base(on: On, answer: string | null, store: Record<string, unknown> | false): Base {
  const w: Base = { ran: [], asked: [], toasts: [] }
  if (store !== false) mock.store(on, store)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]?.question ?? ''
    w.asked.push(q)
    if (answer === null) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [q]: answer } } }
  })
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, ($, e) => {
    w.ran.push(String(e.command))
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  return w
}

/** The usual world: a mocked clock and store. */
function world(on: On, answer: string | null, opts: { store?: Record<string, unknown> | false } = {}): Base & { clock: MockClock } {
  const clock = mock.clock(on, { now: 5_000_000 })
  return { ...base(on, answer, opts.store ?? {}), clock }
}

/**
 * A clock driven by hand: `now` is what `$.clock.now()` reads, a broken clock
 * fails it, and each `$.clock.after` waits for `fire()`. `read()` resolves at
 * the next read of the clock.
 */
type HandClock = { now: number; isBroken: boolean; fire: () => void; read: () => Promise<void> }
function handClock(on: On): HandClock {
  const timers: (() => void)[] = []
  const waiting: (() => void)[] = []
  const c: HandClock = {
    now: 5_000_000,
    isBroken: false,
    fire: () => {
      for (const t of timers.splice(0)) t()
    },
    read: () => new Promise(res => void waiting.push(res)),
  }
  on('clock.now', ($, e, next) => {
    for (const w of waiting.splice(0)) w()
    return c.isBroken ? next(e) : { value: c.now }
  })
  on('clock.after', () => new Promise(res => void timers.push(() => res({ value: undefined }))))
  return c
}

/** A store the test can read back: what warden persisted. */
function recordingStore(on: On): Map<string, unknown> {
  const m = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  return m
}

const warden = async ($: Engine, args = ''): Promise<string> => String((await $.command.run({ command: 'warden', args, ...RUN })).text)

describe('the guard', () => {
  test('a subagent is named in the question and the log; a harmless or non-shell call passes untouched', async ($, on) => {
    const w = world(on, 'Allow once')
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Bash', command: 'git stash clear', agentId: 'a1' } as never)
    expect(r.deny).toBeUndefined()
    expect(w.asked[0]).toMatch(/A subagent wants to run a medium-risk command \(git stash clear\)/)
    expect(w.ran).toEqual(['git stash clear'])
    await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    await $.tool.call({ tool: 'Bash', command: 42 } as never)
    expect(w.ran).toEqual(['git stash clear', 'ls -la', '42'])
    expect(w.asked.length).toBe(1)
    const log = await warden($)
    expect(log).toMatch(/0 blocked · 1 allowed · 0 warned/)
    expect(log).toMatch(/✓ allowed git stash clear .* ago · you · subagent/)
    expect(log).toMatch(/\n {6}git stash clear/)
  })

  test('Claude is named for the main loop; a dismissed question blocks and says no one could confirm', async ($, on) => {
    const w = world(on, null)
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item C:\\ -Recurse -Force' })
    expect(w.asked[0]).toMatch(/^🛡 KOZMOS warden: Claude wants to run a critical-risk command/)
    expect(r.deny).toMatch(/No one could be asked to confirm it\./)
    expect(w.toasts).toEqual(['🛡 warden blocked: Remove-Item -Recurse -Force C:\\'])
    expect(await warden($)).toMatch(/✖ blocked .* · no one to ask/)
  })

  test('any answer but "Allow once" is a no', async ($, on) => {
    const w = world(on, 'maybe later')
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Bash', command: 'git push -f' })
    expect(r.deny).toMatch(/The person denied it\./)
    expect(w.ran).toEqual([])
  })

  test('mode warn toasts and runs; the report says so', { options: { mode: 'warn' } }, async ($, on) => {
    const w = world(on, 'Deny')
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'chmod -R 777 /' })
    expect(w.toasts).toEqual(['⚠ warden: running chmod -R 777 (critical risk)'])
    expect(w.asked).toEqual([])
    const log = await warden($)
    expect(log).toMatch(/^🛡 KOZMOS warden · mode warn · band shown/)
    expect(log).toMatch(/⚠ warned {2}chmod -R 777 .* · mode warn/)
  })

  test('the log keeps the newest 40 and the report shows the newest 20, newest first', { options: { mode: 'deny' } }, async ($, on) => {
    world(on, null)
    await $.session.start(START)
    for (let i = 0; i < 42; i++) await $.tool.call({ tool: 'Bash', command: `git branch -D b${i}` })
    const log = await warden($)
    expect(log).toMatch(/42 blocked/)
    const shown = log.split('\n').filter(l => /^ {6}git branch -D b\d+$/.test(l)).map(l => l.trim())
    expect(shown.length).toBe(20)
    expect(shown[0]).toBe('git branch -D b41')
    expect(shown[19]).toBe('git branch -D b22')
  })
})

describe('/warden', () => {
  test('a fresh session: the rule book, nothing risky yet, and the bad extra patterns', { options: { extraPatterns: 'kubectl delete ;; [oops ;; (x' } }, async ($, on) => {
    world(on, 'Deny')
    await $.session.start(START)
    const log = await warden($)
    expect(log).toMatch(/mode ask · band shown \(\/warden hide\)/)
    expect(log).toMatch(/ {2}CRITICAL rm -r \/ Remove-Item/)
    expect(log).toMatch(/ {2}MEDIUM {3}git branch -D/)
    expect(log).toMatch(/\(skipped bad extraPatterns: \[oops ;; \(x\)/)
    expect(log).toMatch(/0 blocked · 0 allowed · 0 warned\n {2}Nothing risky yet\./)
  })

  test('extra patterns guard too', { options: { extraPatterns: 'kubectl delete' } }, async ($, on) => {
    const w = world(on, 'Deny')
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Bash', command: 'kubectl delete ns prod' })
    expect(r.deny).toMatch(/blocked custom \/kubectl delete\/ \(high risk\)/)
    expect(w.ran).toEqual([])
  })

  test('hide, show and toggle persist in the store; any other word shows the report', async ($, on) => {
    const store = recordingStore(on)
    world(on, 'Deny', { store: false })
    await $.session.start(START)
    expect(await warden($, ' HIDE ')).toBe('warden band hidden (the guard still runs). /warden show brings it back.')
    expect(store.get('isHidden')).toBe(true)
    expect(await warden($, 'toggle')).toBe('warden band shown.')
    expect(store.get('isHidden')).toBe(false)
    expect(await warden($, 'toggle')).toMatch(/hidden/)
    expect(await warden($, 'show')).toBe('warden band shown.')
    expect(await warden($, 'rules')).toMatch(/^🛡 KOZMOS warden/)
  })

  test('a hidden band is remembered across sessions', async ($, on) => {
    world(on, 'Deny', { store: { isHidden: true } })
    await $.session.start(START)
    expect(await warden($)).toMatch(/band hidden \(\/warden show\)/)
  })

  test('a stored value that is not a boolean is ignored', async ($, on) => {
    world(on, 'Deny', { store: { isHidden: 'yes' } })
    await $.session.start(START)
    expect(await warden($)).toMatch(/band shown/)
  })

  test('with no store the toggle still works for the session', async ($, on) => {
    world(on, 'Deny', { store: false })
    await $.session.start(START)
    expect(await warden($, 'hide')).toMatch(/hidden/)
    expect(await warden($)).toMatch(/band hidden/)
  })
})

describe('failing closed', () => {
  test('when warden itself fails before running the call, the call is refused', async ($, on) => {
    // No clock beneath: judging cannot stamp the entry and throws.
    const ran: string[] = []
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      ran.push(String(e.command))
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    expect(r.deny).toBe('KOZMOS warden failed closed')
    expect(ran).toEqual([])
  })

  test('when the call beneath fails after warden let it through, that failure stands', { options: { mode: 'warn' } }, async ($, on) => {
    mock.clock(on, { now: 1000 })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('ui.toast', () => ({ value: undefined }))
    let calls = 0
    on('tool.call', { tool: 'Bash' }, () => {
      calls++
      throw new Error('disk on fire')
    })
    await $.session.start(START)
    await expect($.tool.call({ tool: 'Bash', command: 'git reset --hard' })).rejects.toThrow()
    // The failed run is not run again by the handler.
    expect(calls).toBe(1)
  })

  test('a shell call raised beneath warden\'s own question is judged alone: risky ones refused, others run', {
    plugins: [{
      name: 'nested',
      tier: 'append',
      register(on) {
        on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
          const risky = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
          const fine = await $.tool.call({ tool: 'Bash', command: 'ls' })
          const odd = await $.tool.call({ tool: 'Bash', command: 7 } as never)
          $.ui.toast(JSON.stringify([risky, fine, odd]))
          return next(e)
        })
      },
    }],
  }, async ($, on) => {
    const w = world(on, 'Deny')
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    const [risky, fine, odd] = JSON.parse(w.toasts[0] ?? '[]')
    expect(risky.deny).toBe('KOZMOS warden: blocked rm -rf / (critical risk); it could not be confirmed here.')
    expect(fine.result.stdout).toBe('ok')
    expect(odd.result.stdout).toBe('ok')
    expect(w.ran).toEqual(['ls', '7'])
  })
})

describe('the band', () => {
  test('nothing to show: no flash yet, a survey up, or hidden', async ($, on) => {
    const w = world(on, 'Deny')
    await $.session.start(START)
    const fresh = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND })
    expect(await fresh.find({ type: 'Text' })).toBeUndefined()
    expect(await fresh.find({ key: 'engine' })).toBeDefined()
    await fresh.unmount()
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    expect(w.ran).toEqual([])
    const survey = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await survey.find({ type: 'Text' })).toBeUndefined()
    await survey.unmount()
    await warden($, 'hide')
    const hidden = await $.ui.mount({ plugin: 'warden', surface: 'desktop', ...BAND })
    expect(await hidden.find({ type: 'Svg' })).toBeUndefined()
    await hidden.unmount()
  })

  test('terminal: the verdict, severity, command and fuse; ✕ hides it', async ($, on) => {
    const store = recordingStore(on)
    world(on, 'Deny', { store: false })
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
    const ui = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: '🛡 warden blocked: git push --force' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · high' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · git push --force origin main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ▮▮▮▮▮▮▮▮' })).toBeDefined()
    await ui.press({ key: 'warden-hide' })
    expect(await ui.find({ type: 'Text', text: /warden blocked/ })).toBeUndefined()
    expect(store.get('isHidden')).toBe(true)
    await ui.unmount()
  })

  test('terminal: a narrow band drops the command; no width given reads as 80 columns', async ($, on) => {
    world(on, 'Deny')
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~5' })
    const narrow = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 40 } })
    expect(await narrow.find({ type: 'Text', text: /warden blocked: git reset --hard/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /HEAD~5/ })).toBeUndefined()
    await narrow.unmount()
    const unset = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 0 } })
    expect(await unset.find({ type: 'Text', text: ' · git reset --hard HEAD~5' })).toBeDefined()
    await unset.unmount()
  })

  test('desktop: a blocked flash draws a cross, a warned one an exclamation; a narrow card drops the command', { options: { mode: 'warn' } }, async ($, on) => {
    world(on, 'Deny')
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git clean -fdx --quiet' })
    const wide = await $.ui.mount({ plugin: 'warden', surface: 'desktop', ...BAND })
    const svg = await wide.find({ type: 'Svg' })
    const src = String(svg?.props.source)
    expect(svg?.props.alt).toBe('warden warned: git clean -fdx')
    expect(src).toMatch(/warden warned:/)
    expect(src).toMatch(/<circle cx="24" cy="23" r="1.4"/)
    expect(src).toMatch(/git clean -fdx --quiet/)
    expect(src).toMatch(/animation:wdfuse 8000ms/)
    await wide.unmount()
    const narrow = await $.ui.mount({ plugin: 'warden', surface: 'desktop', ...BAND, props: { ...BAND.props, bodyColumns: 10 } })
    const small = String((await narrow.find({ type: 'Svg' }))?.props.source)
    expect(small).toMatch(/width="220"/)
    expect(small).not.toMatch(/--quiet/)
    await narrow.press({ key: 'warden-hide' })
    expect(await narrow.find({ type: 'Svg' })).toBeUndefined()
    await narrow.unmount()
  })

  test('desktop: a blocked flash draws the cross', { options: { mode: 'deny' } }, async ($, on) => {
    world(on, null)
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'mkfs.ext4 /dev/sdb1' })
    const ui = await $.ui.mount({ plugin: 'warden', surface: 'desktop', ...BAND })
    const src = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(src).toMatch(/warden blocked:/)
    expect(src).toMatch(/M20.5 14.5l7 7M27.5 14.5l-7 7/)
    expect(src).toMatch(/critical/)
    await ui.unmount()
  })
})


describe('the flash timer', () => {
  test('the flash clears 8 s after the last block, a newer block restarting the fuse', { options: { mode: 'deny' } }, async ($, on) => {
    const w = world(on, null)
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    await w.clock.advance(4000)
    await $.tool.call({ tool: 'Bash', command: 'git clean -f' })
    await w.clock.advance(4500)
    const ui = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /warden blocked: git clean -f/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' ▮▮▮▮' })).toBeDefined()
    await w.clock.advance(3500)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /warden blocked/ })).toBeUndefined()
    await ui.unmount()
    expect(w.ran).toEqual([])
  })

  test('a timer that fires early keeps the flash; the band still hides it once its time is up', { options: { mode: 'deny' } }, async ($, on) => {
    const clock = handClock(on)
    base(on, null, {})
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    // The timer fires while the clock still reads 7 s before the flash ends.
    clock.now += 1000
    const read = clock.read()
    clock.fire()
    await read
    const ui = await $.ui.mount({ plugin: 'warden', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /warden blocked: git reset --hard/ })).toBeDefined()
    clock.now += 7000
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /warden blocked/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a clock that fails when the timer fires is shrugged off', { options: { mode: 'deny' } }, async ($, on) => {
    const clock = handClock(on)
    base(on, null, {})
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
    clock.isBroken = true
    const read = clock.read()
    clock.fire()
    await read
    clock.isBroken = false
    expect(await warden($)).toMatch(/1 blocked/)
  })
})
