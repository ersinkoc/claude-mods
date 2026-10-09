import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, RenderChildren, TextProps } from 'claude-code'

import type { EpilogueRecap } from '../types'
import { KZ, fitText, fmtClock, fmtTokens, fmtUsd, pxOf, svg, svgText, textWidth, toolDetail, xml } from './lib/kz.ts'
import { FAMILIES, addTool, addUsage, cleanSummary, fileList, newTally, summaryPrompt, toRecap } from './recap.ts'
import type { Family, Tally } from './recap.ts'

const PANE = 'kz-epilogue'
const TITLE = 'KOZMOS · Epilogue'
const KEEP = 20
const SUMMARY_MODEL = 'claude-haiku-5-5'

const recapsAtom = atom({ plugin: 'epilogue', key: 'recaps' } as const, [])
const shownAtom = atom({ plugin: 'epilogue', key: 'isShown' } as const, false)
const hiddenAtom = atom({ plugin: 'epilogue', key: 'isHidden' } as const, false)

let tally: Tally | null = null
let wantsSummary = false

async function costNow($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
  } catch {
    return undefined
  }
}

async function setHidden($: EngineInterface, value: boolean): Promise<void> {
  await update($, hiddenAtom, () => value)
  try {
    await $.store.set('hidden', value)
  } catch {
    // Session only.
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

async function summarize($: EngineInterface, id: string, answer: string): Promise<void> {
  let summary: string | undefined
  try {
    const r = await $.model.complete({ model: SUMMARY_MODEL, prompt: summaryPrompt(answer), maxTokens: 80, effort: 'low', timeoutMs: 20_000 })
    summary = r.isAnswered ? cleanSummary(r.text) : undefined
  } catch {
    summary = undefined
  }
  if (!summary) return
  const text = summary
  await update($, recapsAtom, list => list.map(r => (r.id === id ? { ...r, summary: text } : r)))
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    tally = null
    wantsSummary = options.aiSummary === true
    try {
      const isHidden = (await $.store.get('hidden')) === true
      await update($, hiddenAtom, () => isHidden)
    } catch {
      // Shown by default.
    }
    await $.command.register({ name: 'epilogue', description: 'KOZMOS: open the last 20 turn recaps (hide / show the band)', argumentHint: '[hide | show]', immediate: true })
    return started
  })

  on('command.run', { command: 'epilogue' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'hide' || verb === 'show') {
      await setHidden($, verb === 'hide')
      return { text: verb === 'hide' ? 'Epilogue band hidden; /epilogue still lists recaps.' : 'Epilogue band shown after each turn.' }
    }
    return { text: (await togglePane($)) ? 'Epilogue open.' : 'Epilogue closed.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, shownAtom, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    tally = newTally(e.turnId, await $.clock.now(), e.text, await costNow($))
    await update($, shownAtom, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (tally && r.usage) addUsage(tally, r.usage.model || e.model, r.usage)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (tally) {
      const failed = ran.isError === true || ran.deny !== undefined
      addTool(tally, String(e.tool), e as unknown as Record<string, unknown>, failed, toolDetail(String(e.tool), e))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (tally && (r as { agentId?: string }).agentId) tally.agents++
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || !tally) return done
    const t = tally
    tally = null
    const recap = toRecap(t, await $.clock.now(), e.durationMs, e.reason, await costNow($))
    await update($, recapsAtom, list => [...list, recap].slice(-KEEP))
    await update($, shownAtom, () => true)
    if (wantsSummary && e.answer.trim()) void summarize($, recap.id, e.answer).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // ---- the band -------------------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || e.props.isWorking) return drawn
    if (!(await read($, shownAtom)) || (await read($, hiddenAtom))) return drawn
    // Shown only once turn.complete stored a recap.
    const recaps = await read($, recapsAtom)
    const r = recaps[recaps.length - 1]!
    const { Box, Button, Text } = $.ui.resolve(e)
    const cols = Math.max(40, e.props.bodyColumns || 80)
    const hide = <Button key="epilogue-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    // The terminal draws text rows; every other surface one SVG card.
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(cols)
      const card = recapCard(r, W, { isBand: true })
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="epilogue" flexDirection="row">
            <Svg source={card.source} alt={altOf(r)} width={W} height={card.height} />
            {hide}
          </Box>
        </Box>
      )
    }

    const lines = termLines(r, cols - 3, Text)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="epilogue" flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            {lines}
          </Box>
          {hide}
        </Box>
      </Box>
    )
  })

  // ---- the pane -------------------------------------------------------------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const recaps = [...(await read($, recapsAtom))].reverse()
    const { Box, Text } = $.ui.resolve(e)
    const cols = Math.max(32, e.props.bodyColumns || 60)
    if (recaps.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={KZ.violet} bold>◆ Epilogue</Text>
          <Text dimColor>No turns yet: a recap lands here after each one.</Text>
        </Box>
      )
    }
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(cols, 60)
      return (
        <Box flexDirection="column">
          {recaps.map((r, i) => {
            const card = recapCard(r, W, { isBand: false, index: recaps.length - i })
            return <Svg key={`ep-${r.id}`} source={card.source} alt={altOf(r)} width={W} height={card.height} />
          })}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {recaps.map((r, i) => (
          <Box key={`ep-${r.id}`} flexDirection="column" marginBottom={1}>
            <Text wrap="truncate-end">
              <Text color={KZ.violet} bold>#{recaps.length - i} </Text>
              <Text dimColor>{timeOf(r.endedAt)} · </Text>
              <Text>{r.prompt ? `“${r.prompt}”` : '(continuation)'}</Text>
            </Text>
            {termLines(r, cols, Text, true)}
          </Box>
        ))}
      </Box>
    )
  })
}

