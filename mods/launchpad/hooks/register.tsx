import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LaunchpadData, PadCount } from '../types'
import { KZ, bar, clip, pxOf } from './lib/kz.ts'
import {
  MAX_SAVED, agoText, accentOf, bannerSvg, bump, commandCardSvg, errorText, fillNote, frequentTiles, listText, parseArgs, pinnedTiles,
  promptCardSvg, sectionSvg,
} from './pad.ts'
import type { Tile } from './pad.ts'

const PANE = 'kz-launchpad'
const TITLE = 'KOZMOS · Launchpad'

const padAtom = atom({ plugin: 'launchpad', key: 'pad' } as const, { counts: {}, pinned: [], saved: [], known: {}, hasList: false })

async function persist($: EngineInterface): Promise<void> {
  const d = await read($, padAtom)
  try {
    await $.store.set('counts', d.counts)
    await $.store.set('pinned', d.pinned)
    await $.store.set('saved', d.saved)
  } catch {
    // Kept for this session only.
  }
}

async function load($: EngineInterface): Promise<void> {
  try {
    const counts = await $.store.get('counts')
    const pinned = await $.store.get('pinned')
    const saved = await $.store.get('saved')
    await update($, padAtom, prev => ({
      ...prev,
      counts: isCounts(counts) ? counts : prev.counts,
      pinned: isStrings(pinned) ? pinned : prev.pinned,
      saved: isStrings(saved) ? saved : prev.saved,
    }))
  } catch {
    // Fresh store.
  }
}

async function refreshKnown($: EngineInterface): Promise<void> {
  try {
    const list = await $.command.list()
    const known: Record<string, string> = {}
    for (const c of list) known[c.name] = c.description
    await update($, padAtom, prev => ({ ...prev, known, hasList: true }))
  } catch {
    // Keep what was known.
  }
}

async function record($: EngineInterface, name: string): Promise<void> {
  const at = await $.clock.now()
  await update($, padAtom, prev => ({ ...prev, counts: bump(prev.counts, name, at) }))
  await persist($)
}

async function launch($: EngineInterface, name: string): Promise<void> {
  await record($, name)
  try {
    const { text } = await $.command.run({ command: name })
    await update($, padAtom, prev => ({ ...prev, lastRun: { label: `/${name}`, text: clip(text ?? 'done', 120) || 'done' } }))
  } catch (err) {
    await update($, padAtom, prev => ({ ...prev, lastRun: { label: `/${name}`, text: errorText(err) } }))
  }
}

async function fill($: EngineInterface, text: string): Promise<void> {
  let note: string
  try {
    note = fillNote(await $.prompt.fill({ text }))
  } catch (err) {
    note = errorText(err)
  }
  await update($, padAtom, prev => ({ ...prev, lastRun: { label: 'prompt', text: note } }))
}

async function setPinned($: EngineInterface, name: string, isPinned: boolean): Promise<void> {
  await update($, padAtom, prev => ({
    ...prev,
    pinned: isPinned ? (prev.pinned.includes(name) ? prev.pinned : [...prev.pinned, name]) : prev.pinned.filter(n => n !== name),
  }))
  await persist($)
}

