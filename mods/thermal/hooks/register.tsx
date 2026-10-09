import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ThermalFile, ThermalMetric, ThermalSnap } from '../types'
import { KZ, fitText, fmtSpan, pxOf, svg, svgText, xml } from './lib/kz.ts'
import { HALF_LIFE_MS, buildTree, flatten, hit, metricOf, ranked, squarify, thermal, treePath } from './heatmap.ts'
import type { HitKind, Rect, Stats, TreeNode } from './heatmap.ts'

const PANE = 'kz-thermal'
const TITLE = 'KOZMOS · Thermal'
const MAX_FILES = 500
const snapAtom = atom({ plugin: 'thermal', key: 'snap' } as const, null)
const metricAtom = atom({ plugin: 'thermal', key: 'metric' } as const, 'heat')
const NEXT: Record<ThermalMetric, ThermalMetric> = { heat: 'reads', reads: 'edits', edits: 'heat' }
const METRIC_LABEL: Record<ThermalMetric, string> = { heat: 'heat', reads: 'reads', edits: 'edits' }

let files = new Map<string, ThermalFile>()
let cwd = ''
let isDirty = true
let lastPubAt = -Infinity

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  await publish($)
  return true
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  isDirty = false
  lastPubAt = now
  const snap: ThermalSnap = { cwd, files: [...files.values()].map(f => ({ ...f })), now }
  await update($, snapAtom, () => snap)
}

/** Redraws for new touches at once, and every 15 s while open so heat visibly cools. */
async function tick($: EngineInterface): Promise<void> {
  if (!(await isOpen($))) return
  const now = await $.clock.now()
  if (isDirty || (files.size > 0 && now - lastPubAt >= 15_000)) await publish($)
}

