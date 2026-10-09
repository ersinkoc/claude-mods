import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { KozmosHub } from '../types'
import { CATALOG } from './catalog.ts'
import type { CatalogEntry } from './catalog.ts'
import { KZ, fitText, hue, noise, pxOf, svg, svgText, xml } from './lib/kz.ts'

const PANE = 'kz-hub'
const TITLE = 'KOZMOS'
const hubAtom = atom({ plugin: 'kozmos', key: 'hub' } as const, { installed: [], filter: 'all' })

const CATEGORIES: readonly { id: string; label: string; color: string; where: string }[] = [
  { id: 'all', label: 'All', color: KZ.violet, where: '' },
  { id: 'pane', label: 'Sidebars', color: KZ.cyan, where: 'sidebar' },
  { id: 'band', label: 'Bands', color: KZ.magenta, where: 'above the prompt' },
  { id: 'transcript', label: 'Transcript', color: KZ.blue, where: 'in the transcript' },
  { id: 'companion', label: 'Companions', color: KZ.amber, where: 'above the prompt' },
  { id: 'status', label: 'Status', color: KZ.green, where: 'status line' },
  { id: 'sound', label: 'Sound', color: KZ.yellow, where: 'speakers' },
  { id: 'guard', label: 'Guards', color: KZ.red, where: 'before risky moves' },
  { id: 'tool', label: 'Tools', color: KZ.teal, where: 'on demand' },
]

const colorOf = (category: string): string => CATEGORIES.find(c => c.id === category)?.color ?? KZ.mist

