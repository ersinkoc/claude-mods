import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitscopeFile, GitscopeSnap } from '../types'
import { KZ, MONO, clip, fitText, mix, pxOf, svg, svgText, xml } from './lib/kz.ts'
import { GIT_HEAD, GIT_NUMSTAT, GIT_STATUS, gitLogArgv, parseGitLog, parseGitStatus, parseNumstat } from './lib/probe.ts'
import { diffBar, fmtAgo, isAbsolute, normPath, relTo, splitPath, untrackedOf } from './scope.ts'

const PANE = 'kz-gitscope'
const TITLE = 'KOZMOS · Gitscope'
const snapAtom = atom({ plugin: 'gitscope', key: 'snap' } as const, null)
const REFRESH_MS = 5000
const MAX_FILES = 40
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const DIRTYING_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// ---------------------------------------------------------------------------
// Module state: the files this session edited, and the refresh bookkeeping.

let touched = new Set<string>() // normalized absolute paths
let lastAt = -Infinity
let isDirty = true
let isBusy = false
let lastPublished = ''

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface): Promise<boolean> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  await refresh($).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------
// Probes: git through $.process.run, parsed by lib/probe.ts and scope.ts.

async function sh($: EngineInterface, argv: readonly string[], timeoutMs: number, cwd?: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(argv, cwd ? { timeoutMs, cwd } : { timeoutMs })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

const notRepo = (now: number): GitscopeSnap => ({
  isRepo: false, root: '', branch: '', isDetached: false, ahead: 0, behind: 0, staged: 0, unstaged: 0,
  untracked: 0, conflicts: 0, stash: 0, commits: [], files: [], touchedClean: 0, refreshedAt: now,
})

async function readScope($: EngineInterface, cwd: string, now: number): Promise<GitscopeSnap> {
  const status = await sh($, GIT_STATUS, 5000, cwd)
  if (status === undefined) return notRepo(now)
  const [top, head, log, numstat] = await Promise.all([
    sh($, ['git', 'rev-parse', '--show-toplevel'], 3000, cwd),
    sh($, GIT_HEAD, 3000, cwd),
    sh($, gitLogArgv(8), 4000, cwd),
    sh($, GIT_NUMSTAT, 5000, cwd),
  ])
  const g = parseGitStatus(status, head ?? '')
  const root = (top ?? cwd).trim()
  const isWin = /^[a-zA-Z]:\//.test(normPath(root))
  const key = (p: string) => (isWin ? p.toLowerCase() : p)

  const touchedRel = new Set<string>()
  let outside = 0
  for (const abs of touched) {
    const rel = relTo(root, abs)
    if (rel === undefined || rel === '') outside++
    else touchedRel.add(key(rel))
  }

  const files: GitscopeFile[] = parseNumstat(numstat ?? '').map(f => ({
    path: f.path, added: f.added, removed: f.removed, kind: 'mod' as const, isTouched: touchedRel.has(key(f.path)),
  }))
  for (const p of untrackedOf(status)) {
    files.push({ path: p, added: 0, removed: 0, kind: 'new', isTouched: touchedRel.has(key(p)) })
  }
  const shown = new Set(files.map(f => key(f.path)))
  const touchedClean = outside + [...touchedRel].filter(p => !shown.has(p)).length
  // Touched first, then by churn.
  files.sort((a, b) => Number(b.isTouched) - Number(a.isTouched) || b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))

  return {
    isRepo: true,
    root,
    branch: g.branch,
    isDetached: g.isDetached,
    upstream: g.upstream,
    ahead: g.ahead,
    behind: g.behind,
    staged: g.staged,
    unstaged: g.unstaged,
    untracked: g.untracked,
    conflicts: g.conflicts,
    stash: g.stash,
    head: g.head ? { sha: g.head.sha, subject: g.head.subject } : undefined,
    commits: parseGitLog(log ?? '').map(c => ({ sha: c.sha, subject: c.subject, author: c.author, at: c.at })),
    files: files.slice(0, MAX_FILES),
    touchedClean,
    refreshedAt: now,
  }
}

async function refresh($: EngineInterface): Promise<void> {
  if (isBusy) {
    isDirty = true
    return
  }
  isBusy = true
  try {
    const now = await $.clock.now()
    isDirty = false
    lastAt = now
    const snap = await readScope($, await $.session.cwd(), now)
    const key = JSON.stringify({ ...snap, refreshedAt: 0 })
    if (key !== lastPublished) {
      lastPublished = key
      await update($, snapAtom, () => snap)
    }
  } finally {
    isBusy = false
  }
}