async function record($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<void> {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  let kind: HitKind | undefined
  let target = ''
  if (tool === 'Read') {
    kind = 'read'
    target = str('file_path')
  } else if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    kind = 'edit'
    target = str('file_path') || str('notebook_path')
  } else if (tool === 'Write') {
    kind = 'write'
    target = str('file_path')
  } else if (tool === 'Grep' || tool === 'Glob') {
    kind = 'search'
    target = str('path')
  }
  if (!kind || !target) return
  if (!cwd) cwd = await $.session.cwd()
  const now = await $.clock.now()
  const key = treePath(cwd, target)
  files.set(key, hit(files.get(key), key, kind, now))
  if (files.size > MAX_FILES) {
    // Drop the coldest.
    const coldest = [...files.values()].sort((a, b) => a.heat * Math.pow(0.5, (now - a.heatAt) / HALF_LIFE_MS) - b.heat * Math.pow(0.5, (now - b.heatAt) / HALF_LIFE_MS))[0]
    if (coldest) files.delete(coldest.path)
  }
  isDirty = true
  if (await isOpen($)) await publish($)
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    files = new Map()
    cwd = ''
    isDirty = true
    lastPubAt = -Infinity
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = ''
    }
    await $.command.register({ name: 'thermal', description: 'KOZMOS: toggle the Thermal heatmap of files this session touched', immediate: true })
    $.clock.every(5000, () => void tick($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'thermal' }, async $ => ({
    text: (await toggle($)) ? 'Thermal open.' : 'Thermal closed.',
  }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined) await record($, String(e.tool), e as unknown as Record<string, unknown>).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapAtom)
    const metric = await read($, metricAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const cols = Math.max(28, e.props.bodyColumns || 40)
    const now = snap?.now ?? (await $.clock.now())
    const root = buildTree(snap?.files ?? [], now)
    const touches = (snap?.files ?? []).reduce((n, f) => n + f.reads + f.edits + f.writes + f.searches, 0)
    const fileCount = snap?.files.length ?? 0

    const switcher = (
      <Button key="metric" hotkey="m" dimColor onPress={() => void update($, metricAtom, m => NEXT[m])}>
        {`◐ ${METRIC_LABEL[metric]} → ${METRIC_LABEL[NEXT[metric]]}`}
      </Button>
    )

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(cols, 44)
      const { source, height } = treemapCard(root, metric, W, fileCount, touches)
      return (
        <Box flexDirection="column">
          {switcher}
          <Svg source={source} alt={altText(root, metric, fileCount)} width={W} height={height} isInteractive />
        </Box>
      )
    }

    const head = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text bold color={KZ.amber}>▓▒░ THERMAL</Text>
          <Text dimColor> {fileCount} paths · {touches} touches</Text>
        </Text>
        <Box flexShrink={0} marginLeft={1}>{switcher}</Box>
      </Box>
    )

    if (fileCount === 0) {
      return (
        <Box flexDirection="column">
          {head}
          <Box marginTop={1} flexDirection="column" alignItems="center">
            <Text color={thermal(0.1)}>░░▒▒▓▓██▓▓▒▒░░</Text>
            <Text dimColor>No files touched yet.</Text>
            <Text dimColor wrap="wrap">Reads, edits and searches warm up here.</Text>
          </Box>
        </Box>
      )
    }

    const limit = Math.max(4, (e.props.scroll.bodyRows || 30) - 4)
    const { rows, hidden } = flatten(root, metric, limit)
    const maxDir = Math.max(1e-9, ...rows.filter(r => r.isDir).map(r => metricOf(r.node.stats, metric)))
    const maxFile = Math.max(1e-9, ...rows.filter(r => !r.isDir).map(r => metricOf(r.node.stats, metric)))
    const blocks = (ratio: number) => {
      const n = ratio > 0 ? Math.max(1, Math.ceil(ratio * 5)) : 0
      return Array.from({ length: 5 }, (_, i) => (
        <Text key={`b${i}`} color={i < n ? thermal((i + 1) / 5) : KZ.mist} dimColor={i >= n}>{i < n ? '■' : '□'}</Text>
      ))
    }
    const counts = (s: Stats) => [
      s.reads ? `r${s.reads}` : '', s.searches ? `s${s.searches}` : '', s.edits ? `e${s.edits}` : '', s.writes ? `w${s.writes}` : '',
    ].filter(Boolean).join(' ')
    const countW = Math.min(14, Math.max(...rows.map(r => counts(r.node.stats).length), 2))
    const showAge = cols >= 44
    const maxHeat = Math.max(1e-9, maxHeatOf(root))

    return (
      <Box flexDirection="column">
        {head}
        <Box marginTop={1} flexDirection="column">
          {rows.map(r => {
            const v = metricOf(r.node.stats, metric)
            const ratio = v / (r.isDir ? maxDir : maxFile)
            const hot = thermal(Math.min(1, r.node.stats.heat / maxHeat))
            return (
              <Box key={r.node.path} flexDirection="row">
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    {'  '.repeat(r.depth)}
                    <Text color={r.isDir ? KZ.mist : hot}>{r.isDir ? '▾ ' : '• '}</Text>
                    <Text bold={r.isDir} color={r.isDir ? KZ.blue : undefined}>{r.node.name}{r.isDir ? '/' : ''}</Text>
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1}><Text>{blocks(ratio)}</Text></Box>
                <Box flexShrink={0} width={countW + 1} marginLeft={1}><Text dimColor wrap="truncate-end">{counts(r.node.stats)}</Text></Box>
                {showAge ? <Box flexShrink={0} width={5}><Text dimColor>{fmtAge(now - r.node.stats.lastAt)}</Text></Box> : null}
              </Box>
            )
          })}
        </Box>
        {hidden > 0 ? <Text dimColor>  … {hidden} more</Text> : null}
        <Box marginTop={1}>
          <Text wrap="truncate-end" dimColor>
            cold <Text color={thermal(0)}>■</Text><Text color={thermal(0.3)}>■</Text><Text color={thermal(0.55)}>■</Text><Text color={thermal(0.8)}>■</Text><Text color={thermal(1)}>■</Text> hot · r read s search e edit w write
          </Text>
        </Box>
      </Box>
    )
  })
}