// ---------------------------------------------------------------------------

type TextTag = ElementConstructor<TextProps>

function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function costLine(r: EpilogueRecap): string {
  const est = r.estUsd > 0 ? `~${fmtUsd(r.estUsd)}` : '$0'
  return r.sessionDeltaUsd !== undefined ? `${est} (session +${fmtUsd(r.sessionDeltaUsd)})` : est
}

function reasonMark(r: EpilogueRecap): string {
  return r.reason === 'aborted' ? '⏹ interrupted' : r.reason === 'error' ? '⚠ ended on an error' : r.reason === 'refusal' ? '⊘ refused' : ''
}

function altOf(r: EpilogueRecap): string {
  const tools = r.tools.map(t => `${FAMILIES[t.family as Family].label} ${t.count}`).join(', ')
  return [
    `Turn recap: ${fmtClock(r.durationMs)}`,
    `${fmtTokens(r.tokens)} tokens, ${costLine(r)}`,
    tools ? `tools ${tools}` : 'no tools',
    r.files.length ? `files ${r.files.join(', ')}` : '',
    r.agents ? `${r.agents} subagents` : '',
    r.failed.length ? `${r.failed.length} failed` : '',
    r.summary ?? '',
  ].filter(Boolean).join('; ')
}

/** One or two rows of colored text: the figures and chips, then files, agents and the one-liner. */
function termLines(r: EpilogueRecap, cols: number, Text: TextTag, isPane = false): RenderChildren[] {
  const chips = r.tools.map(t => {
    const f = FAMILIES[t.family as Family]
    return [
      <Text key={`c-${t.family}`} backgroundColor={f.color} color="#111111" bold> {f.glyph} {t.count} </Text>,
      <Text key={`s-${t.family}`}> </Text>,
    ]
  })
  const mark = reasonMark(r)
  const row1 = (
    <Text key="r1" wrap="truncate-end">
      {isPane ? null : <Text color={KZ.violet} bold>◆ </Text>}
      <Text bold>{fmtClock(r.durationMs)}</Text>
      <Text dimColor> · </Text>
      <Text color={KZ.yellow}>{costLine(r)}</Text>
      <Text dimColor> · {fmtTokens(r.tokens)} tok · </Text>
      {chips.length ? chips : <Text dimColor>no tools </Text>}
      {r.failed.length ? <Text color={KZ.red} bold>✖ {r.failed.length} failed </Text> : null}
      {mark ? <Text color={KZ.amber}>{mark}</Text> : null}
    </Text>
  )
  const bits: RenderChildren[] = []
  if (r.files.length) bits.push(<Text key="f" color={KZ.yellow}>✎ <Text dimColor>{fileList(r.files, Math.max(16, Math.floor(cols * 0.45)))}</Text></Text>)
  if (r.agents) bits.push(<Text key="a" color={KZ.violet}>◈ {r.agents} agent{r.agents === 1 ? '' : 's'}</Text>)
  if (isPane && r.failed.length) bits.push(<Text key="x" color={KZ.red}>✖ {r.failed.map(f => `${f.tool}${f.detail ? ` ${f.detail}` : ''}`).join(', ')}</Text>)
  if (r.summary) bits.push(<Text key="s" italic color={KZ.cyan}>“{r.summary}”</Text>)
  if (!bits.length) return [row1]
  const joined: RenderChildren[] = []
  bits.forEach((b, i) => {
    if (i) joined.push(<Text key={`d${i}`} dimColor> · </Text>)
    joined.push(b)
  })
  return [row1, <Text key="r2" wrap="truncate-end">{isPane ? '' : '  '}{joined}</Text>]
}

