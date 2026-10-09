import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AlmanacEntry, AlmanacSnap } from '../types'
import { KZ, bar, fmtClock, modelName, pxOf } from './lib/kz.ts'
import { FAMILY_COLOR, Tally, barsSvg, cloudSvg, familiesSvg, familyOf, headerSvg, mcpParts, pluginOfAgent, snapText, tagColor } from './book.ts'
import type { Family } from './book.ts'

const PANE = 'kz-almanac'
const TITLE = 'KOZMOS · Almanac'
const snapAtom = atom({ plugin: 'almanac', key: 'snap' } as const, null)

// The ledger. Module state starts over on a reload; session.start resets it.
let startedAt = 0
let version = ''
let toolCount = 0
let commands = new Tally()
let skills = new Tally()
let agents = new Tally()
let mcp = new Tally()
let models = new Tally()
let plugins = new Tally()
let families = new Tally()
let installed: string[] | null = null
let ownTools = new Set<string>()
let isDirty = true
let lastKey = ''
let tick = 0

function reset(now: number): void {
  startedAt = now
  toolCount = 0
  commands = new Tally()
  skills = new Tally()
  agents = new Tally()
  mcp = new Tally()
  models = new Tally()
  plugins = new Tally()
  families = new Tally()
  installed = null
  ownTools = new Set()
  isDirty = true
  lastKey = ''
  tick = 0
}

function snapshot(now: number): AlmanacSnap {
  const unused = installed ? installed.filter(n => !commands.has(n)).length : -1
  return {
    version,
    startedAt,
    now,
    commands: commands.entries(startedAt),
    skills: skills.entries(startedAt),
    agents: agents.entries(startedAt),
    mcp: mcp.entries(startedAt),
    models: models.entries(startedAt),
    plugins: plugins.entries(startedAt),
    families: families.entries(startedAt),
    tools: toolCount,
    installed: installed ? installed.length : -1,
    unused,
  }
}

