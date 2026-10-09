import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StoryBoard, StoryChapter } from '../types'
import { KZ, bar, fmtClock, pxOf } from './lib/kz.ts'
import {
  CHAPTER_SCHEMA, NUDGE, PHASES, PHASE_COLOR, PHASE_GLYPH, bandSvg, chapterAlt, chapterRowSvg, headerSvg, parseChapter, phaseTimes,
  railRuns, stepText, timesSvg,
} from './story.ts'

const PANE = 'kz-storyboard'
const TITLE = 'KOZMOS · Storyboard'
const TOOL = 'mcp__storyboard__chapter'
const MAX_LOG = 120

const boardAtom = atom({ plugin: 'storyboard', key: 'board' } as const, { current: null, log: [], startedAt: 0 })
const hiddenAtom = atom({ plugin: 'storyboard', key: 'isHidden' } as const, false)

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function addChapter($: EngineInterface, c: StoryChapter): Promise<number> {
  let n = 0
  await update($, boardAtom, prev => {
    const log = [...prev.log, c].slice(-MAX_LOG)
    n = log.length
    return { ...prev, current: c, log }
  })
  return n
}

function logText(b: StoryBoard): string {
  if (!b.log.length) return 'Storyboard: no chapters yet. Claude marks them on multi-step tasks.'
  return [
    `Storyboard — ${b.log.length} chapter${b.log.length === 1 ? '' : 's'}`,
    ...b.log.map(c => {
      const step = stepText(c)
      return `  ${fmtClock(c.at - b.startedAt)}  ${c.phase.padEnd(7)} ${c.title}${step ? ` (${step})` : ''}${c.note ? ` — ${c.note}` : ''}`
    }),
  ].join('\n')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    await update($, boardAtom, () => ({ current: null, log: [], startedAt: now }))
    await $.command.register({
      name: 'storyboard',
      description: 'KOZMOS: show or hide the Storyboard chapter band (/storyboard log opens the chapter history)',
      argumentHint: '[log]',
      immediate: true,
    })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // Fresh store.
    }
    try {
      await $.tool.register({
        name: 'chapter',
        description: 'Mark a new chapter of your work for the user watching: call it when your phase changes on a multi-step task. Returns "noted".',
        inputSchema: CHAPTER_SCHEMA,
        isDeferred: false,
      })
    } catch {
      // No tool this session; the band stays empty.
    }
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'storyboard' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'log') {
      const isOpen = await togglePane($)
      return { text: isOpen ? 'Storyboard log open.' : 'Storyboard log closed.' }
    }
    if (arg === 'list' || arg === 'print') return { text: logText(await read($, boardAtom)) }
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Storyboard band hidden.' : 'Storyboard band shown.' }
  })

  // The tool the model calls. Its answer is one word, to cost nothing.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseChapter(e as unknown as Record<string, unknown>, await $.clock.now())
    if (typeof parsed === 'string') return { result: `not noted: ${parsed}` }
    await addChapter($, parsed)
    return { result: 'noted' }
  }).catch(() => ({ result: 'not noted: the storyboard is unavailable' }))

  // One short section of the system prompt, on the session side of the cache
  // boundary, only where the tool is offered; `nudge: false` drops it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (options.nudge === false) return composed
    if (e.tools.length > 0 && !e.tools.includes(TOOL)) return composed
    if (composed.sections.some(s => s.id === 'storyboard:nudge')) return composed
    return { sections: [...composed.sections, { id: 'storyboard:nudge', text: NUDGE, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const c = (await read($, boardAtom)).current
    if (!c) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const hide = <Button key="storyboard-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns) - 36
      const { source, height } = bandSvg(c, W)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="storyboard" flexDirection="row">
            <Svg source={source} alt={chapterAlt(c)} width={W} height={height} />
            {hide}
          </Box>
        </Box>
      )
    }

    const cols = Math.max(24, e.props.bodyColumns || 80)
    const color = PHASE_COLOR[c.phase]
    const step = stepText(c)
    const meter = c.step !== undefined && c.steps !== undefined ? ` ${bar(c.step / c.steps, Math.min(10, c.steps * 2))}` : ''
    const roomy = e.props.maxRows >= 8
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="storyboard" flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color={color} bold>{PHASE_GLYPH[c.phase]} </Text>
              <Text bold>{c.title}</Text>
              {step ? <Text color={color}>  {step}</Text> : ''}
              {meter ? <Text color={color} dimColor>{meter}</Text> : ''}
            </Text>
            {hide}
          </Box>
          <Text wrap="truncate-end">
            {railRuns(c.phase, cols).map((r, i) => (
              <Text key={`r${i}`} color={r.color} bold={r.bold} dimColor={r.dim}>{r.text}</Text>
            ))}
          </Text>
          {roomy && c.note ? <Text dimColor wrap="truncate-end">  ↳ {c.note}</Text> : null}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const b = await read($, boardAtom)
    const now = await $.clock.now()
    const times = phaseTimes(b.log, now)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const rows = [...b.log].reverse()
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={headerSvg(b.current, b.log.length, W)} alt={b.current ? chapterAlt(b.current) : 'No chapters yet'} width={W} height={78} />
          {b.log.length > 0 && <Svg key="times" source={timesSvg(times, W)} alt="Time per phase" width={W} height={54} />}
          {rows.map((c, i) => (
            <Svg key={`c${b.log.length - i}`} source={chapterRowSvg(c, W, b.startedAt, i === 0, i === rows.length - 1)} alt={chapterAlt(c)} width={W} height={c.note ? 50 : 36} />
          ))}
        </Box>
      )
    }

    const cols = Math.max(28, e.props.bodyColumns || 40)
    const total = PHASES.reduce((s, p) => s + times[p], 0)
    return (
      <Box flexDirection="column">
        <Text bold color={KZ.violet}>✦ STORYBOARD <Text dimColor>· {b.log.length} chapters</Text></Text>
        {b.current ? (
          <Text wrap="truncate-end">
            {railRuns(b.current.phase, cols).map((r, i) => (
              <Text key={`r${i}`} color={r.color} bold={r.bold} dimColor={r.dim}>{r.text}</Text>
            ))}
          </Text>
        ) : <Text dimColor>No chapters yet: Claude marks them on multi-step tasks.</Text>}
        {total > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {PHASES.map(p => (
              <Box key={`t-${p}`} flexDirection="row">
                <Box width={9} flexShrink={0}><Text color={PHASE_COLOR[p]}>{p}</Text></Box>
                <Text color={PHASE_COLOR[p]}>{bar(times[p] / total, Math.max(6, Math.min(24, cols - 20)))}</Text>
                <Text dimColor> {times[p] ? fmtClock(times[p]) : '—'}</Text>
              </Box>
            ))}
          </Box>
        )}
        {[...b.log].reverse().map((c, i) => {
          const step = stepText(c)
          return (
            <Box key={`c${b.log.length - i}`} flexDirection="column" marginTop={i === 0 ? 1 : 0}>
              <Text wrap="truncate-end">
                <Text dimColor>{fmtClock(c.at - b.startedAt).padStart(5)} </Text>
                <Text color={PHASE_COLOR[c.phase]} bold={i === 0}>{i === 0 ? '◉' : '●'} {c.phase.padEnd(7)}</Text>
                <Text bold={i === 0}>{c.title}</Text>
                {step ? <Text dimColor> {step}</Text> : ''}
              </Text>
              {c.note ? <Text dimColor wrap="truncate-end">{'      '}↳ {c.note}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
