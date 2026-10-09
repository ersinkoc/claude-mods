import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { BreadcrumbsSnap, BreadcrumbsView, Crumb } from '../types'
import { KZ, clip, pxOf } from './lib/kz.ts'
import {
  MAX_CRUMBS, SEARCH, altOfGroup, classify, clockOf, domainColor, emptySnap, errorOutcome, fetchOutcome, fmtBytes, fmtMs,
  groupSvg, groupsOf, headerSvg, monogram, rowLabel, searchOutcome, splitUrl, statusColor, statusLabel, toMarkdown,
} from './trail.ts'

const PANE = 'kz-breadcrumbs'
const TITLE = 'KOZMOS · Breadcrumbs'
const PER_GROUP = 15
const snapAtom = atom({ plugin: 'breadcrumbs', key: 'snap' } as const, null)
const viewAtom = atom({ plugin: 'breadcrumbs', key: 'view' } as const, { folded: [] })

let live: BreadcrumbsSnap = emptySnap()
let isSeeded = false
let seq = 0
const agentNames = new Map<string, string>()

async function seed($: EngineInterface): Promise<void> {
  if (isSeeded) return
  isSeeded = true
  try {
    const kept = await read($, snapAtom)
    if (kept) live = structuredClone(kept)
  } catch {
    // Nothing kept: start empty.
  }
}

/** Every call follows a change to the trail, so each one writes. */
async function publish($: EngineInterface): Promise<void> {
  const next = structuredClone(live)
  await update($, snapAtom, () => next)
}

async function whoOf($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'main'
  const known = agentNames.get(agentId)
  if (known) return known
  try {
    for (const a of await $.agent.list()) agentNames.set(a.id, a.description || a.type)
  } catch {
    // The roster is not readable now; fall back to the id.
  }
  return agentNames.get(agentId) ?? `agent ${agentId.slice(0, 6)}`
}

async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return true
}

async function copyTrail($: EngineInterface, surface: RenderSurface): Promise<void> {
  // The copy button shows only once the trail has a step, so there is a snapshot and Markdown.
  const snap = (await read($, snapAtom)) as BreadcrumbsSnap
  const r = await $.ui.copy({ text: toMarkdown(snap), surface })
  if (r.isCopied) $.ui.toast(`Breadcrumbs: ${snap.crumbs.length} steps copied as Markdown`)
}