async function tick($: EngineInterface): Promise<void> {
  if (!(await isOpen($))) return
  const now = await $.clock.now()
  if (isDirty || now - lastAt >= REFRESH_MS) await refresh($)
}

async function noteTool($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<void> {
  if (EDIT_TOOLS.has(tool)) {
    const p = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
    if (p) touched.add(normPath(isAbsolute(p) ? p : `${await $.session.cwd()}/${p}`))
  }
  if (DIRTYING_TOOLS.has(tool)) {
    isDirty = true
    if (await isOpen($)) await refresh($)
  }
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    touched = new Set()
    lastAt = -Infinity
    isDirty = true
    isBusy = false
    lastPublished = ''
    await $.command.register({ name: 'gitscope', description: 'KOZMOS: toggle the Gitscope git radar sidebar', immediate: true })
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'gitscope' }, async $ => ({
    text: (await toggle($)) ? 'Gitscope open.' : 'Gitscope closed.',
  }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined) await noteTool($, String(e.tool), e as unknown as Record<string, unknown>).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapAtom)
    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = Math.max(28, e.props.bodyColumns || 40)

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(cols, 44)
      const { source, height } = snap === null ? loadingCard(W) : snap.isRepo ? desktopCard(snap, W, now) : emptyCard(W)
      return (
        <Box flexDirection="column">
          <Svg source={source} alt={altText(snap)} width={W} height={height} />
        </Box>
      )
    }

    if (snap === null) return <Text dimColor>⎇ reading git…</Text>
    if (!snap.isRepo) {
      return (
        <Box flexDirection="column" paddingY={1} alignItems="center">
          <Text color={KZ.mist}>╭─────╮</Text>
          <Text color={KZ.mist}>│  ⎇  │</Text>
          <Text color={KZ.mist}>╰─────╯</Text>
          <Text bold>Not a git repository</Text>
          <Text dimColor wrap="wrap">This folder has no history yet.</Text>
          <Text dimColor wrap="wrap">Run <Text color={KZ.cyan}>git init</Text> to start the radar.</Text>
        </Box>
      )
    }

    const rule = (label: string, extra = '') => {
      const text = `── ${label}${extra ? ' ' + extra : ''} `
      return (
        <Box key={`rule-${label}`} marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold color={KZ.violet}>{`── ${label}`}</Text>
            {extra ? <Text dimColor> {extra}</Text> : ''}
            <Text color={KZ.mist} dimColor> {'─'.repeat(Math.max(0, cols - text.length - 1))}</Text>
          </Text>
        </Box>
      )
    }

    const sync = snap.upstream
      ? snap.ahead || snap.behind
        ? [
            snap.ahead ? <Text key="a" color={KZ.green}>↑{snap.ahead} </Text> : '',
            snap.behind ? <Text key="b" color={KZ.amber}>↓{snap.behind}</Text> : '',
          ]
        : <Text color={KZ.teal}>≡ in sync</Text>
      : <Text dimColor>local only</Text>

    const chips: [string, number, string, string][] = [
      ['●', snap.staged, 'staged', KZ.green],
      ['✚', snap.unstaged, 'changed', KZ.amber],
      ['?', snap.untracked, 'new', KZ.blue],
      ['✖', snap.conflicts, 'conflict', KZ.red],
      ['⚑', snap.stash, 'stash', KZ.violet],
    ]
    const isClean = snap.staged + snap.unstaged + snap.untracked + snap.conflicts === 0

    const railW = 2
    const shaW = 8
    const commitRows = snap.commits.map((c, i) => {
      const last = i === snap.commits.length - 1
      const rail = snap.commits.length === 1 ? '◉' : i === 0 ? '┬' : last ? '└' : '├'
      const age = now - c.at
      const tone = mix(KZ.violet, KZ.mist, Math.min(1, age / (7 * 864e5)))
      const right = `${fmtAgo(age)} ${clip(c.author.split(' ')[0] ?? '', 10)}`
      return (
        <Box key={`c-${c.sha}`} flexDirection="row">
          <Box width={railW} flexShrink={0}>
            <Text color={tone}>{rail}{i === 0 ? '◉' : '●'}</Text>
          </Box>
          <Box width={shaW} flexShrink={0}>
            <Text color={i === 0 ? KZ.yellow : KZ.amber} dimColor={i > 0}> {c.sha.slice(0, 7)}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" bold={i === 0}> {c.subject}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text dimColor>{right}</Text>
          </Box>
        </Box>
      )
    })

    const maxChurn = Math.max(1, ...snap.files.map(f => f.added + f.removed))
    const barW = Math.max(4, Math.min(14, Math.floor(cols / 4)))
    const numW = Math.max(...snap.files.map(f => (f.kind === 'new' ? 3 : `+${f.added} −${f.removed}`.length)), 3)
    const fileRows = snap.files.map(f => {
      const { dir, name } = splitPath(f.path)
      const b = diffBar(f.added, f.removed, maxChurn, barW)
      return (
        <Box key={`f-${f.path}`} flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color={f.isTouched ? KZ.magenta : KZ.mist}>{f.isTouched ? '✎' : f.kind === 'new' ? '+' : '·'}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-start"><Text dimColor>{dir}</Text><Text bold={f.isTouched} color={f.kind === 'new' ? KZ.blue : undefined}>{name}</Text></Text>
          </Box>
          <Box flexShrink={0} marginLeft={1} width={numW + 1}>
            {f.kind === 'new'
              ? <Text color={KZ.blue}>new</Text>
              : <Text><Text color={KZ.green}>+{f.added}</Text> <Text color={KZ.red}>−{f.removed}</Text></Text>}
          </Box>
          <Box flexShrink={0} width={barW}>
            <Text><Text color={KZ.green}>{b.add}</Text><Text color={KZ.red}>{b.rem}</Text></Text>
          </Box>
        </Box>
      )
    })
    const totals = snap.files.reduce((t, f) => ({ a: t.a + f.added, r: t.r + f.removed }), { a: 0, r: 0 })
    const touchedCount = snap.files.filter(f => f.isTouched).length

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text bold color={KZ.cyan}>⎇ {snap.isDetached ? `(detached) ${snap.branch}` : snap.branch}</Text>
            {snap.upstream ? <Text dimColor> → {snap.upstream}</Text> : ''}
          </Text>
          <Box flexShrink={0} marginLeft={1}><Text>{sync}</Text></Box>
        </Box>
        {isClean
          ? (
              <Box flexDirection="row">
                <Text bold color={KZ.green}>✓ working tree clean </Text>
                <Text color={KZ.yellow}>✦</Text><Text color={KZ.magenta}> ✧</Text><Text color={KZ.cyan}> ⋆</Text>
                {snap.stash ? <Text color={KZ.violet}>  ⚑{snap.stash} stash</Text> : ''}
              </Box>
            )
          : (
              <Text wrap="truncate-end">
                {chips.filter(c => c[1] > 0).map(([g, n, label, c]) => (
                  <Text key={label}><Text bold color={c}>{g}{n}</Text><Text dimColor> {label}  </Text></Text>
                ))}
              </Text>
            )}
        {snap.head ? <Text wrap="truncate-end" dimColor>HEAD <Text color={KZ.yellow}>{snap.head.sha}</Text> {snap.head.subject}</Text> : <Text dimColor>no commits yet</Text>}
        {snap.commits.length > 0 && rule('COMMITS', `${snap.commits.length}`)}
        {commitRows}
        {snap.files.length > 0 && rule('CHANGES', `${snap.files.length} files · +${totals.a} −${totals.r}`)}
        {fileRows}
        {(touchedCount > 0 || snap.touchedClean > 0) && (
          <Box marginTop={1}>
            <Text wrap="truncate-end">
              <Text color={KZ.magenta}>✎</Text>
              <Text dimColor> touched this session: {touchedCount} changed{snap.touchedClean ? `, ${snap.touchedClean} clean or outside` : ''}</Text>
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------
// Desktop: one SVG card stack.

function altText(s: GitscopeSnap | null): string {
  if (s === null) return 'Reading git'
  if (!s.isRepo) return 'Not a git repository'
  const dirty = s.staged + s.unstaged + s.untracked + s.conflicts
  return `Branch ${s.branch}${s.upstream ? ` tracking ${s.upstream}, ${s.ahead} ahead, ${s.behind} behind` : ''}; ${dirty ? `${s.staged} staged, ${s.unstaged} changed, ${s.untracked} new, ${s.conflicts} conflicts` : 'working tree clean'}; ${s.commits.length} recent commits; ${s.files.length} changed files`
}

const CSS = `
.draw{stroke-dasharray:40;stroke-dashoffset:40;animation:kzdraw .9s ease-out .1s forwards}@keyframes kzdraw{to{stroke-dashoffset:0}}
.tw{transform-box:fill-box;transform-origin:center;animation:kztw 2.4s ease-in-out infinite}@keyframes kztw{0%,100%{opacity:.25;transform:scale(.6)}50%{opacity:1;transform:scale(1)}}
.ring{transform-box:fill-box;transform-origin:center;animation:kzring 2.2s ease-out infinite}@keyframes kzring{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(2.4)}}
.rowin{animation:kzin .5s ease-out both}@keyframes kzin{from{opacity:0;transform:translateX(-4px)}}
`

function loadingCard(W: number): { source: string; height: number } {
  const body = `<rect class="p" x="0" y="0" width="${W}" height="44" rx="12"/>` +
    `<circle cx="22" cy="22" r="6" fill="${KZ.cyan}" class="pulse"/>` + svgText(36, 26, 'Reading git…', { cls: 's', size: 12 })
  return { source: svg(W, 44, body, CSS), height: 44 }
}

function emptyCard(W: number): { source: string; height: number } {
  const H = 150
  const cx = W / 2
  const body = `<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="14"/>` +
    `<circle cx="${cx}" cy="46" r="24" fill="none" stroke="${KZ.mist}" stroke-width="1.5" stroke-dasharray="4 5" class="spin" style="animation-duration:14s"/>` +
    `<path d="M${cx - 5} 34v24M${cx - 5} 46c10 0 12-6 12-10" stroke="${KZ.mist}" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="${cx + 7}" cy="34" r="3" fill="${KZ.mist}"/>` +
    svgText(cx, 96, 'Not a git repository', { size: 14, weight: 650, anchor: 'middle' }) +
    svgText(cx, 116, 'This folder has no history yet.', { cls: 's', size: 11.5, anchor: 'middle' }) +
    svgText(cx, 134, 'Run git init to start the radar.', { cls: 'm', size: 11, anchor: 'middle', mono: true })
  return { source: svg(W, H, body, CSS), height: H }
}

function desktopCard(s: GitscopeSnap, W: number, now: number): { source: string; height: number } {
  const parts: string[] = []
  const pad = 14
  const inner = W - pad * 2
  let y = 0
  const isClean = s.staged + s.unstaged + s.untracked + s.conflicts === 0

  // Header: branch, upstream, ahead/behind, and the tree's chips.
  const hh = 82
  parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${hh}" rx="14"/>`)
  parts.push(`<path d="M${pad + 4} ${y + 14}v22M${pad + 4} ${y + 25}c9 0 11-6 11-10" stroke="${KZ.cyan}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="${pad + 15}" cy="${y + 14}" r="3.4" fill="${KZ.cyan}"/><circle cx="${pad + 4}" cy="${y + 36}" r="3.4" fill="${KZ.cyan}"/>`)
  parts.push(svgText(pad + 28, y + 24, fitText(s.isDetached ? `detached @ ${s.branch}` : s.branch, 15, inner - 130), { size: 15, weight: 700 }))
  parts.push(svgText(pad + 28, y + 41, fitText(s.upstream ? `→ ${s.upstream}` : 'no upstream · local only', 11, inner - 130), { cls: 'm', size: 11 }))
  // Ahead/behind pills on the right.
  let rx = W - pad
  const pill = (txt: string, c: string) => {
    const pw = txt.length * 7 + 16
    rx -= pw
    parts.push(`<rect x="${rx}" y="${y + 12}" width="${pw}" height="20" rx="10" fill="${c}" opacity=".16"/>`)
    parts.push(svgText(rx + pw / 2, y + 26, txt, { size: 11, weight: 700, anchor: 'middle', fill: c }))
    rx -= 6
  }
  if (s.upstream) {
    if (s.behind) pill(`↓${s.behind}`, KZ.amber)
    if (s.ahead) pill(`↑${s.ahead}`, KZ.green)
    if (!s.ahead && !s.behind) pill('≡ in sync', KZ.teal)
  }
  // Chips row.
  const chips: [string, number, string][] = [
    ['staged', s.staged, KZ.green], ['changed', s.unstaged, KZ.amber], ['new', s.untracked, KZ.blue],
    ['conflict', s.conflicts, KZ.red], ['stash', s.stash, KZ.violet],
  ]
  let cx = pad
  for (const [label, n, c] of chips) {
    if (!n) continue
    const txt = `${n} ${label}`
    const cw = txt.length * 6.4 + 18
    if (cx + cw > W - pad) break
    parts.push(`<rect x="${cx}" y="${y + 52}" width="${cw}" height="20" rx="10" fill="${c}" opacity=".16"/>`)
    parts.push(`<circle cx="${cx + 9}" cy="${y + 62}" r="3" fill="${c}"/>`)
    parts.push(svgText(cx + 15, y + 66, txt, { size: 10.5, weight: 650, fill: c }))
    cx += cw + 6
  }
  if (isClean && !s.stash) parts.push(svgText(pad, y + 66, s.head ? `HEAD ${s.head.sha} · ${s.head.subject}` : 'no commits yet', { cls: 'm', size: 10.5, mono: true }))
  y += hh + 8

  // Clean: a celebration.
  if (isClean) {
    const ch = 70
    parts.push(`<defs><linearGradient id="gsClean" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${KZ.green}" stop-opacity=".22"/><stop offset="1" stop-color="${KZ.teal}" stop-opacity=".06"/></linearGradient></defs>`)
    parts.push(`<rect x="0" y="${y}" width="${W}" height="${ch}" rx="14" fill="url(#gsClean)"/>`)
    parts.push(`<circle cx="${pad + 22}" cy="${y + ch / 2}" r="18" fill="${KZ.green}" opacity=".2"/>`)
    parts.push(`<path class="draw" d="M${pad + 13} ${y + ch / 2}l6 7 13-15" stroke="${KZ.green}" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    parts.push(svgText(pad + 52, y + ch / 2 - 2, 'Working tree clean', { size: 14.5, weight: 700, fill: KZ.green }))
    parts.push(svgText(pad + 52, y + ch / 2 + 15, s.upstream && !s.ahead && !s.behind ? 'Everything committed and pushed.' : 'Everything is committed.', { cls: 's', size: 11 }))
    const stars: [number, number, string, number][] = [[W - 46, 18, KZ.yellow, 0], [W - 26, 34, KZ.magenta, 0.6], [W - 58, 48, KZ.cyan, 1.2], [W - 34, 56, KZ.green, 1.8]]
    for (const [sx, sy, c, d] of stars) {
      parts.push(`<path class="tw" style="animation-delay:${d}s" d="M${sx} ${y + sy - 5}L${sx + 1.4} ${y + sy - 1.4}L${sx + 5} ${y + sy}L${sx + 1.4} ${y + sy + 1.4}L${sx} ${y + sy + 5}L${sx - 1.4} ${y + sy + 1.4}L${sx - 5} ${y + sy}L${sx - 1.4} ${y + sy - 1.4}Z" fill="${c}"/>`)
    }
    y += ch + 8
  }

  // Commits: a rail of dots.
  if (s.commits.length) {
    const rowH = 34
    const ch = 30 + s.commits.length * rowH
    parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${ch}" rx="14"/>`)
    parts.push(svgText(pad, y + 20, 'COMMITS', { cls: 's', size: 10.5, weight: 700 }))
    const railX = pad + 7
    const y0 = y + 30 + rowH / 2 - 4
    const y1 = y0 + (s.commits.length - 1) * rowH
    parts.push(`<defs><linearGradient id="gsRail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}"/><stop offset="1" stop-color="${KZ.violet}" stop-opacity=".15"/></linearGradient></defs>`)
    if (s.commits.length > 1) parts.push(`<rect x="${railX - 1}" y="${y0}" width="2" height="${y1 - y0}" rx="1" fill="url(#gsRail)"/>`)
    s.commits.forEach((c, i) => {
      const cy = y0 + i * rowH
      const age = now - c.at
      const tone = mix(KZ.violet, KZ.mist, Math.min(1, age / (7 * 864e5)))
      if (i === 0) parts.push(`<circle class="ring" cx="${railX}" cy="${cy}" r="6" fill="none" stroke="${KZ.violet}" stroke-width="1.5"/>`)
      parts.push(`<circle cx="${railX}" cy="${cy}" r="${i === 0 ? 5.5 : 4}" fill="${tone}"/>`)
      const tx = railX + 16
      const right = fmtAgo(age)
      parts.push(`<g class="rowin" style="animation-delay:${i * 40}ms">`)
      parts.push(svgText(tx, cy - 2, fitText(c.subject, 12, inner - 70), { size: 12, weight: i === 0 ? 650 : 450 }))
      parts.push(svgText(tx, cy + 12, `${c.sha.slice(0, 7)} · ${fitText(c.author, 10, inner / 2)}`, { cls: 'm', size: 10, mono: true }))
      parts.push(svgText(W - pad, cy + 3, right, { cls: 's', size: 10.5, weight: 600, anchor: 'end' }))
      parts.push('</g>')
    })
    y += ch + 8
  }

  // Changes: a +/− histogram per file.
  if (s.files.length) {
    const rowH = 24
    const ch = 34 + s.files.length * rowH + 6
    const totals = s.files.reduce((t, f) => ({ a: t.a + f.added, r: t.r + f.removed }), { a: 0, r: 0 })
    parts.push(`<rect class="p" x="0" y="${y}" width="${W}" height="${ch}" rx="14"/>`)
    parts.push(svgText(pad, y + 20, 'CHANGES', { cls: 's', size: 10.5, weight: 700 }))
    parts.push(svgText(pad + 62, y + 20, `${s.files.length} files`, { cls: 'm', size: 10.5 }))
    parts.push(`<text x="${W - pad}" y="${y + 20}" font-size="11" font-weight="700" text-anchor="end" font-family="${MONO}"><tspan fill="${KZ.green}">+${totals.a}</tspan><tspan fill="${KZ.red}"> −${totals.r}</tspan></text>`)
    const maxChurn = Math.max(1, ...s.files.map(f => f.added + f.removed))
    const barW = Math.max(40, Math.min(120, inner * 0.28))
    const numW = 64
    const nameW = inner - 14 - barW - numW - 8
    s.files.forEach((f, i) => {
      const ry = y + 34 + i * rowH
      const mid = ry + rowH / 2
      if (f.isTouched) parts.push(`<circle class="pulse" cx="${pad + 4}" cy="${mid}" r="3.5" fill="${KZ.magenta}"/>`)
      else parts.push(`<circle cx="${pad + 4}" cy="${mid}" r="2" fill="${f.kind === 'new' ? KZ.blue : KZ.mist}" opacity=".7"/>`)
      const { dir, name } = splitPath(f.path)
      const nameFit = fitText(name, 11.5, nameW)
      const nameWpx = Math.min(nameW, nameFit.length * 6.6)
      const dirFit = dir && nameWpx < nameW - 30 ? fitText(dir, 10.5, nameW - nameWpx - 4) : ''
      parts.push(`<text x="${pad + 14}" y="${mid + 4}" font-size="11.5" font-family="${MONO}"><tspan class="m" font-size="10.5">${xml(dirFit)}</tspan><tspan ${f.kind === 'new' ? `fill="${KZ.blue}"` : 'class="t"'} font-weight="${f.isTouched ? 700 : 500}">${xml(nameFit)}</tspan></text>`)
      const nx = W - pad - barW - 8
      if (f.kind === 'new') parts.push(svgText(nx, mid + 4, 'new', { size: 10.5, weight: 650, anchor: 'end', fill: KZ.blue }))
      else parts.push(`<text x="${nx}" y="${mid + 4}" font-size="10.5" font-weight="650" text-anchor="end" font-family="${MONO}"><tspan fill="${KZ.green}">+${f.added}</tspan><tspan fill="${KZ.red}"> −${f.removed}</tspan></text>`)
      const bx = W - pad - barW
      parts.push(`<rect class="k" x="${bx}" y="${mid - 4}" width="${barW}" height="8" rx="4"/>`)
      const aw = f.added ? Math.max(2, (f.added / maxChurn) * barW) : 0
      const rw = f.removed ? Math.max(2, (f.removed / maxChurn) * barW) : 0
      if (aw) parts.push(`<rect x="${bx}" y="${mid - 4}" width="${aw}" height="8" rx="2" fill="${KZ.green}"/>`)
      if (rw) parts.push(`<rect x="${bx + aw}" y="${mid - 4}" width="${rw}" height="8" rx="2" fill="${KZ.red}"/>`)
      if (f.kind === 'new') parts.push(`<rect x="${bx}" y="${mid - 4}" width="${barW}" height="8" rx="4" fill="${KZ.blue}" opacity=".35"/>`)
    })
    y += ch + 8
  }

  const touchedCount = s.files.filter(f => f.isTouched).length
  if (touchedCount || s.touchedClean) {
    parts.push(`<circle cx="${pad + 4}" cy="${y + 8}" r="3.5" fill="${KZ.magenta}"/>`)
    parts.push(svgText(pad + 14, y + 12, `touched this session · ${touchedCount} changed${s.touchedClean ? ` · ${s.touchedClean} clean or outside` : ''}`, { cls: 'm', size: 10.5 }))
    y += 20
  }

  return { source: svg(W, y, parts.join(''), CSS), height: y }
}
