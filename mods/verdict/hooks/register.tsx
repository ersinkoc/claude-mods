import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { VerdictRun, VerdictSnap } from '../types'
import { KZ, clip, hash, pxOf } from './lib/kz.ts'
import { detect, judge } from './parse.ts'
import { bandAlt, bandSvg, chipsOf, clock, duration, failureLines, paneCard, runSummary } from './view.ts'

const PANE = 'kz-verdict'
const TITLE = 'KOZMOS · Verdict'
const KEEP = 60

const snapAtom = atom({ plugin: 'verdict', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'verdict', key: 'isHidden' } as const, false)

// Live history; the band and pane draw the snapshot in $.state.
let runs: VerdictRun[] = []
let sessionStartedAt = 0
let storeKey = 'runs'

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const snap: VerdictSnap = { runs: [...runs], sessionStartedAt }
  await update($, snapAtom, () => snap)
}

async function persist($: EngineInterface): Promise<void> {
  try {
    await $.store.set(storeKey, runs)
  } catch {
    // History stays in memory for this session.
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

function isRun(x: unknown): x is VerdictRun {
  const r = x as VerdictRun
  return typeof r === 'object' && r !== null && typeof r.runner === 'string' && typeof r.at === 'number' && Array.isArray(r.failures)
}

/** The shell output of a Bash or PowerShell result: stdout and stderr, else the text the model read. */
function outputOf(result: unknown, text: string | undefined): string {
  const r = (result ?? {}) as Record<string, unknown>
  const parts = [r.stdout, r.stderr].filter((s): s is string => typeof s === 'string' && s.length > 0)
  if (parts.length) return parts.join('\n')
  if (typeof result === 'string') return result
  return text ?? ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    sessionStartedAt = await $.clock.now()
    storeKey = `runs-${hash(e.cwd || 'default').toString(36)}`
    runs = []
    await $.command.register({ name: 'verdict', description: 'KOZMOS: open the Verdict pane of test/build/lint runs (hide, show, clear)', argumentHint: '[hide|show|clear]', immediate: true })
    try {
      const stored = await $.store.get(storeKey)
      if (Array.isArray(stored)) runs = stored.filter(isRun).slice(-KEEP)
      const hidden = await $.store.get('hidden')
      if (typeof hidden === 'boolean') await update($, hiddenAtom, () => hidden)
    } catch {
      // A fresh store.
    }
    await publish($).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'verdict' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'hide' || arg === 'show') {
      await setHidden($, arg === 'hide')
      return { text: arg === 'hide' ? 'Verdict band hidden.' : 'Verdict band shown.' }
    }
    if (arg === 'clear') {
      await clearRuns($)
      return { text: 'Verdict history cleared for this project.' }
    }
    if (await read($, hiddenAtom)) await setHidden($, false)
    const isOpen = await togglePane($)
    const last = runs[runs.length - 1]
    return { text: isOpen ? `Verdict open.${last ? ` Last: ${last.runner} ${runSummary(last)}.` : ' No runs yet.'}` : 'Verdict closed.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    const command = e.command
    const background = (e as { run_in_background?: unknown }).run_in_background === true
    if (background || !detect(command)) return next(e)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const result = ran.result as { backgroundTaskId?: string; interrupted?: boolean } | undefined
    if (result?.backgroundTaskId || result?.interrupted) return ran
    // judge knows the command: detect() above already did.
    const o = judge(command, outputOf(ran.result, ran.text), ran.isError === true)!
    const at = await $.clock.now()
    runs = [...runs, { ...o, id: (runs[runs.length - 1]?.id ?? 0) + 1, at, ms: at - startedAt, command: clip(command, 120) }].slice(-KEEP)
    await publish($).catch(() => undefined)
    await persist($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap) return drawn
    const chips = chipsOf(snap.runs, snap.sessionStartedAt)
    if (!chips.length) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const hide = <Button key="verdict-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    const failures = failureLines(chips)
    const rows = failures.length && e.props.maxRows >= 8 ? 2 : 1

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns) - 28
      const { source, height } = bandSvg(chips, W, rows >= 2)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row" alignItems="flex-start">
            <Svg source={source} alt={bandAlt(chips)} width={W} height={height} />
            {hide}
          </Box>
        </Box>
      )
    }

    // Every surface but the terminal has Svg and drew above.
    const { Client } = ui as Elements['terminal']
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client key="verdict" module="./bench.tsx" width={cols} height={rows} props={{ cols, rows, chips, failures }} />
          {hide}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapAtom)
    const all = snap?.runs ?? []
    const chips = chipsOf(all, 0)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const recent = [...all].reverse().slice(0, 25)
    const list = recent.map(r => (
      <Box key={`run-${r.id}`} flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={r.ok ? KZ.green : KZ.red} bold>{r.ok ? '✓' : '✗'} {r.runner}</Text>
          <Text> {runSummary(r)}</Text>
          <Text dimColor> · {clock(r.at)} · {duration(r.ms)}</Text>
        </Text>
        <Text dimColor wrap="truncate-end">  $ {r.command}</Text>
        {r.failures.map((f, i) => (
          <Text key={`f${i}`} color={r.ok ? KZ.amber : KZ.red} wrap="truncate-end">
            {'  '}{r.kind === 'test' && r.fail ? '✗' : '!'} {f}
          </Text>
        ))}
      </Box>
    ))
    const clear = all.length ? <Button key="verdict-clear" label="Clear history" plain onPress={() => void clearRuns($)} /> : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 48)
      const { source, height } = paneCard(chips, W)
      return (
        <Box flexDirection="column">
          <Svg source={source} alt={chips.map(c => c.text).join(', ') || 'No runs yet'} width={W} height={height} />
          {list}
          {clear}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold color={KZ.violet}>⚖ Verdict <Text dimColor>· {all.length} runs</Text></Text>
        {chips.length === 0 && <Text dimColor>No test, type-check, lint or build runs yet.</Text>}
        {chips.map(c => (
          <Text key={`sum-${c.runner}`} wrap="truncate-end">
            <Text color={c.ok ? KZ.green : KZ.red}>{c.text}</Text>
            <Text> </Text>
            {c.spark.map((p, i) => (
              <Text key={`p${i}`} color={p.ok ? KZ.green : KZ.red}>{'▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.round(p.h * 7)))]}</Text>
            ))}
          </Text>
        ))}
        {list}
        {clear}
      </Box>
    )
  })
}

async function clearRuns($: EngineInterface): Promise<void> {
  runs = []
  await persist($)
  await publish($)
}