function fmtAge(ms: number): string {
  return ms < 30_000 ? 'now' : fmtSpan(ms)
}

/** The hottest single file's heat (folders aggregate, so they are left out). */
function maxHeatOf(root: TreeNode): number {
  let m = 0
  const walk = (n: TreeNode) => {
    if (n.hasSelf || n.children.length === 0) {
      const own = n.children.length ? n.stats.heat - n.children.reduce((a, c) => a + c.stats.heat, 0) : n.stats.heat
      m = Math.max(m, own)
    }
    n.children.forEach(walk)
  }
  walk(root)
  return m
}

function altText(root: TreeNode, m: ThermalMetric, count: number): string {
  if (!count) return 'No files touched yet'
  const top = flatten(root, m, 400).rows.filter(r => !r.isDir).slice(0, 5).map(r => `${r.node.path} (${Math.round(metricOf(r.node.stats, m) * 10) / 10})`)
  return `Treemap of ${count} files by ${m}; hottest: ${top.join(', ')}`
}

// ---------------------------------------------------------------------------
// Desktop: a squarified treemap colored by heat.

const CSS = `
.tile{transition:opacity .2s}.tile:hover{opacity:.82}
.glow{animation:thglow 2.2s ease-in-out infinite}@keyframes thglow{50%{opacity:.15}}
`