async function refresh($: EngineInterface): Promise<void> {
  try {
    const names = (await $.command.list()).map(c => c.name)
    await update($, hubAtom, prev => ({ ...prev, installed: CATALOG.filter(m => names.includes(m.name)).map(m => m.name) }))
  } catch {
    // Keep what the hub knew.
  }
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await refresh($)
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function launch($: EngineInterface, name: string): Promise<void> {
  try {
    const { text } = await $.command.run({ command: name, args: '' })
    await update($, hubAtom, prev => ({ ...prev, lastRun: { name, text: text ?? 'done' } }))
  } catch (err) {
    // The engine rejects a command run with an Error (no hook answered, a hook failed).
    await update($, hubAtom, prev => ({ ...prev, lastRun: { name, text: (err as Error).message } }))
  }
}

function listText(installed: readonly string[]): string {
  // Only the categories the catalog has mods in get a heading.
  const lines = CATEGORIES.filter(c => c.id !== 'all' && CATALOG.some(m => m.category === c.id)).flatMap(c => [
    `${c.label}:`,
    ...CATALOG.filter(m => m.category === c.id).map(m => `  ${installed.includes(m.name) ? '✓' : '·'} /${m.name} — ${m.blurb}`),
  ])
  return [`KOZMOS — ${installed.length}/${CATALOG.length} mods active`, ...lines].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'kozmos', description: 'KOZMOS: open the hub of every KOZMOS mod (/kozmos list prints them)', argumentHint: '[list]', immediate: true })
    await refresh($)
    return started
  })

  on('command.run', { command: 'kozmos' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await refresh($)
      return { text: listText((await read($, hubAtom)).installed) }
    }
    return { text: (await toggle($)) ? 'KOZMOS hub open.' : 'KOZMOS hub closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const hub: KozmosHub = await read($, hubAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const shown = CATALOG.filter(m => hub.filter === 'all' || m.category === hub.filter)
    const filters = (
      <Box key="filters" flexDirection="row" flexWrap="wrap" gap={1}>
        {CATEGORIES.map(c => (
          <Button
            key={`f-${c.id}`}
            label={`${hub.filter === c.id ? '●' : '○'} ${c.label}`}
            plain
            onPress={() => update($, hubAtom, prev => ({ ...prev, filter: c.id }))}
          />
        ))}
      </Box>
    )
    const footer = hub.lastRun ? (
      <Text key="last" dimColor wrap="truncate-end">
        /{hub.lastRun.name}: {hub.lastRun.text}
      </Text>
    ) : null

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg source={banner(W, hub.installed.length, CATALOG.length)} alt={`KOZMOS, ${hub.installed.length} of ${CATALOG.length} mods active`} width={W} height={92} />
          {filters}
          {shown.map(m => (
            <Box key={`row-${m.name}`} flexDirection="row" alignItems="center" gap={1}>
              <Svg source={modCard(W - 76, m, hub.installed.includes(m.name))} alt={`${m.title}: ${m.blurb}`} width={W - 76} height={50} />
              <Button key={`run-${m.name}`} label="Open" onPress={() => void launch($, m.name)} />
            </Box>
          ))}
          {footer}
        </Box>
      )
    }

    const cols = Math.max(30, e.props.bodyColumns || 40)
    const word = 'K O Z M O S'
    return (
      <Box flexDirection="column">
        <Text bold>
          {[...word].map((ch, i) => (
            <Text key={`w${i}`} color={hue(0.72 + i / 28)}>
              {ch}
            </Text>
          ))}
          <Text dimColor>  {hub.installed.length}/{CATALOG.length} active</Text>
        </Text>
        <Text dimColor wrap="truncate-end">{starLine(cols)}</Text>
        {filters}
        {shown.map(m => {
          const isOn = hub.installed.includes(m.name)
          return (
            <Box key={`row-${m.name}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text color={isOn ? colorOf(m.category) : KZ.mist}>{isOn ? '◆' : '◇'} </Text>
                  <Text bold={isOn} dimColor={!isOn}>{m.title}</Text>
                  <Text dimColor> · /{m.name}</Text>
                </Text>
                {isOn ? <Button key={`run-${m.name}`} label="open" plain onPress={() => void launch($, m.name)} /> : <Text dimColor>not installed</Text>}
              </Box>
              <Text dimColor wrap="truncate-end">  {m.blurb}</Text>
            </Box>
          )
        })}
        {shown.length === 0 && <Text dimColor>Nothing here yet.</Text>}
        {footer}
      </Box>
    )
  })
}

/** A row of drifting stars for the terminal header. */
function starLine(cols: number): string {
  let s = ''
  for (let i = 0; i < cols; i++) {
    const n = noise(i, 7)
    s += n > 0.93 ? '✦' : n > 0.85 ? '·' : n > 0.8 ? '˙' : ' '
  }
  return s
}

/** The desktop banner: a starfield with twinkling stars and a gradient wordmark. */
function banner(W: number, active: number, total: number): string {
  const stars: string[] = []
  for (let i = 0; i < 70; i++) {
    const x = noise(i, 1) * W
    const y = noise(i, 2) * 92
    const r = 0.4 + noise(i, 3) * 1.3
    const d = (noise(i, 4) * 3).toFixed(2)
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" class="tw" style="animation-delay:-${d}s"/>`)
  }
  const css = `.tw{animation:tw 3s ease-in-out infinite}@keyframes tw{50%{opacity:.15}}
.orb{transform-box:fill-box;transform-origin:center;animation:orb 14s linear infinite}@keyframes orb{to{transform:rotate(360deg)}}`
  const body = `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#140c2e"/><stop offset=".55" stop-color="#1d1147"/><stop offset="1" stop-color="#0b2a3a"/></linearGradient>
<linearGradient id="word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${KZ.violet}"/><stop offset=".5" stop-color="${KZ.magenta}"/><stop offset="1" stop-color="${KZ.cyan}"/></linearGradient>
<radialGradient id="neb" cx=".8" cy=".3" r=".6"><stop offset="0" stop-color="${KZ.magenta}" stop-opacity=".35"/><stop offset="1" stop-color="${KZ.magenta}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="92" rx="14" fill="url(#sky)"/>
<rect width="${W}" height="92" rx="14" fill="url(#neb)"/>
${stars.join('')}
<g transform="translate(${W - 58},46)"><g class="orb"><ellipse rx="30" ry="9" fill="none" stroke="${KZ.cyan}" stroke-opacity=".5"/><circle cx="30" cy="0" r="3" fill="${KZ.cyan}"/></g><circle r="9" fill="${KZ.amber}"/></g>
<text x="18" y="50" font-family="'Segoe UI',Inter,sans-serif" font-size="30" font-weight="800" letter-spacing="7" fill="url(#word)">KOZMOS</text>
<text x="20" y="72" font-family="'Segoe UI',Inter,sans-serif" font-size="11.5" fill="#c9c3ef">${xml(`${active} of ${total} mods active in this session`)}</text>`
  return svg(W, 92, body, css)
}

/** One mod's desktop card; exported so a test can draw an entry the catalog does not hold yet. */
export function modCard(W: number, m: CatalogEntry, isOn: boolean): string {
  const c = colorOf(m.category)
  const where = CATEGORIES.find(x => x.id === m.category)?.where ?? ''
  const body = `<rect class="p" width="${W}" height="50" rx="10"/>
<rect x="0" y="0" width="4" height="50" rx="2" fill="${c}" opacity="${isOn ? 1 : 0.35}"/>
<circle cx="20" cy="17" r="5" fill="${isOn ? c : 'none'}" stroke="${c}" stroke-width="1.5" class="${isOn ? 'pulse' : ''}"/>
${svgText(32, 21, m.title, { size: 13.5, weight: 650 })}
${svgText(W - 10, 21, isOn ? `/${m.name}` : 'not installed', { cls: 'm', size: 10.5, anchor: 'end', mono: true })}
${svgText(14, 40, fitText(`${where ? where + ' · ' : ''}${m.blurb}`, 11, W - 24), { cls: 's', size: 11 })}`
  return svg(W, 50, body)
}