async function publish($: EngineInterface, force: boolean): Promise<void> {
  if (!isDirty && !force) return
  isDirty = false
  const now = await $.clock.now()
  const snap = snapshot(now)
  // The clock alone does not redraw: only a change in what was used does,
  // with a minute's step so the session age stays roughly right.
  const key = JSON.stringify({ ...snap, now: Math.floor((now - startedAt) / 60_000) })
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

async function readCatalog($: EngineInterface): Promise<void> {
  try {
    installed = (await $.command.list()).map(c => c.name)
    isDirty = true
  } catch {
    // Unknown stays unknown.
  }
  try {
    ownTools = new Set((await $.tool.list()).filter(t => !t.mcp && t.name.startsWith('mcp__')).map(t => t.name))
  } catch {
    // Every mcp__ name then reads as an MCP server.
  }
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await readCatalog($)
  await publish($, true)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function heartbeat($: EngineInterface): Promise<void> {
  tick++
  if (tick % 30 === 0) await readCatalog($)
  await publish($, tick % 60 === 0)
}

const familyLabel = (e: AlmanacEntry) => e.name

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    reset(await $.clock.now())
    await $.command.register({
      name: 'almanac',
      description: 'KOZMOS: toggle the Almanac of what this session is made of (/almanac print writes it as text)',
      argumentHint: '[print]',
      immediate: true,
    })
    try {
      version = (await $.session.version()).version
    } catch {
      version = ''
    }
    await readCatalog($)
    await publish($, true).catch(() => undefined)
    $.clock.every(1000, () => void heartbeat($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'almanac' }, async ($, e) => {
    if (e.args.trim() === 'print') {
      await readCatalog($)
      return { text: snapText(snapshot(await $.clock.now())) }
    }
    return { text: (await toggle($)) ? 'Almanac open.' : 'Almanac closed.' }
  })

  // Every slash command, whoever ran it.
  on('command.run', async ($, e, next) => {
    commands.add(e.command, await $.clock.now())
    isDirty = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const tool = String(e.tool)
    toolCount++
    families.add(familyOf(tool), at)
    if (tool === 'Skill') {
      const skill = (e as unknown as Record<string, unknown>).skill
      if (typeof skill === 'string') skills.add(skill, at)
    }
    const parts = mcpParts(tool, ownTools)
    if (parts.server) mcp.add(parts.server, at)
    if (parts.plugin) plugins.add(parts.plugin, at)
    isDirty = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const at = await $.clock.now()
    agents.add(e.subagentType, at)
    const plugin = pluginOfAgent(e.subagentType)
    if (plugin) plugins.add(plugin, at)
    isDirty = true
    return next(e)
  }).catch(($, e, next) => next(e))

  // The engine names the model of every step (a non-empty name).
  on('turn.step', async function* ($, e, next) {
    models.add(e.model, await $.clock.now())
    isDirty = true
    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await read($, snapAtom)) ?? snapshot(await $.clock.now())
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const sections = [
        { key: 'commands', alt: 'Slash commands run', ...barsSvg('Commands', KZ.yellow, s.commands, W, x => `/${x.name}`) },
        { key: 'skills', alt: 'Skills invoked', ...cloudSvg('Skills', KZ.amber, s.skills, W) },
        { key: 'agents', alt: 'Subagent types spawned', ...barsSvg('Subagents', KZ.violet, s.agents, W, x => x.name) },
        { key: 'mcp', alt: 'MCP servers used', ...cloudSvg('MCP servers', KZ.magenta, s.mcp, W) },
        { key: 'models', alt: 'Models seen', ...barsSvg('Models · requests', KZ.cyan, s.models, W, x => modelName(x.name)) },
        { key: 'plugins', alt: 'Plugins whose tools were called', ...cloudSvg('Plugins', KZ.teal, s.plugins, W) },
        { key: 'families', alt: 'Tool calls by family', ...familiesSvg(s.families, W) },
      ]
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={headerSvg(s, W)} alt={`Almanac: Claude Code ${s.version || 'unknown version'}, ${s.tools} tool calls`} width={W} height={112} />
          {sections.map(x => <Svg key={x.key} source={x.source} alt={x.alt} width={W} height={x.height} />)}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 40)
    const nameW = Math.min(22, Math.max(10, Math.floor(cols * 0.38)))
    const barW = Math.max(4, cols - nameW - 16)
    const ranked = (key: string, title: string, color: string, xs: readonly AlmanacEntry[], label: (x: AlmanacEntry) => string) => {
      const top = Math.max(1, ...xs.map(x => x.n))
      return (
        <Box key={key} flexDirection="column" marginTop={1}>
          <Text bold color={color}>{title.toUpperCase()} <Text dimColor>{xs.length ? `${xs.length}` : 'none yet'}</Text></Text>
          {xs.slice(0, 6).map((x, i) => (
            <Box key={`${key}-${x.name}`} flexDirection="row">
              <Box width={nameW} flexShrink={0}><Text wrap="truncate-end" bold={i === 0}>{label(x)}</Text></Box>
              <Text color={i === 0 ? color : tagColor(x.name)}>{bar(x.n / top, Math.min(barW, 16))}</Text>
              <Text> ×{x.n}</Text>
              <Text dimColor> +{fmtClock(x.first)}</Text>
            </Box>
          ))}
          {xs.length > 6 ? <Text dimColor>  +{xs.length - 6} more</Text> : null}
        </Box>
      )
    }
    const cloud = (key: string, title: string, color: string, xs: readonly AlmanacEntry[]) => {
      const top = Math.max(1, ...xs.map(x => x.n))
      return (
        <Box key={key} flexDirection="column" marginTop={1}>
          <Text bold color={color}>{title.toUpperCase()} <Text dimColor>{xs.length ? `${xs.length}` : 'none yet'}</Text></Text>
          <Box flexDirection="row" flexWrap="wrap">
            {[...xs].slice(0, 24).sort((a, b) => a.name.localeCompare(b.name)).map(x => (
              <Box key={`${key}-${x.name}`} marginRight={2}>
                <Text color={tagColor(x.name)} bold={x.n >= top * 0.6} dimColor={x.n < top * 0.25}>
                  {x.name}{x.n > 1 ? <Text dimColor>·{x.n}</Text> : ''}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }
    const famTotal = s.families.reduce((a, x) => a + x.n, 0)
    const stackW = Math.max(10, cols - 2)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.amber}>❦ ALMANAC</Text>
          <Text dimColor>v{s.version || '?'} · {fmtClock(s.now - s.startedAt)}</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={KZ.green}>{s.tools}</Text><Text dimColor> tools · </Text>
          <Text color={KZ.yellow}>{s.commands.reduce((a, x) => a + x.n, 0)}</Text><Text dimColor> commands · </Text>
          <Text color={KZ.violet}>{s.agents.reduce((a, x) => a + x.n, 0)}</Text><Text dimColor> agents</Text>
        </Text>
        <Text dimColor wrap="truncate-end">
          {s.installed >= 0 ? `${s.installed} commands installed, ${s.unused} never run here` : 'installed commands unknown'}
        </Text>
        {ranked('commands', 'Commands', KZ.yellow, s.commands, x => `/${x.name}`)}
        {cloud('skills', 'Skills', KZ.amber, s.skills)}
        {ranked('agents', 'Subagents', KZ.violet, s.agents, x => x.name)}
        {cloud('mcp', 'MCP servers', KZ.magenta, s.mcp)}
        {ranked('models', 'Models · requests', KZ.cyan, s.models, x => modelName(x.name))}
        {cloud('plugins', 'Plugins', KZ.teal, s.plugins)}
        <Box key="families" flexDirection="column" marginTop={1}>
          <Text bold color={KZ.green}>TOOL FAMILIES <Text dimColor>{famTotal ? `${famTotal} calls` : 'none yet'}</Text></Text>
          {famTotal > 0 && (
            <Text wrap="truncate-end">
              {s.families.map(x => (
                <Text key={`fb-${x.name}`} color={FAMILY_COLOR[x.name as Family]}>{'█'.repeat(Math.max(1, Math.round((x.n / famTotal) * stackW)))}</Text>
              ))}
            </Text>
          )}
          <Box flexDirection="row" flexWrap="wrap">
            {s.families.map(x => (
              <Box key={`fl-${x.name}`} marginRight={2}>
                <Text><Text color={FAMILY_COLOR[x.name as Family]}>■</Text> {familyLabel(x)} <Text dimColor>{x.n}</Text></Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