function treemapCard(root: TreeNode, m: ThermalMetric, W: number, count: number, touches: number): { source: string; height: number } {
  const parts: string[] = []
  const pad = 12
  const headH = 46
  // Header: title, totals, a legend ramp.
  parts.push(`<rect class="p" x="0" y="0" width="${W}" height="${headH}" rx="12"/>`)
  parts.push(svgText(pad, 20, 'THERMAL', { size: 12, weight: 750, fill: KZ.amber }))
  parts.push(svgText(pad, 36, `${count} paths · ${touches} touches · sized by ${m}`, { cls: 'm', size: 10.5 }))
  const lw = Math.min(120, W * 0.3)
  const lx = W - pad - lw
  parts.push(`<defs><linearGradient id="thRamp" x1="0" x2="1">${[0, 0.3, 0.55, 0.8, 1].map(t => `<stop offset="${t}" stop-color="${thermal(t)}"/>`).join('')}</linearGradient></defs>`)
  parts.push(`<rect x="${lx}" y="16" width="${lw}" height="8" rx="4" fill="url(#thRamp)"/>`)
  parts.push(svgText(lx, 38, 'cold', { cls: 'm', size: 9.5 }))
  parts.push(svgText(lx + lw, 38, 'hot', { cls: 'm', size: 9.5, anchor: 'end' }))

  const mapY = headH + 8
  if (count === 0 || ranked(root, m).length === 0) {
    const H = mapY + 120
    parts.push(`<rect class="p" x="0" y="${mapY}" width="${W}" height="112" rx="12"/>`)
    parts.push(`<rect x="${W / 2 - 40}" y="${mapY + 24}" width="80" height="24" rx="6" fill="url(#thRamp)" opacity=".35" class="glow"/>`)
    parts.push(svgText(W / 2, mapY + 72, count === 0 ? 'No files touched yet' : `Nothing to size by ${m} yet`, { size: 13, weight: 650, anchor: 'middle' }))
    parts.push(svgText(W / 2, mapY + 92, 'Reads, edits and searches warm up here.', { cls: 'm', size: 10.5, anchor: 'middle' }))
    return { source: svg(W, H, parts.join(''), CSS), height: H }
  }

  const mapH = Math.round(Math.max(220, Math.min(560, W * 0.78)))
  const maxHeat = Math.max(1e-9, maxHeatOf(root))
  let hottest: { rect: Rect; heat: number } | undefined

  const tile = (n: TreeNode, r: Rect, isFolderLeaf: boolean) => {
    const t = Math.min(1, n.stats.heat / maxHeat)
    const fill = thermal(t)
    const ink = t > 0.72 ? '#1f1e1d' : '#ffffff'
    const x = r.x + 1
    const y = r.y + 1
    const w = Math.max(0, r.w - 2)
    const h = Math.max(0, r.h - 2)
    const s = n.stats
    const tip = `${n.path}${isFolderLeaf ? '/' : ''} · heat ${s.heat.toFixed(1)} · ${s.reads} reads · ${s.searches} searches · ${s.edits} edits · ${s.writes} writes`
    parts.push(`<g class="tile"><title>${xml(tip)}</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, w / 4, h / 4).toFixed(1)}" fill="${fill}"/>`)
    if (w > 34 && h > 16) {
      const size = w > 120 && h > 44 ? 12 : 10.5
      parts.push(svgText(x + 5, y + size + 3, fitText(isFolderLeaf ? `${n.name}/` : n.name, size, w - 10), { size, weight: 650, fill: ink }))
      if (h > 34 && w > 50) {
        const line = [s.reads ? `r${s.reads}` : '', s.searches ? `s${s.searches}` : '', s.edits ? `e${s.edits}` : '', s.writes ? `w${s.writes}` : ''].filter(Boolean).join(' ')
        parts.push(`<text x="${(x + 5).toFixed(1)}" y="${(y + size + 17).toFixed(1)}" fill="${ink}" fill-opacity=".75" font-size="9.5" font-family="ui-monospace,Consolas,monospace">${xml(fitText(line, 9.5, w - 10))}</text>`)
      }
    }
    parts.push('</g>')
    if (!hottest || n.stats.heat > hottest.heat) hottest = { rect: { x, y, w, h }, heat: n.stats.heat }
  }

  const draw = (n: TreeNode, r: Rect, depth: number) => {
    const items = ranked(n, m).map(c => ({ value: metricOf(c.stats, m), item: c }))
    for (const p of squarify(items, r)) {
      const c = p.item
      const canNest = c.children.length > 0 && p.w > 56 && p.h > 40 && depth < 5
      if (!canNest) {
        tile(c, p, c.children.length > 0)
        continue
      }
      const t = Math.min(1, c.stats.heat / (maxHeat * 2))
      parts.push(`<rect x="${(p.x + 1).toFixed(1)}" y="${(p.y + 1).toFixed(1)}" width="${(p.w - 2).toFixed(1)}" height="${(p.h - 2).toFixed(1)}" rx="6" fill="${thermal(t)}" fill-opacity=".16" stroke="${thermal(t)}" stroke-opacity=".45" stroke-width="1"/>`)
      parts.push(svgText(p.x + 6, p.y + 13, fitText(`${c.name}/`, 10, p.w - 12), { cls: 's', size: 10, weight: 700 }))
      draw(c, { x: p.x + 3, y: p.y + 17, w: p.w - 6, h: p.h - 20 }, depth + 1)
    }
  }
  parts.push(`<rect class="p" x="0" y="${mapY}" width="${W}" height="${mapH}" rx="12"/>`)
  draw(root, { x: 4, y: mapY + 4, w: W - 8, h: mapH - 8 }, 0)
  const hot = hottest as { rect: Rect; heat: number } | undefined
  if (hot && hot.rect.w > 6 && hot.rect.h > 6) {
    parts.push(`<rect class="glow" x="${hot.rect.x.toFixed(1)}" y="${hot.rect.y.toFixed(1)}" width="${hot.rect.w.toFixed(1)}" height="${hot.rect.h.toFixed(1)}" rx="5" fill="none" stroke="${KZ.yellow}" stroke-width="2" pointer-events="none"/>`)
  }
  const H = mapY + mapH
  return { source: svg(W, H, parts.join(''), CSS), height: H }
}