async function removeSaved($: EngineInterface, index: number): Promise<string | undefined> {
  let removed: string | undefined
  await update($, padAtom, prev => {
    removed = prev.saved[index]
    return removed === undefined ? prev : { ...prev, saved: prev.saved.filter((_, i) => i !== index) }
  })
  if (removed !== undefined) await persist($)
  return removed
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await refreshKnown($)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

function isCounts(v: unknown): v is Record<string, PadCount> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v).every(x => typeof x === 'object' && x !== null && typeof (x as PadCount).n === 'number' && typeof (x as PadCount).at === 'number')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'launchpad',
      description: 'KOZMOS: toggle the Launchpad of your most-used commands and saved prompts (save <text>, rm <n>, pin <cmd>, unpin <cmd>, list)',
      argumentHint: '[save <text> | rm <n> | pin <cmd> | unpin <cmd> | list]',
      immediate: true,
    })
    await load($)
    await refreshKnown($)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'launchpad' }, async ($, e) => {
    const action = parseArgs(e.args)
    switch (action.kind) {
      case 'toggle':
        return { text: (await toggle($)) ? 'Launchpad open.' : 'Launchpad closed.' }
      case 'list':
        await refreshKnown($)
        return { text: listText(await read($, padAtom)) }
      case 'save': {
        let n = 0
        await update($, padAtom, prev => {
          const saved = [...prev.saved.filter(s => s !== action.text), action.text].slice(-MAX_SAVED)
          n = saved.length
          return { ...prev, saved }
        })
        await persist($)
        return { text: `Saved as prompt ${n}.` }
      }
      case 'rm': {
        const removed = await removeSaved($, action.index)
        return { text: removed === undefined ? `No saved prompt ${action.index + 1}.` : `Removed prompt ${action.index + 1}: ${clip(removed, 60)}` }
      }
      case 'pin':
        await setPinned($, action.name, true)
        return { text: `Pinned /${action.name}.` }
      case 'unpin':
        await setPinned($, action.name, false)
        return { text: `Unpinned /${action.name}.` }
      case 'forget':
        await update($, padAtom, prev => ({ ...prev, counts: {} }))
        await persist($)
        return { text: 'Launchpad forgot the command counts (pins and saved prompts stay).' }
      case 'help':
        return { text: action.reason }
    }
  })

  // Learn: every slash command the person runs from the prompt box.
  on('command.run', async ($, e, next) => {
    if (e.origin.kind === 'composer' && e.command !== 'launchpad') await record($, e.command).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const d: LaunchpadData = await read($, padAtom)
    const now = await $.clock.now()
    const pinned = pinnedTiles(d)
    const frequent = frequentTiles(d)
    const maxCount = Math.max(1, ...[...pinned, ...frequent].map(t => t.count))
    const runs = Object.values(d.counts).reduce((s, c) => s + c.n, 0)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const footer = d.lastRun ? (
      <Text key="last" dimColor wrap="truncate-end">↳ {d.lastRun.label}: {d.lastRun.text}</Text>
    ) : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const cardW = Math.max(160, W - 96)
      const commandRow = (t: Tile, isPinned: boolean) => (
        <Box key={`${isPinned ? 'p' : 'f'}-${t.name}`} flexDirection="row" alignItems="center" gap={1}>
          <Svg source={commandCardSvg(t, cardW, now, maxCount, isPinned)} alt={`/${t.name}: ${t.description || agoText(t.at, now)}${t.count ? `, run ${t.count} times` : ''}`} width={cardW} height={56} />
          <Box flexDirection="column">
            <Button key={`run-${t.name}`} label="Run" variant={isPinned ? 'primary' : undefined} onPress={() => void launch($, t.name)} />
            <Button key={`${isPinned ? 'unpin' : 'pin'}-${t.name}`} label={isPinned ? '★' : '☆'} plain dimColor onPress={() => void setPinned($, t.name, !isPinned)} />
          </Box>
        </Box>
      )
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="banner" source={bannerSvg(W, runs, Object.keys(d.counts).length, d.saved.length)} alt={`Launchpad: ${runs} runs learned, ${d.saved.length} saved prompts`} width={W} height={64} />
          <Svg key="h-pinned" source={sectionSvg('Pinned', pinned.length ? `${pinned.length}` : 'star a command to keep it here', KZ.yellow, W)} alt="Pinned" width={W} height={26} />
          {pinned.map(t => commandRow(t, true))}
          <Svg key="h-frequent" source={sectionSvg('Frequent', frequent.length ? 'learned from what you run' : 'run a few slash commands', KZ.violet, W)} alt="Frequent" width={W} height={26} />
          {frequent.map(t => commandRow(t, false))}
          <Svg key="h-saved" source={sectionSvg('Saved', d.saved.length ? 'click to fill the prompt box' : '/launchpad save <text>', KZ.cyan, W)} alt="Saved prompts" width={W} height={26} />
          {d.saved.map((s, i) => (
            <Box key={`s-${i}`} flexDirection="row" alignItems="center" gap={1}>
              <Svg source={promptCardSvg(s, i, cardW)} alt={`Saved prompt ${i + 1}: ${clip(s, 120)}`} width={cardW} height={56} />
              <Box flexDirection="column">
                <Button key={`fill-${i}`} label="Fill" onPress={() => void fill($, s)} />
                <Button key={`rm-${i}`} label="✕" plain dimColor onPress={() => void removeSaved($, i)} />
              </Box>
            </Box>
          ))}
          {footer}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 40)
    const labelW = Math.min(24, Math.max(12, ...[...pinned, ...frequent].map(t => t.name.length + 4)))
    const barW = Math.max(4, Math.min(12, cols - labelW - 22))
    const commandLine = (t: Tile, isPinned: boolean) => (
      <Box key={`${isPinned ? 'p' : 'f'}-${t.name}`} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Button key={`run-${t.name}`} label={`▶ /${t.name}`.padEnd(labelW)} variant={isPinned ? 'primary' : 'secondary'} onPress={() => void launch($, t.name)} />
          <Text wrap="truncate-end">
            <Text color={isPinned ? KZ.yellow : accentOf(t.name)}> {bar(t.count / maxCount, barW, '·')}</Text>
            <Text dimColor> ×{t.count} · {agoText(t.at, now)}</Text>
          </Text>
        </Box>
        <Button key={`${isPinned ? 'unpin' : 'pin'}-${t.name}`} label={isPinned ? '★' : '☆'} plain dimColor onPress={() => void setPinned($, t.name, !isPinned)} />
      </Box>
    )
    const head = (key: string, glyph: string, label: string, color: string, sub: string) => (
      <Text key={key} wrap="truncate-end">
        <Text color={color} bold>{glyph} {label}</Text>
        <Text dimColor>  {sub}</Text>
      </Text>
    )
    return (
      <Box flexDirection="column">
        <Text bold>
          <Text color={KZ.violet}>➚ LAUNCHPAD</Text>
          <Text dimColor>  {runs} runs learned · {d.saved.length} saved</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {head('h-pinned', '★', 'PINNED', KZ.yellow, pinned.length ? '' : 'press ☆ on a command, or /launchpad pin <cmd>')}
          {pinned.map(t => commandLine(t, true))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {head('h-frequent', '⚡', 'FREQUENT', KZ.violet, frequent.length ? '' : 'run a few slash commands; they land here')}
          {frequent.map(t => commandLine(t, false))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {head('h-saved', '✎', 'SAVED', KZ.cyan, d.saved.length ? 'press to fill the prompt box' : '/launchpad save <prompt text>')}
          {d.saved.map((s, i) => (
            <Box key={`s-${i}`} flexDirection="row" justifyContent="space-between">
              <Box flexDirection="row">
                <Button key={`fill-${i}`} label={`✎ ${i + 1}`} variant="secondary" onPress={() => void fill($, s)} />
                <Text wrap="truncate-end"> {clip(s, Math.max(10, cols - 14))}</Text>
              </Box>
              <Button key={`rm-${i}`} label="✕" plain dimColor onPress={() => void removeSaved($, i)} />
            </Box>
          ))}
        </Box>
        {footer}
      </Box>
    )
  })
}
