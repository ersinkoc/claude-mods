import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WardenEntry, WardenSnap, WardenVerdict } from '../types'
import { KZ, clip, fitText, fmtSpan, pxOf, svg, svgText } from './lib/kz.ts'
import { RULE_BOOK, classify, parseExtra } from './rules.ts'
import type { Hit, Severity } from './rules.ts'

const FLASH_MS = 8000
const EMPTY: WardenSnap = { log: [], blocked: 0, allowed: 0, warned: 0, flash: null }
const snapAtom = atom({ plugin: 'warden', key: 'snap' } as const, EMPTY)
const hiddenAtom = atom({ plugin: 'warden', key: 'isHidden' } as const, false)

type Mode = 'ask' | 'deny' | 'warn'

const SEV_COLOR: Record<Severity, string> = { critical: KZ.red, high: KZ.amber, medium: KZ.yellow }
const VERDICT_COLOR: Record<WardenVerdict, string> = { blocked: KZ.red, allowed: KZ.green, warned: KZ.amber }
const VERDICT_GLYPH: Record<WardenVerdict, string> = { blocked: '✖', allowed: '✓', warned: '⚠' }

/** The command of a shell tool call, or undefined for any other tool. */
function commandOf(e: { tool: string; command?: unknown }): string | undefined {
  return (e.tool === 'Bash' || e.tool === 'PowerShell') && typeof e.command === 'string' ? e.command : undefined
}

// ---------------------------------------------------------------------------
// Judging, recording, the hide toggle: top-level, since `$` flows only here.

let flashTimer: { cancel: () => void } | undefined

async function judge($: EngineInterface, mode: Mode, found: Hit, command: string, isAgent: boolean): Promise<{ verdict: WardenVerdict; by: string }> {
  if (mode === 'deny') return { verdict: 'blocked', by: 'mode deny' }
  if (mode === 'warn') return { verdict: 'warned', by: 'mode warn' }
  try {
    const who = isAgent ? 'A subagent' : 'Claude'
    const answer = await $.ui.ask(
      `🛡 KOZMOS warden: ${who} wants to run a ${found.severity}-risk command (${found.label}): ${clip(command, 160)} — ${found.why} Run it?`,
      { options: ['Allow once', 'Deny'], header: 'warden' },
    )
    return answer.trim() === 'Allow once' ? { verdict: 'allowed', by: 'you' } : { verdict: 'blocked', by: 'you' }
  } catch {
    // Dismissed, or a -p run: no one could say yes.
    return { verdict: 'blocked', by: 'no one to ask' }
  }
}

async function record($: EngineInterface, entry: WardenEntry): Promise<void> {
  const flashes = entry.verdict !== 'allowed'
  await update($, snapAtom, prev => ({
    log: [...prev.log, entry].slice(-40),
    blocked: prev.blocked + (entry.verdict === 'blocked' ? 1 : 0),
    allowed: prev.allowed + (entry.verdict === 'allowed' ? 1 : 0),
    warned: prev.warned + (entry.verdict === 'warned' ? 1 : 0),
    flash: flashes
      ? { verdict: entry.verdict, label: entry.label, severity: entry.severity, command: entry.command, until: entry.at + FLASH_MS }
      : prev.flash,
  }))
  if (!flashes) return
  flashTimer?.cancel()
  flashTimer = $.clock.after(FLASH_MS, () => void clearFlash($).catch(() => undefined))
}

async function clearFlash($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  // The one live timer always belongs to a flash, so `flash` is set here; a
  // timer that fired early keeps it (the band hides it once its time is up).
  await update($, snapAtom, prev => (Number(prev.flash?.until) <= now + 50 ? { ...prev, flash: null } : prev))
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session at least.
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  try {
    const v = await $.store.get('isHidden')
    if (typeof v === 'boolean') await update($, hiddenAtom, () => v)
  } catch {
    // Nothing stored yet.
  }
}

