import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { ToolMark } from '../types'
import { KZ, svg, svgText, textWidth, toolColor, toolGlyph } from './lib/kz.ts'

// One mark per call, in a $.state family keyed by tool_use_id: a row's draw
// subscribes to its own member alone, so a call finishing redraws its row and
// no other. The ToolUse / ToolResult `requestId` is that same tool_use_id
// (and `e.props.tool_use_id` says so explicitly); the hook prefers the prop.

const markFamily = atom({ plugin: 'toolmarks', key: 'mark' } as const, null)
const onAtom = atom({ plugin: 'toolmarks', key: 'isOn' } as const, true)

const SLOW_MS = 3000

/** 12ms, 1.2s, 14s, 2m05s. */
function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const isShell = (tool: string): boolean => tool === 'Bash' || tool === 'PowerShell'

type Part = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

/** The badge for one call, as parts both surfaces draw. */
function badgeOf(m: ToolMark, isErrored: boolean, isInterrupted: boolean): Part[] {
  const dur = fmtDur(m.ms)
  if (isInterrupted || m.isInterrupted) return [{ text: '⊘ ', color: KZ.amber }, { text: dur, isDim: true }]
  if (m.isBackground) return [{ text: '↗ bg', color: KZ.cyan }, { text: ` · ${dur}`, isDim: true }]
  if (m.isDenied) return [{ text: '✖ denied', color: KZ.red, isBold: true }]
  if (isErrored || m.isError) {
    const what = m.exit !== undefined ? `exit ${m.exit}` : 'failed'
    return [{ text: `✖ ${what}`, color: KZ.red, isBold: true }, { text: ` · ${dur}`, isDim: true }]
  }
  if (isShell(m.tool) && m.exit !== undefined) {
    return [{ text: `${toolGlyph(m.tool)} `, color: toolColor(m.tool) }, { text: `exit ${m.exit} · `, isDim: true }, { text: dur, color: m.ms >= SLOW_MS ? KZ.amber : undefined, isDim: m.ms < SLOW_MS }]
  }
  return [{ text: `${toolGlyph(m.tool)} `, color: toolColor(m.tool) }, { text: dur, color: m.ms >= SLOW_MS ? KZ.amber : undefined, isDim: m.ms < SLOW_MS }]
}

/** The exit status a shell's errored result names ("Exit code 2"), if any. */
function exitFrom(text: string | undefined): number | undefined {
  const m = /exit (?:code|status)[:\s]*(-?\d+)/i.exec(text ?? '')
  return m ? Number(m[1]) : undefined
}

async function setOn($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, onAtom, () => isOn)
  await $.store.set('isOn', isOn)
}

async function record($: EngineInterface, id: string, mark: ToolMark): Promise<void> {
  await update($, memberOf(markFamily, { requestId: id }), () => mark)
}

/** One small SVG pill for the desktop, drawn under a slow or failed row. */
function badgeSvg(parts: readonly Part[]): { source: string; width: number } {
  const size = 11
  let x = 8
  const body: string[] = []
  for (const p of parts) {
    body.push(svgText(x, 13, p.text, p.color ? { size, weight: p.isBold ? 700 : 600, fill: p.color } : { cls: 's', size }))
    x += textWidth(p.text, size)
  }
  const width = Math.ceil(x + 8)
  // Every badge opens with its colored glyph or verdict.
  const tint = parts[0]!.color!
  return { source: svg(width, 18, `<rect x="0" y="0" width="${width}" height="18" rx="9" fill="${tint}" opacity=".14"/>${body.join('')}`), width }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'toolmarks', description: 'KOZMOS: toggle duration and exit badges on tool rows (/toolmarks on|off)', argumentHint: '[on|off]', immediate: true })
    try {
      const stored = await $.store.get('isOn')
      await update($, onAtom, () => stored !== false)
    } catch {
      // Default on.
    }
    return started
  })

  on('command.run', { command: 'toolmarks' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, onAtom))
    await setOn($, isOn)
    return { text: isOn ? 'Toolmarks on: finished tool rows carry their duration and status.' : 'Toolmarks off.' }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const tool = String(e.tool)
    const at = await $.clock.now()
    const ran = await next(e)
    if (typeof id === 'string' && id) {
      const ms = (await $.clock.now()) - at
      let mark: ToolMark
      if (ran.deny !== undefined) mark = { tool, ms, isError: true, isDenied: true }
      else {
        const isError = ran.isError === true
        const res = (ran.result ?? {}) as Record<string, unknown>
        mark = { tool, ms, isError }
        if (res.interrupted === true) mark.isInterrupted = true
        if (typeof res.backgroundTaskId === 'string') mark.isBackground = true
        if (isShell(tool)) {
          const exit = isError ? exitFrom(ran.text) : mark.isInterrupted || mark.isBackground ? undefined : 0
          if (exit !== undefined) mark.exit = exit
        }
      }
      // A failed write lands in the .catch handler below, which hands back `ran` all the same.
      await record($, id, mark)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    // Conservative: anything but the shape we know, or a live row, is the engine's.
    if (typeof p !== 'object' || p === null || typeof p.tool !== 'string' || typeof p.isErrored !== 'boolean' || p.isRunning !== false) return next(e)
    if (!(await read($, onAtom))) return next(e)
    const id = typeof p.tool_use_id === 'string' && p.tool_use_id ? p.tool_use_id : e.requestId
    if (!id) return next(e)
    const mark = await read($, memberOf(markFamily, { requestId: id }))
    if (!mark || mark.tool !== p.tool) return next(e)
    const parts = badgeOf(mark, p.isErrored, p.isInterrupted === true)
    const ui = $.ui.resolve(e)

    if ('Svg' in ui && e.surface !== 'terminal') {
      // The desktop draws its own rich rows: mark only the ones worth a look.
      if (!(p.isErrored || mark.isError || mark.ms >= SLOW_MS)) return next(e)
      const drawn = await next(e)
      const { Box, Svg } = ui
      const { source, width } = badgeSvg(parts)
      return (
        <Box flexDirection="column">
          {drawn}
          <Svg source={source} alt={parts.map(x => x.text).join('')} width={width} height={18} />
        </Box>
      )
    }

    const drawn = await next(e)
    const { Box, Text } = ui
    const nodes: RenderNode[] = parts.map((x, i) => (
      <Text key={`b${i}`} color={x.color} dimColor={x.isDim === true} bold={x.isBold === true}>{x.text}</Text>
    ))
    return (
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>{drawn}</Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text wrap="truncate-end">{nodes}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const p = e.props
    if (e.surface !== 'terminal' || typeof p !== 'object' || p === null || p.isExpanded !== false || p.isActive !== false || !Array.isArray(p.calls)) return next(e)
    if (!(await read($, onAtom))) return next(e)
    let total = 0
    let known = 0
    let failed = 0
    for (const c of p.calls) {
      if (c.isErrored) failed++
      if (typeof c.tool_use_id !== 'string' || !c.tool_use_id) continue
      const m = await read($, memberOf(markFamily, { requestId: c.tool_use_id }))
      if (!m) continue
      known++
      total += m.ms
    }
    if (!known && !failed) return next(e)
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>{drawn}</Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text wrap="truncate-end">
            {known ? <Text key="t" dimColor>Σ {fmtDur(total)}</Text> : ''}
            {failed ? <Text key="f" color={KZ.red} bold>{known ? ' ' : ''}✖ {failed} failed</Text> : ''}
          </Text>
        </Box>
      </Box>
    )
  })
}