/** The recap as one SVG card: figures, family chips, files, failures and the one-liner. */
function recapCard(r: EpilogueRecap, W: number, opts: { isBand: boolean; index?: number }): { source: string; height: number } {
  const pad = 14
  const hasLine3 = Boolean(r.summary) || (!opts.isBand && Boolean(r.prompt))
  const H = hasLine3 ? 74 : 54
  const css = `
.ep-ep{animation:epIn .45s cubic-bezier(.2,.8,.2,1) both}@keyframes epIn{from{opacity:0;transform:translateY(5px)}}
.ep-chip{animation:epChip .4s cubic-bezier(.2,.8,.2,1) both}@keyframes epChip{from{opacity:0;transform:scale(.6)}}
.ep-chip{transform-box:fill-box;transform-origin:center}
.ep-shine{animation:epShine${W} 1.6s ease-out .35s both}@keyframes epShine${W}{from{transform:translateX(-160px)}to{transform:translateX(${W + 160}px)}}
.ep-accent{animation:epHue 6s linear infinite}@keyframes epHue{50%{opacity:.55}}
`
  const p: string[] = []
  p.push(`<defs><linearGradient id="epA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${KZ.violet}"/><stop offset="1" stop-color="${KZ.cyan}"/></linearGradient>` +
    `<linearGradient id="epS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="epC${W}x${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="12"/></clipPath></defs>`)
  p.push(`<g class="ep-ep">`)
  p.push(`<rect class="p" x="0" y="0" width="${W}" height="${H}" rx="12"/>`)
  p.push(`<rect class="ep-accent" x="0" y="0" width="4" height="${H}" fill="url(#epA)" clip-path="url(#epC${W}x${H})"/>`)
  // Line 1: label, duration, cost, tokens; failures and the end reason on the right.
  let x = pad
  const label = opts.index !== undefined ? `#${opts.index} · ${timeOf(r.endedAt)}` : 'EPILOGUE'
  p.push(svgText(x, 21, label, { size: 10, weight: 700, fill: KZ.violet }))
  x += textWidth(label, 10) + 12
  p.push(svgText(x, 21, fmtClock(r.durationMs), { size: 13, weight: 700, mono: true }))
  x += textWidth(fmtClock(r.durationMs), 13) + 14
  p.push(svgText(x, 21, costLine(r), { size: 12, weight: 600, fill: '#eab308' }))
  x += textWidth(costLine(r), 12) + 14
  p.push(svgText(x, 21, `${fmtTokens(r.tokens)} tokens`, { cls: 's', size: 11.5 }))
  let rx = W - pad - (opts.isBand ? 18 : 0)
  if (r.failed.length) {
    const t = `✖ ${r.failed.length} failed`
    const w = textWidth(t, 10.5) + 16
    rx -= w
    p.push(`<rect x="${rx}" y="9" width="${w}" height="17" rx="8.5" fill="${KZ.red}" opacity=".16"/>`)
    p.push(svgText(rx + w / 2, 21, t, { size: 10.5, weight: 700, anchor: 'middle', fill: KZ.red }))
    rx -= 8
  }
  const mark = reasonMark(r)
  if (mark) p.push(svgText(rx, 21, mark, { size: 10.5, weight: 600, anchor: 'end', fill: KZ.amber }))
  // Line 2: chips, files, agents.
  x = pad
  r.tools.forEach((t, i) => {
    const f = FAMILIES[t.family as Family]
    const txt = `${f.glyph} ${f.label} ${t.count}`
    const w = textWidth(txt, 10.5) + 16
    if (x + w > W - pad) return
    p.push(`<g class="ep-chip" style="animation-delay:${(0.08 + i * 0.06).toFixed(2)}s"><rect x="${x}" y="31" width="${w}" height="18" rx="9" fill="${f.color}" opacity=".2"/>` +
      svgText(x + w / 2, 44, txt, { size: 10.5, weight: 650, anchor: 'middle', fill: f.color }) + `</g>`)
    x += w + 6
  })
  if (!r.tools.length) {
    p.push(svgText(x, 44, 'no tools', { cls: 'm', size: 10.5 }))
    x += 56
  }
  const tail: string[] = []
  if (r.agents) tail.push(`◈ ${r.agents} agent${r.agents === 1 ? '' : 's'}`)
  if (r.files.length) tail.push(`✎ ${fileList(r.files, Math.max(12, Math.floor((W - x - pad) / 6.6) - 14))}`)
  if (tail.length && x < W - pad - 60) p.push(svgText(x + 6, 44, fitText(tail.join('   '), 10.5, W - pad - x - 6), { cls: 's', size: 10.5, mono: true }))
  // Line 3: the one-liner, or (in the pane) the prompt.
  if (hasLine3) {
    const body = r.summary ? `“${r.summary}”` : `› ${r.prompt}`
    p.push(`<text ${r.summary ? `fill="${KZ.cyan}"` : 'class="m"'} x="${pad}" y="64" font-size="11.5" font-style="${r.summary ? 'italic' : 'normal'}" font-family="-apple-system,'Segoe UI',sans-serif">${xml(fitText(body, 11.5, W - pad * 2))}</text>`)
  }
  p.push(`<g clip-path="url(#epC${W}x${H})"><rect class="ep-shine" x="0" y="0" width="140" height="${H}" fill="url(#epS)"/></g>`)
  p.push(`</g>`)
  return { source: svg(W, H, p.join(''), css), height: H }
}