function put(c: Crumb): void {
  live.crumbs = [c, ...live.crumbs.filter(x => x.id !== c.id)].slice(0, MAX_CRUMBS)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = emptySnap()
    isSeeded = true
    agentNames.clear()
    await $.command.register({ name: 'breadcrumbs', description: 'KOZMOS: toggle the Breadcrumbs web-trail sidebar (/breadcrumbs md prints the trail as Markdown)', argumentHint: '[md]', immediate: true })
    await publish($).catch(() => undefined)
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'breadcrumbs' }, async ($, e) => {
    if (e.args.trim() === 'md') {
      await seed($)
      return { text: toMarkdown(live) || 'Breadcrumbs: no web steps yet.' }
    }
    return { text: (await toggle($)) ? 'Breadcrumbs open.' : 'Breadcrumbs closed.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) agentNames.set(r.agentId, e.description || e.subagentType)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const what = classify(tool, input)
    if (!what) return next(e)
    await seed($)
    const at = await $.clock.now()
    const where = what.url ? splitUrl(what.url) : { domain: SEARCH, path: undefined }
    const crumb: Crumb = {
      id: e.tool_use_id || `c${++seq}`,
      kind: what.kind,
      tool,
      at,
      domain: what.kind === 'search' ? SEARCH : where.domain,
      url: what.url,
      path: where.path,
      query: what.query,
      isRunning: true,
      isError: false,
      who: await whoOf($, e.agentId),
    }
    if (what.kind === 'search') live.searches++
    else if (what.kind === 'fetch') live.fetches++
    else live.browses++
    put(crumb)
    void publish($).catch(() => undefined)

    const ran = await next(e)
    const done: Crumb = { ...crumb, isRunning: false, ms: Math.max(0, (await $.clock.now()) - at) }
    if (ran.deny !== undefined || ran.isError) {
      const text = ran.deny ?? ran.text ?? (typeof ran.result === 'string' ? ran.result : 'failed')
      const err = errorOutcome(text)
      done.isError = true
      done.error = err.error
      done.status = err.status
      live.failures++
    } else if (what.kind === 'search') {
      const s = tool === 'WebSearch' ? searchOutcome(ran.result) : { results: undefined, hits: [] }
      done.results = s.results
      done.hits = s.hits
    } else if (what.kind === 'fetch') {
      const f = fetchOutcome(ran.result)
      done.status = f.status
      done.statusText = f.statusText
      done.bytes = f.bytes
      if (f.url && f.url !== crumb.url) {
        const moved = splitUrl(f.url)
        done.url = f.url
        done.domain = moved.domain
        done.path = moved.path
      }
    } else if (typeof ran.text === 'string') {
      done.bytes = ran.text.length
    }
    put(done)
    await publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = (await read($, snapAtom)) ?? emptySnap()
    const view: BreadcrumbsView = await read($, viewAtom)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Link } = ui
    const groups = groupsOf(snap.crumbs)
    const domains = groups.filter(g => g.domain !== SEARCH).length
    const fold = (domain: string) => update($, viewAtom, v => ({
      folded: v.folded.includes(domain) ? v.folded.filter(d => d !== domain) : [...v.folded, domain].slice(-100),
    }))
    const copyButton = snap.crumbs.length > 0
      ? <Button key="copy-md" label="⧉ copy all as Markdown" dimColor onPress={p => void copyTrail($, p.surface).catch(() => undefined)} />
      : null
    const empty = snap.crumbs.length === 0
      ? <Text key="empty" dimColor>No web steps yet. WebSearch, WebFetch and browser tools leave their trail here.</Text>
      : null
    const who = (c: Crumb) => (c.who === 'main' ? '' : ` · ◈ ${clip(c.who, 24)}`)

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns, 44)
      const head = headerSvg(snap, groups, W)
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={head.source} alt={`Breadcrumbs: ${snap.fetches} fetches, ${snap.searches} searches, ${domains} domains`} width={W} height={head.height} />
          {copyButton}
          {groups.map(g => {
            const isFolded = view.folded.includes(g.domain)
            const card = groupSvg(g, W - 44, isFolded)
            return (
              <Box key={`g-${g.domain}`} flexDirection="column">
                <Box key={`gh-${g.domain}`} flexDirection="row" alignItems="center" gap={1}>
                  <Svg key={`gs-${g.domain}`} source={card.source} alt={altOfGroup(g)} width={W - 44} height={card.height} />
                  <Button key={`fold-${g.domain}`} label={isFolded ? '▸' : '▾'} plain onPress={() => fold(g.domain)} />
                </Box>
                {!isFolded && g.crumbs.slice(0, PER_GROUP).map(c => (
                  <Box key={`c-${c.id}`} flexDirection="column" paddingLeft={2}>
                    {c.kind === 'search'
                      ? <Text key={`q-${c.id}`} wrap="truncate-end">{clockOf(c.at)} · {rowLabel(c)}{who(c)}</Text>
                      : <Link key={`l-${c.id}`} href={c.url as string} label={`${clockOf(c.at)} · ${rowLabel(c)}${who(c)}`} />}
                    {c.error ? <Text key={`e-${c.id}`} color={KZ.red} wrap="truncate-end">  {c.error}</Text> : null}
                    {(c.hits ?? []).map((hit, i) => <Link key={`h-${c.id}-${i}`} href={hit.url} label={`  ↗ ${hit.title}`} />)}
                  </Box>
                ))}
                {!isFolded && g.crumbs.length > PER_GROUP ? <Text key={`m-${g.domain}`} dimColor>  … {g.crumbs.length - PER_GROUP} more</Text> : null}
              </Box>
            )
          })}
          {empty}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={KZ.cyan}>◍ BREADCRUMBS</Text>
          <Text dimColor>{snap.crumbs.length} steps</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text color={KZ.cyan}>{snap.fetches} fetches</Text>
          <Text dimColor> · </Text>
          <Text color={KZ.violet}>{snap.searches} searches</Text>
          <Text dimColor> · </Text>
          <Text color={KZ.teal}>{domains} domains</Text>
          {snap.browses ? <Text dimColor> · {snap.browses} browser</Text> : ''}
          {snap.failures ? <Text color={KZ.red}> · {snap.failures} failed</Text> : ''}
        </Text>
        {snap.crumbs.length > 0 && (
          <Text wrap="truncate-end">
            {groups.map(g => (
              <Text key={`bar-${g.domain}`} color={domainColor(g.domain)}>{'▆'.repeat(Math.max(1, Math.round((g.crumbs.length / snap.crumbs.length) * Math.max(10, (e.props.bodyColumns || 44) - 4))))}</Text>
            ))}
          </Text>
        )}
        {copyButton}
        {groups.map(g => {
          const isFolded = view.folded.includes(g.domain)
          const color = domainColor(g.domain)
          return (
            <Box key={`g-${g.domain}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text backgroundColor={color} color="#111111" bold> {monogram(g.domain)} </Text>
                  <Text bold> {g.domain === SEARCH ? 'web search' : g.domain}</Text>
                  <Text dimColor> · {g.crumbs.length} · {clockOf(g.last)}{g.bytes ? ` · ${fmtBytes(g.bytes)}` : ''}</Text>
                  {g.failures ? <Text color={KZ.red}> · {g.failures}✖</Text> : ''}
                </Text>
                <Button key={`fold-${g.domain}`} label={isFolded ? '▸' : '▾'} plain dimColor onPress={() => fold(g.domain)} />
              </Box>
              {!isFolded && g.crumbs.slice(0, PER_GROUP).map(c => (
                <Box key={`c-${c.id}`} flexDirection="column">
                  {c.kind === 'search'
                    ? (
                      <Text wrap="truncate-end">
                        <Text dimColor>  {clockOf(c.at)} </Text>
                        <Text color={KZ.violet}>⌕ </Text>
                        <Text>“{c.query}”</Text>
                        <Text dimColor>{c.results !== undefined ? ` · ${c.results} results` : ''} · {fmtMs(c.ms)}{who(c)}</Text>
                      </Text>
                    )
                    : (
                      <Text wrap="truncate-end">
                        <Text dimColor>  {clockOf(c.at)} </Text>
                        <Text color={statusColor(c)}>{statusLabel(c).padEnd(3)} </Text>
                        {c.bytes !== undefined ? <Text dimColor>{fmtBytes(c.bytes)} </Text> : ''}
                        <Link href={c.url as string}>{`↗ ${c.path}`}</Link>
                        <Text dimColor>{who(c)}</Text>
                      </Text>
                    )}
                  {c.error ? <Text color={KZ.red} wrap="truncate-end">      └ {c.error}</Text> : null}
                  {(c.hits ?? []).map((hit, i) => (
                    <Text key={`h-${c.id}-${i}`} wrap="truncate-end">
                      <Text dimColor>        ↗ </Text>
                      <Link href={hit.url}>{hit.title}</Link>
                    </Text>
                  ))}
                </Box>
              ))}
              {!isFolded && g.crumbs.length > PER_GROUP ? <Text dimColor>  … {g.crumbs.length - PER_GROUP} more</Text> : null}
            </Box>
          )
        })}
        {empty}
      </Box>
    )
  })
}