async function report($: EngineInterface, mode: Mode, bad: readonly string[]): Promise<string> {
  const snap = await read($, snapAtom)
  const isHidden = await read($, hiddenAtom)
  const now = await $.clock.now()
  const lines = [`🛡 KOZMOS warden · mode ${mode} · band ${isHidden ? 'hidden (/warden show)' : 'shown (/warden hide)'}`, '', 'Rules:']
  for (const [sev, text] of RULE_BOOK) lines.push(`  ${sev.toUpperCase().padEnd(8)} ${text}`)
  if (bad.length) lines.push(`  (skipped bad extraPatterns: ${bad.join(' ;; ')})`)
  lines.push('', `This session: ${snap.blocked} blocked · ${snap.allowed} allowed · ${snap.warned} warned`)
  if (!snap.log.length) lines.push('  Nothing risky yet.')
  for (const l of [...snap.log].reverse().slice(0, 20)) {
    lines.push(`  ${VERDICT_GLYPH[l.verdict]} ${l.verdict.padEnd(7)} ${l.label.padEnd(20)} ${fmtSpan(now - l.at).padStart(5)} ago · ${l.by}${l.isAgent ? ' · subagent' : ''}`)
    lines.push(`      ${clip(l.command, 100)}`)
  }
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const mode: Mode = options.mode === 'deny' || options.mode === 'warn' ? options.mode : 'ask'
  // The load checks userConfig: extraPatterns is always a string (default '').
  const { patterns: extra, bad } = parseExtra(options.extraPatterns as string)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'warden', description: 'KOZMOS: the destructive-command guard — rules and this session\'s log (/warden hide|show for the band)', argumentHint: '[hide|show]', immediate: true })
    await loadHidden($)
    return started
  })

  on('command.run', { command: 'warden' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'hide' || arg === 'show' || arg === 'toggle') {
      const isHidden = arg === 'toggle' ? !(await read($, hiddenAtom)) : arg === 'hide'
      await setHidden($, isHidden)
      return { text: isHidden ? 'warden band hidden (the guard still runs). /warden show brings it back.' : 'warden band shown.' }
    }
    return { text: await report($, mode, bad) }
  })

  // The guard: judge before `next`, so nothing has run when it refuses.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = commandOf(e)
    const found = command === undefined ? null : classify(command, extra)
    if (!found || command === undefined) return next(e)
    const isAgent = e.agentId !== undefined
    const { verdict, by } = await judge($, mode, found, command, isAgent)
    const at = await $.clock.now()
    await record($, { at, verdict, label: found.label, severity: found.severity, command: clip(command, 200), by, isAgent })
    if (verdict === 'blocked') {
      $.ui.toast(`🛡 warden blocked: ${found.label}`)
      const why = by === 'you' ? 'The person denied it.' : by === 'no one to ask' ? 'No one could be asked to confirm it.' : 'warden is set to deny risky commands.'
      return { deny: `KOZMOS warden: blocked ${found.label} (${found.severity} risk). ${found.why} ${why} Ask the person first, or use a safer form.` }
    }
    if (verdict === 'warned') $.ui.toast(`⚠ warden: running ${found.label} (${found.severity} risk)`)
    return next(e)
  }).catch(($, e, next) => {
    // Raised beneath another hook's call: judge the command alone, no `$`.
    if (next.error.kind === 're-entry') {
      const command = commandOf(e)
      const found = command === undefined ? null : classify(command, extra)
      return found ? { deny: `KOZMOS warden: blocked ${found.label} (${found.severity} risk); it could not be confirmed here.` } : next(e)
    }
    return next.called ? next(e) : { deny: 'KOZMOS warden failed closed' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const { flash } = await read($, snapAtom)
    if (!flash) return drawn
    const now = await $.clock.now()
    const left = flash.until - now
    if (left <= 0) return drawn
    const ui = $.ui.resolve(e)
    const verb = flash.verdict === 'blocked' ? 'blocked' : 'warned'
    const color = VERDICT_COLOR[flash.verdict]
    const cols = Math.max(24, e.props.bodyColumns || 80)

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Box, Button, Svg } = ui
      const W = Math.max(220, pxOf(cols) - 40)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="warden" flexDirection="row" alignItems="center">
            <Svg source={flashSvg(W, flash.verdict, flash.label, flash.severity, flash.command, left)} alt={`warden ${verb}: ${flash.label}`} width={W} height={40} />
            <Button key="warden-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    const { Box, Button, Text } = ui
    const head = `🛡 warden ${verb}: ${flash.label}`
    const room = Math.max(0, cols - head.length - 18)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="warden" flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text bold color={color}>{head}</Text>
            <Text color={SEV_COLOR[flash.severity]}> · {flash.severity}</Text>
            {room > 8 ? <Text dimColor> · {clip(flash.command, room)}</Text> : ''}
            <Text dimColor> {'▮'.repeat(Math.max(1, Math.ceil(left / 1000)))}</Text>
          </Text>
          <Button key="warden-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
        </Box>
      </Box>
    )
  })
}

/** The desktop flash: a shield, the verdict, the rule, the command and an 8 s fuse. */
function flashSvg(W: number, verdict: WardenVerdict, label: string, severity: Severity, command: string, leftMs: number): string {
  const c = VERDICT_COLOR[verdict]
  const sc = SEV_COLOR[severity]
  const head = `warden ${verdict === 'blocked' ? 'blocked' : 'warned'}:`
  const headW = head.length * 7.2
  const labelX = 44 + headW + 6
  const labelW = Math.min(W * 0.4, label.length * 7.4 + 4)
  const chipX = labelX + labelW + 8
  const chipW = severity.length * 6.4 + 14
  const cmdX = chipX + chipW + 10
  const css = `.fuse{transform-box:fill-box;transform-origin:left center;animation:wdfuse ${Math.round(leftMs)}ms linear forwards}@keyframes wdfuse{to{transform:scaleX(0)}}
.glow{animation:wdglow 1.2s ease-in-out infinite}@keyframes wdglow{50%{opacity:.25}}`
  const body = `<rect class="p" x="0" y="0" width="${W}" height="40" rx="10"/>
<rect x="0" y="0" width="4" height="40" rx="2" fill="${c}"/>
<circle cx="24" cy="18" r="13" fill="${c}" opacity=".18" class="glow"/>
<path d="M24 7l9 3.5v6.2c0 6-3.9 10.3-9 12.3-5.1-2-9-6.3-9-12.3v-6.2z" fill="${c}"/>
${verdict === 'blocked' ? '<path d="M20.5 14.5l7 7M27.5 14.5l-7 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' : '<path d="M24 12.5v6.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="23" r="1.4" fill="#fff"/>'}
${svgText(44, 22, head, { size: 12.5, weight: 700, fill: c })}
${svgText(labelX, 22, fitText(label, 12.5, labelW), { size: 12.5, weight: 700, mono: true })}
<rect x="${chipX}" y="10" width="${chipW}" height="17" rx="8.5" fill="${sc}" opacity=".2"/>
${svgText(chipX + chipW / 2, 22, severity, { size: 10, weight: 700, anchor: 'middle', fill: sc })}
${cmdX + 40 < W ? svgText(cmdX, 22, fitText(command, 11, W - cmdX - 12), { cls: 'm', size: 11, mono: true }) : ''}
<rect class="k" x="44" y="32" width="${W - 56}" height="3" rx="1.5"/>
<rect class="fuse" x="44" y="32" width="${W - 56}" height="3" rx="1.5" fill="${c}"/>`
  return svg(W, 40, body, css)
}

